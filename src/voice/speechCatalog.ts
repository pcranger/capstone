/** Shared speech used by commands, recovery and Developer preview. */
export const VOICE_MANUAL = 'Navigate to Town Hall. Search for a place. Choose first, second, or third. '
  + 'Save as Home. Repeat. Pause. Resume. Next instruction. Arrived. Finish crossing. Stop navigation.';
export const V = {
  unknown: 'Command not recognised.',
  unknownHelp: 'Command not recognised. Say manual for commands.',
  noRoute: 'No active route.',
  paused: 'Navigation paused.',
  running: 'Navigation already running.',
  noPausedRoute: 'No paused route.',
  stopped: 'Navigation stopped.',
  cancelled: 'Cancelled.',
  chooseBeforeSave: 'Choose a place before saving.',
  destination: 'Say navigate to, then a place.',
  changeBlocked: 'Finish crossing before changing destination.',
  resultUnavailable: 'That result is unavailable. Search again.',
  searching: 'Searching.',
  planning: 'Planning route.',
  routeUnavailable: 'Route unavailable. Say retry.',
  startFailed: 'Navigation couldn’t start. Say retry.',
  saved: 'Saved.', alreadySaved: 'Already saved.',
  removed: 'Place removed. Undo available.', restored: 'Place restored.',
  saveFailed: 'Couldn’t save. Try again.', removeFailed: 'Couldn’t remove. Try again.', restoreFailed: 'Couldn’t restore. Try again.',
  completionCommands: 'Say next instruction, arrived, or finish crossing.',
  crossingEnded: 'Crossing ended.',
  noCrossing: 'No crossing guidance is active.',
  finishCrossingFirst: 'Finish crossing before advancing the route.',
  finalInstruction: 'Final instruction. Say arrived at your destination.',
  arrivalTooSoon: 'Complete the route instructions before arrival.',
  voiceUnavailable: 'Voice unavailable. Retry voice.',
  voiceRecovery: 'Voice unavailable. Open Voice help in Settings.',
  reopenVoice: 'Voice unavailable. Reopen the app.',
  microphoneIOS: 'Enable microphone and speech recognition in iPhone Settings.',
  microphoneAndroid: 'Enable microphone in Android Settings.',
  locationPermission: 'Location permission is off. Enable it in app settings.',
  locationPoor: 'Location inaccurate. Wait and retry.',
  routeChanged: 'Route start has changed. Replan the route.',
  connection: 'Check your internet connection.',
  navigationUnavailable: 'Route unavailable. Try again.',
  noWalkingRoute: 'No walking route found.',
  noPlaces: 'No places found. Try another name.',
  trafficUnavailable: 'Traffic assessment unavailable.',
  cameraBlocked: 'Camera blocked or too dark.',
  trafficRestored: 'Vehicle detection restored.',
  descriptionUnavailable: 'Description unavailable. Try again.',
  descriptionDisabled: 'Scene descriptions unavailable.',
  describeLeft: 'Point the phone left.', describeForward: 'Point the phone forward.', describeRight: 'Point the phone right.',
  describing: 'Describing.',
  place: (name: string, address: string) => `${name}, ${address}. Say start or save.`,
  routeStarted: (name: string, instruction: string) => `${name}. ${instruction}`,
  savedAs: (alias: string) => `Saved as ${alias.trim()}.`,
  heard: (text: string) => `Heard: ${text}.`,
};
/** Internal/service errors stay available to diagnostics; speech gives a short recovery action. */
export function spokenError(error: unknown, context: 'voice' | 'route' | 'save' | 'remove' | 'restore' = 'route'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (Object.values(V).some(v => typeof v === 'string' && v === message)) return message;
  if (/microphone and speech|speech recognition.*Settings/i.test(message)) return V.microphoneIOS;
  if (/microphone.*Android/i.test(message)) return V.microphoneAndroid;
  if (/reopen|audio could not recover/i.test(message)) return V.reopenVoice;
  if (/Voice help|offline English/i.test(message)) return V.voiceRecovery;
  if (context === 'voice') return V.voiceUnavailable;
  if (/location.*permission|Enable.*location|Location permission/i.test(message)) return V.locationPermission;
  if (/location.*accur|Location uncertain/i.test(message)) return V.locationPoor;
  if (/moved away from the start/i.test(message)) return V.routeChanged;
  if (/internet|cannot connect/i.test(message)) return V.connection;
  if (/No matching places|No places/i.test(message)) return V.noPlaces;
  if (/No walking route/i.test(message)) return V.noWalkingRoute;
  return context === 'save' ? V.saveFailed : context === 'remove' ? V.removeFailed : context === 'restore' ? V.restoreFailed : V.navigationUnavailable;
}
