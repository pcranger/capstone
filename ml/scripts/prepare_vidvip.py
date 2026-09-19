"""Turns a VIDVIP download (jpg + YOLO txt side by side) into a dataset build_dataset.py can merge.

    python scripts/prepare_vidvip.py --src "<...>/vidvipo_full_2023_05_27/vidvipo_full_2023_05_27" \
        --out data/raw/vidvip_yolo

VIDVIP (Japan, sidewalk eye level, 30,471 images) labels pedestrian signals by state (signal_red / signal_blue),
crosswalks, people and vehicles, so no hand labeling and no pseudo-labels are needed.
Request access: https://tetsuakibaba.jp/project/vidvip/  (CC BY-NC-ND 4.0: research/non-commercial use,
do not redistribute modified copies).

By default only images that show a pedestrian signal or a crosswalk are kept (plus --negative-fraction of the rest as
hard negatives), and they are re-encoded at --quality: the full set is 13.5 GB, which is a long upload to Kaggle, while
the kept part is a fraction of that and carries every signal box. Pass --all --quality 0 for a verbatim copy.

The split keeps neighbouring frames of one walk together, because they are near-duplicates.
"""

from __future__ import annotations

import argparse
import hashlib
import random
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

import cv2
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.datasets import VIDVIP_NAMES  # noqa: E402
from crosswise_ml.yolo_io import Box, parse_label_line, reset_output_dir, write_labels  # noqa: E402

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
DEFAULT_KEEP = ("signal_red", "signal_blue", "crosswalk")
_FRAME_NUMBER = re.compile(r"(\d+)(?!.*\d)")     # last run of digits, e.g. img_00042 -> 42


def session_key(image: Path, src: Path, block: int) -> str:
    """The group that must not be split between train and val.

    The distribution is one flat folder of img_00001.jpg …, so consecutive frame numbers stand in for the recording:
    images are grouped in blocks of `block` frames. A download that kept per-recording folders groups by folder.
    """
    folder = image.parent.relative_to(src).as_posix()
    if folder not in ("", "."):
        return folder
    match = _FRAME_NUMBER.search(image.stem)
    return f"block{int(match.group(1)) // block:05d}" if match else image.stem


def split_for(session: str, val_fraction: float) -> str:
    bucket = int(hashlib.sha1(session.encode()).hexdigest(), 16) % 1000
    return "val" if bucket < val_fraction * 1000 else "train"


def prepare(src: Path, out: Path, val_fraction: float, keep: set[str], negative_fraction: float,
            quality: int, block: int, seed: int = 0) -> Counter:
    reset_output_dir(out, src)
    keep_ids = {VIDVIP_NAMES.index(name) for name in keep if name in VIDVIP_NAMES}
    rng = random.Random(seed)
    counts: Counter = Counter()
    images = sorted(p for p in src.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)
    for image in images:
        label = image.with_suffix(".txt")
        if not label.exists():
            counts["no_label_file"] += 1
            continue
        boxes: list[Box] = []
        for line in label.read_text(encoding="utf-8", errors="ignore").splitlines():
            box = parse_label_line(line)
            if box is None:
                continue
            if box.cls < len(VIDVIP_NAMES):  # ids 0-16 mean the same in every VIDVIP class list
                boxes.append(box)
            else:
                counts["other_classes_dropped"] += 1
        if keep_ids and not keep_ids & {b.cls for b in boxes}:
            if rng.random() >= negative_fraction:
                counts["skipped_nothing_of_interest"] += 1
                continue
            counts["negatives_kept"] += 1

        session = session_key(image, src, block)
        split = split_for(session, val_fraction)
        stem = (session + "__" + image.stem).replace("/", "__")
        target = out / "images" / split / f"{stem}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        if quality:
            frame = cv2.imread(str(image))
            if frame is None:
                counts["unreadable"] += 1
                continue
            cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        else:
            shutil.copy2(image, target.with_suffix(image.suffix.lower()))
        write_labels(out / "labels" / split / f"{stem}.txt", boxes)
        counts[f"images_{split}"] += 1
        for box in boxes:
            counts[VIDVIP_NAMES[box.cls]] += 1
    data = {"path": str(out.resolve()), "train": "images/train", "val": "images/val",
            "names": dict(enumerate(VIDVIP_NAMES))}
    out.mkdir(parents=True, exist_ok=True)
    (out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", type=Path, required=True, help="folder with the .jpg and .txt files")
    parser.add_argument("--out", type=Path, default=Path("data/raw/vidvip_yolo"))
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--keep-classes", nargs="+", default=list(DEFAULT_KEEP),
                        help=f"keep images showing any of these VIDVIP classes (default: {' '.join(DEFAULT_KEEP)})")
    parser.add_argument("--all", action="store_true", help="keep every image (13.5 GB of source)")
    parser.add_argument("--negative-fraction", type=float, default=0.05,
                        help="share of the other images kept as hard negatives")
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality for the copies; 0 copies the originals")
    parser.add_argument("--block", type=int, default=200, help="frames per group when the source is one flat folder")
    args = parser.parse_args()

    counts = prepare(args.src, args.out, args.val_fraction, set() if args.all else set(args.keep_classes),
                     args.negative_fraction, args.quality, args.block)
    for key in ["images_train", "images_val", "signal_red", "signal_blue", "crosswalk", "person", "car", "motorbike",
                "negatives_kept", "skipped_nothing_of_interest", "no_label_file", "unreadable",
                "other_classes_dropped"]:
        print(f"{key:>28}: {counts[key]}")
    size = sum(p.stat().st_size for p in args.out.rglob("*.jpg")) / 1e9
    print(f"{'size on disk':>28}: {size:.2f} GB")
    print(f"\nWrote {args.out / 'data.yaml'}. Add to configs/sources.yaml:\n"
          "  - name: vidvip\n    path: data/raw/vidvip_yolo\n    role: all\n    has_traffic_labels: true\n"
          "    class_map: {signal_red: ped_red, signal_blue: ped_green, traffic_light: null, bicycler: bicycle}")


if __name__ == "__main__":
    main()
