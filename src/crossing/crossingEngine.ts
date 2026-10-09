import { VehicleMotion, type MotionState, type MotionDirection } from '../tracking/vehicleMotion';
import { TrafficScan } from './trafficScan';
import { Angles, type BoxF } from '../core/geometry';
import { type Cue, Cues, HapticPattern, Phrase, Priority, ToneKind, Verbosity } from '../feedback/cue';
import type { FrameDetections, ObjectCategory } from '../perception/detection';
import type { OrientationSample } from '../sensors/orientationMath';
import {
  EMPTY_SIGNAL,
  isDontWalkPhase,
  isWalkPhase,
  type SignalEvent,
  SignalPhase,
  SignalPhaseTracker,
  type SignalSnapshot,
} from '../signal/signalPhaseTracker';
import { ObjectTracker, type Track, TrackGroup } from '../tracking/objectTracker';
import { AimGuide } from './aimGuide';
import { HazardLevel, HazardMonitor, Side, type VehicleHazard } from './hazardMonitor';
import { VeerMonitor, type VeerStatus } from './veerMonitor';

/**
 * IDLE: camera may run, nothing is announced.
 * SEARCHING: looking for a pedestrian signal; tilt/scan hints and aiming sonar.
 * WAITING: a signal is being tracked at the curb; phase changes are announced.
 * CROSSING: heading diagnostics and more sensitive vehicle alerts.
 */
export enum AssistMode {
  IDLE = 'IDLE',
  SEARCHING = 'SEARCHING',
  WAITING = 'WAITING',
  CROSSING = 'CROSSING',
}

export enum UserCommand {
  START_ASSIST = 'START_ASSIST',
  STOP_ASSIST = 'STOP_ASSIST',
  START_CROSSING = 'START_CROSSING',
  END_CROSSING = 'END_CROSSING',
  TOGGLE_CROSSING = 'TOGGLE_CROSSING',
  REPEAT_STATUS = 'REPEAT_STATUS',
}

export interface EngineSettings {
  pedestrianSignals?: boolean;
  aimSonar: boolean;
  veerGuidance: boolean;
  vehicleAlerts: boolean;
  autoDetectCrossing: boolean;
  verbosity: Verbosity;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  aimSonar: true,
  veerGuidance: true,
  vehicleAlerts: true,
  autoDetectCrossing: true,
  verbosity: Verbosity.NORMAL,
};

export interface CameraGeometry {
  hfovDeg: number;
  vfovDeg: number;
}

export interface TrackView {
  id: number;
  box: BoxF;
  category: ObjectCategory;
  confidence: number;
  isPrimarySignal: boolean;
  motion?: MotionState;
  motionSupported?: boolean;
  direction?: MotionDirection;
}

export interface EngineSnapshot {
  mode: AssistMode;
  signal: SignalSnapshot;
  hazards: VehicleHazard[];
  veer: VeerStatus | null;
  aimBearingDeg: number | null;
  pitchDeg: number | null;
  walking: boolean;
  tracks: TrackView[];
  crossingElapsedMs: number | null;
}

export const EMPTY_SNAPSHOT: EngineSnapshot = {
  mode: AssistMode.IDLE,
  signal: EMPTY_SIGNAL,
  hazards: [],
  veer: null,
  aimBearingDeg: null,
  pitchDeg: null,
  walking: false,
  tracks: [],
  crossingElapsedMs: null,
};

export interface EngineOutput {
  cues: Cue[];
  snapshot: EngineSnapshot;
}

const HEADING_AVERAGE_MS = 1_000;

export class CrossingEngine {
  settings: EngineSettings;

