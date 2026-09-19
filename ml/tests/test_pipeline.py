"""Unit tests for the data pipeline (no GPU / Ultralytics needed):  python -m pytest ml/tests -q"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest
import yaml

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))
sys.path.insert(0, str(ML_DIR / "scripts"))

from build_dataset import assign_split, build  # noqa: E402
from crosswise_ml.classes import CANONICAL, canonical_name, resolve_class_map  # noqa: E402
from crosswise_ml.imvisible import MODE_TO_CANONICAL, load_labels  # noqa: E402
from crosswise_ml.report import pick_split  # noqa: E402
from crosswise_ml.yolo_io import group_key, label_path_for, parse_label_line, read_labels  # noqa: E402


@pytest.mark.parametrize(
    "raw, expected",
    [
        # Same cases as LabelMapperTest.kt, so app and training agree.
        ("ped_red", "ped_red"),
        ("red-pedestrian-light", "ped_red"),
        ("Red Pedestrian Traffic Light", "ped_red"),
        ("dont_walk", "ped_red"),
        ("red man", "ped_red"),
        ("green-pedestrian-light", "ped_green"),
        ("Green Pedestrian Traffic Light", "ped_green"),
        ("walk", "ped_green"),
        ("green man", "ped_green"),
        ("zebra_crossing", "crosswalk"),
        ("Pedestrian Crossing", "crosswalk"),
        ("pedestrian", "person"),
        ("motorbike", "motorcycle"),
        # Ambiguous or irrelevant labels are dropped for training.
        ("traffic light", None),
        ("red light", None),
        ("handbag", None),
        ("stop sign", None),
        ("countdown", None),
    ],
)
def test_canonical_names(raw, expected):
    assert canonical_name(raw) == expected


def test_overrides_win_and_are_validated():
    mapping = resolve_class_map(["Red", "Green", "car"], {"Red": "ped_red", "green": "ped_green"})
    assert [CANONICAL[mapping[i]] for i in range(3)] == ["ped_red", "ped_green", "car"]
    with pytest.raises(ValueError):
        resolve_class_map(["x"], {"x": "vehicle_light"})


def test_polygon_label_becomes_bbox():
    box = parse_label_line("2 0.1 0.2 0.3 0.2 0.3 0.6 0.1 0.6")
    assert box.cls == 2
    assert box.cx == pytest.approx(0.2) and box.cy == pytest.approx(0.4)
    assert box.w == pytest.approx(0.2) and box.h == pytest.approx(0.4)


def test_roboflow_augmentations_share_group_and_labels_path():
    a = Path("ds/train/images/IMG_12_jpg.rf.aaa.jpg")
    b = Path("ds/train/images/IMG_12_jpg.rf.bbb.jpg")
    assert group_key(a) == group_key(b) == "IMG_12_jpg"
    assert label_path_for(a) == Path("ds/train/labels/IMG_12_jpg.rf.aaa.txt")


def test_split_assignment():
    assert assign_split("test", "train", "k", 0.1) == "test"
    assert assign_split("all", "test", "k", 0.1) == "test"
    assert assign_split("train", "val", "k", 0.1) == "val"
    hashed = {assign_split("train", "unsplit", f"img{i}", 0.2) for i in range(200)}
    assert hashed == {"train", "val"}


def _make_source(root: Path, names: list[str], items: dict[str, list[str]]) -> None:
    root.mkdir(parents=True)
    (root / "data.yaml").write_text(yaml.safe_dump({"names": names}), encoding="utf-8")
    for rel, lines in items.items():
        image = root / rel
        image.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(image), np.full((32, 48, 3), 128, np.uint8))
        label = label_path_for(image)
        label.parent.mkdir(parents=True, exist_ok=True)
        label.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_build_merges_and_remaps(tmp_path):
    ml = tmp_path / "ml"
    _make_source(ml / "data/raw/rf", ["green-pedestrian-light", "red-pedestrian-light", "traffic light", "car"], {
        "train/images/a_jpg.rf.1.jpg": ["0 0.5 0.5 0.1 0.2", "2 0.2 0.2 0.1 0.1"],
        "valid/images/b.jpg": ["1 0.5 0.5 0.1 0.2", "3 0.7 0.7 0.3 0.3"],
    })
    _make_source(ml / "data/raw/local", ["ped_red", "ped_green"], {
        "images/x.jpg": ["1 0.4 0.4 0.05 0.1"],
    })
    (ml / "configs").mkdir()
    sources = ml / "configs" / "sources.yaml"
    sources.write_text(yaml.safe_dump({"sources": [
        {"name": "rf", "path": "data/raw/rf", "role": "train"},
        {"name": "local", "path": "data/raw/local", "role": "test", "has_traffic_labels": True},
    ]}), encoding="utf-8")

    out = tmp_path / "merged"
    build(sources, out, val_fraction=0.1, copy=True)

    data = yaml.safe_load((out / "data.yaml").read_text(encoding="utf-8"))
    assert data["names"][0] == "ped_red" and data["test"] == "images/test"
    train_labels = read_labels(out / "labels/train/rf__a_jpg.rf.1.txt")
    assert [CANONICAL[b.cls] for b in train_labels] == ["ped_green"]  # generic traffic light dropped
    val_labels = read_labels(out / "labels/val/rf__b.txt")
    assert sorted(CANONICAL[b.cls] for b in val_labels) == ["car", "ped_red"]
    test_labels = read_labels(out / "labels/test/local__x.txt")
    assert [CANONICAL[b.cls] for b in test_labels] == ["ped_green"]
    coverage = json.loads((out / "meta/coverage.json").read_text(encoding="utf-8"))
    assert coverage["images/test/local__x.jpg"]["traffic_labeled"] is True
    assert coverage["images/train/rf__a_jpg.rf.1.jpg"]["traffic_labeled"] is False


def test_imvisible_csv_with_bom(tmp_path):
    for split, rows in {
        "training": ["heon_IMG_1732.JPG,1,1842,1194,1,2266,not_blocked", "a.jpg,3,0,0,1,1,blocked"],
        "validation": ["b.jpg,0,0,0,1,1,not_blocked"],
        "testing": ["c.jpg,4,0,0,1,1,not_blocked"],
    }.items():
        (tmp_path / f"{split}_file.csv").write_text("﻿file,mode,x1,y1,x2,y2,block\n" + "\n".join(rows) + "\n",
                                                   encoding="utf-8")
    labels = load_labels(tmp_path)
    assert [(lab.file, lab.phase, lab.split) for lab in labels] == [
        ("heon_IMG_1732.JPG", "ped_green", "train"),
        ("a.jpg", "ped_green", "train"),  # countdown blank is still a green phase
        ("b.jpg", "ped_red", "val"),
        ("c.jpg", None, "test"),
    ]
    assert labels[1].blocked and MODE_TO_CANONICAL[4] is None


def test_pick_split_prefers_the_reviewed_test_set(tmp_path):
    with_test = tmp_path / "with_test.yaml"
    with_test.write_text(yaml.safe_dump({"train": "images/train", "val": "images/val", "test": "images/test"}),
                         encoding="utf-8")
    without = tmp_path / "without.yaml"
    without.write_text(yaml.safe_dump({"train": "images/train", "val": "images/val"}), encoding="utf-8")
    assert pick_split(with_test) == "test"
    assert pick_split(without) == "val"        # no own recordings reviewed yet
    assert pick_split(with_test, "val") == "val"
