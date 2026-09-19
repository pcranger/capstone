"""Reads only the DTLD label files and says which city zips are worth downloading (the full set is ~143 GB).

    python scripts/dtld_plan.py --labels data/raw/DTLD_labels_v2.0

For every city it reports how many frames actually contain a usable pedestrian light (state red or green), how many
frames the converter would keep at the chosen --stride, and how much that costs per gigabyte of download. Then it
suggests the cheapest set of cities that reaches --target frames.

Download DTLD_Labels_v2.0.zip first (655 MB), unzip it, run this, and only then download the city zips you picked.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.datasets import dtld_decide, dtld_labels, dtld_relative_image_path  # noqa: E402

# Sizes of the city archives on the DTLD download page (GB, November 2018 release).
CITY_GB = {
    "Berlin": 12.0, "Bochum": 1.9, "Bremen": 2.0, "Dortmund": 24.0, "Duesseldorf": 18.0, "Essen": 10.0,
    "Frankfurt": 17.0, "Fulda": 2.1, "Hannover": 25.0, "Kassel": 8.0, "Koeln": 23.0,
}


def iter_images(path: Path) -> Iterator[dict]:
    """Streams the images of one label file; uses ijson for big files so a 1 GB JSON does not eat all the RAM."""
    if path.stat().st_size > 200_000_000:
        try:
            import ijson

            with path.open("rb") as handle:
                yield from ijson.items(handle, "images.item")
            return
        except ImportError:
            print(f"[note] {path.name} is large; 'pip install ijson' would avoid loading it whole into memory.")
    yield from json.loads(path.read_text(encoding="utf-8"))["images"]


def summarize(images: Iterable[dict], stride: int, min_height: float) -> dict[str, dict[str, int]]:
    """Per city: frames, frames with a red/green pedestrian light, boxes per state, frames the converter would keep."""
    per_city: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    sequence_index: dict[str, int] = defaultdict(int)
    for image in images:
        rel = dtld_relative_image_path(image["image_path"])
        city, _route, sequence, _file = rel.split("/")
        row = per_city[city]
        row["frames"] += 1
        decision = dtld_decide(dtld_labels(image), min_height)
        if not decision.usable:
            row["unusable_unknown_state"] += 1
        elif decision.too_small:
            row["too_small"] += 1
        elif decision.boxes:
            row["frames_with_pedestrian_light"] += 1
            for name, _box in decision.boxes:
                row[name] += 1
        elif decision.has_other_lights:
            row["frames_vehicle_lights_only"] += 1
        position = sequence_index[sequence]
        sequence_index[sequence] += 1
        if decision.usable and decision.boxes and not decision.too_small and position % stride == 0:
            row["kept_at_stride"] += 1
    return {city: dict(row) for city, row in per_city.items()}


def suggest(summary: dict[str, dict[str, int]], target: int) -> list[str]:
    """Cheapest cities first (frames kept per GB) until the target number of frames is reached."""
    ranked = sorted(
        summary,
        key=lambda city: summary[city].get("kept_at_stride", 0) / CITY_GB.get(city, 99.0),
        reverse=True,
    )
    chosen, total = [], 0
    for city in ranked:
        if total >= target:
            break
        chosen.append(city)
        total += summary[city].get("kept_at_stride", 0)
    return chosen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--labels", type=Path, required=True, help="unzipped DTLD label folder or a single .json")
    parser.add_argument("--stride", type=int, default=5, help="same value you will pass to convert_dtld.py")
    parser.add_argument("--min-height", type=float, default=10)
    parser.add_argument("--target", type=int, default=3000, help="pedestrian-light frames you want from DTLD")
    args = parser.parse_args()

    # Per-city files only: DTLD_all/train/test.json repeat the same frames and are 219 MB of JSON.
    files = ([args.labels] if args.labels.is_file()
             else sorted(p for p in args.labels.rglob("*.json") if not p.stem.startswith("DTLD_")))
    if not files:
        raise SystemExit(f"No .json label files under {args.labels}")
    summary: dict[str, dict[str, int]] = {}
    for file in files:
        print(f"reading {file.name} ...")
        for city, row in summarize(iter_images(file), args.stride, args.min_height).items():
            merged = summary.setdefault(city, {})
            for key, value in row.items():
                merged[key] = merged.get(key, 0) + value

    header = f"{'city':<14}{'GB':>6}{'frames':>9}{'ped frames':>12}{'red':>8}{'green':>8}{'keep@stride':>13}{'keep/GB':>9}"
    print("\n" + header)
    print("-" * len(header))
    for city in sorted(summary, key=lambda c: summary[c].get("kept_at_stride", 0) / CITY_GB.get(c, 99.0), reverse=True):
        row = summary[city]
        gb = CITY_GB.get(city, float("nan"))
        kept = row.get("kept_at_stride", 0)
        print(f"{city:<14}{gb:>6.1f}{row.get('frames', 0):>9}{row.get('frames_with_pedestrian_light', 0):>12}"
              f"{row.get('ped_red', 0):>8}{row.get('ped_green', 0):>8}{kept:>13}{kept / gb:>9.0f}")

    chosen = suggest(summary, args.target)
    gb = sum(CITY_GB.get(c, 0) for c in chosen)
    frames = sum(summary[c].get("kept_at_stride", 0) for c in chosen)
    print(f"\nTo get ~{args.target} pedestrian-light frames, download: {', '.join(chosen)}  ({gb:.1f} GB, {frames} frames)")
    print("Then: python scripts/convert_dtld.py --dtld <folder with the city folders> --labels <label folder> "
          f"--out data/raw/dtld_yolo --val-cities {chosen[-1] if chosen else 'Fulda'}")


if __name__ == "__main__":
    main()