  private readonly vehicleMotion = new VehicleMotion();
  private readonly trafficScan = new TrafficScan();
  private scanSequence=0;
  private scanBlocked=true;
  scanInstruction: { phrase:Phrase; token:number } | null = null;
  private lastTrafficFrameMs = -Infinity;
  private trafficUsable = false;
  private directionAnchor: number | null = null;
  private lastVehicleCueMs = -Infinity;
  private readonly tracker = new ObjectTracker();
  private readonly signal = new SignalPhaseTracker();
  private readonly hazardMonitor = new HazardMonitor();
  private readonly veer = new VeerMonitor();
  private readonly aim = new AimGuide();
  private readonly lastSpokenMs = new Map<Phrase, number>();

  mode = AssistMode.IDLE;

  private orientation: OrientationSample | null = null;
  private recentHeadings: OrientationSample[] = [];
  private lastFrameOrientation: OrientationSample | null = null;
  private geometry: CameraGeometry = { hfovDeg: 60, vfovDeg: 45 };
  private walking = false;
  private walkingSinceMs: number | null = null;
  private crossingStartMs: number | null = null;
  private pitchLowSinceMs: number | null = null;
  private pitchHighSinceMs: number | null = null;
  private warnedWalkingOnDontWalk = false;
  private readonly announcedHazards = new Map<number, [HazardLevel, number]>();
  /** Track ids already told "approaching"; that first announcement skips the 3 s repeat rule (CW-5). */
  private readonly approachHeard = new Set<number>();
  private hazards: VehicleHazard[] = [];
  private veerStatus: VeerStatus | null = null;
  private aimBearing: number | null = null;
  private trackViews: TrackView[] = [];
  private lastTimestampMs = 0;

  constructor(settings: EngineSettings = DEFAULT_ENGINE_SETTINGS) {
    this.settings = settings;
  }

  get snapshot(): EngineSnapshot {
    return {
      mode: this.mode,
      signal: this.signal.snapshot,
      hazards: this.hazards,
      veer: this.veerStatus,
      aimBearingDeg: this.aimBearing,
      pitchDeg: this.orientation?.pitchDeg ?? null,
      walking: this.walking,
      tracks: this.trackViews,
      crossingElapsedMs: this.crossingStartMs !== null ? this.lastTimestampMs - this.crossingStartMs : null,
    };
  }

  command(command: UserCommand, nowMs: number): EngineOutput {
    this.lastTimestampMs = Math.max(this.lastTimestampMs, nowMs);
    const cues: Cue[] = [];
    switch (command) {
      case UserCommand.START_ASSIST:
        if (this.mode === AssistMode.IDLE) {
          this.mode = AssistMode.SEARCHING;
          this.invalidatePerception(); this.directionAnchor=null;
          cues.push(Cues.speak(Phrase.ASSIST_STARTED, Priority.HIGH));
        }
        break;
      case UserCommand.STOP_ASSIST:
        if (this.mode !== AssistMode.IDLE) {
          this.endCrossingInternal();
          this.mode = AssistMode.IDLE;
          this.invalidatePerception(); this.directionAnchor=null;
          cues.push(Cues.speak(Phrase.ASSIST_STOPPED, Priority.HIGH));
        }
        break;
      case UserCommand.START_CROSSING:
        this.startCrossing(nowMs, false, cues);
        break;
      case UserCommand.END_CROSSING:
        if (this.mode === AssistMode.CROSSING) this.endCrossing(nowMs, cues);
        break;
      case UserCommand.TOGGLE_CROSSING:
        if (this.mode === AssistMode.CROSSING) this.endCrossing(nowMs, cues);
        else this.startCrossing(nowMs, false, cues);
        break;
      case UserCommand.REPEAT_STATUS:
        if (this.mode !== AssistMode.IDLE) cues.push(...this.statusCues(nowMs));
        break;
    }
    return { cues, snapshot: this.snapshot };
  }

