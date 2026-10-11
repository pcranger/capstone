import { Angles, clamp } from '../core/geometry';

/**
 * The guided crossing check: turn right and hold, turn left and hold, face the road, then report what the camera
 * saw. It reports observations only; nothing here ever means "safe". Pure logic, no React.
 *
 * All angles are degrees. "rel" means heading minus the start heading (anchor), wrapped to (-180, 180], so
 * positive is clockwise (right).
 */

export const CHECK_EVENT_KINDS = [
  'HOLD', 'HOLD_STILL', 'KEEP_TURNING_RIGHT', 'KEEP_TURNING_LEFT', 'TOO_FAR', 'LITTLE_MORE', 'LITTLE_BACK',
  'TURN_LEFT', 'FACE_ROAD', 'WRONG_WAY', 'DONE',
] as const;
export type CheckEventKind = (typeof CHECK_EVENT_KINDS)[number];
export interface CheckEvent { kind: CheckEventKind }

export type CheckPhase = 'RIGHT_TURN' | 'RIGHT_HOLD' | 'LEFT_TURN' | 'LEFT_HOLD' | 'FACE_ROAD' | 'DONE';

export interface CheckVehicle {
  id: number;
  moving: boolean;
  supported: boolean;
  approaching: boolean;
  /** Absolute compass bearing of the box centre. */
  bearingDeg: number;
  heightFraction: number;
}

export interface CheckInput {
  t: number;
  heading: number | null;
  usable: boolean;
  walking: boolean;
  vehicles: CheckVehicle[];
}

export interface SideResult {
  status: 'CHECKED' | 'NOT_CHECKED';
  movingVehicles: number;
  approaching: boolean;
  unsureVehicles: number;
  stationaryVehicles: number;
  framesUsed: number;
}

export type CheckSummary = 'MOVING_RIGHT' | 'MOVING_LEFT' | 'MOVING_BOTH' | 'NOT_CHECKED' | 'UNSURE' | 'NONE_SEEN';

export interface CheckResult {
  right: SideResult;
  left: SideResult;
  /** True when no car gave the road's angle, so the left target is plain straight left. */
  fallbackNote: boolean;
  summary: CheckSummary;
}

const TURN_HALF_WINDOW = 40; // accepted +-40 around a target; 90 +- 40 is the 50..130 wide window
const FINE_BAND = 40; // within this of a window edge, say "a little" instead of "keep turning"
const MOVE_RESET_DEG = 15;
const FACE_ROAD_DEG = 20;
const FRAME_GAP_MS = 400;
const UNUSABLE_LIMIT_MS = 3000;
const EVENT_GAP_MS = 1500;
const GUIDE_GAP_MS = 2000;
const ROAD_OFF_DEG = 20;
const WRONG_WAY_DEG = 30;
const WRONG_WAY_GAP_MS = 1500;

interface Evidence {
  moving: Set<number>;
  unsure: Set<number>;
  stationary: Set<number>;
  approaching: boolean;
  frames: number;
  unusableMs: number;
}

const newEvidence = (): Evidence => ({
  moving: new Set(), unsure: new Set(), stationary: new Set(), approaching: false, frames: 0, unusableMs: 0,
});

const sideOf = (e: Evidence, checked: boolean): SideResult => ({
  status: checked ? 'CHECKED' : 'NOT_CHECKED',
  movingVehicles: e.moving.size,
  approaching: e.approaching,
  unsureVehicles: e.unsure.size,
  stationaryVehicles: e.stationary.size,
  framesUsed: e.frames,
});

export class CrossingCheck {
  private readonly holdMs: number;
  private _phase: CheckPhase | null = null;
  private anchor = 0;
  private lastT = 0;
  private rightEv = newEvidence();
  private leftEv = newEvidence();
  private rightChecked = true;
  private leftChecked = true;
  private rightDone = false;
  private leftDone = false;
  private _leftTarget = -90;
  private roadBearingRight: number | null = null;
  private roadHeight = Infinity;
  private holdHeading = 0;
  private heldMs = 0;
  private lastTurnEmit = -Infinity;
  private lastStillEmit = -Infinity;
  private lastGuideEmit = -Infinity;
  private lastWrongEmit = -Infinity;
  /** Most anticlockwise rel seen in this left turn; a rise from it means turning the wrong way. */
  private leftMinRel: number | null = null;

