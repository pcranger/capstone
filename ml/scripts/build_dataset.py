"""Merges several YOLO datasets into one CrossWise dataset with canonical classes.

    python scripts/build_dataset.py --sources configs/sources.yaml --out data/merged

Each source's class names are mapped with crosswise_ml.classes (override per source in the YAML) and
the mapping table is printed: check it before training, a wrong mapping (e.g. a vehicle light mapped
to ped_green) is the most dangerous data bug this project can have.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.classes import CANONICAL, resolve_class_map  # noqa: E402
from crosswise_ml.yolo_io import (  # noqa: E402
    Box,
    group_key,
    label_path_for,
    list_images,
    read_labels,
    read_names,
    reset_output_dir,
    split_of,
    write_labels,
)

ROLES = {"train", "test", "all"}


def assign_split(role: str, own_split: str, key: str, val_fraction: float) -> str:
    """train: own train/val (unsplit or test -> hashed train/val); test: everything to test; all: keep own splits."""
    if role == "test":
        return "test"
    if role == "all" and own_split in {"train", "val", "test"}:
        return own_split
    if own_split == "train":
        return "train"
    if own_split == "val":
        return "val"
    bucket = int(hashlib.sha1(key.encode()).hexdigest(), 16) % 1000
    return "val" if bucket < val_fraction * 1000 else "train"


def inside(box: Box, head: Box, margin: float = 0.02) -> bool:
    """True when box's centre lies within head — i.e. the lit lamp that gives that signal head its state."""
    return (head.cx - head.w / 2 - margin <= box.cx <= head.cx + head.w / 2 + margin
            and head.cy - head.h / 2 - margin <= box.cy <= head.cy + head.h / 2 + margin)


def build(sources_file: Path, out: Path, val_fraction: float, copy: bool) -> None:
    config = yaml.safe_load(sources_file.read_text(encoding="utf-8"))
    base = sources_file.parent.parent  # paths in the YAML are relative to ml/
    reset_output_dir(out, *[base / s["path"] for s in config["sources"]], nested_ok=(sources_file.parent,))
    coverage: dict[str, dict] = {}
    stats: dict[tuple[str, str], Counter] = defaultdict(Counter)
    image_counts: Counter = Counter()
    skipped: Counter = Counter()

    for source in config["sources"]:
        name, role = source["name"], source.get("role", "train")
        if role not in ROLES:
            raise ValueError(f"{name}: role must be one of {sorted(ROLES)}")
        root = (base / source["path"]).resolve()
        data_yaml = next(iter(sorted(root.rglob("data.yaml"))), None)
        if data_yaml is None:
            hint = f"\n       {source['manual']}" if source.get("manual") else ""
            print(f"[skip] {name}: no data.yaml under {root} (not downloaded/converted yet){hint}")
            continue
        names = read_names(data_yaml)
        mapping = resolve_class_map(names, source.get("class_map"))
        print(f"\n== {name} ({role}) — class mapping, CHECK THIS:")
        for i, src_name in enumerate(names):
            target = mapping[i]
            print(f"   {i:>3} {src_name!r:<40} -> {CANONICAL[target] if target is not None else '(dropped)'}")

        # Some sources box the signal HEAD with a class that carries no state ('pedestrian Traffic Light'), next to
        # the lit lamp. Dropping such a box would leave a lit signal unlabeled, so the whole image is skipped unless
        # every head contains a red/green box.
        unstated = source.get("unstated_signal_class")
        unstated_ids = {i for i, n in enumerate(names) if n == unstated} if unstated else set()
        if unstated and not unstated_ids:
            raise SystemExit(f"{name}: unstated_signal_class {unstated!r} is not one of {names}")

        for image in list_images(root):
            raw = read_labels(label_path_for(image))
            boxes = [Box(mapping[b.cls], b.cx, b.cy, b.w, b.h) for b in raw
                     if b.cls in mapping and mapping[b.cls] is not None]
            if unstated_ids:
                states = [b for b in boxes if CANONICAL[b.cls] in ("ped_red", "ped_green")]
                heads = [b for b in raw if b.cls in unstated_ids]
                if any(not any(inside(state, head) for state in states) for head in heads):
                    skipped[name] += 1
                    continue
            split = assign_split(role, split_of(image, root), f"{name}/{group_key(image)}", val_fraction)
            stem = f"{name}__{image.stem}"
            target_image = out / "images" / split / f"{stem}{image.suffix.lower()}"
            target_image.parent.mkdir(parents=True, exist_ok=True)
            if copy:
                shutil.copy2(image, target_image)
            else:
                try:
                    target_image.hardlink_to(image)
                except OSError:
                    shutil.copy2(image, target_image)
            write_labels(out / "labels" / split / f"{stem}.txt", boxes)
            rel = target_image.relative_to(out).as_posix()
            coverage[rel] = {"source": name, "traffic_labeled": bool(source.get("has_traffic_labels", False))}
            image_counts[(name, split)] += 1
            for b in boxes:
                stats[(name, split)][CANONICAL[b.cls]] += 1

    for name, n in skipped.items():
        print(f"[skip] {name}: {n} images left a pedestrian signal head without a red/green box")

    splits = {s for (_, s) in image_counts}
    data = {
        "path": str(out.resolve()),
        "train": "images/train",
        "val": "images/val",
        "names": dict(enumerate(CANONICAL)),
    }
    if "test" in splits:
        data["test"] = "images/test"
    (out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    (out / "meta").mkdir(parents=True, exist_ok=True)
    (out / "meta" / "coverage.json").write_text(json.dumps(coverage, indent=1), encoding="utf-8")

    print("\n== Summary (images / boxes per class)")
    header = f"{'source':<28}{'split':<7}{'images':>7}  " + " ".join(f"{c[:9]:>9}" for c in CANONICAL)
    print(header)
    for (name, split), count in sorted(image_counts.items()):
        row = stats[(name, split)]
        print(f"{name:<28}{split:<7}{count:>7}  " + " ".join(f"{row[c]:>9}" for c in CANONICAL))
    print(f"\nWrote {out / 'data.yaml'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sources", type=Path, default=Path("configs/sources.yaml"))
    parser.add_argument("--out", type=Path, default=Path("data/merged"))
    parser.add_argument("--val-fraction", type=float, default=0.12)
    parser.add_argument("--copy", action="store_true", help="copy images instead of hard-linking")
    args = parser.parse_args()
    build(args.sources, args.out, args.val_fraction, args.copy)


if __name__ == "__main__":
    main()