  acknowledgeScan(token:number): void { if(this.scanInstruction?.token===token)this.scanInstruction=null; }
  canSpeakScan(token:number, now:number):boolean {
    return this.settings.vehicleAlerts && this.scanInstruction?.token===token && !this.scanBlocked && this.trafficUsable && now-this.lastTrafficFrameMs<400 && !this.walking && (this.mode===AssistMode.SEARCHING || this.mode===AssistMode.WAITING);
  }
  invalidatePerception(): void {
    this.scanInstruction=null;this.scanSequence++;this.scanBlocked=true;
    this.vehicleMotion.reset(); this.trafficScan.reset(); this.hazards=[]; this.trackViews=[];
    this.lastTrafficFrameMs=-Infinity; this.trafficUsable=false;
    this.tracker.clear(); this.signal.reset(); this.lastFrameOrientation=null;
  }

  /** Call regularly (about 10 Hz) with the latest sensor state, independent of the camera frame rate. */
  onSensors(nowMs: number, sample: OrientationSample | null, isWalking: boolean): EngineOutput {
    this.lastTimestampMs = Math.max(this.lastTimestampMs, nowMs);
    if (sample !== null) {
      this.orientation = sample;
      this.recentHeadings.push(sample);
      while (this.recentHeadings.length > 0 && nowMs - this.recentHeadings[0].timestampMs > HEADING_AVERAGE_MS) {
        this.recentHeadings.shift();
      }
    }
    this.updateWalking(nowMs, isWalking);
    const cues: Cue[] = [];
    switch (this.mode) {
      case AssistMode.IDLE:
        break;
      case AssistMode.CROSSING: {
        // Stillness may mean a refuge island or a pause in the road. Elapsed time and sensor gaps do not
        // establish arrival either: only an explicit end command (or stopping assistance) leaves this mode.
        this.crossingGuidance(nowMs, cues);
        break;
      }
      case AssistMode.SEARCHING:
      case AssistMode.WAITING:
        this.curbGuidance(nowMs, cues);
        break;
    }
    return { cues, snapshot: this.snapshot };
  }

