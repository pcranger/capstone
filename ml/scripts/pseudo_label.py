"""Adds person/vehicle boxes from a large COCO teacher to images whose source did not label traffic.

    python scripts/pseudo_label.py --data data/merged/data.yaml --teacher yolo26x.pt

Why: pedestrian-signal datasets contain cars and people that are *unlabeled*. Training on them as-is
teaches the student that vehicles are background. The teacher fills those gaps (train/val only; test
labels must stay human-made). A CSV log records every added box for the report.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.classes import CANONICAL_ID, COCO_TO_CANONICAL  # noqa: E402
from crosswise_ml.yolo_io import Box, label_path_for, read_labels, write_labels  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=Path("data/merged/data.yaml"))
    parser.add_argument("--teacher", default="yolo26x.pt", help="COCO-pretrained Ultralytics weights")
    parser.add_argument("--conf", type=float, default=0.45)
    parser.add_argument("--imgsz", type=int, default=1280, help="large input finds small, distant vehicles")
    parser.add_argument("--splits", nargs="+", default=["train", "val"])
    parser.add_argument("--dedupe-iou", type=float, default=0.5)
    parser.add_argument("--batch", type=int, default=16)
    args = parser.parse_args()

    from ultralytics import YOLO

    data = yaml.safe_load(args.data.read_text(encoding="utf-8"))
    root = Path(data["path"])
    coverage = json.loads((root / "meta" / "coverage.json").read_text(encoding="utf-8"))
    teacher = YOLO(args.teacher)
    coco_ids = sorted(COCO_TO_CANONICAL)

    targets = [
        root / rel for rel, meta in coverage.items()
        if not meta["traffic_labeled"] and Path(rel).parts[1] in args.splits
    ]
    print(f"Pseudo-labeling {len(targets)} images with {args.teacher}")
    log_path = root / "meta" / "pseudo_labels.csv"
    added_total = 0
    with log_path.open("w", newline="", encoding="utf-8") as f:
        log = csv.writer(f)
        log.writerow(["image", "class", "conf", "cx", "cy", "w", "h"])
        for start in range(0, len(targets), args.batch):
            chunk = targets[start:start + args.batch]
            results = teacher.predict(
                [str(p) for p in chunk], conf=args.conf, imgsz=args.imgsz, classes=coco_ids, verbose=False,
            )
            for image, result in zip(chunk, results):
                label_file = label_path_for(image)
                boxes = read_labels(label_file)
                added = 0
                for (cx, cy, w, h), cls, conf in zip(
                    result.boxes.xywhn.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist(),
                ):
                    canonical = CANONICAL_ID[COCO_TO_CANONICAL[int(cls)]]
                    candidate = Box(canonical, cx, cy, w, h)
                    if any(b.cls == canonical and b.iou(candidate) > args.dedupe_iou for b in boxes):
                        continue
                    boxes.append(candidate)
                    added += 1
                    log.writerow([image.relative_to(root).as_posix(), canonical, f"{conf:.3f}", cx, cy, w, h])
                if added:
                    write_labels(label_file, boxes)
                    added_total += added
            print(f"  {min(start + args.batch, len(targets))}/{len(targets)} images, {added_total} boxes added")
    print(f"Done. Log: {log_path}")


if __name__ == "__main__":
    main()
