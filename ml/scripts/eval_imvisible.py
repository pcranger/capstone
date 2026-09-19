"""Image-level phase accuracy on the ImVisible PTL test split, comparable to LYTNet (Yu et al., 2019).

    python scripts/eval_imvisible.py --model runs/detect/crosswise_v1/weights/best.pt

The signal is chosen like the app does (confident, large, centered). The safety-critical number is
the red->green error: a "walk" answer for a "don't walk" signal.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.imvisible import index_images, load_labels, main_signal  # noqa: E402

PHASES = ["ped_red", "ped_green", "none"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--imvisible", type=Path, default=Path("data/raw/imvisible"))
    parser.add_argument("--model", required=True, help=".pt or exported .tflite")
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--out", type=Path, default=Path("runs/eval_imvisible.json"))
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    images = index_images(args.imvisible)
    confusion: Counter = Counter()
    for label in (lab for lab in load_labels(args.imvisible) if lab.split == "test"):
        path = images.get(label.file.lower())
        if path is None:
            continue
        result = model.predict(str(path), conf=args.conf, imgsz=args.imgsz, verbose=False)[0]
        predicted, _ = main_signal(result, model.names, args.conf)
        confusion[(label.phase or "none", predicted or "none")] += 1

    total = sum(confusion.values())
    correct = sum(v for (t, p), v in confusion.items() if t == p)
    print(f"\nImVisible test images: {total}, accuracy {correct / max(total, 1):.3f}")
    header = "true/pred"
    print(f"{header:<12}" + "".join(f"{p:>11}" for p in PHASES))
    for t in PHASES:
        print(f"{t:<12}" + "".join(f"{confusion[(t, p)]:>11}" for p in PHASES))
    red_total = sum(confusion[("ped_red", p)] for p in PHASES)
    green_total = sum(confusion[("ped_green", p)] for p in PHASES)
    report = {
        "images": total,
        "accuracy": correct / max(total, 1),
        "red_called_green_rate": confusion[("ped_red", "ped_green")] / max(red_total, 1),
        "green_called_red_rate": confusion[("ped_green", "ped_red")] / max(green_total, 1),
        "red_recall": confusion[("ped_red", "ped_red")] / max(red_total, 1),
        "green_recall": confusion[("ped_green", "ped_green")] / max(green_total, 1),
        "confusion": {f"{t}->{p}": confusion[(t, p)] for t in PHASES for p in PHASES},
    }
    print(f"\nSAFETY: red called green = {report['red_called_green_rate']:.3%} "
          f"(single frames; the app's temporal filter lowers this further)")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
