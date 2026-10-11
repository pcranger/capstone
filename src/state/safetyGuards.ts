import { AssistMode, UserCommand } from '../crossing/crossingEngine';
import { T } from '../text/safetyText';
import { controller } from './controller';

/** A second press within this long confirms the risky action. */
export const CONFIRM_MS = 3_000;
/** The big button ignores presses this long after its label changes, so a second tap meant for the old label cannot hit the new one. */
export const LABEL_LOCK_MS = 1_500;
let labelChangedAt = 0;
let lastStop = 0;
let lastBack = 0;

export function noteLabelChange(): void { labelChangedAt = Date.now(); }
export function pressUnlessLabelJustChanged(press: () => void): void { if (Date.now() - labelChangedAt >= LABEL_LOCK_MS) press(); }

/**
 * The Stop button. In the middle of a crossing the first press only asks; a second press within 3 s confirms.
 * (Voice "pause" already refuses during a crossing.)
 */
export function pressStop(): void {
  if (controller.ui.value.snapshot.mode === AssistMode.CROSSING) {
    const now = Date.now();
    if (lastStop === 0 || now - lastStop > CONFIRM_MS) { lastStop = now; controller.speakNow(T.stopConfirm); return; }
  }
  lastStop = 0;
  controller.command(UserCommand.STOP_ASSIST, true);
}

/** Back on the home screen would exit the app. Returns true when the press was used up asking; false lets the app close. */
export function pressBack(): boolean {
  const now = Date.now();
  if (lastBack !== 0 && now - lastBack <= CONFIRM_MS) { lastBack = 0; return false; }
  lastBack = now;
  controller.speakNow(T.backConfirm);
  return true;
}
