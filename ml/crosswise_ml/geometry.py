"""Pixel-box helpers: polygon/mask extents, crop windows around small objects, YOLO normalization."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class PixelBox:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def w(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def h(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def area(self) -> float:
        return self.w * self.h

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2

    def intersect(self, other: "PixelBox") -> "PixelBox":
        return PixelBox(max(self.x1, other.x1), max(self.y1, other.y1), min(self.x2, other.x2), min(self.y2, other.y2))

    def iou(self, other: "PixelBox") -> float:
        inter = self.intersect(other).area
        union = self.area + other.area - inter
        return inter / union if union > 0 else 0.0


def polygon_box(points: list[list[float]]) -> PixelBox | None:
    if len(points) < 3:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    box = PixelBox(min(xs), min(ys), max(xs), max(ys))
    return box if box.area > 0 else None


def mask_box(mask: np.ndarray, origin_x: int = 0, origin_y: int = 0) -> PixelBox | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return PixelBox(origin_x + xs.min(), origin_y + ys.min(), origin_x + xs.max() + 1, origin_y + ys.max() + 1)


def crop_window(image_w: int, image_h: int, focus: list[PixelBox], size: int) -> PixelBox:
    """A size x size window (smaller if the image is smaller) centered on the focus boxes, kept inside the image.

    Cropping around pedestrian signals keeps them large after the detector's 640 px resize, which matches how
    big they look to the phone camera across a street.
    """
    win_w, win_h = min(size, image_w), min(size, image_h)
    if focus:
        cx = sum(b.cx for b in focus) / len(focus)
        cy = sum(b.cy for b in focus) / len(focus)
    else:
        cx, cy = image_w / 2, image_h / 2
    x0 = int(round(min(max(cx - win_w / 2, 0), image_w - win_w)))
    y0 = int(round(min(max(cy - win_h / 2, 0), image_h - win_h)))
    return PixelBox(x0, y0, x0 + win_w, y0 + win_h)


def visible_fraction(box: PixelBox, window: PixelBox) -> float:
    return box.intersect(window).area / box.area if box.area > 0 else 0.0


def to_yolo(box: PixelBox, window: PixelBox) -> tuple[float, float, float, float]:
    """Clips to the window and returns normalized cx, cy, w, h relative to it."""
    clipped = box.intersect(window)
    ww, wh = window.w, window.h
    return (
        (clipped.cx - window.x1) / ww,
        (clipped.cy - window.y1) / wh,
        clipped.w / ww,
        clipped.h / wh,
    )
