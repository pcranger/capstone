"""Reading and writing YOLO-format datasets."""

from __future__ import annotations

import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml


def _path_key(path: Path) -> str:
    key = str(path.resolve())
    # Windows and (by default) macOS disks are case-insensitive: data/raw/dtld IS data/raw/DTLD there.
    return key.lower() if os.name == "nt" or sys.platform == "darwin" else key


def reset_output_dir(out: Path, *scanned_inputs: Path, nested_ok: tuple[Path, ...] = ()) -> None:
    """Deletes and recreates an output folder without ever touching input data.

    Refuses when the output equals or contains any input (deleting it would delete the input). For folders the script
    scans recursively (``scanned_inputs``) it also refuses an output inside them, which would be re-read as input.
    ``nested_ok`` inputs (e.g. the folder of a single label file) may contain the output.
    """
    out_key = _path_key(out)
    for source in (*scanned_inputs, *nested_ok):
        src_key = _path_key(source)
        inside_input = out_key.startswith(src_key + os.sep) and source not in nested_ok
        if out_key == src_key or src_key.startswith(out_key + os.sep) or inside_input:
            raise SystemExit(f"Refusing to overwrite '{out}': it overlaps the input '{source}'. Choose a different --out.")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class Box:
    cls: int
    cx: float
    cy: float
    w: float
    h: float

    def to_line(self) -> str:
        return f"{self.cls} {self.cx:.6f} {self.cy:.6f} {self.w:.6f} {self.h:.6f}"

    def iou(self, other: "Box") -> float:
        ax1, ay1, ax2, ay2 = self.cx - self.w / 2, self.cy - self.h / 2, self.cx + self.w / 2, self.cy + self.h / 2
        bx1, by1 = other.cx - other.w / 2, other.cy - other.h / 2
        bx2, by2 = other.cx + other.w / 2, other.cy + other.h / 2
        iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
        ih = max(0.0, min(ay2, by2) - max(ay1, by1))
        inter = iw * ih
        union = self.w * self.h + other.w * other.h - inter
        return inter / union if union > 0 else 0.0


def parse_label_line(line: str) -> Box | None:
    """Parses 'cls cx cy w h' or a segmentation polygon 'cls x1 y1 x2 y2 ...' (converted to its bounding box)."""
    parts = line.split()
    if len(parts) < 5:
        return None
    cls = int(float(parts[0]))
    values = [float(v) for v in parts[1:]]
    if len(values) == 4:
        cx, cy, w, h = values
    else:
        xs, ys = values[0::2], values[1::2]
        x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
        cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
    if w <= 0 or h <= 0:
        return None
    return Box(cls, cx, cy, w, h)


def read_labels(path: Path) -> list[Box]:
    if not path.exists():
        return []
    boxes = []
    for line in path.read_text(encoding="utf-8").splitlines():
        box = parse_label_line(line)
        if box is not None:
            boxes.append(box)
    return boxes


def write_labels(path: Path, boxes: list[Box]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(b.to_line() + "\n" for b in boxes), encoding="utf-8")


def read_names(data_yaml: Path) -> list[str]:
    data = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    names = data["names"]
    if isinstance(names, dict):
        return [names[k] for k in sorted(names, key=int)]
    return list(names)


def label_path_for(image: Path) -> Path:
    """Ultralytics convention: .../images/... -> .../labels/..., extension .txt."""
    parts = list(image.parts)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "images":
            parts[i] = "labels"
            break
    return Path(*parts).with_suffix(".txt")


def split_of(image: Path, root: Path) -> str:
    """Infers the split from Roboflow ('train/images') or Ultralytics ('images/train') layouts."""
    rel = [p.lower() for p in image.relative_to(root).parts]
    for part in rel:
        if part in {"train", "training"}:
            return "train"
        if part in {"valid", "val", "validation"}:
            return "val"
        if part in {"test", "testing"}:
            return "test"
    return "unsplit"


def list_images(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS and "images" in p.parts)


def group_key(image: Path) -> str:
    """Roboflow augmentations of one photo share the stem before '.rf.'; keep them in one split."""
    stem = image.name
    return stem.split(".rf.")[0] if ".rf." in stem else image.stem
