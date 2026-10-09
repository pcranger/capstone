import type { BoxF } from '../core/geometry';
import { ObjectCategory } from '../perception/detection';
import { type Track, TrackGroup } from '../tracking/objectTracker';

export enum SignalPhase {
  UNKNOWN = 'UNKNOWN',
  DONT_WALK = 'DONT_WALK',
  WALK = 'WALK',
  WALK_FLASHING = 'WALK_FLASHING',
  DONT_WALK_FLASHING = 'DONT_WALK_FLASHING',
}

export function isWalkPhase(p: SignalPhase): boolean {
  return p === SignalPhase.WALK || p === SignalPhase.WALK_FLASHING;
}

export function isDontWalkPhase(p: SignalPhase): boolean {
  return p === SignalPhase.DONT_WALK || p === SignalPhase.DONT_WALK_FLASHING;
}

export interface SignalSnapshot {
  phase: SignalPhase;
  /** False when the phase comes from the color heuristic on a generic light (could be a vehicle signal). */
  trusted: boolean;
  walkEvidence: number;
  dontWalkEvidence: number;
  primaryTrackId: number | null;
  primaryBox: BoxF | null;
  /** When the current phase began, only if that moment was actually observed. */
  phaseOnsetMs: number | null;
  /** True when this WALK phase was seen starting (DONT_WALK -> WALK), i.e. the full walk interval is ahead. */
  freshWalk: boolean;
  lastSeenMs: number | null;
}

export const EMPTY_SIGNAL: SignalSnapshot = {
  phase: SignalPhase.UNKNOWN,
  trusted: true,
  walkEvidence: 0,
  dontWalkEvidence: 0,
  primaryTrackId: null,
  primaryBox: null,
  phaseOnsetMs: null,
  freshWalk: false,
  lastSeenMs: null,
};

export type SignalEvent =
  | { type: 'acquired'; phase: SignalPhase; trusted: boolean }
  | { type: 'changed'; from: SignalPhase; to: SignalPhase; freshWalk: boolean; trusted: boolean }
  | { type: 'lost'; lastPhase: SignalPhase; lastBox: BoxF | null; trusted: boolean };

export interface SignalPhaseConfig {
  evidenceTauMs: number;
  walkOnEvidence: number;
  walkDwellMs: number;
  dontWalkOnEvidence: number;
  dontWalkDwellMs: number;
  dominance: number;
  lostAfterMs: number;
  freshMaxGapMs: number;
  freshMinDontWalkMs: number;
  flashWindowMs: number;
  flashMinRunMs: number;
  flashMaxRunMs: number;
  flashMaxCv: number;
  switchRatio: number;
  continuityDistance: number;
  candidateMaxAgeMs: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalPhaseConfig = {
  evidenceTauMs: 450,
  walkOnEvidence: 0.45,
  walkDwellMs: 700,
  dontWalkOnEvidence: 0.35,
  dontWalkDwellMs: 300,
  dominance: 2,
  lostAfterMs: 1_800,
  freshMaxGapMs: 3_000,
  freshMinDontWalkMs: 1_000,
  flashWindowMs: 4_000,
  flashMinRunMs: 180,
  flashMaxRunMs: 1_300,
  flashMaxCv: 0.45,
  switchRatio: 1.6,
  continuityDistance: 0.12,
  candidateMaxAgeMs: 300,
};

interface Presence {
  t: number;
  walk: boolean;
  dontWalk: boolean;
}

const NOMINAL_FRAME_MS = 100;
const UNTRUSTED_WEIGHT = 0.8;

/**
 * Turns noisy per-frame detections of one pedestrian signal into a stable phase with events.
 *
 * Design choices (see docs/DESIGN.md):
 *  - Leaky evidence accumulators make the output frame-rate independent.
 *  - Asymmetric dwell: announcing WALK needs more evidence and time than announcing DON'T WALK,
 *    because a false "walk" is far more dangerous than a late one.
 *  - Flashing (clearance interval) is detected from the on/off rhythm of detections, which a
 *    single-frame classifier cannot see.
 *  - A WALK phase is "fresh" only if the transition from DON'T WALK was observed; otherwise the user
 *    is told the walk sign may already be ending (O&M practice: start at the onset of the walk interval).
 */
export class SignalPhaseTracker {
  private lastUpdateMs: number | null = null;
  private primaryId: number | null = null;
  private primaryBox: BoxF | null = null;
  private primaryLastSeenMs: number | null = null;
  private walkEvidence = 0;
  private dontWalkEvidence = 0;
  private trusted = true;
  private presence: Presence[] = [];

