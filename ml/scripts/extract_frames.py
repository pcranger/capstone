"""Extracts sharp frames from crossing videos (e.g. to inspect footage or feed an external labeling tool).

    python scripts/extract_frames.py --videos data/videos --out data/raw/local/unlabeled --every-ms 700

You normally do not need this: scripts/autolabel_video.py reads the videos directly, labels them automatically and
scripts/review_labels.py lets a person accept / flip / reject each frame instead of drawing boxes.
Recording protocol (see docs/ROADMAP.md): a sighted team member films from the curb, phone upright at chest height,
covering red->green transitions, flashing phases, night, rain and several intersections.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2


def sharpness(frame) -> float:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--videos", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--every-ms", type=int, default=700)
    parser.add_argument("--min-sharpness", type=float, default=60.0, help="skip motion-blurred frames")
    parser.add_argument("--max-side", type=int, default=1280)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    videos = sorted(p for p in args.videos.rglob("*") if p.suffix.lower() in {".mp4", ".mov", ".mkv", ".avi"})
    for video in videos:
        cap = cv2.VideoCapture(str(video))
        next_ms, saved, skipped = 0.0, 0, 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = cap.get(cv2.CAP_PROP_POS_MSEC)
            if t < next_ms:
                continue
            next_ms = t + args.every_ms
            if sharpness(frame) < args.min_sharpness:
                skipped += 1
                continue
            h, w = frame.shape[:2]
            scale = args.max_side / max(h, w)
            if scale < 1:
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(args.out / f"{video.stem}_{int(t):08d}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            saved += 1
        cap.release()
        print(f"{video.name}: saved {saved}, skipped {skipped} blurry")


if __name__ == "__main__":
    main()
