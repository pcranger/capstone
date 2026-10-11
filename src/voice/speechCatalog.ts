/** Shared speech used by commands, recovery and Developer preview. */
export const VOICE_MANUAL = 'Navigate to Town Hall. Search for a place. Say one, two, or three to choose a location. '
  + 'Start journey. Save as Home. Repeat. Pause navigation. Resume navigation. Next instruction. Arrived. Finish crossing. '
  + 'Cancel search. Retry. Stop navigation. Stop listening. Questions keep listening on. Directions end the voice turn; double-tap the camera to listen again. '
  + 'For a trip over 1 kilometre, say yes to proceed or no to cancel.';
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
  planning: 'Finding route.',
  longTrip: 'The trip is over 1 kilometre. Do you want to proceed?',
  longTripAnswer: 'Say yes to proceed, or no to cancel.',
  noConfirmation: 'No question pending. Say manual for commands.',
  routeUnavailable: 'Route unavailable. Say retry.',
  startFailed: 'Navigation couldn’t start. Say retry.',
  saved: 'Saved.', alreadySaved: 'Already saved.',
  removed: 'Place removed. Undo available.', restored: 'Place restored.',
  saveFailed: 'Couldn’t save. Try again.', removeFailed: 'Couldn’t remove. Try again.', restoreFailed: 'Couldn’t restore. Try again.',
  completionCommands: 'Say next instruction, arrived, or finish crossing.',
  crossingEnded: 'Crossing guidance ended.',
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
  savedUnavailable: 'Saved places unavailable. Say retry.',
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
/** Conversational follow-ups, including choices phrased as instructions rather than questions.
 * Keep this explicit: route text can contain place names and must not arm the microphone by accident.
 */
export function expectsVoiceAnswer(text: string): boolean {
  return [V.longTrip, V.longTripAnswer, V.destination, V.unknown, V.unknownHelp,
    V.noConfirmation, V.chooseBeforeSave, V.resultUnavailable, V.routeUnavailable,
    V.startFailed, V.noPlaces, V.navigationUnavailable, V.saveFailed, V.removeFailed,
    V.restoreFailed, V.savedUnavailable, V.completionCommands].includes(text)
    || text.endsWith('. Say start or save.')
    || text.endsWith(' Say one or two.')
    || text.endsWith(' Say one, two, or three.');
}
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
  if (/Saved places unavailable|saved data/i.test(message)) return V.savedUnavailable;
  return context === 'save' ? V.saveFailed : context === 'remove' ? V.removeFailed : context === 'restore' ? V.restoreFailed : V.navigationUnavailable;
}