  private phase = SignalPhase.UNKNOWN;
  private phaseOnsetMs: number | null = null;
  private freshWalk = false;
  private pending: SignalPhase | null = null;
  private pendingSinceMs = 0;

  private dontWalkPhaseStartMs: number | null = null;
  private lastDontWalkSeenMs: number | null = null;
  private lastDontWalkDurationMs = 0;

  constructor(private readonly config: SignalPhaseConfig = DEFAULT_SIGNAL_CONFIG) {}

  get snapshot(): SignalSnapshot {
    return {
      phase: this.phase,
      trusted: this.trusted,
      walkEvidence: this.walkEvidence,
      dontWalkEvidence: this.dontWalkEvidence,
      primaryTrackId: this.primaryId,
      primaryBox: this.primaryBox,
      phaseOnsetMs: this.phaseOnsetMs,
      freshWalk: this.freshWalk,
      lastSeenMs: this.primaryLastSeenMs,
    };
  }

  get currentPhase(): SignalPhase {
    return this.phase;
  }

  reset(): void {
    this.lastUpdateMs = null;
    this.primaryId = null;
    this.primaryBox = null;
    this.primaryLastSeenMs = null;
    this.clearPhaseHistory();
    this.lastDontWalkSeenMs = null;
    this.lastDontWalkDurationMs = 0;
    this.dontWalkPhaseStartMs = null;
    this.phase = SignalPhase.UNKNOWN;
    this.phaseOnsetMs = null;
    this.freshWalk = false;
    this.trusted = true;
  }

  update(timestampMs: number, tracks: readonly Track[], shiftX = 0, shiftY = 0): SignalEvent[] {
    const c = this.config;
    const events: SignalEvent[] = [];
    const dt =
      this.lastUpdateMs !== null ? Math.min(Math.max(timestampMs - this.lastUpdateMs, 1), 1_000) : NOMINAL_FRAME_MS;
    this.lastUpdateMs = timestampMs;
    this.primaryBox = this.primaryBox?.offset(shiftX, shiftY) ?? null;

    this.selectPrimary(timestampMs, tracks, events);

    let observedWalk = 0;
    let observedDontWalk = 0;
    const primary = tracks.find((t) => t.id === this.primaryId);
    if (primary && primary.isSeenAt(timestampMs)) {
      const sample = primary.latest;
      this.primaryBox = primary.box;
      this.primaryLastSeenMs = timestampMs;
      if (sample.category === ObjectCategory.PED_WALK) {
        observedWalk = sample.score;
        this.trusted = true;
      } else if (sample.category === ObjectCategory.PED_DONT_WALK) {
        observedDontWalk = sample.score;
        this.trusted = true;
      } else if (sample.category === ObjectCategory.TRAFFIC_LIGHT && sample.colorHint === 'GREEN') {
        observedWalk = sample.score * UNTRUSTED_WEIGHT;
        this.trusted = false;
      } else if (sample.category === ObjectCategory.TRAFFIC_LIGHT && sample.colorHint === 'RED') {
        observedDontWalk = sample.score * UNTRUSTED_WEIGHT;
        this.trusted = false;
      }
    }
    if (observedDontWalk > 0) this.lastDontWalkSeenMs = timestampMs;

    const decay = Math.exp(-dt / c.evidenceTauMs);
    this.walkEvidence = decay * this.walkEvidence + (1 - decay) * observedWalk;
    this.dontWalkEvidence = decay * this.dontWalkEvidence + (1 - decay) * observedDontWalk;

    if (this.primaryId !== null) {
      this.presence.push({ t: timestampMs, walk: observedWalk > 0, dontWalk: observedDontWalk > 0 });
      while (this.presence.length > 0 && timestampMs - this.presence[0].t > c.flashWindowMs) this.presence.shift();
    }

    const lastSeen = this.primaryLastSeenMs;
    if (this.phase !== SignalPhase.UNKNOWN && (lastSeen === null || timestampMs - lastSeen > c.lostAfterMs)) {
      events.push({ type: 'lost', lastPhase: this.phase, lastBox: this.primaryBox, trusted: this.trusted });
      this.endPhase(timestampMs);
      this.clearPhaseHistory();
      return events;
    }

    let candidate: SignalPhase | null = null;
    if (this.isFlashing((p) => p.walk) && this.walkEvidence > 0.12) candidate = SignalPhase.WALK_FLASHING;
    else if (this.isFlashing((p) => p.dontWalk) && this.dontWalkEvidence > 0.12) {
      candidate = SignalPhase.DONT_WALK_FLASHING;
    } else if (this.walkEvidence >= c.walkOnEvidence && this.walkEvidence >= c.dominance * this.dontWalkEvidence) {
      candidate = SignalPhase.WALK;
    } else if (
      this.dontWalkEvidence >= c.dontWalkOnEvidence &&
      this.dontWalkEvidence >= c.dominance * this.walkEvidence
    ) {
      candidate = SignalPhase.DONT_WALK;
    }
    if (candidate === null || candidate === this.phase) {
      this.pending = null;
      return events;
    }
    if (this.pending !== candidate) {
      this.pending = candidate;
      this.pendingSinceMs = timestampMs;
    }
    const dwell =
      candidate === SignalPhase.WALK ? c.walkDwellMs : candidate === SignalPhase.DONT_WALK ? c.dontWalkDwellMs : 0;
    if (timestampMs - this.pendingSinceMs < dwell) return events;

    this.confirm(candidate, this.pendingSinceMs, events);
    return events;
  }

