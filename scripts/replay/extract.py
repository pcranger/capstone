"""Video -> per-frame detections + vehicle flow, in the shape the app's JS engine consumes.

Ports, line for line where it can:
  CameraSurface.tsx processFrame  (letterbox 'contain', gray 114 bars, RGB 0..1 planar, decode at min(.08, threshold),
                                   non-vehicle classes kept only at score >= scoreThreshold 0.35)
  src/perception/yoloDecoder.ts   (decodeRaw channels-first, per-class NMS 0.5, max 100)
  src/perception/pixels.ts        (motionLuma 384 px upright luma from the letterboxed tensor, meanLuminance)
  VehicleFlow.kt                  (goodFeaturesToTrack + pyramidal LK, forward/back check < 1 px)

Run with the venv:  .replay-venv/Scripts/python scripts/replay/extract.py VIDEO --out OUT.json [--fps 5] [--png-at 12,30]
Differences from the phone are listed in scripts/replay/README.md.
"""
import argparse
import json
import zipfile
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

MODEL = Path(__file__).resolve().parents[2] / 'assets' / 'models' / 'crosswise-416.tflite'
SCORE_THRESHOLD = 0.35  # src/settings/settings.ts DEFAULT scoreThreshold
IOU = 0.5
VEHICLES = {'bicycle', 'motorcycle', 'car', 'bus', 'truck'}  # CameraSurface vehicleClasses (via labelMapper)


def letterbox_of(sw, sh, dw, dh):
    scale = min(dw / sw, dh / sh)
    scw, sch = round(sw * scale), round(sh * scale)
    return dict(sw=sw, sh=sh, dw=dw, dh=dh, scale=scale, scw=scw, sch=sch, padx=(dw - scw) / 2, pady=(dh - sch) / 2)


