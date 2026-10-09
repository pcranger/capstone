import { type Cue, HapticPattern, ToneKind } from '../feedback/cue';

/** Along a walking route, keep vehicle alerts without signal-search or aiming chatter. */
export function walkingCue(cue: Cue): boolean {
  if (cue.kind === 'speak') return cue.phrase.startsWith('VEHICLE_') || cue.phrase === 'MODEL_MISSING';
  if (cue.kind === 'tone') return cue.tone === ToneKind.ALERT || cue.tone === ToneKind.CRITICAL;
  if (cue.kind === 'haptic') return cue.pattern === HapticPattern.ALERT || cue.pattern === HapticPattern.CRITICAL;
  return false;
}
