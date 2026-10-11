/**
 * New user-facing text for steering hints, the clearer buzz patterns, the crossing-check settings and the
 * small accessibility fixes. Kept in its own file so it merges cleanly beside strings.ts.
 */
export const STEER = {
  // Steering hints are about the PHONE's direction, never the body (turning the phone is not drifting).
  settingsSteerHints: 'Steering hints (experimental, off by default)',
  settingsSteerHintsExplain: 'Uses the phone’s direction, not your body. May be wrong.',
  cuePhoneLeft: 'Phone pointing left of the crossing. Point it straight ahead.',
  cuePhoneRight: 'Phone pointing right of the crossing. Point it straight ahead.',
  developerNote: 'Steering hints are experimental and off by default. They use the phone’s direction, not your body.',
  practiceNote: 'Steering hints are experimental and off by default. Turning the phone does not establish walking drift.',

  // Crossing check settings (CW-25 a, CW-28 a).
  settingsSectionCrossingCheck: 'Crossing check',
  settingsHoldName: 'Hold time on each side',
  settingsHoldValue: (n: number) => `${n} seconds`,
  settingsRoadName: 'Road width',
  settingsRoadValue: (n: number) => `${n} ${n === 1 ? 'lane' : 'lanes'}, about ${n * 6} steps`,
  stepperIncrease: 'Increase',
  stepperDecrease: 'Decrease',

  // Buzz patterns. The mic-ready cue is wired in the controller later.
  guideHapticMicReady: 'Double tick: the microphone is ready.',

  // Error banner in User mode (Developer mode keeps the Settings pointer).
  detectionUnavailableUser: 'Close and reopen CrossWise. If it keeps happening, restart the phone.',
};