  constructor(opts?: { holdMs?: number }) {
    this.holdMs = opts?.holdMs ?? 5000;
  }

  get phase(): CheckPhase | null {
    return this._phase;
  }

  /** Milliseconds of the current hold counted so far. */
  get heldMsSoFar(): number {
    return this.heldMs;
  }

  /** True once a moving car has told us the road's angle. */
  get roadKnown(): boolean {
    return this.roadBearingRight !== null;
  }

  /** Left target relative to the start heading (negative = left). -90 until the right hold has finished. */
  get leftTarget(): number {
    return this._leftTarget;
  }

  start(t: number, heading: number): void {
    this.reset();
    this.anchor = heading;
    this.lastT = t;
    this._phase = 'RIGHT_TURN';
  }

  reset(): void {
    this._phase = null;
    this.rightEv = newEvidence();
    this.leftEv = newEvidence();
    this.rightChecked = true;
    this.leftChecked = true;
    this.rightDone = false;
    this.leftDone = false;
    this._leftTarget = -90;
    this.roadBearingRight = null;
    this.roadHeight = Infinity;
    this.heldMs = 0;
    this.lastTurnEmit = -Infinity;
    this.lastStillEmit = -Infinity;
    this.lastGuideEmit = -Infinity;
    this.lastWrongEmit = -Infinity;
    this.leftMinRel = null;
  }

  result(): CheckResult | null {
    if (!this.rightDone || !this.leftDone) return null;
    const right = sideOf(this.rightEv, this.rightChecked);
    const left = sideOf(this.leftEv, this.leftChecked);
    const movingR = right.movingVehicles > 0 || right.approaching;
    const movingL = left.movingVehicles > 0 || left.approaching;
    let summary: CheckSummary;
    if (movingR && movingL) summary = 'MOVING_BOTH';
    else if (movingR) summary = 'MOVING_RIGHT';
    else if (movingL) summary = 'MOVING_LEFT';
    else if (!this.rightChecked || !this.leftChecked) summary = 'NOT_CHECKED';
    else if (right.unsureVehicles + right.stationaryVehicles + left.unsureVehicles + left.stationaryVehicles > 0) {
      summary = 'UNSURE';
    } else summary = 'NONE_SEEN';
    return { right, left, fallbackNote: this.roadBearingRight === null, summary };
  }

  update(input: CheckInput): CheckEvent | null {
    const phase = this._phase;
    if (phase === null || phase === 'DONE') return null;
    const { t } = input;
    const dt = t - this.lastT;
    this.lastT = t;
    const heading = input.heading;
    const rel = heading === null ? null : Angles.wrap180(heading - this.anchor);

    if (phase === 'FACE_ROAD') {
      return rel !== null && Math.abs(rel) <= FACE_ROAD_DEG ? this.go('DONE', 'DONE') : null;
    }
    if (rel === null || heading === null) {
      // No compass: a turn phase cannot judge anything; a hold counts it as unusable time.
      if (phase === 'RIGHT_HOLD' || phase === 'LEFT_HOLD') return this.holdFrame(input, dt, null);
      return null;
    }

    const isRight = phase === 'RIGHT_TURN' || phase === 'RIGHT_HOLD';
    const target = isRight ? 90 : this._leftTarget;
    const d = rel - target; // unwrapped on purpose: facing the wrong way must read as "keep turning"
    const inWindow = Math.abs(d) <= TURN_HALF_WINDOW;

    if (phase === 'RIGHT_HOLD' || phase === 'LEFT_HOLD') {
      if (inWindow) return this.holdFrame(input, dt, heading);
      this._phase = isRight ? 'RIGHT_TURN' : 'LEFT_TURN';
      this.heldMs = 0;
      this.leftMinRel = null;
    }
    // Turn phases.
    if (inWindow) {
      this._phase = isRight ? 'RIGHT_HOLD' : 'LEFT_HOLD';
      this.heldMs = 0;
      this.holdHeading = heading;
      return { kind: 'HOLD' };
    }
    let wrong: boolean;
    if (isRight) wrong = rel < -WRONG_WAY_DEG;
    else {
      // The left turn starts from about +90, so "clockwise of the anchor" alone is the normal start. Wrong way is
      // clockwise of the anchor AND turning clockwise away from the furthest-left point reached so far.
      this.leftMinRel = this.leftMinRel === null ? rel : Math.min(this.leftMinRel, rel);
      wrong = rel > WRONG_WAY_DEG && rel - this.leftMinRel > WRONG_WAY_DEG;
    }
    if (wrong) {
      if (t - this.lastWrongEmit < WRONG_WAY_GAP_MS) return null;
      this.lastWrongEmit = t;
      return { kind: 'WRONG_WAY' };
    }
    const tooLittle = isRight ? d < 0 : d > 0;
    const pastEdge = Math.abs(d) - TURN_HALF_WINDOW;
    let kind: CheckEventKind;
    if (!isRight && pastEdge <= FINE_BAND) kind = tooLittle ? 'LITTLE_MORE' : 'LITTLE_BACK';
    else if (tooLittle) kind = isRight ? 'KEEP_TURNING_RIGHT' : 'KEEP_TURNING_LEFT';
    else kind = 'TOO_FAR';
    if (t - this.lastTurnEmit < EVENT_GAP_MS) return null;
    this.lastTurnEmit = t;
    return { kind };
  }

