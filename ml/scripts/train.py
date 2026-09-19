"""Trains the CrossWise detector (YOLO26n by default) and reports the safety-relevant confusions.

    python scripts/train.py --data data/merged/data.yaml --name crosswise_v1
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
    parser.add_argument("--data", type=Path, default=Path("data/merged/data.yaml"))
    parser.add_argument("--model", default="yolo26n.pt", help="start weights: yolo26n.pt (fast) or yolo26s.pt")
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--name", default="crosswise_v1")
    parser.add_argument("--project", default="runs/detect")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=30,
        cos_lr=True,
        close_mosaic=15,
        # Color IS the label for pedestrian signals: never shift hue (red <-> green) during augmentation.
        hsv_h=0.0,
        hsv_s=0.5,
        hsv_v=0.4,
        fliplr=0.5,
        scale=0.5,
        degrees=0.0,
        mosaic=1.0,
        # Absolute: Ultralytics re-roots a relative project under its own runs_dir setting, which on a fresh
        # machine turns runs/detect into <runs_dir>/detect/runs/detect and hides the weights from later steps.
        project=str(Path(args.project).resolve()),
        name=args.name,
        exist_ok=True,
        seed=0,
    )
    run_dir = Path(getattr(model.trainer, "save_dir", Path(args.project) / args.name))
    best_path = Path(getattr(model.trainer, "best", run_dir / "weights" / "best.pt"))
    if not best_path.exists():
        raise SystemExit(f"Training finished but {best_path} is missing")

    best = YOLO(str(best_path))
    report = detection_report(best, args.data, pick_split(args.data), args.imgsz, str(best_path))
    out = run_dir / "crosswise_report.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nNext: python scripts/export_litert.py --weights {best_path} --data {args.data}")


if __name__ == "__main__":
    main()
