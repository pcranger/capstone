import { Angles } from '../core/geometry';
import { CHECK_RESULT_TEXT, CHECK_TEXT, checkEventText } from '../text/checkText';
import { CrossingCheck, type CheckPhase, type CheckSummary, type CheckVehicle } from './crossingCheck';

/**
 * One guided crossing check from the user's side: wait for a steady upright phone, run the CrossingCheck, stop at
 * once if a car shows up during a hold, repeat the prompt when the user stalls, give up after 30 s, and let a result
 * expire after 20 s. Pure logic with no speech; the engine turns a CheckStep into speech and tones.
 */
export type CheckStage = 'off' | 'waiting' | 'running' | 'result' | 'expired' | 'stopped';

export interface CheckStep {
  /** Routine guidance (turn prompts), spoken through the scan queue. */
  prompt?: string;
  /** Urgent speech: results, a car during a hold, expiry, giving up. */
  urgent?: string;
  /** One soft tick for each second of an active hold. */
  tick?: boolean;
  /** A hold has finished. */
  end?: boolean;
}

export interface CheckView {
  stage: CheckStage;
  summary: CheckSummary | null;
  text: string | null;
  canCross: boolean;
}

export interface CheckFrame {
  heading: number | null;
  pitch: number | null;
  usable: boolean;
  walking: boolean;
  vehicles: CheckVehicle[];
}

export const STEADY_MS = 1000;
export const STEADY_DEG = 3;
export const PITCH_MAX_DEG = 30;
export const REPROMPT_MS = 6000;
export const STOP_MS = 30000;
export const EXPIRE_MS = 20000;

const isHold = (p: CheckPhase | null) => p === 'RIGHT_HOLD' || p === 'LEFT_HOLD';
const carNow = (v: CheckVehicle) => (v.moving && v.supported) || v.approaching;
const EMPTY: CheckStep = {};

export class CheckSession {
  stage: CheckStage = 'off';
  summary: CheckSummary | null = null;
  private resultText: string | null = null;
  private resultAt = 0;
  private holdMs = 5000;
  private check = new CrossingCheck();
  private headings: { t: number; h: number }[] = [];
  private progressAt = 0;
  private promptAt = 0;
  private lastPrompt: string = CHECK_TEXT.holdUpright;
  private lastKind: string | null = null;
  private lastPhase: CheckPhase | null = null;
  private tickN = 0;

  /** (Re)start: the check itself starts when the phone is steady. */
  begin(now: number, holdSeconds = 5): void {
    this.holdMs = holdSeconds * 1000;
    this.stage = 'waiting';
    this.summary = null;
    this.resultText = null;
    this.headings = [];
    this.progressAt = this.promptAt = now;
    this.lastPrompt = CHECK_TEXT.holdUpright;
    this.lastKind = null;
    this.lastPhase = null;
    this.tickN = 0;
  }

  reset(): void {
    this.stage = 'off';
    this.summary = null;
    this.resultText = null;
    this.headings = [];
  }

  /** Perception was lost: a check in progress starts over (silently); a finished result is kept until it expires. */
  interrupt(now: number): void {
    if (this.stage === 'waiting' || this.stage === 'running') this.begin(now, this.holdMs / 1000);
  }

  canCross(now: number): boolean {
    return this.stage === 'result' && (this.summary === 'NONE_SEEN' || this.summary === 'UNSURE') && now - this.resultAt < EXPIRE_MS;
  }

  /** What to say when "Cross" is refused. */
  refusal(now: number): string {
    return this.stage === 'expired' || (this.stage === 'result' && now - this.resultAt >= EXPIRE_MS) ? CHECK_TEXT.expired : CHECK_TEXT.notYet;
  }

  view(now: number): CheckView | undefined {
    if (this.stage === 'off') return undefined;
    const expired = this.stage === 'expired' || (this.stage === 'result' && now - this.resultAt >= EXPIRE_MS);
    const text = expired ? CHECK_TEXT.expired : this.stage === 'stopped' ? CHECK_TEXT.stopped : this.stage === 'result' ? this.resultText : null;
    return { stage: expired ? 'expired' : this.stage, summary: this.summary, text, canCross: this.canCross(now) };
  }

