"""Scores a trained model on a split without retraining — the report numbers for your reviewed own-video test set.

    python scripts/evaluate.py --model runs/detect/crosswise_v1/weights/best.pt --data data/merged/data.yaml

Your own recordings are test-only (they never train the model), so after reviewing them you do not need another
training run: rebuild the merged dataset and score the model you already have.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.report import detection_report, pick_split  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", required=True)
    parser.add_argument("--data", type=Path, default=Path("data/merged/data.yaml"))
    parser.add_argument("--split", default="test", help="falls back to val when the dataset has no such split")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--out", type=Path, help="default: <model folder>/../crosswise_report_<split>.json")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    split = pick_split(args.data, args.split)
    if split != args.split:
        print(f"[warn] {args.data} has no '{args.split}' split; scoring on '{split}' instead")
    report = detection_report(model, args.data, split, args.imgsz, args.model)
    out = args.out or Path(args.model).parents[1] / f"crosswise_report_{split}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
