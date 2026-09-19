"""Auto-labels your own crossing videos so a person only reviews labels instead of drawing boxes.

    python scripts/autolabel_video.py --videos data/videos --model runs/detect/crosswise_v1/weights/best.pt \
        --out data/raw/local_auto
    python scripts/review_labels.py make  --dataset data/raw/local_auto     # open the review.html it writes
    python scripts/review_labels.py apply --dataset data/raw/local_auto --decisions decisions.json

For each video:
  1. The trained CrossWise model tracks pedestrian signals and crosswalks through every (--vid-stride) frame.
  2. Each signal track gets one phase per stretch of time (confidence-weighted vote over +-1 s): a real signal does not
     flicker between red and green, so single-frame detector mistakes are voted away.
  3. A frame is saved every --every-ms with the smoothed signal boxes, crosswalks, and people/vehicles from a large
     COCO teacher model.
  4. Frames that deserve a human look are flagged: close to a phase change, lit color disagreeing with the phase,
     a tracked signal missing in that frame, or an open-vocabulary detector (YOLOE, text prompt) seeing a signal the
     model did not. Flags are written to autolabel_report.csv and shown in the review page.
Needs ultralytics and a GPU (Colab). Filming protocol and safety rules: docs/ROADMAP.md.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.classes import CANONICAL, CANONICAL_ID, COCO_TO_CANONICAL  # noqa: E402
from crosswise_ml.colors import classify_crop  # noqa: E402
from crosswise_ml.geometry import PixelBox, to_yolo  # noqa: E402
from crosswise_ml.temporal import TrackSample, smooth_states  # noqa: E402
from crosswise_ml.yolo_io import Box, write_labels  # noqa: E402

SIGNALS = {"ped_red", "ped_green"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".m4v"}
FLAG_NEAR_CHANGE = "near_phase_change"
FLAG_COLOR = "color_disagrees"
FLAG_GAP = "tracked_signal_missing"
FLAG_OPEN_VOCAB = "possible_missed_signal"
FLAG_SHORT = "short_or_untracked_signal"


def chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def process_video(video: Path, model, teacher, open_vocab, args, report: csv.writer) -> int:
    names = model.names
    keep = [i for i, n in names.items() if n in SIGNALS or n == "crosswalk"]
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()

    frames: list[dict] = []
    samples: dict[int, list[TrackSample]] = defaultdict(list)
    next_ms = 0.0
    results = model.track(
        source=str(video), stream=True, persist=False, tracker=args.tracker, conf=args.conf, imgsz=args.imgsz,
        vid_stride=args.vid_stride, classes=keep, verbose=False,
    )
    for i, result in enumerate(results):
        t_ms = i * args.vid_stride * 1000.0 / fps
        boxes = result.boxes
        ids = boxes.id.int().tolist() if boxes.id is not None else [None] * len(boxes)
        detections = []
        for track_id, xyxy, cls, conf in zip(ids, boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist()):
            name = names[int(cls)]
            detections.append((track_id, name, float(conf), PixelBox(*xyxy)))
            if track_id is not None and name in SIGNALS:
                samples[track_id].append(TrackSample(t_ms, name, float(conf)))
        if t_ms >= next_ms:
            next_ms = t_ms + args.every_ms
            image_path = args.out / "images" / args.split / video.stem / f"{video.stem}_{int(t_ms):08d}.jpg"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(image_path), result.orig_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            frames.append({"t_ms": t_ms, "path": image_path, "detections": detections})

    smoothed = {tid: {s.t_ms: s for s in smooth_states(ss, args.window_ms, args.change_margin_ms)} for tid, ss in samples.items()}
    spans = {tid: (min(s.t_ms for s in ss), max(s.t_ms for s in ss), len(ss)) for tid, ss in samples.items()}

    paths = [str(f["path"]) for f in frames]
    traffic: dict[str, list[Box]] = defaultdict(list)
    if teacher is not None:
        for part in chunks(paths, 16):
            for path, r in zip(part, teacher.predict(part, conf=args.teacher_conf, imgsz=args.imgsz,
                                                     classes=sorted(COCO_TO_CANONICAL), verbose=False)):
                for (cx, cy, w, h), cls in zip(r.boxes.xywhn.tolist(), r.boxes.cls.tolist()):
                    traffic[path].append(Box(CANONICAL_ID[COCO_TO_CANONICAL[int(cls)]], cx, cy, w, h))
    open_vocab_boxes: dict[str, list[PixelBox]] = defaultdict(list)
    if open_vocab is not None:
        for part in chunks(paths, 16):
            for path, r in zip(part, open_vocab.predict(part, conf=args.open_vocab_conf, imgsz=args.imgsz, verbose=False)):
                open_vocab_boxes[path] = [PixelBox(*xyxy) for xyxy in r.boxes.xyxy.tolist()]

    for frame in frames:
        t_ms, path = frame["t_ms"], frame["path"]
        image = cv2.imread(str(path))
        height, width = image.shape[:2]
        window = PixelBox(0, 0, width, height)
        flags: set[str] = set()
        boxes: list[Box] = []
        signal_boxes: list[PixelBox] = []
        present: set[int] = set()
        states: list[str] = []
        for track_id, name, conf, box in frame["detections"]:
            if name == "crosswalk":
                if conf >= args.crosswalk_conf:
                    boxes.append(Box(CANONICAL_ID["crosswalk"], *to_yolo(box, window)))
                continue
            state = name
            sample = smoothed.get(track_id, {}).get(t_ms) if track_id is not None else None
            if sample is None:
                flags.add(FLAG_SHORT)
            else:
                present.add(track_id)
                state = sample.state
                if sample.near_change:
                    flags.add(FLAG_NEAR_CHANGE)
                if spans[track_id][2] < args.min_track_samples:
                    flags.add(FLAG_SHORT)
            crop = image[int(box.y1):int(box.y2), int(box.x1):int(box.x2)]
            color = classify_crop(crop, red_max_hue=40)
            if color is not None and color != state:
                flags.add(FLAG_COLOR)
            boxes.append(Box(CANONICAL_ID[state], *to_yolo(box, window)))
            signal_boxes.append(box)
            states.append(state)
        for track_id, (start, end, count) in spans.items():
            if track_id not in present and start < t_ms < end and count >= args.min_track_samples:
                flags.add(FLAG_GAP)
        for candidate in open_vocab_boxes.get(str(path), []):
            if candidate.h >= args.min_signal_px and all(candidate.iou(b) < 0.2 for b in signal_boxes):
                flags.add(FLAG_OPEN_VOCAB)
        boxes.extend(traffic.get(str(path), []))
        write_labels(args.out / "labels" / args.split / path.parent.name / f"{path.stem}.txt", boxes)
        report.writerow([path.relative_to(args.out).as_posix(), f"{t_ms:.0f}", ";".join(sorted(flags)), " ".join(states)])
    return len(frames)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--videos", type=Path, required=True)
    parser.add_argument("--model", required=True, help="trained CrossWise .pt (classes ped_red, ped_green, crosswalk)")
    parser.add_argument("--out", type=Path, default=Path("data/raw/local_auto"))
    parser.add_argument("--split", choices=["test", "train", "val"], default="test")
    parser.add_argument("--every-ms", type=float, default=1000)
    parser.add_argument("--vid-stride", type=int, default=2)
    parser.add_argument("--imgsz", type=int, default=960)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--tracker", default="bytetrack.yaml")
    parser.add_argument("--window-ms", type=float, default=1000)
    parser.add_argument("--change-margin-ms", type=float, default=700)
    parser.add_argument("--min-track-samples", type=int, default=5)
    parser.add_argument("--crosswalk-conf", type=float, default=0.5)
    parser.add_argument("--teacher", default="yolo26x.pt", help="COCO model for people/vehicles, or 'none'")
    parser.add_argument("--teacher-conf", type=float, default=0.45)
    parser.add_argument("--open-vocab", default="yoloe-26l-seg.pt", help="YOLOE weights for the second opinion, or 'none'")
    parser.add_argument("--open-vocab-conf", type=float, default=0.15)
    parser.add_argument("--min-signal-px", type=float, default=10)
    args = parser.parse_args()

    from ultralytics import YOLO, YOLOE

    model = YOLO(args.model)
    if not SIGNALS & set(model.names.values()):
        raise SystemExit("The model has no ped_red/ped_green classes: train CrossWise first (scripts/train.py).")
    teacher = None if args.teacher == "none" else YOLO(args.teacher)
    open_vocab = None
    if args.open_vocab != "none":
        open_vocab = YOLOE(args.open_vocab)
        open_vocab.set_classes(["pedestrian traffic light", "pedestrian signal"])

    videos = sorted(p for p in args.videos.rglob("*") if p.suffix.lower() in VIDEO_EXTENSIONS)
    if not videos:
        raise SystemExit(f"No videos in {args.videos}")
    args.out.mkdir(parents=True, exist_ok=True)
    total = 0
    with (args.out / "autolabel_report.csv").open("w", newline="", encoding="utf-8") as f:
        report = csv.writer(f)
        report.writerow(["image", "t_ms", "flags", "signal_states"])
        for video in videos:
            n = process_video(video, model, teacher, open_vocab, args, report)
            total += n
            print(f"{video.name}: {n} frames")
    data = {"path": str(args.out.resolve()), "train": "images/train", "val": "images/val", "test": "images/test",
            "names": dict(enumerate(CANONICAL))}
    (args.out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    print(f"\n{total} frames labeled. Next: python scripts/review_labels.py make --dataset {args.out}")


if __name__ == "__main__":
    main()