  /** Time-driven parts (reprompt, giving up, expiry); call about 10 times a second. */
  tick(now: number): CheckStep {
    if (this.stage === 'result' && now - this.resultAt >= EXPIRE_MS) {
      this.stage = 'expired';
      return { urgent: CHECK_TEXT.expired };
    }
    if (this.stage !== 'waiting' && this.stage !== 'running') return EMPTY;
    if (now - this.progressAt >= STOP_MS) {
      this.stage = 'stopped';
      return { urgent: CHECK_TEXT.stopped };
    }
    if (now - this.progressAt >= REPROMPT_MS && now - this.promptAt >= REPROMPT_MS) {
      this.promptAt = now;
      return { prompt: this.lastPrompt };
    }
    return EMPTY;
  }

  /** One analysed camera frame. */
  frame(now: number, f: CheckFrame): CheckStep {
    if (this.stage === 'waiting') return this.waitForSteady(now, f);
    if (this.stage !== 'running') return EMPTY;
    const before = this.check.phase;
    const event = this.check.update({ t: now, heading: f.heading, usable: f.usable, walking: f.walking, vehicles: f.vehicles });
    const after = this.check.phase;

    // A car while a hold runs ends the check on the spot. The user must start a new one.
    const holdPhase = isHold(before) ? before : isHold(after) ? after : null;
    if (holdPhase !== null && f.vehicles.some(carNow)) {
      const right = holdPhase === 'RIGHT_HOLD';
      this.finish(now, right ? 'MOVING_RIGHT' : 'MOVING_LEFT', right ? CHECK_TEXT.vehicleStopRight : CHECK_TEXT.vehicleStopLeft);
      return { urgent: this.resultText ?? undefined };
    }

    const step: CheckStep = {};
    if (after !== this.lastPhase) {
      this.lastPhase = after;
      this.progressAt = now;
      this.tickN = 0;
    }
    if (isHold(after)) {
      const n = Math.floor(this.check.heldMsSoFar / 1000);
      if (n > this.tickN) {
        this.progressAt = now;
        step.tick = true;
      }
      this.tickN = n;
    }
    if (event === null) return step;

    if (event.kind === 'DONE') {
      const r = this.check.result();
      const summary = r?.summary ?? 'NOT_CHECKED';
      // The fallback note repeats after the result, so the user knows the left look was aimed at a guessed angle.
      this.finish(now, summary, r?.fallbackNote ? `${CHECK_RESULT_TEXT[summary]} ${CHECK_TEXT.fallbackResult}` : CHECK_RESULT_TEXT[summary]);
      step.urgent = this.resultText ?? undefined;
      return step;
    }
    let text = checkEventText(event.kind);
    if (event.kind === 'TURN_LEFT' && !this.check.roadKnown) text = `${text} ${CHECK_TEXT.fallbackNote}`;
    if (event.kind === 'TURN_LEFT' || event.kind === 'FACE_ROAD') step.end = true;
    const changed = event.kind !== this.lastKind;
    if (changed) this.progressAt = now;
    // Same event again is not repeated (the reprompt does that); a wrong way warning is, at the check's own 1.5 s limit.
    if (changed || event.kind === 'WRONG_WAY') {
      step.prompt = text;
      this.lastPrompt = text;
      this.promptAt = now;
    }
    this.lastKind = event.kind;
    return step;
  }

  private finish(now: number, summary: CheckSummary, text: string): void {
    this.stage = 'result';
    this.summary = summary;
    this.resultText = text;
    this.resultAt = now;
  }

  private waitForSteady(now: number, f: CheckFrame): CheckStep {
    if (f.heading === null || !f.usable || f.walking || f.pitch === null || Math.abs(f.pitch) > PITCH_MAX_DEG) {
      this.headings = [];
      return EMPTY;
    }
    const heading = f.heading;
    this.headings.push({ t: now, h: heading });
    while (this.headings.length > 0 && now - this.headings[0].t > STEADY_MS * 1.5) this.headings.shift();
    const span = now - this.headings[0].t;
    const recent = this.headings.filter((s) => now - s.t <= STEADY_MS);
    if (span < STEADY_MS || recent.some((s) => Math.abs(Angles.wrap180(s.h - heading)) > STEADY_DEG)) return EMPTY;
    this.check = new CrossingCheck({ holdMs: this.holdMs });
    this.check.start(now, heading);
    this.stage = 'running';
    this.progressAt = this.promptAt = now;
    this.lastPrompt = CHECK_TEXT.start;
    this.lastKind = 'START';
    this.lastPhase = 'RIGHT_TURN';
    this.tickN = 0;
    return { prompt: CHECK_TEXT.start };
  }
}
