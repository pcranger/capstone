"""ImVisible Pedestrian-Traffic-Light (PTL) dataset helpers (Yu et al., 2019, MIT license).

Labels are per image: the phase of the *main* pedestrian signal plus the zebra-crossing midline.
Per the LYTNet paper, "countdown green" and "countdown blank" are both a green light with a countdown.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

MODE_TO_CANONICAL = {0: "ped_red", 1: "ped_green", 2: "ped_green", 3: "ped_green", 4: None}
CSV_SPLITS = {"training": "train", "validation": "val", "testing": "test"}


@dataclass
class PtlLabel:
    file: str
    mode: int
    split: str
    midline: tuple[int, int, int, int]  # x1, y1, x2, y2 on the 4032x3024 original
    blocked: bool

    @property
    def phase(self) -> str | None:
        return MODE_TO_CANONICAL[self.mode]


def load_labels(root: Path) -> list[PtlLabel]:
    labels = []
    for csv_split, split in CSV_SPLITS.items():
        path = root / f"{csv_split}_file.csv"
        with path.open(encoding="utf-8-sig", newline="") as f:  # files start with a BOM
            for row in csv.DictReader(f):
                labels.append(PtlLabel(
                    file=row["file"].strip(),
                    mode=int(row["mode"]),
                    split=split,
                    midline=(int(row["x1"]), int(row["y1"]), int(row["x2"]), int(row["y2"])),
                    blocked=row["block"].strip() == "blocked",
                ))
    return labels


def index_images(root: Path) -> dict[str, Path]:
    """Maps lower-cased file names to paths, wherever the archive put them."""
    index = {}
    for p in root.rglob("*"):
        if p.suffix.lower() in {".jpg", ".jpeg", ".png"}:
            index.setdefault(p.name.lower(), p)
    return index


def main_signal(result, names: dict[int, str], min_conf: float) -> tuple[str | None, float]:
    """Picks the signal the app would lock on: confident, large, near the horizontal center."""
    best, best_score = None, 0.0
    for (cx, _, _, h), cls, conf in zip(result.boxes.xywhn.tolist(), result.boxes.cls.tolist(),
                                        result.boxes.conf.tolist()):
        name = names[int(cls)]
        if name not in {"ped_red", "ped_green"} or conf < min_conf:
            continue
        score = conf * (1 - 0.8 * abs(cx - 0.5)) * min(1.0, max(0.3, h / 0.04))
        if score > best_score:
            best, best_score = (name, conf), score
    return best if best else (None, 0.0)
