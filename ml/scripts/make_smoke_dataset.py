"""Builds a tiny synthetic dataset and video so the whole pipeline can be exercised without downloading anything.

    python scripts/make_smoke_dataset.py

Writes:
  data/raw/smoke/{images,labels}/{train,val}   YOLO dataset with names ped_red, ped_green, crosswalk, car
  data/videos/smoke.mp4                        red -> green -> red cycle with a looming car
  configs/sources_smoke.yaml                   source list pointing at the dataset

It is deliberately crude (flat colors, rectangles): the point is to prove that every script runs and that the formats
line up, not to train a useful model.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.yolo_io import Box, reset_output_dir, write_labels  # noqa: E402

NAMES = ["ped_red", "ped_green", "crosswalk", "car"]
RED_BGR, GREEN_BGR = (40, 40, 235), (120, 230, 60)


def render(width: int, height: int, phase: str, signal_x: float, signal_scale: float, car_size: float | None,
           car_x: float = 0.45) -> tuple[np.ndarray, list[Box]]:
    """One fake street scene: sky, road, crosswalk stripes, one pedestrian signal and (optionally) a car."""
    image = np.full((height, width, 3), 95, np.uint8)
    image[: int(height * 0.35)] = (170, 150, 130)
    boxes: list[Box] = []

    stripe_top = int(height * 0.72)
    for i in range(6):
        y1 = stripe_top + int(i * height * 0.045)
        cv2.rectangle(image, (int(width * 0.1), y1), (int(width * 0.9), y1 + int(height * 0.022)), (230, 230, 230), -1)
    boxes.append(Box(NAMES.index("crosswalk"), 0.5, (stripe_top + height * 0.14) / height / 1.0, 0.8, 0.28))

    head_w = int(width * 0.05 * signal_scale)
    head_h = int(head_w * 2.0)
    x1 = int(signal_x * width - head_w / 2)
    y1 = int(height * 0.18)
    cv2.rectangle(image, (x1, y1), (x1 + head_w, y1 + head_h), (35, 35, 35), -1)
    lamp = RED_BGR if phase == "ped_red" else GREEN_BGR
    pad = max(1, head_w // 6)
    lamp_y = y1 + pad if phase == "ped_red" else y1 + head_h // 2 + pad // 2
    cv2.rectangle(image, (x1 + pad, lamp_y), (x1 + head_w - pad, lamp_y + head_h // 2 - pad), lamp, -1)
    boxes.append(Box(NAMES.index(phase), (x1 + head_w / 2) / width, (y1 + head_h / 2) / height,
                     head_w / width, head_h / height))

    if car_size:
        car_w = int(width * car_size)
        car_h = int(car_w * 0.55)
        cx, cy = int(car_x * width), int(height * 0.6)
        cv2.rectangle(image, (cx - car_w // 2, cy - car_h // 2), (cx + car_w // 2, cy + car_h // 2), (60, 60, 160), -1)
        cv2.rectangle(image, (cx - car_w // 3, cy - car_h // 2), (cx + car_w // 3, cy), (200, 200, 210), -1)
        boxes.append(Box(NAMES.index("car"), cx / width, cy / height, car_w / width, car_h / height))
    return image, boxes


def build_dataset(out: Path, train: int, val: int, seed: int) -> None:
    reset_output_dir(out)
    rng = random.Random(seed)
    for split, count in (("train", train), ("val", val)):
        for i in range(count):
            phase = "ped_red" if i % 2 else "ped_green"
            image, boxes = render(
                640, 360, phase,
                signal_x=rng.uniform(0.25, 0.75),
                signal_scale=rng.uniform(0.8, 1.6),
                car_size=rng.choice([None, rng.uniform(0.08, 0.22)]),
                car_x=rng.uniform(0.2, 0.8),
            )
            stem = f"{split}_{i:03d}"
            path = out / "images" / split / f"{stem}.jpg"
            path.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(path), image)
            write_labels(out / "labels" / split / f"{stem}.txt", boxes)
    (out / "data.yaml").write_text(
        yaml.safe_dump({"path": str(out.resolve()), "train": "images/train", "val": "images/val",
                        "names": dict(enumerate(NAMES))}, sort_keys=False), encoding="utf-8")


def build_video(path: Path, seconds: float, fps: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (640, 360))
    if not writer.isOpened():
        raise SystemExit(f"OpenCV cannot write {path} (no mp4v encoder?)")
    frames = int(seconds * fps)
    for i in range(frames):
        t = i / fps
        phase = "ped_red" if t < seconds * 0.4 else "ped_green"
        # The car approaches between 60% and 95% of the clip: its image grows, which is what the app calls looming.
        car = None
        if seconds * 0.6 <= t <= seconds * 0.95:
            progress = (t - seconds * 0.6) / (seconds * 0.35)
            car = 0.08 + 0.35 * progress ** 2
        image, _ = render(640, 360, phase, signal_x=0.5, signal_scale=1.4, car_size=car, car_x=0.3)
        writer.write(image)
    writer.release()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=Path("data/raw/smoke"))
    parser.add_argument("--video", type=Path, default=Path("data/videos/smoke.mp4"))
    parser.add_argument("--sources", type=Path, default=Path("configs/sources_smoke.yaml"))
    parser.add_argument("--train", type=int, default=24)
    parser.add_argument("--val", type=int, default=8)
    parser.add_argument("--seconds", type=float, default=12.0)
    parser.add_argument("--fps", type=int, default=10)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    build_dataset(args.out, args.train, args.val, args.seed)
    build_video(args.video, args.seconds, args.fps)
    args.sources.parent.mkdir(parents=True, exist_ok=True)
    args.sources.write_text(yaml.safe_dump({"sources": [
        {"name": "smoke", "path": str(args.out).replace("\\", "/"), "role": "all", "has_traffic_labels": False},
    ]}, sort_keys=False), encoding="utf-8")
    print(f"dataset: {args.out}\nvideo:   {args.video}\nsources: {args.sources}")


if __name__ == "__main__":
    main()
