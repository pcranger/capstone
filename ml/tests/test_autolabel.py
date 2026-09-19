"""Tests for the no-hand-labeling tools (synthetic data in each dataset's real format):  python -m pytest ml/tests -q"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import zlib
from pathlib import Path

import cv2
import numpy as np
import pytest
import yaml

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(ML_DIR / "scripts"))

import convert_dtld  # noqa: E402
import convert_vistas  # noqa: E402
import dtld_plan  # noqa: E402
import prepare_vidvip  # noqa: E402
from crosswise_ml.classes import CANONICAL  # noqa: E402
from crosswise_ml.colors import classify_counts, classify_crop  # noqa: E402
from crosswise_ml.datasets import decode_supervisely_bitmap, dtld_relative_image_path, vistas_category  # noqa: E402
from crosswise_ml.geometry import PixelBox, crop_window, to_yolo, visible_fraction  # noqa: E402
from crosswise_ml.review import apply_decisions, build_items, render_html  # noqa: E402
from crosswise_ml.temporal import TrackSample, smooth_states  # noqa: E402
from crosswise_ml.yolo_io import read_labels, read_names, reset_output_dir  # noqa: E402

RED_BGR, GREEN_BGR, GRAY_BGR = (40, 40, 235), (120, 230, 40), (90, 90, 90)


def names_of(label_file: Path) -> list[str]:
    return sorted(CANONICAL[b.cls] for b in read_labels(label_file))


# ------------------------------------------------------------------------------------------------- output safety

def test_output_folder_never_overlaps_inputs(tmp_path):
    source = tmp_path / "raw" / "DTLD"
    source.mkdir(parents=True)
    (source / "keep.txt").write_text("download")
    for bad in [source, source / "converted", tmp_path / "raw"]:
        with pytest.raises(SystemExit):
            reset_output_dir(bad, source)
    if sys.platform in ("win32", "darwin"):
        with pytest.raises(SystemExit):
            reset_output_dir(tmp_path / "raw" / "dtld", source)  # same folder on case-insensitive disks
    assert (source / "keep.txt").exists()
    out = tmp_path / "raw" / "dtld_yolo"
    (out / "old").mkdir(parents=True)
    reset_output_dir(out, source)
    assert out.exists() and not (out / "old").exists()
    # A label file's folder may hold the output, but the output must never be that folder itself.
    reset_output_dir(tmp_path / "raw" / "labels_out", nested_ok=(tmp_path / "raw",))
    with pytest.raises(SystemExit):
        reset_output_dir(tmp_path / "raw", nested_ok=(tmp_path / "raw",))
    assert (source / "keep.txt").exists()


# ------------------------------------------------------------------------------------------------ color + geometry

def test_color_rule_matches_app_thresholds():
    assert classify_counts(20, 1, 100) == "ped_red"
    assert classify_counts(0, 12, 100) == "ped_green"
    assert classify_counts(10, 8, 100) is None
    assert classify_counts(2, 0, 100) is None
    assert classify_counts(0, 0, 100, white=30) is None
    assert classify_counts(0, 0, 100, white=30, white_is_walk=True) == "ped_green"


def test_color_of_crops_with_mask():
    crop = np.full((40, 20, 3), 15, np.uint8)
    crop[5:18, 4:16] = RED_BGR
    assert classify_crop(crop) == "ped_red"
    crop[22:35, 4:16] = GREEN_BGR
    assert classify_crop(crop) is None  # both lit: undecided
    mask = np.zeros((40, 20), bool)
    mask[20:40] = True
    assert classify_crop(crop, mask) == "ped_green"


def test_crop_window_and_normalization():
    signal = PixelBox(3900, 100, 3940, 180)
    window = crop_window(4000, 3000, [signal], 1600)
    assert (window.x1, window.x2, window.y1, window.y2) == (2400, 4000, 0, 1600)
    assert visible_fraction(signal, window) == 1.0
    cx, cy, w, h = to_yolo(signal, window)
    assert cx == pytest.approx((3920 - 2400) / 1600) and h == pytest.approx(80 / 1600)
    assert crop_window(800, 600, [signal], 1600) == PixelBox(0, 0, 800, 600)


# ------------------------------------------------------------------------------------------------------------ VIDVIP

def test_prepare_vidvip_keeps_needed_classes_and_splits_by_session(tmp_path):
    src = tmp_path / "vidvip"
    for session in ["20210427_c50/signal09_anno", "2020_12_miyawaki"]:
        folder = src / session
        folder.mkdir(parents=True)
        for k in range(3):
            cv2.imwrite(str(folder / f"f{k}.jpg"), np.zeros((20, 20, 3), np.uint8))
            (folder / f"f{k}.txt").write_text("15 0.5 0.2 0.05 0.1\n16 0.6 0.2 0.05 0.1\n13 0.5 0.8 0.6 0.2\n30 0.1 0.1 0.1 0.1\n")
    out = tmp_path / "prepared"
    counts = prepare_vidvip.prepare(src, out, val_fraction=0.5, keep=set(prepare_vidvip.DEFAULT_KEEP),
                                    negative_fraction=0.0, quality=0, block=200)
    assert counts["signal_red"] == 6 and counts["other_classes_dropped"] == 6
    names = read_names(out / "data.yaml")
    assert names[15] == "signal_red" and names[16] == "signal_blue" and len(names) == 17
    labels = sorted((out / "labels").rglob("*.txt"))
    assert len(labels) == 6
    assert all(len(read_labels(p)) == 3 for p in labels)
    for session in ["20210427_c50__signal09_anno", "2020_12_miyawaki"]:
        splits = {p.parent.name for p in labels if p.name.startswith(session)}
        assert len(splits) == 1  # a recording never spans train and val


def test_prepare_vidvip_flat_folder_groups_frames_and_drops_irrelevant_images(tmp_path):
    # The real download is one flat folder of img_00001.jpg, so frame numbers stand in for the recording.
    src = tmp_path / "vidvipo_full"
    src.mkdir()
    for number, classes in [(1, "15"), (199, "16"), (205, "13"), (900, "0")]:
        cv2.imwrite(str(src / f"img_{number:05d}.jpg"), np.zeros((20, 20, 3), np.uint8))
        (src / f"img_{number:05d}.txt").write_text(f"{classes} 0.5 0.5 0.1 0.1\n")
    out = tmp_path / "prepared"
    counts = prepare_vidvip.prepare(src, out, val_fraction=0.5, keep=set(prepare_vidvip.DEFAULT_KEEP),
                                    negative_fraction=0.0, quality=0, block=100)
    assert counts["skipped_nothing_of_interest"] == 1          # the person-only frame
    assert sorted(p.stem for p in (out / "labels").rglob("*.txt")) == [
        "block00000__img_00001", "block00001__img_00199", "block00002__img_00205"]
    assert prepare_vidvip.session_key(src / "img_00042.jpg", src, 200) == "block00000"
    assert prepare_vidvip.session_key(src / "img_00201.jpg", src, 200) == "block00001"
    assert prepare_vidvip.session_key(src / "walk3" / "img_00201.jpg", src, 200) == "walk3"


# -------------------------------------------------------------------------------------------------------------- DTLD

def _dtld_label(x, y, w, h, pictogram, state, track):
    return {"x": x, "y": y, "w": w, "h": h, "unique_id": 1, "track_id": track,
            "attributes": {"pictogram": pictogram, "state": state, "direction": "front", "relevance": "relevant",
                           "occlusion": "not_occluded", "orientation": "vertical", "aspects": "two_aspects"}}


def test_convert_dtld(tmp_path):
    root = tmp_path / "DTLD"
    images = []
    for city, name, labels in [
        ("Berlin", "a_k0.tiff", [_dtld_label(100, 20, 10, 24, "pedestrian", "red", "t1"),
                                 _dtld_label(140, 20, 10, 24, "circle", "green", "t2"),
                                 _dtld_label(60, 20, 10, 24, "pedestrian", "off", "t3")]),
        ("Berlin", "b_k0.tiff", [_dtld_label(100, 20, 10, 24, "pedestrian", "unknown", "t1")]),
        ("Berlin", "c_k0.tiff", [_dtld_label(20, 20, 10, 24, "circle", "red", "t4")]),
        ("Koeln", "d_k0.tiff", [_dtld_label(30, 40, 12, 30, "pedestrian", "green", "t5")]),
    ]:
        seq = root / city / f"{city}1" / "2015-04-17_10-50-05"
        seq.mkdir(parents=True, exist_ok=True)
        raw = np.full((100, 200), 2048, np.uint16)  # 12-bit mid gray, Bayer pattern irrelevant here
        cv2.imwrite(str(seq / name), raw)
        images.append({"image_path": f"/data/DTLD/{city}/{city}1/2015-04-17_10-50-05/{name}",
                       "disparity_image_path": "", "time_stamp": 0, "labels": labels})
    label_file = tmp_path / "DTLD_all.json"
    label_file.write_text(json.dumps({"images": images}))
    out = tmp_path / "dtld_yolo"
    counts = convert_dtld.convert(root, [label_file], out, stride=1, negative_fraction=1.0, min_height=10,
                                  crop=1024, val_cities={"Koeln"})
    assert counts["skipped_unknown_state"] == 1
    assert counts["negatives_vehicle_lights_only"] == 1
    assert counts["images_train"] == 2 and counts["images_val"] == 1
    assert names_of(out / "labels/train/a_k0.txt") == ["ped_red"]  # vehicle light and dark head stay unlabeled
    assert names_of(out / "labels/train/c_k0.txt") == []
    assert names_of(out / "labels/val/d_k0.txt") == ["ped_green"]
    image = cv2.imread(str(out / "images/train/a_k0.jpg"))
    assert image.shape == (100, 200, 3)
    box = read_labels(out / "labels/train/a_k0.txt")[0]
    assert box.cx == pytest.approx(105 / 200) and box.h == pytest.approx(24 / 100)
    assert dtld_relative_image_path(r"C:\x\DTLD\Bochum\Bochum2\seq\img_k0.tiff") == "Bochum/Bochum2/seq/img_k0.tiff"


def test_dtld_plan_ranks_cities_by_frames_per_gigabyte():
    images = [{"image_path": f"/d/DTLD/Bochum/Bochum1/seq1/img{i}_k0.tiff",
               "labels": [_dtld_label(10, 10, 10, 24, "pedestrian", "red" if i % 2 else "green", "t1")]}
              for i in range(10)]
    images += [{"image_path": f"/d/DTLD/Hannover/Hannover1/seq2/img{i}_k0.tiff",
                "labels": [_dtld_label(10, 10, 10, 24, "circle", "red", "t2")]} for i in range(4)]
    images.append({"image_path": "/d/DTLD/Hannover/Hannover1/seq2/imgX_k0.tiff",
                   "labels": [_dtld_label(10, 10, 10, 24, "pedestrian", "unknown", "t3")]})
    summary = dtld_plan.summarize(images, stride=2, min_height=10)
    assert summary["Bochum"]["frames"] == 10
    assert summary["Bochum"]["frames_with_pedestrian_light"] == 10
    assert summary["Bochum"]["kept_at_stride"] == 5
    assert summary["Bochum"]["ped_red"] == 5 and summary["Bochum"]["ped_green"] == 5
    assert summary["Hannover"]["frames_vehicle_lights_only"] == 4
    assert summary["Hannover"]["unusable_unknown_state"] == 1
    # Bochum: 5 usable frames for 1.9 GB beats Hannover: 0 frames for 25 GB.
    assert dtld_plan.suggest(summary, target=3) == ["Bochum"]


# ------------------------------------------------------------------------------------------------------------ Vistas

@pytest.mark.parametrize("label, expected", [
    ("object--traffic-light--pedestrians", "ped_signal"),
    ("traffic light - pedestrians", "ped_signal"),
    ("object--traffic-light--general-upright", None),
    ("marking--discrete--crosswalk-zebra", "crosswalk"),
    ("crosswalk - zebra", "crosswalk"),
    ("construction--flat--crosswalk-plain", None),
    ("human--person--individual", "person"),
    ("human--person--person-group", None),
    ("human--rider--motorcyclist", "person"),
    ("object--vehicle--car", "car"),
    ("void--car-mount", None),
    ("marking--discrete--symbol--bicycle", None),
    ("object--vehicle--motorcycle", "motorcycle"),
    ("traffic sign - direction (front)", None),
])
def test_vistas_category(label, expected):
    assert vistas_category(label) == expected


def _street_image(path: Path, signal_color):
    image = np.full((600, 800, 3), 60, np.uint8)
    image[100:140, 400:420] = (20, 20, 20)
    image[104:120, 403:417] = signal_color
    image[300:330, 100:160] = GREEN_BGR  # a vehicle signal that must stay unlabeled
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)


def _args(src: Path, out: Path, **extra) -> argparse.Namespace:
    base = dict(vistas=src, out=out, model=None, min_height=14, crop=1600, max_side=1280, crosswalk_only_max=10,
                white_is_walk=False)
    base.update(extra)
    return argparse.Namespace(**base)


def test_convert_vistas_official_layout(tmp_path):
    src = tmp_path / "vistas"
    rect = lambda x1, y1, x2, y2: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]  # noqa: E731
    for name, color in [("red_img", RED_BGR), ("dark_img", GRAY_BGR)]:
        _street_image(src / "training/images" / f"{name}.jpg", color)
        polygons = {"height": 600, "width": 800, "objects": [
            {"id": 0, "label": "object--traffic-light--pedestrians", "polygon": rect(400, 100, 420, 140)},
            {"id": 1, "label": "object--traffic-light--general-upright", "polygon": rect(100, 300, 160, 330)},
            {"id": 2, "label": "object--vehicle--car", "polygon": rect(500, 350, 700, 450)},
            {"id": 3, "label": "marking--discrete--crosswalk-zebra", "polygon": rect(0, 450, 800, 600)},
        ]}
        p = src / "training/v2.0/polygons" / f"{name}.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(polygons))
    out = tmp_path / "converted"
    counts = convert_vistas.convert(_args(src, out))
    assert counts["images_train"] == 1 and counts["skip_undecided_signal"] == 1
    assert names_of(out / "labels/train/red_img.txt") == ["car", "crosswalk", "ped_red"]
    assert not (out / "labels/train/dark_img.txt").exists()
    mapping = (out / "label_mapping.csv").read_text(encoding="utf-8")
    assert "object--traffic-light--pedestrians" in mapping and "ped_signal" in mapping


def test_convert_vistas_supervisely_bitmap(tmp_path):
    src = tmp_path / "ninja"
    _street_image(src / "training/img/green_img.jpg", GREEN_BGR)
    mask = np.zeros((40, 20, 4), np.uint8)
    mask[..., 3] = 255
    ok, png = cv2.imencode(".png", mask)
    bitmap = base64.b64encode(zlib.compress(png.tobytes())).decode()
    assert decode_supervisely_bitmap(bitmap).shape == (40, 20)
    ann = {"size": {"height": 600, "width": 800}, "objects": [
        {"classTitle": "traffic light - pedestrians", "geometryType": "bitmap", "bitmap": {"data": bitmap, "origin": [400, 100]}},
        {"classTitle": "car", "geometryType": "polygon", "points": {"exterior": [[500, 350], [700, 350], [700, 450]], "interior": []}},
    ]}
    (src / "training/ann").mkdir(parents=True)
    (src / "training/ann/green_img.jpg.json").write_text(json.dumps(ann))
    out = tmp_path / "converted"
    counts = convert_vistas.convert(_args(src, out))
    assert counts["images_train"] == 1
    assert names_of(out / "labels/train/green_img.txt") == ["car", "ped_green"]


def test_vistas_state_policy_with_detector():
    decide = convert_vistas.decide_state
    assert decide("ped_red", None, 0.0, use_model=False) == ("ped_red", "color")
    assert decide("ped_red", "ped_red", 0.9, use_model=True) == ("ped_red", "agree")
    assert decide("ped_red", "ped_green", 0.9, use_model=True) == (None, "disagree")
    assert decide(None, "ped_green", 0.8, use_model=True) == ("ped_green", "model_only")
    assert decide(None, "ped_green", 0.5, use_model=True) == (None, "undecided")


# -------------------------------------------------------------------------------------------- video: temporal vote

def test_smoothing_removes_blips_and_marks_changes():
    samples = [TrackSample(t, "ped_red", 0.8) for t in range(0, 3000, 100)]
    samples[5] = TrackSample(500, "ped_green", 0.6)  # one-frame misread
    samples += [TrackSample(t, "ped_green", 0.8) for t in range(3000, 6000, 100)]
    result = smooth_states(samples, window_ms=1000, change_margin_ms=700)
    by_t = {s.t_ms: s for s in result}
    assert by_t[500].state == "ped_red" and not by_t[500].near_change
    assert by_t[2800].near_change and by_t[3200].near_change
    assert not by_t[1500].near_change and not by_t[4500].near_change
    assert by_t[4500].state == "ped_green"


# ----------------------------------------------------------------------------------------------------------- review

def _review_dataset(tmp_path: Path) -> Path:
    root = tmp_path / "local_auto"
    for name, line in [("v1_0", "0 0.5 0.3 0.05 0.1"), ("v1_1", "1 0.5 0.3 0.05 0.1"), ("v1_2", "0 0.5 0.3 0.05 0.1")]:
        image = root / "images/test/v1" / f"{name}.jpg"
        image.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(image), np.zeros((10, 10, 3), np.uint8))
        label = root / "labels/test/v1" / f"{name}.txt"
        label.parent.mkdir(parents=True, exist_ok=True)
        label.write_text(line + "\n2 0.5 0.8 0.5 0.2\n")
    (root / "data.yaml").write_text(yaml.safe_dump({"names": dict(enumerate(CANONICAL))}))
    (root / "autolabel_report.csv").write_text(
        "image,t_ms,flags,signal_states\nimages/test/v1/v1_1.jpg,1000,near_phase_change;color_disagrees,ped_green\n")
    return root


def test_review_items_and_page(tmp_path):
    root = _review_dataset(tmp_path)
    items = build_items(root)
    assert [it["img"] for it in items] == ["images/test/v1/v1_0.jpg", "images/test/v1/v1_1.jpg", "images/test/v1/v1_2.jpg"]
    assert items[1]["flags"] == ["near_phase_change", "color_disagrees"]
    assert [it["img"] for it in build_items(root, only_flagged=True)] == ["images/test/v1/v1_1.jpg"]
    page = render_html("local_auto", CANONICAL, items)
    assert "__DATA__" not in page and "near_phase_change" in page and "images/test/v1/v1_2.jpg" in page


def test_apply_review_decisions(tmp_path):
    root = _review_dataset(tmp_path)
    decisions = {"images/test/v1/v1_0.jpg": "flip", "images/test/v1/v1_1.jpg": "reject"}
    counts = apply_decisions(root, decisions, CANONICAL, drop_unreviewed=True)
    assert counts["flip"] == 1 and counts["reject"] == 1 and counts["unreviewed"] == 1
    assert names_of(root / "labels/test/v1/v1_0.txt") == ["crosswalk", "ped_green"]
    assert not (root / "images/test/v1/v1_1.jpg").exists()
    assert (tmp_path / "local_auto_removed/images/test/v1/v1_1.jpg").exists()
    assert (tmp_path / "local_auto_removed/labels/test/v1/v1_2.txt").exists()
    summary = json.loads((root / "review_summary.json").read_text())
    assert summary["reviewed"] == 2 and summary["auto_label_precision"] == 0.0