  onFrame(frame: FrameDetections, cameraGeometry: CameraGeometry): EngineOutput {
    const now = frame.timestampMs;
    this.lastTimestampMs = Math.max(this.lastTimestampMs, now);
    this.geometry = cameraGeometry;
    const cues: Cue[] = [];

    let shiftX = 0;
    let shiftY = 0;
    const current = this.orientation;
    const previous = this.lastFrameOrientation;
    if (current && previous && this.geometry.hfovDeg > 1 && this.geometry.vfovDeg > 1) {
      const dYaw = Angles.wrap180(current.headingDeg - previous.headingDeg);
      const dPitch = current.pitchDeg - previous.pitchDeg;
      if (Math.abs(dYaw) < 45 && Math.abs(dPitch) < 45) {
        shiftX = -dYaw / this.geometry.hfovDeg;
        shiftY = dPitch / this.geometry.vfovDeg;
      }
    }
    this.lastFrameOrientation = current;

    const tracks = this.tracker.update(frame.detections, now, shiftX, shiftY);
    const events = this.signal.update(now, tracks, shiftX, shiftY);
    const signalSnapshot = this.signal.snapshot;

    for (const event of events) {
      if (event.type === 'acquired' || event.type === 'changed') {
        if (this.mode === AssistMode.SEARCHING) this.mode = AssistMode.WAITING;
      } else if (this.mode === AssistMode.WAITING) {
        this.mode = AssistMode.SEARCHING;
      }
      if (isDontWalkPhase(signalSnapshot.phase)) this.warnedWalkingOnDontWalk = false;
      if (this.mode !== AssistMode.IDLE) cues.push(...this.signalCues(event, now, false));
    }

    const frameAspect = frame.frameWidth / Math.max(frame.frameHeight, 1);
    if(this.directionAnchor===null && current) this.directionAnchor=current.headingDeg;
    const motion = this.vehicleMotion.update(tracks, frame.detections, frame.motionImage, now, this.walking);
    this.lastTrafficFrameMs=now;
    this.trafficUsable = this.vehicleMotion.reliable && (frame.brightness ?? 0)>.12;
    const looming = this.hazardMonitor.assess(tracks, now, frameAspect, this.mode === AssistMode.CROSSING);
    this.hazards = this.settings.vehicleAlerts ? tracks.filter(t => t.group === TrackGroup.VEHICLE && t.isSeenAt(now) && (motion.get(t.id)?.state === 'MOVING' || !motion.get(t.id)?.supported || looming.some(h => h.trackId === t.id))).map(t => {
      const estimate = motion.get(t.id);
      const growing = looming.find(h => h.trackId === t.id);
      // CW-14: growth must hold for a few frames in a row. A 1-2 frame jump (sway, walking jolt, box jitter) is not "approaching".
      const urgent = growing?.sustained ? growing : undefined;
      // Direction is camera-relative. During a scan or stale orientation, do not claim a body-relative side.
      const steady = current && previous && this.directionAnchor!==null && Math.abs(Angles.wrap180(current.headingDeg-this.directionAnchor))<12 && Math.abs(Angles.wrap180(current.headingDeg-previous.headingDeg)) < 2 && Math.abs(now-current.timestampMs)<300;
      const direction = steady ? estimate?.direction : 'UNKNOWN';
      return { trackId:t.id, category:t.category, uncertain:!estimate?.supported, approaching:!!urgent && !!estimate?.supported, pending:!!growing && !urgent && !!estimate?.supported && estimate.state!=='MOVING', level:urgent?.level ?? HazardLevel.WARNING,
        side:direction==='LEFT_TO_RIGHT'?Side.LEFT:direction==='RIGHT_TO_LEFT'?Side.RIGHT:Side.AHEAD,
        ttcSeconds:urgent?.ttcSeconds ?? Infinity, heightFraction:t.box.height };
    }).sort((a,b)=>a.ttcSeconds-b.ttcSeconds || b.heightFraction-a.heightFraction) : [];
    if (this.mode !== AssistMode.IDLE) cues.push(...this.hazardCues(now));
    if(this.mode===AssistMode.SEARCHING || this.mode===AssistMode.WAITING) {
      const usable=this.settings.vehicleAlerts && this.vehicleMotion.reliable && !this.walking && !!current && Math.abs(now-current.timestampMs)<300 && Math.abs(current.pitchDeg)<30 && (frame.brightness ?? 0)>.12;
      const blocked=(signalSnapshot.trusted && isDontWalkPhase(signalSnapshot.phase)) || tracks.some(t=>t.group===TrackGroup.VEHICLE && now-t.lastSeenMs<900 && (motion.get(t.id)?.state!=='STATIONARY' || !motion.get(t.id)?.supported || looming.some(h=>h.trackId===t.id)));
      this.scanBlocked=blocked || !usable;
      if(this.scanBlocked && this.scanInstruction) {
        this.scanInstruction=null;this.scanSequence++;this.trafficScan.interrupt(now);
      }
      if(this.scanInstruction && !this.scanBlocked) this.trafficScan.pause(now);
      else {
        const scan=this.trafficScan.update(now,current?.headingDeg ?? null,usable,blocked);
        if(scan) {
          const phrase=scan==='START'?Phrase.SCAN_LEFT:scan==='RESTART'?Phrase.SCAN_RESTART:scan==='RIGHT'?Phrase.SCAN_RIGHT:Phrase.SCAN_COMPLETE;
          this.scanInstruction={phrase,token:++this.scanSequence};
        }
      }
    } else {this.trafficScan.reset();this.scanInstruction=null;}


    // Aiming sonar toward the signal (or crosswalk) while at the curb.
    this.aimBearing = null;
    const primaryTrack =
      tracks.find((t) => t.id === signalSnapshot.primaryTrackId && now - t.lastSeenMs <= 300) ?? null;
    const signalTarget =
      primaryTrack ??
      maxBy(
        tracks.filter((t) => t.group === TrackGroup.SIGNAL && t.hits >= 2 && t.isSeenAt(now)),
        (t) => t.confidence,
      );
    const target =
      signalTarget ??
      maxBy(
        tracks.filter((t) => t.group === TrackGroup.CROSSWALK && t.hits >= 3 && t.isSeenAt(now)),
        (t) => t.box.area,
      );
    if (target !== null) this.aimBearing = Angles.bearingFromImageX(target.box.centerX, this.geometry.hfovDeg);
    if (this.settings.pedestrianSignals !== false && this.settings.aimSonar && (this.mode === AssistMode.SEARCHING || this.mode === AssistMode.WAITING)) {
      cues.push(
        ...this.aim.update(now, target?.id ?? null, this.aimBearing, this.mode === AssistMode.WAITING, () => {
          if (this.settings.verbosity === Verbosity.DETAILED) {
            const phrase = target === signalTarget ? Phrase.SIGNAL_CENTERED : Phrase.CROSSWALK_CENTERED;
            this.speak(cues, phrase, Priority.LOW, now);
          }
        }),
      );
    }

    this.trackViews = tracks
      .filter((t) => now - t.lastSeenMs <= 300)
      .map((t) => ({
        id: t.id,
        box: t.box,
        category: t.category,
        confidence: t.confidence,
        isPrimarySignal: t.id === signalSnapshot.primaryTrackId,
        motion: motion.get(t.id)?.state,
        motionSupported: motion.get(t.id)?.supported,
        direction: motion.get(t.id)?.direction,
      }));
    return { cues, snapshot: this.snapshot };
  }

