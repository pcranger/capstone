import { type Cue, Phrase } from './feedback/cue';

/*
 * Every user-facing string, ported from the Android app's res/values/strings.xml.
 * Spoken phrases are kept short: they compete with traffic noise and the user's attention.
 * Never phrase anything as "safe to cross"; describe what is seen and let the user decide.
 */

export const PHRASES: Record<Phrase, string> = {
  [Phrase.VEHICLE_MOVING]: 'Moving vehicle detected.',
  [Phrase.TRAFFIC_UNAVAILABLE]: 'Traffic assessment unavailable.',
  [Phrase.SIGNAL_UNAVAILABLE]: 'Pedestrian signal recognition unavailable.',
  [Phrase.SCAN_RESTART]: 'Scan again. Point the phone left. Hold still.',
  [Phrase.STATUS_DETECTED]: '',
  [Phrase.VEHICLE_DETECTED]: 'Vehicle detected.',
  [Phrase.SCAN_LEFT]: 'Face forward. Point the phone left. Hold still.',
  [Phrase.SCAN_RIGHT]: 'Point the phone right. Hold still.',
  [Phrase.SCAN_COMPLETE]: 'Scan complete. No moving vehicles detected.',
  [Phrase.ASSIST_STARTED]: 'Point the phone forward.',
  [Phrase.ASSIST_STOPPED]: 'Camera help off.',
  [Phrase.MODEL_MISSING]: 'Detection unavailable.',
  [Phrase.TILT_UP]: 'Raise the phone.',
  [Phrase.TILT_DOWN]: 'Lower the phone.',
  [Phrase.SIGNAL_CENTERED]: 'Pedestrian signal ahead.',
  [Phrase.CROSSWALK_CENTERED]: 'Crosswalk ahead.',
  [Phrase.WALK_STARTED]: 'Pedestrian walk signal just started.',
  [Phrase.WALK_ALREADY_ON]: 'Pedestrian walk signal. Start time unknown.',
  [Phrase.WALK_FLASHING]: 'Pedestrian walk signal flashing.',
  [Phrase.DONT_WALK]: 'Don’t-walk signal.',
  [Phrase.DONT_WALK_FLASHING]: 'Don’t-walk signal flashing.',
  [Phrase.SIGNAL_LOST]: 'Pedestrian signal out of view.',
  [Phrase.SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING]: 'Signal changed to don’t walk.',
  [Phrase.WALKING_ON_DONT_WALK]: 'Don’t-walk signal.',
  [Phrase.CROSSING_STARTED]: 'Crossing guidance started.',
  [Phrase.CROSSING_DETECTED]: 'Crossing guidance started.',
  [Phrase.CROSSING_ENDED]: 'Crossing guidance ended.',
  [Phrase.VEHICLE_LEFT]: 'Vehicle coming from the left.',
  [Phrase.VEHICLE_AHEAD]: 'Vehicle approaching.',
  [Phrase.VEHICLE_RIGHT]: 'Vehicle coming from the right.',
  [Phrase.VEHICLE_CLOSE_LEFT]: 'Caution. Vehicle from the left.',
  [Phrase.VEHICLE_CLOSE_AHEAD]: 'Caution. Vehicle detected.',
  [Phrase.VEHICLE_CLOSE_RIGHT]: 'Caution. Vehicle from the right.',
  [Phrase.STATUS_NO_SIGNAL]: 'No pedestrian signal in view.',
  [Phrase.STATUS_WALK_ELAPSED]: '', // plural, see phraseText
  [Phrase.STATUS_WALK_UNKNOWN_AGE]: 'Pedestrian walk signal. Start time unknown.',
  [Phrase.STATUS_WALK_FLASHING]: 'Pedestrian walk signal flashing.',
  [Phrase.STATUS_DONT_WALK]: 'Don’t-walk signal.',
  [Phrase.STATUS_NO_VEHICLES]: 'No moving vehicles in view.',
  [Phrase.STATUS_VEHICLES]: '', // plural, see phraseText
};

/** Text of a phrase, also used for on-screen captions and logs. */
export function phraseText(phrase: Phrase, args: readonly number[] = []): string {
  const n = args[0] ?? 0;
  switch (phrase) {
    case Phrase.STATUS_WALK_ELAPSED:
      return n === 1 ? `Pedestrian walk signal started ${n} second ago.` : `Pedestrian walk signal started ${n} seconds ago.`;
    case Phrase.STATUS_DETECTED:
      return `${n} ${n === 1 ? 'vehicle' : 'vehicles'} detected.`;
    case Phrase.STATUS_VEHICLES:
      return n === 1 ? `${n} moving vehicle in view.` : `${n} moving vehicles in view.`;
    default:
      return PHRASES[phrase];
  }
}

