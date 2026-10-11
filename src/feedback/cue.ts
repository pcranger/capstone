/**
 * Everything the app can say or play. The engine emits Cues; the platform layer turns them into
 * speech (text from strings.ts), synthesized tones and vibration patterns.
 */
export enum Priority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export enum Phrase {
  VEHICLE_MOVING = 'VEHICLE_MOVING',
  TRAFFIC_UNAVAILABLE = 'TRAFFIC_UNAVAILABLE',
  SIGNAL_UNAVAILABLE = 'SIGNAL_UNAVAILABLE',
  SCAN_RESTART = 'SCAN_RESTART',
  STATUS_DETECTED = 'STATUS_DETECTED',
  VEHICLE_DETECTED = 'VEHICLE_DETECTED',
  SCAN_LEFT = 'SCAN_LEFT',
  SCAN_RIGHT = 'SCAN_RIGHT',
  SCAN_COMPLETE = 'SCAN_COMPLETE',
  ASSIST_STARTED = 'ASSIST_STARTED',
  ASSIST_STOPPED = 'ASSIST_STOPPED',
  MODEL_MISSING = 'MODEL_MISSING',
  TILT_UP = 'TILT_UP',
  TILT_DOWN = 'TILT_DOWN',
  SIGNAL_CENTERED = 'SIGNAL_CENTERED',
  CROSSWALK_CENTERED = 'CROSSWALK_CENTERED',

  WALK_STARTED = 'WALK_STARTED',
  WALK_ALREADY_ON = 'WALK_ALREADY_ON',
  WALK_FLASHING = 'WALK_FLASHING',
  DONT_WALK = 'DONT_WALK',
  DONT_WALK_FLASHING = 'DONT_WALK_FLASHING',
  SIGNAL_LOST = 'SIGNAL_LOST',
  SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING = 'SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING',
  WALKING_ON_DONT_WALK = 'WALKING_ON_DONT_WALK',

  CROSSING_STARTED = 'CROSSING_STARTED',
  CROSSING_DETECTED = 'CROSSING_DETECTED',
  CROSSING_ENDED = 'CROSSING_ENDED',

  VEHICLE_LEFT = 'VEHICLE_LEFT',
  VEHICLE_AHEAD = 'VEHICLE_AHEAD',
  VEHICLE_RIGHT = 'VEHICLE_RIGHT',
  VEHICLE_CLOSE_LEFT = 'VEHICLE_CLOSE_LEFT',
  VEHICLE_CLOSE_AHEAD = 'VEHICLE_CLOSE_AHEAD',
  VEHICLE_CLOSE_RIGHT = 'VEHICLE_CLOSE_RIGHT',

  STATUS_NO_SIGNAL = 'STATUS_NO_SIGNAL',
  STATUS_WALK_ELAPSED = 'STATUS_WALK_ELAPSED',
  STATUS_WALK_UNKNOWN_AGE = 'STATUS_WALK_UNKNOWN_AGE',
  STATUS_WALK_FLASHING = 'STATUS_WALK_FLASHING',
  STATUS_DONT_WALK = 'STATUS_DONT_WALK',
  STATUS_NO_VEHICLES = 'STATUS_NO_VEHICLES',
  STATUS_VEHICLES = 'STATUS_VEHICLES',
}

export enum ToneKind {
  LISTENING = 'LISTENING',
  SONAR = 'SONAR',
  CENTERED = 'CENTERED',
  WALK_CHIME = 'WALK_CHIME',
  STOP = 'STOP',
  ALERT = 'ALERT',
  CRITICAL = 'CRITICAL',
  VEER = 'VEER',
  /** First camera frame analysed: the app can now see. */
  READY = 'READY',
  LOST = 'LOST',
}

export enum HapticPattern {
  WALK = 'WALK',
  DONT_WALK = 'DONT_WALK',
  FLASHING = 'FLASHING',
  LOST = 'LOST',
  CENTERED_TICK = 'CENTERED_TICK',
  VEER_LEFT = 'VEER_LEFT',
  VEER_RIGHT = 'VEER_RIGHT',
  ALERT = 'ALERT',
  CRITICAL = 'CRITICAL',
  /** Camera help switched off: a long buzz with a different rhythm from CRITICAL (a vehicle about to hit). */
  STOPPED = 'STOPPED',
  /** Double tick for "microphone ready"; unlike CENTERED_TICK (one tick). Wired in the controller later. */
  MIC_READY = 'MIC_READY',
}

export type Cue =
  | { kind: 'speak'; phrase: Phrase; priority: Priority; args?: number[] }
  /** Words generated at runtime — a scene description or a route step — rather than a fixed phrase. */
  | { kind: 'speakText'; text: string; priority: Priority }
  /** pan from -1 (left ear) to +1 (right ear): the sound comes from the direction to attend to. */
  | { kind: 'tone'; tone: ToneKind; pan: number }
  | { kind: 'haptic'; pattern: HapticPattern };

export const Cues = {
  speak: (phrase: Phrase, priority: Priority, args?: number[]): Cue => ({ kind: 'speak', phrase, priority, args }),
  speakText: (text: string, priority: Priority): Cue => ({ kind: 'speakText', text, priority }),
  tone: (tone: ToneKind, pan = 0): Cue => ({ kind: 'tone', tone, pan }),
  haptic: (pattern: HapticPattern): Cue => ({ kind: 'haptic', pattern }),
};

export enum Verbosity {
  MINIMAL = 'MINIMAL',
  NORMAL = 'NORMAL',
  DETAILED = 'DETAILED',
}