  // ---------------------------------------------------------------------------------------------

  private updateWalking(nowMs: number, isWalking: boolean): void {
    if (isWalking) {
      if (this.walkingSinceMs === null) this.walkingSinceMs = nowMs;
    } else {
      this.walkingSinceMs = null;
    }
    this.walking = isWalking;
    if(isWalking) {this.trafficScan.reset();this.scanInstruction=null;this.scanSequence++;}
  }

  private startCrossing(nowMs: number, detected: boolean, cues: Cue[]): void {
    if (this.mode !== AssistMode.SEARCHING && this.mode !== AssistMode.WAITING) return;
    this.mode = AssistMode.CROSSING;
    this.crossingStartMs = nowMs;
    this.aim.reset();
    const heading = this.orientation;
    if (heading !== null && this.settings.veerGuidance) {
      // Average the last second: a single reading can sit at the extreme of walking sway.
      this.veer.lock(this.averageHeading() ?? heading.headingDeg, nowMs);
      cues.push(Cues.speak(detected ? Phrase.CROSSING_DETECTED : Phrase.CROSSING_STARTED, Priority.HIGH));
    } else {
      cues.push(Cues.speak(Phrase.CROSSING_STARTED, Priority.HIGH));
    }
  }

  private endCrossing(nowMs: number, cues: Cue[]): void {
    this.endCrossingInternal();
    this.mode = AssistMode.SEARCHING;
    // The next crossing starts with a different signal: do not carry the old phase over.
    this.signal.reset();
    this.tracker.clear();
    cues.push(Cues.speak(Phrase.CROSSING_ENDED, Priority.NORMAL));
  }

  private endCrossingInternal(): void {
    this.veer.unlock();
    this.veerStatus = null;
    this.crossingStartMs = null;
    this.aim.reset();
  }

  private crossingGuidance(nowMs: number, cues: Cue[]): void {
    const sample = this.orientation;
    if (sample === null || !this.settings.veerGuidance) return;
    const status = this.veer.update(sample.headingDeg, nowMs);
    if (status === null) return;
    this.veerStatus = status;
    // Phone heading remains diagnostic only. Camera scanning is not walking drift.
    return;
  }

