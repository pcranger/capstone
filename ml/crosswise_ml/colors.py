"""Lit-color rule for pedestrian signal crops (same thresholds as the app's SignalColorHeuristic.kt).

Used to assign red/green automatically when a dataset has pedestrian-signal boxes but no state
(Mapillary Vistas), and to double-check a detector's red/green on auto-labeled video frames.
"""

from __future__ import annotations

import cv2
import numpy as np

RED = "ped_red"
GREEN = "ped_green"


def lit_color_counts(
    crop_bgr: np.ndarray,
    mask: np.ndarray | None = None,
    red_max_hue: float = 20.0,
) -> tuple[int, int, int, int]:
    """Counts bright saturated red, bright green/cyan and bright white pixels.

    Returns (red, green, white, total) over the mask (or the whole crop). Hues are in degrees.
    ``red_max_hue`` can be raised to ~40 to accept orange "don't walk" hands when the box is already
    known to be a pedestrian signal.
    """
    if crop_bgr.size == 0:
        return 0, 0, 0, 0
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    hue = hsv[..., 0].astype(np.float32) * 2.0
    sat = hsv[..., 1].astype(np.float32) / 255.0
    val = hsv[..., 2].astype(np.float32) / 255.0
    valid = np.ones(hue.shape, bool) if mask is None else mask.astype(bool)
    bright = valid & (val > 0.5)
    red = bright & (sat > 0.45) & ((hue < red_max_hue) | (hue > 335.0))
    green = bright & ~red & (sat > 0.30) & (hue >= 90.0) & (hue <= 200.0)
    white = valid & (val > 0.85) & (sat < 0.20)
    return int(red.sum()), int(green.sum()), int(white.sum()), int(valid.sum())


def classify_counts(
    red: int,
    green: int,
    total: int,
    white: int = 0,
    min_ratio: float = 0.06,
    dominance: float = 2.5,
    white_is_walk: bool = False,
) -> str | None:
    """'ped_red', 'ped_green' or None (undecided). Mirrors SignalColorHeuristic.classify in the app."""
    if total <= 0:
        return None
    r, g = red / total, green / total
    if white_is_walk:
        g = max(g, white / total)
    if r >= min_ratio and r > dominance * g:
        return RED
    if g >= min_ratio and g > dominance * r:
        return GREEN
    return None


def classify_crop(
    crop_bgr: np.ndarray,
    mask: np.ndarray | None = None,
    red_max_hue: float = 20.0,
    white_is_walk: bool = False,
) -> str | None:
    red, green, white, total = lit_color_counts(crop_bgr, mask, red_max_hue)
    return classify_counts(red, green, total, white=white, white_is_walk=white_is_walk)
