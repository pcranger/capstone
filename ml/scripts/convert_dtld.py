"""Converts DTLD pedestrian traffic lights (red/green) into a YOLO dataset.

    python scripts/convert_dtld.py --dtld data/raw/DTLD --labels data/raw/DTLD/DTLD_labels_v2.0 --out data/raw/dtld_yolo

DTLD (11 German cities, car-mounted camera, 15 Hz) labels every traffic light with a pictogram (pedestrian,
circle, arrow, ...) and a state (red, green, off, ...). Register via
https://www.uni-ulm.de/en/in/institute-of-measurement-control-and-microtechnology/research/data-sets/driveu-traffic-light-dataset/
(research and teaching use). The city archives total ~143 GB: download the labels first and run
`scripts/dtld_plan.py` to see which cities are worth it. Images that are not on disk are simply skipped.

What the conversion does:
  * keeps pedestrian lights with state red/green; 'off' heads stay unlabeled (a dark head is background);
    images where a visible pedestrian light has an unknown state are skipped;
  * skips frames whose biggest lit pedestrian light is under --min-height: filmed from a car, many are a handful
    of pixels, and every lit light in a kept frame is labeled whatever its size;
  * keeps a fraction of images that contain only vehicle lights: they teach the model NOT to call a
    vehicle signal a pedestrian signal (vehicle lights are never labeled);
  * takes every Nth frame of a sequence (15 Hz frames are near-duplicates);
  * crops a window around the pedestrian lights so they stay large after the 640 px training resize;
  * debayers the 12-bit raw TIFFs to 8-bit JPEG;
  * splits by city (--val-cities, default Fulda) so train and val never share an intersection.
Cars and people are NOT labeled in DTLD: keep has_traffic_labels: false so pseudo_label.py fills them in.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

import cv2
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.classes import CANONICAL, CANONICAL_ID  # noqa: E402
from crosswise_ml.datasets import debayer_dtld, dtld_decide, dtld_labels, dtld_relative_image_path  # noqa: E402
from crosswise_ml.geometry import crop_window, to_yolo, visible_fraction  # noqa: E402
from crosswise_ml.yolo_io import Box, reset_output_dir, write_labels  # noqa: E402

_INDEX: dict[Path, dict[str, Path]] = {}


def resolve_image(dtld_root: Path, rel: str) -> Path | None:
    """Finds City/Route/Sequence/file.tiff under the download.

    The city archives unpack differently depending on the unzip tool: Bochum.zip usually ends up as
    <root>/Bochum/Bochum/Bochum1/..., so the path in the label file is one level deeper than the root.
    """
    city = rel.split("/", 1)[0]
    for candidate in (dtld_root / rel, dtld_root / city / rel, dtld_root / city / city / rel):
        if candidate.exists():
            return candidate
    index = _INDEX.get(dtld_root / city)     # last resort: index the city folder once, match on file name
    if index is None:
        folder = dtld_root / city
        index = {p.name: p for p in folder.rglob("*.tiff")} if folder.is_dir() else {}
        _INDEX[dtld_root / city] = index
    return index.get(rel.rsplit("/", 1)[-1])


def convert(
    dtld_root: Path,
    label_files: list[Path],
    out: Path,
    stride: int,
    negative_fraction: float,
    min_height: float,
    crop: int,
    val_cities: set[str],
    seed: int = 0,
) -> Counter:
    reset_output_dir(out, dtld_root, nested_ok=tuple({f.parent for f in label_files}))
    rng = random.Random(seed)
    counts: Counter = Counter()
    sequence_index: Counter = Counter()
    for label_file in label_files:
        data = json.loads(label_file.read_text(encoding="utf-8"))
        for image_dict in data["images"]:
            rel = dtld_relative_image_path(image_dict["image_path"])
            city, _route, sequence, filename = rel.split("/")
            n = sequence_index[sequence]
            sequence_index[sequence] += 1
            if n % stride:
                continue
            decision = dtld_decide(dtld_labels(image_dict), min_height)
            if not decision.usable:
                counts["skipped_unknown_state"] += 1
                continue
            if decision.too_small:
                counts["skipped_tiny_signal"] += 1
                continue
            if not decision.boxes:
                if not (decision.has_other_lights and rng.random() < negative_fraction):
                    continue
                counts["negatives_vehicle_lights_only"] += 1
            image_path = resolve_image(dtld_root, rel)
            if image_path is None:
                counts["missing_on_disk"] += 1
                continue
            raw = cv2.imread(str(image_path), cv2.IMREAD_UNCHANGED)
            if raw is None:
                counts["unreadable"] += 1
                continue
            bgr = debayer_dtld(raw) if image_path.suffix.lower() in {".tif", ".tiff"} else raw
            height, width = bgr.shape[:2]
            window = crop_window(width, height, [b for _, b in decision.boxes], crop)
            # A pedestrian light cut in half by the crop would be an unlabeled lit signal: skip such images.
            if any(0 < visible_fraction(b, window) < 0.5 for _, b in decision.boxes):
                counts["skipped_partial_crop"] += 1
                continue
            boxes = [
                Box(CANONICAL_ID[name], *to_yolo(b, window))
                for name, b in decision.boxes if visible_fraction(b, window) >= 0.5
            ]
            split = "val" if city in val_cities else "train"
            stem = Path(filename).stem
            crop_img = bgr[int(window.y1):int(window.y2), int(window.x1):int(window.x2)]
            target = out / "images" / split / f"{stem}.jpg"
            target.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(target), crop_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            write_labels(out / "labels" / split / f"{stem}.txt", boxes)
            counts[f"images_{split}"] += 1
            for b in boxes:
                counts[CANONICAL[b.cls]] += 1
    data = {"path": str(out.resolve()), "train": "images/train", "val": "images/val", "names": dict(enumerate(CANONICAL))}
    out.mkdir(parents=True, exist_ok=True)
    (out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dtld", type=Path, required=True, help="folder containing the city folders")
    parser.add_argument("--labels", type=Path, required=True, help="DTLD v2.0 .json label file or folder of them")
    parser.add_argument("--cities", nargs="+", help="only these city label files (default: every per-city file)")
    parser.add_argument("--out", type=Path, default=Path("data/raw/dtld_yolo"))
    parser.add_argument("--stride", type=int, default=5, help="keep every Nth frame of a sequence (15 Hz source)")
    parser.add_argument("--negative-fraction", type=float, default=0.1)
    parser.add_argument("--min-height", type=float, default=12,
                        help="skip frames whose biggest lit pedestrian light is smaller than this (px)")
    parser.add_argument("--crop", type=int, default=640,
                        help="side of the window cropped around the lights; smaller keeps them large after resize")
    parser.add_argument("--val-cities", nargs="+", default=["Fulda"],
                        help="cities held out for validation; pick one you actually downloaded")
    args = parser.parse_args()

    if args.labels.is_file():
        files = [args.labels]
    else:
        # Per-city files only: DTLD_all/train/test.json cover every city (219 MB of JSON) and would just be parsed
        # to find that the images are not on disk.
        files = sorted(p for p in args.labels.rglob("*.json") if not p.stem.startswith("DTLD_"))
        if args.cities:
            wanted = {c.lower() for c in args.cities}
            files = [p for p in files if p.stem.lower() in wanted]
    if not files:
        raise SystemExit(f"No per-city .json label files in {args.labels}")
    print("label files:", ", ".join(p.stem for p in files))
    counts = convert(args.dtld, files, args.out, args.stride, args.negative_fraction, args.min_height, args.crop,
                     set(args.val_cities))
    for key in ["images_train", "images_val", "ped_red", "ped_green", "negatives_vehicle_lights_only",
                "skipped_unknown_state", "skipped_tiny_signal", "skipped_partial_crop", "missing_on_disk",
                "unreadable"]:
        print(f"{key:>30}: {counts[key]}")
    print(f"\nWrote {args.out / 'data.yaml'}. Add to configs/sources.yaml:\n"
          "  - name: dtld\n    path: data/raw/dtld_yolo\n    role: all\n    has_traffic_labels: false")


if __name__ == "__main__":
    main()