def preprocess(bgr, lb):
    """Resize (bilinear) into the middle of a gray-114 square; RGB float 0..1, planar (NCHW)."""
    rgb = cv2.cvtColor(cv2.resize(bgr, (lb['scw'], lb['sch']), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB)
    canvas = np.full((lb['dh'], lb['dw'], 3), 114, np.uint8)
    x0, y0 = int(lb['padx']), int(lb['pady'])
    canvas[y0:y0 + lb['sch'], x0:x0 + lb['scw']] = rgb
    return canvas.astype(np.float32) / 255.0  # HWC, 0..1


def decode(out, lb, threshold):
    """yoloDecoder.decodeCandidates, RAW_CHANNELS_FIRST. out is [channels, anchors]."""
    channels, anchors = out.shape
    # units: only the first 512 anchors are probed, exactly as in decodeRaw
    probe = min(anchors, 512)
    max_coord = max(out[0, :probe].max(), out[1, :probe].max(), 0)
    ux = lb['dw'] if max_coord <= 2 else 1
    uy = lb['dh'] if max_coord <= 2 else 1
    scores = out[4:]
    best = scores.argmax(0)
    best_score = scores.max(0)
    cands = []
    for i in np.nonzero(best_score > threshold)[0]:
        cx, cy, w, h = out[0, i] * ux, out[1, i] * uy, out[2, i] * ux, out[3, i] * uy
        left = np.clip((cx - w / 2 - lb['padx']) / lb['scale'] / lb['sw'], 0, 1)
        top = np.clip((cy - h / 2 - lb['pady']) / lb['scale'] / lb['sh'], 0, 1)
        right = np.clip((cx + w / 2 - lb['padx']) / lb['scale'] / lb['sw'], 0, 1)
        bottom = np.clip((cy + h / 2 - lb['pady']) / lb['scale'] / lb['sh'], 0, 1)
        if (right - left) * (bottom - top) > 0:
            cands.append((float(left), float(top), float(right), float(bottom), int(best[i]), float(best_score[i])))
    return sorted(nms(cands), key=lambda c: -c[5])[:100]


def iou(a, b):
    ix = min(a[2], b[2]) - max(a[0], b[0])
    iy = min(a[3], b[3]) - max(a[1], b[1])
    if ix <= 0 or iy <= 0:
        return 0.0
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return 0.0 if union <= 0 else inter / union


def nms(cands):
    kept = []
    for cls in {c[4] for c in cands}:
        group = sorted((c for c in cands if c[4] == cls), key=lambda c: -c[5])
        removed = [False] * len(group)
        for i, c in enumerate(group):
            if removed[i]:
                continue
            kept.append(c)
            for j in range(i + 1, len(group)):
                if not removed[j] and iou(group[j], c) > IOU:
                    removed[j] = True
    return kept


def motion_luma(tensor, lb):
    """pixels.motionLuma: upright, unletterboxed luma, 384 px on the long side, sampled from the model tensor."""
    s = 384 / max(lb['sw'], lb['sh'])
    w, h = max(32, round(lb['sw'] * s)), max(32, round(lb['sh'] * s))
    px = np.minimum(lb['dw'] - 1, np.floor(lb['padx'] + (np.arange(w) + .5) / w * lb['scw'])).astype(int)
    py = np.minimum(lb['dh'] - 1, np.floor(lb['pady'] + (np.arange(h) + .5) / h * lb['sch'])).astype(int)
    rgb = tensor[py][:, px]
    return np.round(255 * (.299 * rgb[..., 0] + .587 * rgb[..., 1] + .114 * rgb[..., 2])).astype(np.uint8)


def mean_luminance(tensor, lb):
    """pixels.meanLuminance."""
    step = max(1, round(lb['scw'] / 45))
    x0, y0 = int(np.ceil(lb['padx'])), int(np.ceil(lb['pady']))
    x1, y1 = int(np.floor(lb['padx'] + lb['scw'])), int(np.floor(lb['pady'] + lb['sch']))
    sub = tensor[y0:y1:step, x0:x1:step]
    return float(((sub[..., 0] * 77 + sub[..., 1] * 150 + sub[..., 2] * 29) / 256).mean()) if sub.size else .5


def flow(before, after, regions):
    """VehicleFlow.track: LK from `after` to `before` (so dx = p - q), vehicle regions first, then the rest."""
    h, w = after.shape
    background = np.full((h, w), 255, np.uint8)
    selected, cells = [], set()

    def collect(mask, limit):
        pts = cv2.goodFeaturesToTrack(after, limit, .01, 5.0, mask=mask, blockSize=3, useHarrisDetector=False, k=.04)
        for x, y in ([] if pts is None else pts[:, 0]):
            if x < 8 or y < 8 or x >= w - 8 or y >= h - 8:
                continue
            cell = (int(x / 5), int(y / 5))
            if cell not in cells:
                cells.add(cell)
                selected.append((x, y))

    for l, t, r, b in regions[:12]:
        left = min(max(int(l * w), 0), w - 1)
        top = min(max(int(t * h), 0), h - 1)
        right = min(max(int(r * w), left + 1), w)
        bottom = min(max(int(b * h), top + 1), h)
        mask = np.zeros((h, w), np.uint8)
        mask[top:bottom, left:right] = 255
        collect(mask, 20)
        background[top:bottom, left:right] = 0
    collect(background, 160)
    pts = selected[:400]
    if len(pts) < 6:
        return []
    xy = np.array(pts, np.float32).reshape(-1, 1, 2)
    args = dict(winSize=(15, 15), maxLevel=2, criteria=(cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 20, .01))
    q, ok1, _ = cv2.calcOpticalFlowPyrLK(after, before, xy, None, **args)
    back, ok2, _ = cv2.calcOpticalFlowPyrLK(before, after, q, None, **args)
    keep = (ok1[:, 0] > 0) & (ok2[:, 0] > 0) & (np.linalg.norm(xy[:, 0] - back[:, 0], axis=1) < 1.0)
    return [dict(x=float(p[0] / w), y=float(p[1] / h), dx=float(p[0] - f[0]), dy=float(p[1] - f[1]))
            for p, f in zip(xy[keep, 0], q[keep, 0])]


def annotate(bgr, boxes):
    img = bgr.copy()
    h, w = img.shape[:2]
    for b in boxes:
        l, t, r, bt = b['box']
        colour = (0, 200, 0) if b['label'] in VEHICLES else (200, 120, 0)
        cv2.rectangle(img, (int(l * w), int(t * h)), (int(r * w), int(bt * h)), colour, 2)
        cv2.putText(img, f"{b['label']} {b['score']:.2f}", (int(l * w), max(12, int(t * h) - 4)),
                    cv2.FONT_HERSHEY_SIMPLEX, .5, colour, 1, cv2.LINE_AA)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('--out', required=True)
    ap.add_argument('--fps', type=float, default=5.0,
                    help='frames per second fed to the engine; 5 = scripts/benchmark_vehicle_flow.py (phone runs 3-17)')
    ap.add_argument('--png-at', default='', help='comma list of seconds; saves annotated frames (t-0.6, t, t+0.6 side by side)')
    args = ap.parse_args()

    names = json.loads(zipfile.ZipFile(MODEL).read('metadata.json'))['names']
    labels = [names[str(i)] for i in range(len(names))]
    interp = Interpreter(model_path=str(MODEL))
    interp.allocate_tensors()
    inp, outd = interp.get_input_details()[0], interp.get_output_details()[0]
    assert list(inp['shape']) == [1, 3, 416, 416] and list(outd['shape']) == [1, 13, 3549], 'unexpected model layout'
    cv2.setNumThreads(2)

    cap = cv2.VideoCapture(args.video)
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    png_at = [float(s) for s in args.png_at.split(',') if s.strip()]
    wanted_png = {round(t * src_fps) + d: (t, k) for t in png_at for k, d in enumerate((-round(.6 * src_fps), 0, round(.6 * src_fps)))}
    strips = {}

    frames, previous, idx, next_t = [], None, 0, 0.0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        t = idx / src_fps
        take = t + 1e-9 >= next_t
        if not take and idx not in wanted_png:
            idx += 1
            continue
        h, w = bgr.shape[:2]
        lb = letterbox_of(w, h, 416, 416)
        tensor = preprocess(bgr, lb)
        found = []
        if take or idx in wanted_png:
            interp.set_tensor(inp['index'], np.ascontiguousarray(tensor.transpose(2, 0, 1)[None]))
            interp.invoke()
            head = interp.get_tensor(outd['index'])[0]
            for l, tp, r, b, c, s in decode(head, lb, min(.08, SCORE_THRESHOLD)):
                if labels[c] not in VEHICLES and s < SCORE_THRESHOLD:
                    continue
                found.append(dict(cls=c, label=labels[c], score=round(s, 4), box=[round(l, 5), round(tp, 5), round(r, 5), round(b, 5)]))
        if idx in wanted_png:
            sec, k = wanted_png[idx]
            strips.setdefault(sec, {})[k] = annotate(bgr, found)
        if take:
            next_t += 1.0 / args.fps
            gray = motion_luma(tensor, lb)
            regions = [b['box'] for b in found if b['label'] in VEHICLES]
            fl = flow(previous, gray, regions) if previous is not None and previous.shape == gray.shape else []
            frames.append(dict(t_ms=round(t * 1000), frameWidth=w, frameHeight=h, brightness=round(mean_luminance(tensor, lb), 4),
                               motionWidth=int(gray.shape[1]), motionHeight=int(gray.shape[0]),
                               flowFromMs=frames[-1]['t_ms'] if previous is not None and previous.shape == gray.shape else None,
                               boxes=found, flow=fl))
            previous = gray
        idx += 1
    cap.release()

    out_path.write_text(json.dumps(dict(video=str(Path(args.video).resolve()), srcFps=src_fps, fps=args.fps,
                                       labels=labels, frames=frames)))
    for sec, parts in strips.items():
        if len(parts) == 3:
            cv2.imwrite(str(out_path.with_name(f'{out_path.stem}.t{sec:g}s.png')),
                        cv2.hconcat([cv2.resize(parts[k], None, fx=.7, fy=.7) for k in (0, 1, 2)]))
    cars = sum(1 for f in frames for b in f['boxes'] if b['label'] in VEHICLES)
    print(f'{len(frames)} frames at {args.fps} fps, {cars} vehicle boxes, '
          f'{sum(len(f["flow"]) for f in frames) // max(1, len(frames))} flow points/frame -> {out_path}')


if __name__ == '__main__':
    main()
