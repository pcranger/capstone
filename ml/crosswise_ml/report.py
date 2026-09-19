"""The metrics table for the report: mAP plus the red/green confusions that actually matter for safety."""

from __future__ import annotations

from pathlib import Path

import yaml


def pick_split(data_yaml: Path, preferred: str = "test") -> str:
    """The reviewed own-video split if the dataset has one, otherwise val."""
    data = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
    return preferred if preferred in data else "val"


def detection_report(model, data_yaml: Path, split: str, imgsz: int, weights: str) -> dict:
    """Validates `model` and returns the numbers the capstone report needs.

    A red signal called green is the dangerous confusion; the opposite is merely conservative, so both are reported
    separately, with raw counts because on a small split one box turns into an alarming-looking ratio.
    """
    metrics = model.val(data=str(data_yaml), split=split, imgsz=imgsz, plots=True)
    names = model.names
    # Only classes that actually occur in this split (maps[] fills the others with the overall mean).
    per_class = {names[int(c)]: float(metrics.box.maps[int(c)]) for c in metrics.box.ap_class_index}
    report = {
        "weights": weights,
        "split": split,
        "mAP50-95": float(metrics.box.map),
        "mAP50": float(metrics.box.map50),
        "per_class_mAP50-95": per_class,
    }

    # Confusion matrix rows = predicted, columns = true (Ultralytics convention; last index = background).
    matrix = metrics.confusion_matrix.matrix
    ids = {v: k for k, v in names.items()}
    red, green = ids.get("ped_red"), ids.get("ped_green")
    if red is not None and green is not None:
        true_red = float(matrix[:, red].sum())
        true_green = float(matrix[:, green].sum())
        report["red_boxes_called_green"] = float(matrix[green, red]) / max(true_red, 1.0)
        report["green_boxes_called_red"] = float(matrix[red, green]) / max(true_green, 1.0)
        report["counts"] = {"true_red": true_red, "true_green": true_green,
                            "red_as_green": float(matrix[green, red]), "green_as_red": float(matrix[red, green])}
    return report
