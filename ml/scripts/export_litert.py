"""Exports a YOLO model to LiteRT (.tflite) for the Android app and checks what the app will see.

    # Day-1 baseline, no training (COCO: vehicles + generic traffic lights, unverified colors):
    python scripts/export_litert.py --weights yolo26n.pt
    # Trained CrossWise model:
    python scripts/export_litert.py --weights runs/detect/crosswise_v1/weights/best.pt --data data/merged/data.yaml --int8

Runs on Linux x86-64 or macOS only (Ultralytics' LiteRT exporter requirement) - use Colab on Windows.
Outputs:
  * <name>.tflite       FP32, NMS-free end-to-end head [1, 300, 6]: best for the phone GPU
  * <name>_int8.tflite  INT8 weights+activations, raw head [1, 4+nc, anchors]: smaller, for CPU-only phones
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[2] / "android" / "app" / "src" / "main" / "assets" / "models"


def describe(tflite: Path) -> None:
    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(str(tflite))
    interpreter.allocate_tensors()
    for d in interpreter.get_input_details():
        print(f"   input  {d['name']}: shape={d['shape'].tolist()} dtype={d['dtype'].__name__}")
    for d in interpreter.get_output_details():
        print(f"   output {d['name']}: shape={d['shape'].tolist()} dtype={d['dtype'].__name__}")
    print(f"   size {tflite.stat().st_size / 1e6:.1f} MB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weights", default="yolo26n.pt")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--data", type=Path, help="dataset yaml: enables INT8 calibration and accuracy check")
    parser.add_argument("--int8", action="store_true", help="also export a static INT8 model (needs --data)")
    parser.add_argument("--install", action="store_true", help=f"copy the FP32 model to {ASSETS}/crosswise.tflite")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.weights)
    fp32 = Path(model.export(format="litert", imgsz=args.imgsz, nms=False))
    print(f"\nFP32 end-to-end model: {fp32}")
    describe(fp32)

    if args.data:
        print("\nAccuracy check of the exported file (should match the .pt within ~1 mAP):")
        exported = YOLO(str(fp32), task="detect")
        metrics = exported.val(data=str(args.data), imgsz=args.imgsz, split="val", plots=False)
        print(f"   mAP50-95 = {metrics.box.map:.4f}, mAP50 = {metrics.box.map50:.4f}")

    if args.int8:
        if not args.data:
            raise SystemExit("--int8 needs --data for calibration images")
        int8 = Path(YOLO(args.weights).export(
            format="litert", imgsz=args.imgsz, quantize=8, data=str(args.data), fraction=0.1,
        ))
        print(f"\nINT8 model: {int8}")
        describe(int8)

    if args.install:
        ASSETS.mkdir(parents=True, exist_ok=True)
        shutil.copy2(fp32, ASSETS / "crosswise.tflite")
        print(f"\nInstalled into the app: {ASSETS / 'crosswise.tflite'} (rebuild the app)")
    else:
        print("\nTo use it: copy the .tflite into android/app/src/main/assets/models/crosswise.tflite, "
              "or import it on the phone via Settings > Import .tflite model.")


if __name__ == "__main__":
    main()