  private curbGuidance(nowMs: number, cues: Cue[]): void {
    const phase = this.signal.currentPhase;
    const walkingFor = this.walkingSinceMs !== null ? nowMs - this.walkingSinceMs : 0;
    // The walking detector itself needs ~1.5 s of steps, so keep this extra delay short.
    if (this.settings.autoDetectCrossing && walkingFor >= 1_000) {
      // Only when roughly facing the signal, so walking along the curb does not lock a wrong heading.
      if (this.signal.snapshot.trusted && isWalkPhase(phase) && Math.abs(this.aimBearing ?? 0) <= 30) {
        this.startCrossing(nowMs, true, cues);
        return;
      }
      if (this.signal.snapshot.trusted && isDontWalkPhase(phase) && !this.warnedWalkingOnDontWalk && Math.abs(this.aimBearing ?? 90) <= 25) {
        this.warnedWalkingOnDontWalk = true;
        cues.push(Cues.speak(Phrase.WALKING_ON_DONT_WALK, Priority.HIGH));
      }
    }
    if (this.mode !== AssistMode.SEARCHING || this.settings.verbosity === Verbosity.MINIMAL) return;

    const pitch = this.orientation?.pitchDeg;
    if (pitch !== undefined) {
      this.pitchLowSinceMs = pitch < -35 ? (this.pitchLowSinceMs ?? nowMs) : null;
      this.pitchHighSinceMs = pitch > 50 ? (this.pitchHighSinceMs ?? nowMs) : null;
      if (this.pitchLowSinceMs !== null && nowMs - this.pitchLowSinceMs >= 1_500) {
        this.speak(cues, Phrase.TILT_UP, Priority.NORMAL, nowMs, 6_000);
      } else if (this.pitchHighSinceMs !== null && nowMs - this.pitchHighSinceMs >= 1_500) {
        this.speak(cues, Phrase.TILT_DOWN, Priority.NORMAL, nowMs, 6_000);
      }
    }

  }

  private signalCues(event: SignalEvent, nowMs: number, force: boolean): Cue[] {
    if (this.settings.pedestrianSignals === false || !event.trusted) return [];
    const cues: Cue[] = [];
    const dontWalk = (trusted: boolean) => {
      if (trusted) {
        cues.push(Cues.speak(Phrase.DONT_WALK, Priority.HIGH));
        cues.push(Cues.haptic(HapticPattern.DONT_WALK));
        cues.push(Cues.tone(ToneKind.STOP));
      }
    };
    const walkOfUnknownAge = (trusted: boolean) => {
      if (trusted) {
        cues.push(Cues.speak(Phrase.WALK_ALREADY_ON, Priority.HIGH));
        cues.push(Cues.haptic(HapticPattern.WALK));
      }
    };
    const flashing = (phrase: Phrase) => {
      cues.push(Cues.speak(phrase, Priority.HIGH));
      cues.push(Cues.haptic(HapticPattern.FLASHING));
    };

    switch (event.type) {
      case 'acquired':
        switch (event.phase) {
          case SignalPhase.WALK:
            walkOfUnknownAge(event.trusted);
            break;
          case SignalPhase.WALK_FLASHING:
            flashing(Phrase.WALK_FLASHING);
            break;
          case SignalPhase.DONT_WALK:
            dontWalk(event.trusted);
            break;
          case SignalPhase.DONT_WALK_FLASHING:
            flashing(Phrase.DONT_WALK_FLASHING);
            break;
          case SignalPhase.UNKNOWN:
            break;
        }
        break;
      case 'changed':
        switch (event.to) {
          case SignalPhase.WALK:
            if (!event.trusted) {
              walkOfUnknownAge(false);
            } else if (event.freshWalk) {
              cues.push(Cues.speak(Phrase.WALK_STARTED, Priority.HIGH));
              cues.push(Cues.haptic(HapticPattern.WALK));
              cues.push(Cues.tone(ToneKind.WALK_CHIME));
            } else {
              walkOfUnknownAge(true);
            }
            break;
          case SignalPhase.WALK_FLASHING:
            flashing(Phrase.WALK_FLASHING);
            break;
          case SignalPhase.DONT_WALK:
            if (this.mode === AssistMode.CROSSING && isWalkPhase(event.from)) {
              cues.push(Cues.speak(Phrase.SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING, Priority.HIGH));
              cues.push(Cues.haptic(HapticPattern.DONT_WALK));
            } else {
              dontWalk(event.trusted);
            }
            break;
          case SignalPhase.DONT_WALK_FLASHING:
            flashing(Phrase.DONT_WALK_FLASHING);
            break;
          case SignalPhase.UNKNOWN:
            break;
        }
        break;
      case 'lost': {
        // Mid-crossing the far signal naturally leaves the view; don't distract the user.
        if (this.mode === AssistMode.CROSSING && !force) return cues;
        if (this.settings.verbosity === Verbosity.MINIMAL) {
          cues.push(Cues.haptic(HapticPattern.LOST));
          return cues;
        }
        cues.push(Cues.speak(Phrase.SIGNAL_LOST, Priority.NORMAL));
        cues.push(Cues.haptic(HapticPattern.LOST));
        cues.push(Cues.tone(ToneKind.LOST));
        const box = event.lastBox;
        let hint: Phrase | null = null;
        if (box !== null) {
          if (box.centerY < 0.15) hint = Phrase.TILT_UP;
          else if (box.centerY > 0.85) hint = Phrase.TILT_DOWN;

        }
        if (hint !== null) this.speak(cues, hint, Priority.NORMAL, nowMs, 3_000);
        break;
      }
    }
    return cues;
  }

