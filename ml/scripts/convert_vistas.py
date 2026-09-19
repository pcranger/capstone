"""Converts Mapillary Vistas v2.0 into CrossWise labels, assigning pedestrian-signal red/green automatically.

    # official download (mapillary.com/dataset/vistas): folder with training/ validation/ config_v2.0.json
    python scripts/convert_vistas.py --vistas data/raw/vistas_download --out data/raw/vistas_yolo
    # or the Dataset Ninja copy:  pip install dataset-tools
    #   python -c "import dataset_tools as d; d.download(dataset='Mapillary Vistas', dst_dir='data/raw/vistas_ninja')"
    python scripts/convert_vistas.py --vistas data/raw/vistas_ninja --out data/raw/vistas_yolo
    # stricter: also require agreement with a trained detector
    python scripts/convert_vistas.py ... --model runs/detect/crosswise_v1/weights/best.pt

Vistas (25k street photos from around the world, CC BY-NC-SA 4.0) outlines "traffic light - pedestrians" but not
whether it shows walk or don't walk. The state is decided from the lit pixels inside the outline (same rule as the
app); with --model the detector must agree too. An image is skipped when any clearly visible pedestrian signal stays
undecided (e.g. seen from the back, or a white US "walk" figure unless --white-is-walk), so a lit signal is never
taught as background. Vehicle signals are left unlabeled on purpose: they are the hard negatives the model needs.
Each kept image is cropped around its signals so they stay large after the 640 px training resize.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Iterator

import cv2
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.classes import CANONICAL, CANONICAL_ID  # noqa: E402
from crosswise_ml.colors import classify_crop  # noqa: E402
from crosswise_ml.datasets import (  # noqa: E402
    VistasObject,
    object_mask_in_crop,
    vistas_category,
    vistas_objects_official,
    vistas_objects_supervisely,
)
from crosswise_ml.geometry import PixelBox, crop_window, to_yolo, visible_fraction  # noqa: E402
from crosswise_ml.yolo_io import Box, reset_output_dir, write_labels  # noqa: E402


def iter_samples(root: Path) -> Iterator[tuple[str, Path, list[VistasObject]]]:
    official = [(s, root / s / "v2.0" / "polygons", root / s / "images") for s in ("training", "validation")]
    if any(p.is_dir() for _, p, _ in official):
        for split_name, polygons, images in official:
            split = "train" if split_name == "training" else "val"
            for json_path in sorted(polygons.glob("*.json")):
                data = json.loads(json_path.read_text(encoding="utf-8"))
                yield split, images / f"{json_path.stem}.jpg", vistas_objects_official(data)
        return
    ann_dirs = sorted(p for p in root.rglob("ann") if p.is_dir() and (p.parent / "img").is_dir())
    if not ann_dirs:
        raise SystemExit(f"{root}: neither official Vistas (training/v2.0/polygons) nor Supervisely (*/ann + */img) layout")
    for ann_dir in ann_dirs:
        name = ann_dir.parent.name.lower()
        if "train" in name:
            split = "train"
        elif "valid" in name or name == "val":
            split = "val"
        else:
            continue  # the test split has no labels
        for ann in sorted(ann_dir.glob("*.json")):
            data = json.loads(ann.read_text(encoding="utf-8"))
            yield split, ann_dir.parent / "img" / ann.name[: -len(".json")], vistas_objects_supervisely(data)


def int_box(box: PixelBox, width: int, height: int) -> PixelBox:
    return PixelBox(max(0, int(box.x1)), max(0, int(box.y1)), min(width, int(box.x2) + 1), min(height, int(box.y2) + 1))


class DetectorVote:
    """Optional second opinion from a trained CrossWise detector (needs ultralytics)."""

    def __init__(self, weights: str, conf: float = 0.25, imgsz: int = 1280):
        from ultralytics import YOLO

        self.model = YOLO(weights)
        self.conf, self.imgsz = conf, imgsz

    def detections(self, image) -> list[tuple[str, float, PixelBox]]:
        result = self.model.predict(image, conf=self.conf, imgsz=self.imgsz, verbose=False)[0]
        names = self.model.names
        return [
            (names[int(c)], float(p), PixelBox(*xyxy))
            for xyxy, c, p in zip(result.boxes.xyxy.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist())
            if names[int(c)] in {"ped_red", "ped_green"}
        ]


def decide_state(color: str | None, model_state: str | None, model_conf: float, use_model: bool) -> tuple[str | None, str]:
    """Color rule first; a detector (if given) can veto it, or fill in when it is confident and the color is unclear."""
    if not use_model:
        return color, ("color" if color else "undecided")
    if color is not None and model_state is not None:
        return (color, "agree") if color == model_state else (None, "disagree")
    if color is not None:
        return color, "color_no_detection"
    if model_state is not None and model_conf >= 0.7:
        return model_state, "model_only"
    return None, "undecided"


def convert(args: argparse.Namespace) -> Counter:
    reset_output_dir(args.out, args.vistas)
    voter = DetectorVote(args.model) if args.model else None
    counts: Counter = Counter()
    label_table: Counter = Counter()
    crosswalk_only = 0
    for split, image_path, objects in iter_samples(args.vistas):
        categorized = [(o, vistas_category(o.label)) for o in objects]
        for o, cat in categorized:
            label_table[(o.label, cat)] += 1
        signals = [o for o, cat in categorized if cat == "ped_signal" and o.box.h >= args.min_height]
        crosswalks = [o for o, cat in categorized if cat == "crosswalk"]
        if not signals and not (crosswalks and crosswalk_only < args.crosswalk_only_max):
            continue
        image = cv2.imread(str(image_path))
        if image is None:
            counts["missing_image"] += 1
            continue
        height, width = image.shape[:2]
        window = crop_window(width, height, [o.box for o in signals], args.crop) if signals else PixelBox(0, 0, width, height)

        boxes: list[Box] = []
        usable = True
        detections = voter.detections(image) if (voter and signals) else []
        for o in signals:
            fraction = visible_fraction(o.box, window)
            if fraction == 0:
                continue
            if fraction < 0.5:
                usable = False
                counts["skip_signal_cut_by_crop"] += 1
                break
            region = int_box(o.box, width, height)
            crop = image[int(region.y1):int(region.y2), int(region.x1):int(region.x2)]
            color = classify_crop(crop, object_mask_in_crop(o, region), red_max_hue=40, white_is_walk=args.white_is_walk)
            model_state, model_conf = None, 0.0
            for name, conf, det_box in detections:
                if det_box.iou(o.box) >= 0.3 and conf > model_conf:
                    model_state, model_conf = name, conf
            state, how = decide_state(color, model_state, model_conf, voter is not None)
            counts[f"state_{how}"] += 1
            if state is None:
                usable = False
                counts["skip_undecided_signal"] += 1
                break
            boxes.append(Box(CANONICAL_ID[state], *to_yolo(o.box, window)))
        if not usable:
            continue
        for o, cat in categorized:
            if cat in (None, "ped_signal"):
                continue
            fraction = visible_fraction(o.box, window)
            if fraction >= (0.2 if cat == "crosswalk" else 0.3):
                boxes.append(Box(CANONICAL_ID[cat], *to_yolo(o.box, window)))

        if not signals:
            crosswalk_only += 1
        out_image = image[int(window.y1):int(window.y2), int(window.x1):int(window.x2)]
        scale = args.max_side / max(out_image.shape[:2])
        if scale < 1:
            out_image = cv2.resize(out_image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        target = args.out / "images" / split / f"{image_path.stem}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(target), out_image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        write_labels(args.out / "labels" / split / f"{image_path.stem}.txt", boxes)
        counts[f"images_{split}"] += 1
        for b in boxes:
            counts[CANONICAL[b.cls]] += 1

    data = {"path": str(args.out.resolve()), "train": "images/train", "val": "images/val", "names": dict(enumerate(CANONICAL))}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "data.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    with (args.out / "label_mapping.csv").open("w", encoding="utf-8") as f:
        f.write("vistas_label,crosswise_category,objects\n")
        for (label, cat), n in sorted(label_table.items(), key=lambda kv: -kv[1]):
            f.write(f"\"{label}\",{cat or ''},{n}\n")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vistas", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("data/raw/vistas_yolo"))
    parser.add_argument("--model", help="optional trained CrossWise .pt: its red/green must agree with the color rule")
    parser.add_argument("--min-height", type=float, default=14, help="signals smaller than this (px) are ignored")
    parser.add_argument("--crop", type=int, default=1600)
    parser.add_argument("--max-side", type=int, default=1280)
    parser.add_argument("--crosswalk-only-max", type=int, default=1500, help="images with crosswalks but no signal")
    parser.add_argument("--white-is-walk", action="store_true", help="treat a lit white figure as walk (US style)")
    args = parser.parse_args()
    counts = convert(args)
    for key in ["images_train", "images_val", "ped_red", "ped_green", "crosswalk", "person", "car", "motorcycle",
                "state_color", "state_agree", "state_color_no_detection", "state_model_only", "state_disagree",
                "state_undecided", "skip_undecided_signal", "skip_signal_cut_by_crop", "missing_image"]:
        if counts[key] or key.startswith("images"):
            print(f"{key:>28}: {counts[key]}")
    # People in groups and vehicles cut by the crop are not labeled, so let the COCO teacher fill gaps.
    print(f"\nWrote {args.out / 'data.yaml'} and {args.out / 'label_mapping.csv'} (check which Vistas labels were used).\n"
          "Add to configs/sources.yaml:\n  - name: vistas\n    path: data/raw/vistas_yolo\n    role: all\n    has_traffic_labels: false")


if __name__ == "__main__":
    main()
