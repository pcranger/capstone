"""Weak-label mining: turns ImVisible's image-level phase labels into bounding boxes.

    python scripts/mine_imvisible.py --imvisible data/raw/imvisible --model runs/detect/crosswise_v0/weights/best.pt

A detector trained on box-labeled data (v0) proposes pedestrian-signal boxes; a box is kept only if its
class agrees with the human image label. Images where the detector confidently disagrees are listed in
review.csv (they are the most informative ones to fix by hand), images with no matching box are skipped.
Only the train/val splits are mined; the ImVisible test split stays untouched for eval_imvisible.py.
"""

from __future__ import annotations

import argparse
import csv
import shutil
import sys
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.classes import CANONICAL, CANONICAL_ID  # noqa: E402
from crosswise_ml.imvisible import index_images, load_labels  # noqa: E402
from crosswise_ml.yolo_io import Box, reset_output_dir, write_labels  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--imvisible", type=Path, default=Path("data/raw/imvisible"))
    parser.add_argument("--model", required=True, help="v0 detector weights (.pt)")
    parser.add_argument("--out", type=Path, default=Path("data/raw/imvisible_mined"))
    parser.add_argument("--conf", type=float, default=0.30)
    parser.add_argument("--conflict-conf", type=float, default=0.50)
    parser.add_argument("--imgsz", type=int, default=960)
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    names = model.names
    labels = [label for label in load_labels(args.imvisible) if label.split in {"train", "val"}]
    images = index_images(args.imvisible)
    reset_output_dir(args.out, args.imvisible)
    outcome = Counter()

    with (args.out.parent / f"{args.out.name}_review.csv").open("w", newline="", encoding="utf-8") as f:
        review = csv.writer(f)
        review.writerow(["file", "split", "label", "detector_says", "conf"])
        for i, label in enumerate(labels):
            path = images.get(label.file.lower())
            if path is None:
                outcome["missing_image"] += 1
                continue
            boxes: list[Box] = []
            if label.phase is not None:
                result = model.predict(str(path), conf=args.conf, imgsz=args.imgsz, verbose=False)[0]
                agree, disagree = [], []
                for (cx, cy, w, h), cls, conf in zip(
                    result.boxes.xywhn.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist(),
                ):
                    name = names[int(cls)]
                    if name == label.phase:
                        agree.append(Box(CANONICAL_ID[name], cx, cy, w, h))
                    elif name in {"ped_red", "ped_green"} and conf >= args.conflict_conf:
                        disagree.append((name, conf))
                if disagree:
                    for name, conf in disagree:
                        review.writerow([label.file, label.split, label.phase, name, f"{conf:.2f}"])
                    outcome["conflict_skipped"] += 1
                    continue
                if not agree:
                    outcome["no_box_skipped"] += 1
                    continue
                boxes = agree
                outcome[f"kept_{label.phase}"] += 1
            else:
                outcome["kept_negative"] += 1
            target = args.out / "images" / label.split / path.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            write_labels(args.out / "labels" / label.split / f"{path.stem}.txt", boxes)
            if (i + 1) % 250 == 0:
                print(f"  {i + 1}/{len(labels)} {dict(outcome)}")

    data = {"path": str(args.out.resolve()), "train": "images/train", "val": "images/val",
            "names": dict(enumerate(CANONICAL))}
    (args.out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    print(f"Done: {dict(outcome)}\nAdd {args.out} to configs/sources.yaml (role: all) and rebuild the dataset.")


if __name__ == "__main__":
    main()