  private confirm(next: SignalPhase, onsetMs: number, events: SignalEvent[]): void {
    const c = this.config;
    const previous = this.phase;
    if (isDontWalkPhase(previous) && !isDontWalkPhase(next)) {
      this.lastDontWalkDurationMs = onsetMs - (this.dontWalkPhaseStartMs ?? onsetMs);
    }
    switch (next) {
      case SignalPhase.WALK: {
        if (isDontWalkPhase(previous)) {
          this.freshWalk = this.lastDontWalkDurationMs >= c.freshMinDontWalkMs;
        } else if (previous === SignalPhase.UNKNOWN) {
          const gap = this.lastDontWalkSeenMs !== null ? onsetMs - this.lastDontWalkSeenMs : null;
          this.freshWalk =
            gap !== null && gap <= c.freshMaxGapMs && this.lastDontWalkDurationMs >= c.freshMinDontWalkMs;
        } else {
          this.freshWalk = false;
        }
        this.phaseOnsetMs = this.freshWalk ? onsetMs : null;
        break;
      }
      case SignalPhase.WALK_FLASHING:
        this.freshWalk = false;
        this.phaseOnsetMs = null;
        break;
      case SignalPhase.DONT_WALK:
      case SignalPhase.DONT_WALK_FLASHING:
        if (!isDontWalkPhase(previous)) this.dontWalkPhaseStartMs = onsetMs;
        this.freshWalk = false;
        this.phaseOnsetMs = previous !== SignalPhase.UNKNOWN ? onsetMs : null;
        break;
      case SignalPhase.UNKNOWN:
        break;
    }
    this.phase = next;
    this.pending = null;
    if (previous === SignalPhase.UNKNOWN && !(next === SignalPhase.WALK && this.freshWalk)) {
      events.push({ type: 'acquired', phase: next, trusted: this.trusted });
    } else {
      const from = previous === SignalPhase.UNKNOWN ? SignalPhase.DONT_WALK : previous;
      events.push({ type: 'changed', from, to: next, freshWalk: this.freshWalk, trusted: this.trusted });
    }
  }

