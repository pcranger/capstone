"""Format knowledge for external datasets: VIDVIP, DTLD and Mapillary Vistas.

Formats were checked against the official tools (Sept 2026):
  * VIDVIP: YOLO txt next to each jpg; class ids 0-16 are identical in every published class list
    (names_c39/c49/c50/c69/c71.txt), which covers everything CrossWise needs.
  * DTLD v2.0: JSON {"images": [{"image_path", "labels": [{"x","y","w","h","attributes","track_id",...}]}]};
    images are 12-bit Bayer (GB) TIFFs (dtld_parsing/driveu_dataset.py).
  * Vistas v2.0 official: images/*.jpg + v2.0/polygons/*.json {"height","width","objects":[{"label","polygon":[[x,y],...]}]}.
    Dataset Ninja (Supervisely): <split>/img/*.jpg + <split>/ann/*.jpg.json with "classTitle" = readable name lower-cased,
    geometry "polygon" (points.exterior [[x,y],...]) or "bitmap" (base64 zlib PNG + origin).
"""

from __future__ import annotations

import base64
import re
import zlib
from dataclasses import dataclass

import cv2
import numpy as np

from crosswise_ml.geometry import PixelBox, mask_box, polygon_box

# ---------------------------------------------------------------------------------------------------- VIDVIP

VIDVIP_NAMES = [
    "person", "bicycle", "car", "motorbike", "bus", "train", "truck", "boat", "traffic_light", "bicycler",
    "braille_block", "guardrail", "white_line", "crosswalk", "signal_button", "signal_red", "signal_blue",
]
# signal_red / signal_blue are pedestrian signals (Japan calls green "blue"); traffic_light is the vehicle signal.
VIDVIP_CLASS_MAP = {
    "signal_red": "ped_red",
    "signal_blue": "ped_green",
    "traffic_light": None,
    "bicycler": "bicycle",
    "train": None,
    "boat": None,
}

# ------------------------------------------------------------------------------------------------------ DTLD


@dataclass
class DtldLabel:
    x: float
    y: float
    w: float
    h: float
    pictogram: str
    state: str
    track_id: str


def dtld_labels(image_dict: dict) -> list[DtldLabel]:
    labels = []
    for o in image_dict.get("labels", []):
        attributes = o.get("attributes", {})
        labels.append(DtldLabel(
            x=float(o["x"]), y=float(o["y"]), w=float(o["w"]), h=float(o["h"]),
            pictogram=str(attributes.get("pictogram", "unknown")),
            state=str(attributes.get("state", "unknown")),
            track_id=str(o.get("track_id", "")),
        ))
    return labels


@dataclass
class DtldDecision:
    boxes: list[tuple[str, PixelBox]]  # (canonical class, box)
    usable: bool  # False when a clearly visible pedestrian light has an unknown state
    has_pedestrian: bool
    has_other_lights: bool
    too_small: bool = False  # every lit pedestrian light in the frame is smaller than min_height


def dtld_decide(labels: list[DtldLabel], min_height: float) -> DtldDecision:
    """Pedestrian lights with red/green become boxes; 'off' ones stay unlabeled (a dark head is background);
    unknown or odd states make the image unusable, so a lit signal is never taught as background.

    Every lit signal is labeled whatever its size — dropping the small ones would teach exactly that. `min_height`
    instead decides whether the frame is worth keeping at all: a frame whose biggest lit signal is a handful of
    pixels (DTLD is filmed from a car, so many are) becomes label noise rather than a useful example.
    """
    boxes: list[tuple[str, PixelBox]] = []
    usable, has_ped, has_other, biggest = True, False, False, 0.0
    for lab in labels:
        # 'pedestrian_bicycle' is a combined head that also governs pedestrians, so it is labeled, not left as
        # background — leaving a lit signal unlabeled is the one thing this pipeline must never do.
        if lab.pictogram not in ("pedestrian", "pedestrian_bicycle"):
            has_other = True
            continue
        has_ped = True
        box = PixelBox(lab.x, lab.y, lab.x + lab.w, lab.y + lab.h)
        if lab.state in ("red", "green"):
            boxes.append((f"ped_{lab.state}", box))
            biggest = max(biggest, lab.h)
        elif lab.state != "off":
            usable = False
    return DtldDecision(boxes, usable, has_ped, has_other, bool(boxes) and biggest < min_height)