  private hazardCues(nowMs: number): Cue[] {
    // CW-14: a far, unsure car that is not growing (box under hazardMonitor's 5% height floor) is shown, not spoken.
    const speakable = this.hazards.filter((h) => !h.pending && !(h.uncertain && !Number.isFinite(h.ttcSeconds) && h.heightFraction < 0.05));
    const firstApproach = (h: VehicleHazard) => h.approaching && !this.approachHeard.has(h.trackId);
    if(nowMs-this.lastVehicleCueMs<3000 && !speakable.some(h=>h.level===HazardLevel.CRITICAL || firstApproach(h))) return [];
    for (const [id, value] of [...this.announcedHazards.entries()]) {
      if (!this.hazards.some((h) => h.trackId === id) && nowMs - value[1] > 5_000) { this.announcedHazards.delete(id); this.approachHeard.delete(id); }
    }
    // One announcement per frame: the most urgent hazard that is new, escalated, or due for a repeat.
    const hazard = speakable.find((h) => {
      const previous = this.announcedHazards.get(h.trackId);
      return (
        previous === undefined ||
        firstApproach(h) ||
        (h.level === HazardLevel.CRITICAL && previous[0] === HazardLevel.WARNING) ||
        // CW-14: a car whose motion is unsure and that is not growing is told once ("Vehicle detected"), not every 3 s.
        (nowMs - previous[1] >= 3_000 && (!h.uncertain || Number.isFinite(h.ttcSeconds)))
      );
    });
    if (!hazard) return [];
    this.announcedHazards.set(hazard.trackId, [hazard.level, nowMs]);
    if (hazard.approaching) this.approachHeard.add(hazard.trackId);
    this.lastVehicleCueMs=nowMs;
    const critical = hazard.level === HazardLevel.CRITICAL;
    let phrase: Phrase;
    let pan: number;
    switch (hazard.side) {
      case Side.LEFT:
        phrase = critical ? Phrase.VEHICLE_CLOSE_LEFT : Phrase.VEHICLE_LEFT;
        pan = -1;
        break;
      case Side.AHEAD:
        phrase = critical ? Phrase.VEHICLE_CLOSE_AHEAD : Phrase.VEHICLE_AHEAD;
        pan = 0;
        break;
      case Side.RIGHT:
        phrase = critical ? Phrase.VEHICLE_CLOSE_RIGHT : Phrase.VEHICLE_RIGHT;
        pan = 1;
        break;
    }
    if(hazard.uncertain && !critical) phrase=Phrase.VEHICLE_DETECTED;
    else if(!critical && hazard.side===Side.AHEAD && !hazard.approaching) phrase=Phrase.VEHICLE_MOVING;
    return [
      Cues.haptic(critical ? HapticPattern.CRITICAL : HapticPattern.ALERT),
      Cues.speak(phrase, critical ? Priority.CRITICAL : Priority.HIGH),
      Cues.tone(critical ? ToneKind.CRITICAL : ToneKind.ALERT, pan),
    ];
  }