/** The words a speech cue says, or null for tones and haptics. */
export function cueText(cue: Cue): string | null {
  if (cue.kind === 'speak') return phraseText(cue.phrase, cue.args);
  if (cue.kind === 'speakText') return cue.text;
  return null;
}

export const S = {
  appName: 'CrossWise',

  actionStartAssist: 'Start assist',
  actionStopAssist: 'Stop assist',
  actionStartCrossing: "I'm crossing now",
  actionEndCrossing: 'I’m on the footpath',
  crossingFinishHint: 'Confirm the far footpath, not a refuge island.',
  actionRepeatStatus: 'Repeat status',
  actionSettings: 'Settings',
  actionBack: 'Back',
  actionBackToSettings: 'Back to Settings',
  actionGrantCamera: 'Allow camera',
  actionOpenSettings: 'Open app settings',
  cameraPermissionNeeded:
    'CrossWise needs the camera to see pedestrian signals and traffic. Detection runs on the phone. Optional scene descriptions send requested images to Google Gemini.',
  cameraPermissionDenied:
    'Camera access is off for CrossWise. Turn it on in app settings, then come back to the app.',

  modeIdle: 'Assist off',
  modeSearching: 'Looking for a signal',
  modeWaiting: 'Watching the signal',
  modeCrossing: 'Crossing',

  phaseUnknown: 'NO SIGNAL',
  phaseWalk: 'WALK',
  phaseWalkFlashing: 'WALK FLASHING',
  phaseDontWalk: "DON'T WALK",
  phaseDontWalkFlashing: "DON'T WALK FLASHING",
  phaseDetailFresh: (s: number) => `just started · ${s} s`,
  phaseDetailUnknownAge: 'start not seen · may end soon',
  phaseDetailUnverified: 'unverified light color',
  veerOnCourse: 'on course',
  veerDriftLeft: (d: number) => `drifted left ${d}°`,
  veerDriftRight: (d: number) => `drifted right ${d}°`,
  hazardBanner: (side: string) => `VEHICLE APPROACHING · ${side}`,
  sideLeft: 'LEFT',
  sideAhead: 'AHEAD',
  sideRight: 'RIGHT',

  modelLoading: 'Loading model…',
  modelMissing: 'No model · see ml/README.md',
  modelFailed: (m: string) => `Model error: ${m}`,
  modelReady: (name: string, px: number, backend: string) => `${name} · ${px} px · ${backend}`,
  perfStats: (fps: number, ms: number) => `${fps.toFixed(1)} fps · ${ms} ms`,

  safetyTitle: 'Before you use CrossWise',
  safetyBody:
    'CrossWise is an aid, not a replacement for your cane, guide dog, orientation and mobility skills, or your own judgment. It can miss or misread signals and vehicles, especially at night, in rain, or when the view is blocked. It never tells you that it is safe to cross. Test it with a sighted helper before relying on it.',
  safetyAccept: 'I understand',

  settingsTitle: 'Settings',
  settingsSectionHelp: 'Help and practice',
  settingsOpenGuide: 'How to use CrossWise',
  settingsSectionFeedback: 'Feedback',
  settingsSpeech: 'Speech',
  settingsTones: 'Tones (use headphones for left/right)',
  settingsHaptics: 'Vibration',
  settingsSpeechRate: 'Speech rate',
  settingsVerbosity: 'Verbosity',
  verbosityMinimal: 'Minimal',
  verbosityNormal: 'Normal',
  verbosityDetailed: 'Detailed',
  settingsSectionGuidance: 'Guidance',
  settingsAimSonar: 'Signal sonar while aiming',
  settingsVeer: 'Drift warnings while crossing',
  settingsVehicleAlerts: 'Approaching vehicle alerts',
  settingsAutoCrossing: 'Detect crossing start from walking',
  settingsSectionDetection: 'Detection',
  settingsGpu: 'Use hardware acceleration when available',
  settingsThreshold: 'Detection threshold',
  settingsPreview: 'Show camera preview',
  settingsOverlay: 'Show detection boxes',
  settingsSectionModel: 'Model',
  settingsImportModel: 'Import .tflite model',
  settingsSectionData: 'Research data',
  settingsLog: 'Log sessions to CSV',
  settingsLogLocation:
    'Logs are saved in app storage. Use Share logs in Guide to export them.',

  tabAssist: 'Assist',
  tabPractice: 'Practice',
  tabGuide: 'Guide',
  tabSettings: 'Settings',
  tabNavigate: 'Go',

  sceneSignalAt: (clock: number, pct: number) => `Signal at ${clock} o’clock, confidence ${pct}%`,
  sceneSignalStale: (s: number) => `Signal last seen ${s} s ago`,
  sceneSignalNone: 'No pedestrian signal in view',
  sceneCrosswalk: 'Crosswalk markings in view',
  sceneNoCrosswalk: 'No crosswalk markings in view',
  sceneNearby: (name: string, clock: number) => `${name} at ${clock} o’clock`,
  sceneNearbyMany: (n: number, name: string, clock: number) => `${n} ${name}, nearest at ${clock} o’clock`,
  sceneQuiet: 'No people or vehicles detected',
  sceneHeading: (point: string, deg: number) => `Facing ${point}, ${deg}°`,
  sceneWalking: 'Walking',
  sceneStanding: 'Standing still',

  warnTitle: 'Check before you rely on it',
  warnDark: 'Very dark image. Detection is unreliable at night without street lighting.',
  warnCovered: 'The lens may be covered. Check nothing is over the camera.',
  warnTilt: 'Phone is flat. Hold it upright, chest height, pointing across the street.',
  warnSlow: (fps: number) => `Only ${Math.round(fps)} frames per second. A fast vehicle may be missed.`,
  warnNoHeadphones: 'No headphones. Left and right tones will both play from the phone.',
  warnBattery: (pct: number) => `Battery ${pct}%. Assist uses the camera continuously.`,
  warnBaselineModel:
    'Baseline model: it cannot tell a red signal from a green one. Colours are announced as unverified.',
  warnTapToDismiss: 'tap to dismiss',

  practiceTitle: 'Practice the cues',
  practiceIntro:
    'Every sound, word and vibration the app can produce, on demand, with no traffic involved. Learn them here before you stand at a curb. Use headphones to hear left and right.',
  practiceSignals: 'Signal phases',
  practiceHazards: 'Vehicles',
  practiceGuidance: 'Aiming and drift',
  practiceWalk: 'Walk sign just came on',
  practiceWalkOld: 'Walk sign already on',
  practiceFlashing: 'Walk sign flashing',
  practiceDontWalk: 'Don’t walk',
  practiceLost: 'Signal lost',
  practiceVehicleLeft: 'Vehicle from the left',
  practiceVehicleAhead: 'Vehicle ahead',
  practiceVehicleRight: 'Vehicle from the right',
  practiceVehicleClose: 'Vehicle very close',
  practiceSonar: 'Aiming sonar',
  practiceCentered: 'Signal centered',
  practiceBearLeft: 'Bear left',
  practiceBearRight: 'Bear right',
  practiceCrossing: 'Crossing started',

  guideTitle: 'Guide',
  guideSectionSafety: 'Safety',
  guideSectionHolding: 'Holding the phone',
  guideSectionSounds: 'What the sounds mean',
  guideSectionHaptics: 'What the vibrations mean',
  guideSectionTrouble: 'If something is wrong',
  guideSectionAbout: 'About',
  guideSectionSessions: 'Recorded sessions',
  guideHolding:
    'The camera fills the screen. The bottom up arrow shows the map; the down arrow hides it. Tap the map to expand it. Use the bottom-right inward arrows to return. These buttons are labelled Show map, Hide map, Open full-screen map and Close full-screen map for VoiceOver.\n\nChoose destination, confirm the place and address, review the route, then Start journey. Repeat reads the current guidance. Show the map to review and confirm completed instructions. Pause shows Resume and End journey.\n\nAt a road, choose Crossing help. Hold the phone upright at chest height and scan slowly left and right. Choose “I’m crossing” when you begin. Confirm “I’m on the footpath” only on the far footpath, not on a refuge island. Route speech then resumes.\n\nWithout a destination, use Start camera assistance, then I’m crossing and I’m on the footpath. Stop assistance ends the session. Volume buttons change volume normally.',
  guideSoundSonar:
    'Repeating tick that speeds up as the signal moves towards the centre of view, panned to the ear it is on.',
  guideSoundCentered: 'Short double tick: the signal is straight ahead.',
  guideSoundWalk: 'Rising chime: the walk sign came on while you were watching.',
  guideSoundStop: 'Low tone: don’t walk.',
  guideSoundAlert: 'Vehicle warnings vibrate. Left or right is announced only with reliable direction while the phone faces forward. An uncertain vehicle is announced as “Vehicle detected.” Hold the phone left, then right when instructed. A scan summary is not permission to cross.',
  guideSoundCritical: 'Urgent repeated beeps: an elevated vehicle warning. Image expansion does not measure distance.',
  guideSoundVeer: 'Phone heading is diagnostic information; turning the phone does not establish walking drift.',
  guideSoundLost: 'Falling tone: the signal left the camera view.',
  guideHapticWalk: 'Three pulses: pedestrian walk signal observed.',
  guideHapticDont: 'One long pulse: don’t walk.',
  guideHapticFlashing: 'Three short pulses: flashing, the interval is ending.',
  guideHapticAlert: 'Four short buzzes: vehicle warning.',
  guideHapticTick: 'Single tick: the signal is centred.',
  guideTroubleNoSignal:
    'If no signal is found: check the lens is clear, hold the phone upright and sweep slowly. Some crossings have no pedestrian signal at all.',
  guideTroubleNoSound:
    'If you hear nothing: check the volume, that Speech and Tones are on in Settings, and that any headphones are connected. CrossWise plays even when the ring/silent switch is on silent.',
  guideTroubleSlow: 'If the frame rate is low: close other apps, or turn the preview off in Settings.',
  guideTroubleModel:
    'If the model is missing: import a .tflite in Settings, or copy one into the CrossWise folder in the Files app.',
  guideAboutVersion: (v: string) => `Version ${v}`,
  guideAboutModel: (m: string) => `Model: ${m}`,
  guideAboutLicenses:
    'Detector from Ultralytics YOLO (AGPL-3.0). Type is Atkinson Hyperlegible by the Braille Institute (SIL OFL 1.1), Inter and Tinos. Training data: VIDVIP (CC BY-NC-ND 4.0, non-commercial), DTLD (research and teaching), Roboflow Universe sets (CC BY 4.0). Research prototype — not a commercial product.',
  guideSessionsEmpty: 'No sessions recorded yet. Turn on “Log sessions to CSV” in Settings.',
  guideSessionsCount: (n: number) => `${n} session file(s) in Documents/logs`,
  guideShare: 'Share',

  actionDetails: 'Details',
  actionHideDetails: 'Hide',
  settingsFont: 'Typeface',
  fontModern: 'Modern (Inter)',
  fontClassic: 'Classic (Times)',
  fontHyperlegible: 'Hyperlegible (low vision)',
  settingsLargeStatus: 'Large status text',
  settingsSectionDisplay: 'Display',
  actionStartShort: 'Start',
  actionStopShort: 'Stop',
  actionCrossingShort: 'Cross',
  actionCrossingEndShort: 'End',
  settingsModelDelete: 'Remove',
  modelKindTrained: 'Trained on pedestrian signals',
  modelKindCoco: 'COCO baseline — no signal colours',
  modelKindImported: 'Imported',
  noticeModelImported: (name: string) => `Model imported: ${name}`,
  noticeModelActive: (name: string, n: number) => `Using ${name}, ${n} classes`,
  noticeModelFailed: (name: string) => `Could not load ${name}`,
  segLegend: 'Segmentation classes',
  segShowMask: 'Mask',
  segShowBoxes: 'Boxes',
  settingsShowWarnings: 'Show warnings over the camera',
  settingsShowStatusIcons: 'Show status icons (people, crosswalk, signal)',
  settingsShowModelLine: 'Show model and frame rate',
  geminiPointLeft: 'Point the phone left.',
  geminiPointFront: 'Point the phone forward.',
  geminiPointRight: 'Point the phone right.',
  geminiThinking: 'Looking at your surroundings.',
  geminiFailed: 'Description unavailable. Try again.',
  geminiNoKey: 'Scene descriptions unavailable.',
  actionDescribe: 'Describe surroundings',
  actionDescribing: 'Scanning…',
  settingsSectionAi: 'Assistant',
  settingsGemini: 'Describe surroundings (Gemini)',

  // UI P1b
  voiceStart: 'Start voice commands',
  voiceStop: 'Stop listening',
  voiceRetry: 'Retry voice',
  noticeDismissHint: 'Tap to dismiss',
};