def debayer_dtld(raw: np.ndarray) -> np.ndarray:
    """12-bit Bayer GB TIFF -> 8-bit BGR, exactly like the official loader."""
    bgr = cv2.cvtColor(raw, cv2.COLOR_BAYER_GB2BGR)
    return np.right_shift(bgr, 4).astype(np.uint8)


def dtld_relative_image_path(image_path: str) -> str:
    """Label files store absolute paths from the authors' machine; the last 4 parts are City/Route/Sequence/file."""
    parts = re.split(r"[\\/]+", image_path.strip())
    return "/".join(parts[-4:])


# ---------------------------------------------------------------------------------------------------- VISTAS

_WORDS = re.compile(r"[a-z]+")
_EXCLUDE = {"mount", "ego", "symbol", "marking", "lane", "sign", "frame", "rack", "parking", "group"}


def vistas_category(label: str) -> str | None:
    """Maps an official name ('object--traffic-light--pedestrians') or readable title ('traffic light - pedestrians')
    to 'ped_signal', 'crosswalk', a canonical traffic class, or None."""
    words = set(_WORDS.findall(label.lower()))
    if {"traffic", "light"} <= words:
        return "ped_signal" if words & {"pedestrian", "pedestrians"} else None
    if {"crosswalk", "zebra"} <= words:
        return "crosswalk"
    if words & _EXCLUDE:
        return None
    if words & {"person", "individual", "bicyclist", "motorcyclist"} or {"other", "rider"} <= words:
        return "person"
    for name in ("bicycle", "bus", "car", "motorcycle", "truck"):
        if name in words:
            return name
    return None


@dataclass
class VistasObject:
    label: str
    box: PixelBox
    polygon: list[list[float]] | None = None
    mask: np.ndarray | None = None  # cropped to the box, for bitmap geometry
    mask_origin: tuple[int, int] = (0, 0)


def vistas_objects_official(data: dict) -> list[VistasObject]:
    objects = []
    for o in data.get("objects", []):
        polygon = o.get("polygon") or []
        box = polygon_box(polygon)
        if box is not None:
            objects.append(VistasObject(o["label"], box, polygon=polygon))
    return objects


def decode_supervisely_bitmap(data: str) -> np.ndarray:
    raw = zlib.decompress(base64.b64decode(data))
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError("Cannot decode Supervisely bitmap")
    if image.ndim == 3 and image.shape[2] == 4:
        return image[:, :, 3] > 0
    if image.ndim == 2:
        return image > 0
    return image[:, :, 0] > 0


def vistas_objects_supervisely(data: dict) -> list[VistasObject]:
    objects = []
    for o in data.get("objects", []):
        title = o.get("classTitle", "")
        geometry = o.get("geometryType")
        if geometry == "polygon":
            polygon = o.get("points", {}).get("exterior", [])
            box = polygon_box(polygon)
            if box is not None:
                objects.append(VistasObject(title, box, polygon=polygon))
        elif geometry == "bitmap":
            mask = decode_supervisely_bitmap(o["bitmap"]["data"])
            ox, oy = (int(v) for v in o["bitmap"]["origin"])
            box = mask_box(mask, ox, oy)
            if box is not None:
                objects.append(VistasObject(title, box, mask=mask, mask_origin=(ox, oy)))
    return objects


def object_mask_in_crop(obj: VistasObject, crop: PixelBox) -> np.ndarray:
    """Boolean mask of the object inside an integer crop rectangle (for polygon or bitmap geometry)."""
    h, w = int(crop.h), int(crop.w)
    out = np.zeros((h, w), np.uint8)
    if obj.polygon is not None:
        pts = np.array([[p[0] - crop.x1, p[1] - crop.y1] for p in obj.polygon], np.int32)
        cv2.fillPoly(out, [pts], 1)
    elif obj.mask is not None:
        ox, oy = obj.mask_origin
        mh, mw = obj.mask.shape
        x0, y0 = int(ox - crop.x1), int(oy - crop.y1)
        xs, ys = max(0, x0), max(0, y0)
        xe, ye = min(w, x0 + mw), min(h, y0 + mh)
        if xe > xs and ye > ys:
            out[ys:ye, xs:xe] = obj.mask[ys - y0:ye - y0, xs - x0:xe - x0]
    return out.astype(bool)
