"""Reproduce bundled FLOAT32 end-to-end detection and prepare the iPhone model probe.

Optional environment: pip install ai-edge-litert pillow numpy opencv-python
Run from the repository root:
  python ml/scripts/diagnose_mobile_detector.py --image mobile/read.JPG --out ml/data/diagnostics/photo
Use --rotate180 for an intentionally incorrect-orientation comparison, never as preprocessing for normal inference.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from ai_edge_litert.interpreter import Interpreter


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--models', nargs='+', type=Path, default=[root / 'mobile/assets/models' / n for n in ('crosswise.tflite', 'yolo26n.tflite')])
    parser.add_argument('--threshold', type=float, default=0.35)
    parser.add_argument('--rotate180', action='store_true')
    args = parser.parse_args()
    if not 0 < args.threshold <= 1:
        parser.error('threshold must be in (0, 1]')
    image = ImageOps.exif_transpose(Image.open(args.image)).convert('RGB')
    if args.rotate180:
        image = image.transpose(Image.Transpose.ROTATE_180)
    rgb = np.asarray(image)
    sw, sh = image.size
    args.out.mkdir(parents=True, exist_ok=True)
    report = {'image': str(args.image), 'sourceSize': [sw, sh], 'rotated180': args.rotate180, 'threshold': args.threshold, 'models': {}}
    for path in args.models:
        model = Interpreter(model_path=str(path), num_threads=4)
        model.allocate_tensors()
        inp, = model.get_input_details()
        output, = model.get_output_details()
        shape = inp['shape'].tolist()
        if inp['dtype'] != np.float32 or len(shape) != 4 or shape[0] != 1:
            raise ValueError(f'Unsupported input: {shape}, {inp["dtype"]}')
        planar = shape[1] == 3
        height, width = shape[2:] if planar else shape[1:3]
        if (shape[1] if planar else shape[3]) != 3 or output['shape'][-1] != 6:
            raise ValueError('This diagnostic supports RGB end-to-end box models only')
        scale = min(width / sw, height / sh)
        rw, rh = round(sw * scale), round(sh * scale)
        px, py = round((width - rw) / 2 - 0.1), round((height - rh) / 2 - 0.1)
        canvas = np.full((height, width, 3), 114, dtype=np.uint8)
        canvas[py:py + rh, px:px + rw] = cv2.resize(rgb, (rw, rh), interpolation=cv2.INTER_LINEAR)
        tensor = np.ascontiguousarray(canvas.transpose(2, 0, 1)[None] if planar else canvas[None], dtype=np.float32) / 255
        model.set_tensor(inp['index'], tensor)
        model.invoke()
        head = model.get_tensor(output['index'])[0]
        if not np.isfinite(head).all():
            raise ValueError('Nonfinite model output')
        with zipfile.ZipFile(path) as archive:
            labels = json.loads(archive.read('metadata.json'))['names']
        results = []
        annotated = Image.fromarray(canvas)
        draw = ImageDraw.Draw(annotated)
        for x1, y1, x2, y2, score, cls in head:
            if score < args.threshold:
                continue
            label = labels[str(round(float(cls)))]
            box = [float(v) for v in (x1, y1, x2, y2)]
            results.append({'label': label, 'score': float(score), 'inputBox': box})
            draw.rectangle(box, outline='#00ff88', width=2)
            draw.text((box[0], max(0, box[1] - 12)), f'{label} {score:.2f}', fill='#00ff88')
        folder = args.out / path.stem
        folder.mkdir(exist_ok=True)
        annotated.save(folder / 'detections.png')
        Image.fromarray(canvas).save(folder / 'input.png')
        tensor.tofile(folder / 'probe-input.f32')
        (folder / 'probe.request.json').write_text(json.dumps({'width': sw, 'height': sh}))
        head.tofile(folder / 'desktop-head.f32')
        report['models'][path.name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'inputShape': shape,
                                      'outputShape': output['shape'].tolist(), 'detections': results}
    (args.out / 'results.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
