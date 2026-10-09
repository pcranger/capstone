import type { BoxF } from '../core/geometry';
import {
  type Detection,
  isSignal,
  isVehicle,
  ObjectCategory,
  type SignalColor,
} from '../perception/detection';

export interface TrackSample {
  timestampMs: number;
  box: BoxF;
  score: number;
  category: ObjectCategory;
  colorHint: SignalColor | null;
}

/**
 * Objects that may legitimately change class between frames stay in one group, so e.g. a signal
 * switching from red to green keeps its track (and its phase history).
 */
export enum TrackGroup {
  SIGNAL = 'SIGNAL',
  VEHICLE = 'VEHICLE',
  CROSSWALK = 'CROSSWALK',
  PERSON = 'PERSON',
  OTHER = 'OTHER',
}

export function trackGroupOf(category: ObjectCategory): TrackGroup {
  if (isSignal(category)) return TrackGroup.SIGNAL;
  if (isVehicle(category)) return TrackGroup.VEHICLE;
  if (category === ObjectCategory.CROSSWALK) return TrackGroup.CROSSWALK;
  if (category === ObjectCategory.PERSON) return TrackGroup.PERSON;
  return TrackGroup.OTHER;
}

export class Track {
  private readonly history: TrackSample[];
  readonly group: TrackGroup;
  readonly firstSeenMs: number;
  lastSeenMs: number;
  hits = 1;
  /** Smoothed detection confidence; decays while the object is not detected. */
  confidence: number;
  /** Last box, shifted by camera motion accumulated since it was last detected. */
  box: BoxF;

  constructor(
    readonly id: number,
    first: TrackSample,
  ) {
    this.history = [first];
    this.group = trackGroupOf(first.category);
    this.firstSeenMs = first.timestampMs;
    this.lastSeenMs = first.timestampMs;
    this.confidence = first.score;
    this.box = first.box;
  }

  get latest(): TrackSample {
    return this.history[this.history.length - 1];
  }
  get category(): ObjectCategory {
    return this.latest.category;
  }
  get samples(): readonly TrackSample[] {
    return this.history;
  }

  isSeenAt(timestampMs: number): boolean {
    return this.lastSeenMs === timestampMs;
  }

  /** @internal */
  addSample(sample: TrackSample): void {
    this.history.push(sample);
    this.lastSeenMs = sample.timestampMs;
    this.hits++;
    this.confidence = 0.6 * this.confidence + 0.4 * sample.score;
    this.box = sample.box;
  }

  /** @internal */
  markMissed(shiftX: number, shiftY: number): void {
    this.confidence *= 0.7;
    this.box = this.box.offset(shiftX, shiftY);
  }

  /** @internal */
  shift(shiftX: number, shiftY: number): void {
    this.box = this.box.offset(shiftX, shiftY);
  }

  /** @internal */
  trimBefore(timestampMs: number): void {
    while (this.history.length > 1 && this.history[0].timestampMs < timestampMs) this.history.shift();
  }
}

interface MatchCandidate {
  track: number;
  detection: number;
  score: number;
}

/**
 * Greedy IoU + center-distance tracker. Camera rotation (from the gyroscope) can be passed in as an
 * image-space shift so small objects like signal heads keep their identity while the user scans.
 */
export class ObjectTracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(
    private readonly maxMissMs = 900,
    private readonly historyMs = 3_000,
    private readonly minIou = 0.15,
  ) {}

  get activeTracks(): readonly Track[] {
    return this.tracks;
  }

  /**
   * @param shiftX expected horizontal image motion of static scene points since the previous call,
   * in normalized units (+ = moves right). Similarly shiftY (+ = moves down).
   */
  update(detections: Detection[], timestampMs: number, shiftX = 0, shiftY = 0): readonly Track[] {
    const predicted = this.tracks.map((t) => t.box.offset(shiftX, shiftY));
    const pairs: MatchCandidate[] = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      const tb = predicted[ti];
      for (let di = 0; di < detections.length; di++) {
        const det = detections[di];
        if (trackGroupOf(det.category) !== this.tracks[ti].group) continue;
        // Do not give a large parked foreground car the identity of a small passing car.
        const areaRatio = det.box.area / Math.max(tb.area, 1e-8);
        if (this.tracks[ti].group === TrackGroup.VEHICLE && (areaRatio < .4 || areaRatio > 2.5)) continue;
        const iou = tb.iou(det.box);
        const gate = Math.max(tb.diagonal, det.box.diagonal) * 1.5 + 0.02;
        const dist = tb.centerDistance(det.box);
        if (iou >= this.minIou || dist <= gate) {
          const closeness = 1 - Math.min(Math.max(dist / gate, 0), 1);
          pairs.push({ track: ti, detection: di, score: iou + 0.5 * closeness });
        }
      }
    }
    // Stable, like Kotlin's sortByDescending: ties keep insertion order.
    pairs.sort((a, b) => b.score - a.score);

    const trackUsed = new Array<boolean>(this.tracks.length).fill(false);
    const detectionUsed = new Array<boolean>(detections.length).fill(false);
    for (const p of pairs) {
      if (trackUsed[p.track] || detectionUsed[p.detection]) continue;
      trackUsed[p.track] = true;
      detectionUsed[p.detection] = true;
      this.tracks[p.track].addSample(toSample(detections[p.detection], timestampMs));
    }
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!trackUsed[ti]) this.tracks[ti].markMissed(shiftX, shiftY);
    }
    for (let di = 0; di < detections.length; di++) {
      if (!detectionUsed[di]) this.tracks.push(new Track(this.nextId++, toSample(detections[di], timestampMs)));
    }
    this.tracks = this.tracks.filter((t) => timestampMs - t.lastSeenMs <= this.maxMissMs);
    for (const t of this.tracks) t.trimBefore(timestampMs - this.historyMs);
    return this.tracks;
  }

  /** Applies camera motion without new detections (e.g. between analyzed frames). */
  shiftAll(shiftX: number, shiftY: number): void {
    for (const t of this.tracks) t.shift(shiftX, shiftY);
  }

  clear(): void {
    this.tracks = [];
  }
}

function toSample(d: Detection, t: number): TrackSample {
  return { timestampMs: t, box: d.box, score: d.score, category: d.category, colorHint: d.colorHint ?? null };
}
