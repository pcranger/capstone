/** Shared speech used by commands, recovery and Developer preview. */
export const VOICE_MANUAL = 'Start. Pause. Resume. Repeat. Retry. Finish crossing. Cancel. Stop listening.';
export const V = {
  unknown: 'Command not recognised.',
  unknownHelp: 'Command not recognised. Say manual for commands.',
  started: 'Camera help on.',
  paused: 'Camera help paused.',
  running: 'Camera help already on.',
  cancelled: 'Cancelled.',
  crossingEnded: 'Crossing ended.',
  noCrossing: 'No crossing guidance is active.',
  finishCrossingFirst: 'Finish crossing first.',
  voiceUnavailable: 'Voice unavailable. Retry voice.',
  voiceRecovery: 'Voice unavailable. Open Voice help in Settings.',
  reopenVoice: 'Voice unavailable. Reopen the app.',
  microphoneIOS: 'Enable microphone and speech recognition in iPhone Settings.',
  microphoneAndroid: 'Enable microphone in Android Settings.',
  trafficUnavailable: 'Traffic assessment unavailable.',
  cameraBlocked: 'Camera blocked or too dark.',
  trafficRestored: 'Vehicle detection restored.',
  heard: (text: string) => `Heard: ${text}.`,
};
/** Internal errors stay available to diagnostics; speech gives a short recovery action. */
export function spokenError(error: unknown, _context: 'voice' = 'voice'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (Object.values(V).some(v => typeof v === 'string' && v === message)) return message;
  if (/microphone and speech|speech recognition.*Settings/i.test(message)) return V.microphoneIOS;
  if (/microphone.*Android/i.test(message)) return V.microphoneAndroid;
  if (/reopen|audio could not recover/i.test(message)) return V.reopenVoice;
  if (/Voice help|offline English/i.test(message)) return V.voiceRecovery;
  return V.voiceUnavailable;
}
