import { AssistMode, UserCommand } from '../crossing/crossingEngine';
import { T } from '../text/safetyText';
import { controller } from './controller';

/** A second press (or spoken word) within this long confirms the risky action. One window for the Stop button and voice. */
export const CONFIRM_MS = 3_000;
/** The big button ignores presses this long after its label changes, so a second tap meant for the old label cannot hit the new one. */
export const LABEL_LOCK_MS = 1_500;
let labelChangedAt = 0;
/** What is waiting for its second press, and when it was asked. Keys: 'stop', 'cancel', 'back'. */
const asked = new Map<string, { at: number; first: number; windowMs: number }>();

export function noteLabelChange(): void { labelChangedAt = Date.now(); }
export function pressUnlessLabelJustChanged(press: () => void): void { if (Date.now() - labelChangedAt >= LABEL_LOCK_MS) press(); }

/** The button path: the question takes about 3 s to read, so the second press gets 6 s from the first. */
export const BUTTON_CONFIRM_MS = 6_000;
/** A pending question never lives longer than this, however often it is refreshed. */
export const CONFIRM_MAX_AGE_MS = 8_000;

/** First call for a key records it and returns false (the caller asks); a second within `windowMs` returns true and clears it. */
export function confirmTwice(key: string, windowMs = CONFIRM_MS): boolean {
  const now = Date.now(), q = asked.get(key);
  if (q !== undefined && now - q.at <= q.windowMs && now - q.first <= CONFIRM_MAX_AGE_MS) { asked.delete(key); return true; }
  asked.set(key, { at: now, first: now, windowMs });
  return false;
}
/** The window of this one question restarts when it has been spoken aloud. Other pending questions are left alone. */
export function refreshConfirm(key: string): void {
  const q = asked.get(key), now = Date.now();
  if (!q) return;
  if (now - q.first > CONFIRM_MAX_AGE_MS) asked.delete(key); else q.at = now;
}
/** Any other command cancels a pending question. */
export function clearConfirm(except?: string): void { for (const key of [...asked.keys()]) if (key !== except) asked.delete(key); }

/**
 * The Stop button. In the middle of a crossing the first press only asks; a second press within 3 s confirms.
 * Voice "stop" uses the same question and the same window (controller.handleVoice).
 */
export function pressStop(): void {
  if (controller.ui.value.snapshot.mode === AssistMode.CROSSING && !confirmTwice('stop', BUTTON_CONFIRM_MS)) { controller.speakHigh(T.stopConfirm, true); return; }
  asked.delete('stop');
  controller.command(UserCommand.STOP_ASSIST, true);
}

/** Back on the home screen would exit the app. Returns true when the press was used up asking; false lets the app close. */
export function pressBack(): boolean {
  if (confirmTwice('back')) return false;
  controller.speakHigh(T.backConfirm, true);
  return true;
}
