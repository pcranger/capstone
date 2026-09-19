"""Temporal consistency for auto-labeling video: a signal keeps one phase for many seconds."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass


@dataclass
class TrackSample:
    t_ms: float
    state: str  # "ped_red" / "ped_green"
    conf: float


@dataclass
class SmoothedSample:
    t_ms: float
    state: str
    near_change: bool


def smooth_states(samples: list[TrackSample], window_ms: float = 1000.0, change_margin_ms: float = 700.0) -> list[SmoothedSample]:
    """Confidence-weighted majority vote over ±window_ms, then marks samples close to a phase change.

    Frames near a change are where single-frame labels are least trustworthy (the lamp is switching, the
    detector flickers), so the auto-labeler flags them for review instead of accepting them.
    """
    ordered = sorted(samples, key=lambda s: s.t_ms)
    voted: list[str] = []
    for s in ordered:
        weights: dict[str, float] = defaultdict(float)
        for other in ordered:
            if abs(other.t_ms - s.t_ms) <= window_ms:
                weights[other.state] += other.conf
        best = max(weights.items(), key=lambda kv: (kv[1], kv[0] == s.state))[0]
        voted.append(best)
    changes = [
        (ordered[i - 1].t_ms + ordered[i].t_ms) / 2
        for i in range(1, len(ordered)) if voted[i] != voted[i - 1]
    ]
    return [
        SmoothedSample(s.t_ms, voted[i], any(abs(s.t_ms - c) <= change_margin_ms for c in changes))
        for i, s in enumerate(ordered)
    ]
