"""Canonical class schema, shared with the Android app (see LabelMapper.kt).

The order of CANONICAL defines the class ids of the trained model. The app reads the names from the
model metadata, so ids may change between versions, but the *names* must stay canonical.
"""

from __future__ import annotations

import re

CANONICAL: list[str] = [
    "ped_red",  # pedestrian signal: don't walk (red standing figure / orange hand)
    "ped_green",  # pedestrian signal: walk (green walking figure / white walking person)
    "crosswalk",  # zebra / marked crossing
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
]
CANONICAL_ID = {name: i for i, name in enumerate(CANONICAL)}
SIGNAL_CLASSES = {"ped_red", "ped_green"}
TRAFFIC_CLASSES = {"person", "bicycle", "car", "motorcycle", "bus", "truck"}

# COCO class id -> canonical name, for teacher pseudo-labels.
COCO_TO_CANONICAL = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

_EXACT = {
    "ped_red": "ped_red",
    "ped_green": "ped_green",
    "crosswalk": "crosswalk",
    "person": "person",
    "pedestrian": "person",
    "pedestrians": "person",
    "people": "person",
    "bicycle": "bicycle",
    "bike": "bicycle",
    "car": "car",
    "van": "car",
    "taxi": "car",
    "motorcycle": "motorcycle",
    "motorbike": "motorcycle",
    "scooter": "motorcycle",
    "bus": "bus",
    "truck": "truck",
    "lorry": "truck",
}
_SEPARATORS = re.compile(r"[^a-z0-9]+")


def normalize(raw: str) -> str:
    return _SEPARATORS.sub("_", raw.strip().lower().replace("'", "")).strip("_")


def canonical_name(raw: str) -> str | None:
    """Maps a dataset's class name to a canonical name, or None to drop the label.

    Same token rules as the app's LabelMapper, except that ambiguous lights (a red/green light with no
    pedestrian hint, which may be a vehicle signal) and countdown displays are dropped for training.
    """
    n = normalize(raw)
    if n in _EXACT:
        return _EXACT[n]
    tokens = [t for t in n.split("_") if t]

    def tok(*words: str) -> bool:
        return any(t in words for t in tokens)

    def prefix(*words: str) -> bool:
        return any(t.startswith(w) for t in tokens for w in words)

    light_word = prefix("light", "signal", "lamp")
    color_word = tok("red", "green")
    if prefix("zebra", "crosswalk", "crossing") and not light_word and not color_word:
        return "crosswalk"
    if prefix("countdown", "timer", "digit"):
        return None
    pedestrian_hint = prefix("ped", "cross") or tok("walk", "walking", "man", "hand", "person", "dontwalk", "nowalk")
    if light_word or pedestrian_hint:
        stop = tok("red", "stop", "dont", "donot", "no", "wait", "hand", "dontwalk", "nowalk")
        go = tok("green", "go", "walk", "walking", "white")
        if stop and pedestrian_hint:
            return "ped_red"
        if go and pedestrian_hint:
            return "ped_green"
        return None
    return None


def resolve_class_map(source_names: list[str], overrides: dict[str, str | None] | None) -> dict[int, int | None]:
    """Source class id -> canonical class id (None = drop). Explicit overrides win over the rules."""
    overrides = {normalize(k): v for k, v in (overrides or {}).items()}
    result: dict[int, int | None] = {}
    for i, name in enumerate(source_names):
        key = normalize(name)
        target = overrides[key] if key in overrides else canonical_name(name)
        if target is not None and target not in CANONICAL_ID:
            raise ValueError(f"Override for '{name}' points to unknown class '{target}'. Use one of {CANONICAL}.")
        result[i] = CANONICAL_ID[target] if target is not None else None
    return result