  private statusCues(nowMs: number): Cue[] {
    const cues: Cue[] = [];
    const s = this.signal.snapshot;
    if (this.settings.pedestrianSignals === false) cues.push(Cues.speak(Phrase.SIGNAL_UNAVAILABLE, Priority.NORMAL));
    else if (s.phase === SignalPhase.UNKNOWN) cues.push(Cues.speak(Phrase.STATUS_NO_SIGNAL, Priority.HIGH));
    else if (!s.trusted) cues.push(Cues.speak(Phrase.SIGNAL_UNAVAILABLE, Priority.NORMAL));
    else if (s.phase === SignalPhase.WALK && s.freshWalk && s.phaseOnsetMs !== null) {
      cues.push(
        Cues.speak(Phrase.STATUS_WALK_ELAPSED, Priority.HIGH, [Math.trunc((nowMs - s.phaseOnsetMs) / 1000)]),
      );
    } else if (s.phase === SignalPhase.WALK) cues.push(Cues.speak(Phrase.STATUS_WALK_UNKNOWN_AGE, Priority.HIGH));
    else if (s.phase === SignalPhase.WALK_FLASHING) cues.push(Cues.speak(Phrase.STATUS_WALK_FLASHING, Priority.HIGH));
    else cues.push(Cues.speak(Phrase.STATUS_DONT_WALK, Priority.HIGH));

    const observed = this.trackViews.filter(t=>t.motion !== undefined);
    const uncertain = observed.filter(t=>!t.motionSupported).length;
    const moving = observed.filter(t=>t.motion==='MOVING' && t.motionSupported).length;
    if (!this.settings.vehicleAlerts || nowMs-this.lastTrafficFrameMs>400 || !this.trafficUsable) {
      cues.push(Cues.speak(Phrase.TRAFFIC_UNAVAILABLE, Priority.HIGH));
    } else {
      if(moving) cues.push(Cues.speak(Phrase.STATUS_VEHICLES, Priority.HIGH,[moving]));
      if(uncertain) cues.push(Cues.speak(Phrase.STATUS_DETECTED, Priority.HIGH,[uncertain]));
      if(!moving && !uncertain) cues.push(Cues.speak(Phrase.STATUS_NO_VEHICLES, Priority.NORMAL));
    }
    return cues;
  }

  /** Circular mean of the headings from the last HEADING_AVERAGE_MS. */
  private averageHeading(): number | null {
    if (this.recentHeadings.length === 0) return null;
    let sinSum = 0;
    let cosSum = 0;
    for (const s of this.recentHeadings) {
      const rad = Angles.toRad(s.headingDeg);
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }
    return Angles.wrap360(Angles.toDeg(Math.atan2(sinSum, cosSum)));
  }

  private speak(cues: Cue[], phrase: Phrase, priority: Priority, nowMs: number, minIntervalMs = 4_000): void {
    const last = this.lastSpokenMs.get(phrase);
    if (last !== undefined && nowMs - last < minIntervalMs) return;
    this.lastSpokenMs.set(phrase, nowMs);
    cues.push(Cues.speak(phrase, priority));
  }
}

function maxBy(tracks: Track[], key: (t: Track) => number): Track | null {
  let best: Track | null = null;
  let bestKey = Number.NEGATIVE_INFINITY;
  for (const t of tracks) {
    const k = key(t);
    if (k > bestKey) {
      best = t;
      bestKey = k;
    }
  }
  return best;
}
