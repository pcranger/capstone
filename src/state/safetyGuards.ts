import { AssistMode, UserCommand } from '../crossing/crossingEngine';
import { T } from '../text/safetyText';
import { controller } from './controller';

/** A second press (or spoken word) within this long confirms the risky action. One window for the Stop button and voice. */
export const CONFIRM_MS = 3_000;
/** The big button ignores presses this long after its label changes, so a second tap meant for the old label cannot hit the new one. */
export const LABEL_LOCK_MS = 1_500;
let labelChangedAt = 0;
/** What is waiting for its second press, and when it was asked. Keys: 'stop', 'cancel', 'back'. */
const asked = new Map<string, number>();

export function noteLabelChange(): void { labelChangedAt = Date.now(); }
export function pressUnlessLabelJustChanged(press: () => void): void { if (Date.now() - labelChangedAt >= LABEL_LOCK_MS) press(); }

/** First call for a key records it and returns false (the caller asks); a second within 3 s returns true and clears it. */
export function confirmTwice(key: string): boolean {
  const now = Date.now(), at = asked.get(key);
  if (at !== undefined && now - at <= CONFIRM_MS) { asked.delete(key); return true; }
  asked.set(key, now);
  return false;
}
/** The window starts when the question has been spoken aloud, not when it was asked. */
export function refreshConfirm(): void { const now = Date.now(); for (const key of asked.keys()) asked.set(key, now); }
/** Any other command cancels a pending question. */
export function clearConfirm(except?: string): void { for (const key of [...asked.keys()]) if (key !== except) asked.delete(key); }

/**
 * The Stop button. In the middle of a crossing the first press only asks; a second press within 3 s confirms.
 * Voice "stop" uses the same question and the same window (controller.handleVoice).
 */
export function pressStop(): void {
  if (controller.ui.value.snapshot.mode === AssistMode.CROSSING && !confirmTwice('stop')) { controller.speakHigh(T.stopConfirm, true); return; }
  asked.delete('stop');
  controller.command(UserCommand.STOP_ASSIST, true);
}

/** Back on the home screen would exit the app. Returns true when the press was used up asking; false lets the app close. */
export function pressBack(): boolean {
  if (confirmTwice('back')) return false;
  controller.speakHigh(T.backConfirm, true);
  return true;
}
