"""Human review of auto-labels: build a keyboard-driven HTML page, then apply the decisions to the dataset."""

from __future__ import annotations

import csv
import json
import random
import shutil
from collections import Counter
from pathlib import Path

from crosswise_ml.yolo_io import IMAGE_EXTENSIONS, label_path_for, read_labels, write_labels

DECISIONS = {"accept", "reject", "flip"}


def load_flags(dataset: Path) -> dict[str, list[str]]:
    report = dataset / "autolabel_report.csv"
    if not report.exists():
        return {}
    with report.open(encoding="utf-8", newline="") as f:
        return {row["image"]: [x for x in row["flags"].split(";") if x] for row in csv.DictReader(f)}


def build_items(dataset: Path, only_flagged: bool = False, sample: int | None = None, seed: int = 0) -> list[dict]:
    flags = load_flags(dataset)
    images = sorted(p for p in (dataset / "images").rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)
    items = []
    for image in images:
        rel = image.relative_to(dataset).as_posix()
        item_flags = flags.get(rel, [])
        if only_flagged and not item_flags:
            continue
        boxes = [[b.cls, round(b.cx, 5), round(b.cy, 5), round(b.w, 5), round(b.h, 5)] for b in read_labels(label_path_for(image))]
        items.append({"img": rel, "boxes": boxes, "flags": item_flags})
    if sample is not None and sample < len(items):
        items = sorted(random.Random(seed).sample(items, sample), key=lambda it: it["img"])
    return items


def render_html(dataset_name: str, names: list[str], items: list[dict]) -> str:
    payload = json.dumps({"dataset": dataset_name, "names": names, "items": items}).replace("</", "<\\/")
    return (Path(__file__).with_name("review_template.html").read_text(encoding="utf-8")
            .replace("__DATASET_NAME__", dataset_name).replace("__DATA__", payload))


def apply_decisions(dataset: Path, decisions: dict[str, str], names: list[str], drop_unreviewed: bool = False) -> Counter:
    """accept: keep; flip: swap ped_red/ped_green in the labels, keep; reject: move out of the dataset.
    Moved files go to a sibling folder '<dataset>_removed' so nothing is deleted."""
    red, green = names.index("ped_red"), names.index("ped_green")
    removed_root = dataset.parent / f"{dataset.name}_removed"
    counts: Counter = Counter()
    images = sorted(p for p in (dataset / "images").rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)
    for image in images:
        rel = image.relative_to(dataset).as_posix()
        decision = decisions.get(rel)
        if decision is not None and decision not in DECISIONS:
            raise ValueError(f"{rel}: unknown decision '{decision}'")
        label = label_path_for(image)
        if decision == "flip":
            boxes = read_labels(label)
            for b in boxes:
                if b.cls == red:
                    b.cls = green
                elif b.cls == green:
                    b.cls = red
            write_labels(label, boxes)
        if decision == "reject" or (decision is None and drop_unreviewed):
            for path in (image, label):
                if path.exists():
                    target = removed_root / path.relative_to(dataset)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(path), str(target))
        counts[decision or "unreviewed"] += 1
    reviewed = counts["accept"] + counts["flip"] + counts["reject"]
    summary = {
        **counts,
        "reviewed": reviewed,
        "auto_label_precision": (counts["accept"] / reviewed) if reviewed else None,
        "note": "precision = frames accepted without change / frames reviewed (flip and reject count as errors)",
    }
    (dataset / "review_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return counts