  private go(phase: CheckPhase, kind: CheckEventKind): CheckEvent {
    this._phase = phase;
    return { kind };
  }

  private holdFrame(input: CheckInput, dt: number, heading: number | null): CheckEvent | null {
    const right = this._phase === 'RIGHT_HOLD';
    const ev = right ? this.rightEv : this.leftEv;
    const t = input.t;
    const usable = input.usable && heading !== null;

    if (!usable) {
      if (dt > 0) ev.unusableMs += dt;
      if (ev.unusableMs > UNUSABLE_LIMIT_MS) return this.finishHold(false);
      return null;
    }
    // Moved or walking: the hold starts again from here. Evidence stays.
    if (input.walking || Math.abs(Angles.wrap180(heading - this.holdHeading)) > MOVE_RESET_DEG) {
      this.heldMs = 0;
      this.holdHeading = heading;
      if (t - this.lastStillEmit < EVENT_GAP_MS) return null;
      this.lastStillEmit = t;
      return { kind: 'HOLD_STILL' };
    }

    ev.frames += 1;
    for (const v of input.vehicles) {
      if (!v.supported) ev.unsure.add(v.id);
      else if (v.moving) ev.moving.add(v.id);
      else ev.stationary.add(v.id);
      if (v.approaching) ev.approaching = true;
      // The farthest moving car (smallest box height) sits nearest the vanishing point of the road.
      if (right && v.supported && v.moving && v.heightFraction < this.roadHeight) {
        this.roadHeight = v.heightFraction;
        this.roadBearingRight = v.bearingDeg;
      }
    }
    // A gap in frames pauses the count; it never resets it.
    if (dt > 0 && dt <= FRAME_GAP_MS) this.heldMs += dt;
    if (this.heldMs >= this.holdMs) return this.finishHold(true);

    if (right && this.roadBearingRight !== null && t - this.lastGuideEmit >= GUIDE_GAP_MS) {
      const off = Angles.wrap180(this.roadBearingRight - heading);
      if (Math.abs(off) > ROAD_OFF_DEG) {
        this.lastGuideEmit = t;
        return { kind: off > 0 ? 'LITTLE_MORE' : 'LITTLE_BACK' };
      }
    }
    return null;
  }

  private finishHold(checked: boolean): CheckEvent {
    this.heldMs = 0;
    if (this._phase === 'RIGHT_HOLD') {
      this.rightDone = true;
      this.rightChecked = checked;
      if (this.roadBearingRight !== null) {
        const rr = Angles.wrap180(this.roadBearingRight - this.anchor);
        this._leftTarget = clamp(Angles.wrap180(rr + 180), -130, -50);
      } else this._leftTarget = -90;
      this.leftMinRel = null;
      return this.go('LEFT_TURN', 'TURN_LEFT');
    }
    this.leftDone = true;
    this.leftChecked = checked;
    return this.go('FACE_ROAD', 'FACE_ROAD');
  }
}