/** Everyday speech: observations, short confirmations and recoverable failures. Tutorials stay in Help. */
export const P = {
  cameraUnavailable: 'Camera unavailable.',
  cameraStarting: 'Starting camera…',
  detectionWaiting: 'Waiting for detection…',
  detectionTooSlow: 'Detection too slow.',
  detectionUnavailable: 'Vehicle detection unavailable.',
  journeyPaused: 'Navigation paused.',
  crossingPaused: 'Crossing guidance ended. Navigation paused.',
  crossingHelp: 'Crossing guidance.',
  confirmFootpath: 'Finish crossing before changing the route.',
  journeyEnded: 'Navigation stopped.',
  locationRestored: 'Location restored.',
  locationPoor: 'Location inaccurate. Distance unavailable.',
  offRoute: 'You may be off route.',
  stepEnd: 'End of this instruction nearby.',
  nearDestination: 'Destination nearby.',
  places: (count: number) => count ? `${count} ${count === 1 ? 'place' : 'places'} found.` : 'No places found. Try another name.',
  routeReady: (name: string, metres: number) => `${name}. About ${Math.round(metres)} metres.`,
  instruction: (index: number, instruction: string, remaining: number | null) =>
    `${instruction}${/[.!?]$/.test(instruction) ? '' : '.'}` +
    (remaining === null ? '' : ` About ${remaining} metres remaining.`),
  arrived: (name: string) => `Arrived at ${name}.`,
};