  private endPhase(timestampMs: number): void {
    if (isDontWalkPhase(this.phase)) {
      this.lastDontWalkDurationMs = timestampMs - (this.dontWalkPhaseStartMs ?? timestampMs);
    }
    this.phase = SignalPhase.UNKNOWN;
    this.phaseOnsetMs = null;
    this.freshWalk = false;
  }

  private clearPhaseHistory(): void {
    this.walkEvidence = 0;
    this.dontWalkEvidence = 0;
    this.presence = [];
    this.pending = null;
  }

  private bearsPhase(track: Track): boolean {
    return track.samples.some(
      (s) =>
        s.category === ObjectCategory.PED_WALK ||
        s.category === ObjectCategory.PED_DONT_WALK ||
        (s.category === ObjectCategory.TRAFFIC_LIGHT && s.colorHint !== null),
    );
  }

  private primaryScore(track: Track): number {
    const b = track.box;
    const centerWeight = 1 - 0.8 * Math.abs(b.centerX - 0.5);
    const sizeWeight = Math.min(Math.max(b.height / 0.04, 0.3), 1);
    const maturity = Math.min(1, track.hits / 5);
    return track.confidence * centerWeight * sizeWeight * maturity;
  }

  private selectPrimary(timestampMs: number, tracks: readonly Track[], events: SignalEvent[]): void {
    const c = this.config;
    const candidates = tracks.filter(
      (t) =>
        t.group === TrackGroup.SIGNAL &&
        timestampMs - t.lastSeenMs <= c.candidateMaxAgeMs &&
        t.hits >= 2 &&
        this.bearsPhase(t),
    );
    let best: Track | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const t of candidates) {
      const s = this.primaryScore(t);
      if (s > bestScore) {
        best = t;
        bestScore = s;
      }
    }
    if (best === null) return;
    const current = tracks.find((t) => t.id === this.primaryId) ?? null;
    if (current !== null && current.id === best.id) return;
    if (current !== null && bestScore <= c.switchRatio * this.primaryScore(current)) return;

    const referenceBox = current?.box ?? this.primaryBox;
    // Same window as fresh-walk detection, so a brief occlusion during DON'T WALK keeps the history.
    const recentlySeen = this.primaryLastSeenMs !== null && timestampMs - this.primaryLastSeenMs <= c.freshMaxGapMs;
    const continuation =
      referenceBox !== null && recentlySeen && best.box.centerDistance(referenceBox) <= c.continuityDistance;
    if (this.primaryId !== null && !continuation) {
      // The user is now looking at a different physical signal: its history does not carry over.
      if (this.phase !== SignalPhase.UNKNOWN) {
        events.push({ type: 'lost', lastPhase: this.phase, lastBox: this.primaryBox, trusted: this.trusted });
      }
      this.endPhase(timestampMs);
      this.clearPhaseHistory();
      this.lastDontWalkSeenMs = null;
      this.lastDontWalkDurationMs = 0;
    }
    this.primaryId = best.id;
  }

  private isFlashing(selector: (p: Presence) => boolean): boolean {
    const c = this.config;
    const presence = this.presence;
    if (presence.length < 8) return false;
    const span = presence[presence.length - 1].t - presence[0].t;
    if (span < c.flashWindowMs * 0.6) return false;

    const on: number[] = [];
    const off: number[] = [];
    let runValue = selector(presence[0]);
    let runStart = presence[0].t;
    let isFirstRun = true;
    for (let i = 1; i < presence.length; i++) {
      const p = presence[i];
      const v = selector(p);
      if (v !== runValue) {
        if (!isFirstRun) (runValue ? on : off).push(p.t - runStart);
        isFirstRun = false;
        runValue = v;
        runStart = p.t;
      }
    }
    // The last run is still open (partial), so it is not counted.
    if (on.length < 2 || off.length < 2) return false;
    if ([...on, ...off].some((d) => d < c.flashMinRunMs || d > c.flashMaxRunMs)) return false;
    return coefficientOfVariation(on) <= c.flashMaxCv && coefficientOfVariation(off) <= c.flashMaxCv;
  }
}

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return Number.MAX_VALUE;
  const variance = values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
}
