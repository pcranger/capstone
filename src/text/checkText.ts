import type { CheckEventKind, CheckSummary } from '../crossing/crossingCheck';

/**
 * Every user-facing line of the guided crossing check. Observations only: none of these says "safe".
 * (Kept apart from strings.ts so the check can change without touching the shared text file.)
 */
export const CHECK_TEXT = {
  gettingReady: 'Getting ready.',
  holdUpright: 'Hold the phone upright and still.',
  start: 'Facing the road. Turn right until the phone points up the road, toward the traffic.',
  fallbackNote: 'Couldn’t see the road’s angle, using straight left.',
  fallbackResult: 'Road angle not found; left side checked at a right angle.',
  vehicleStopRight: 'Vehicle on your right. Wait. Check again.',
  vehicleStopLeft: 'Vehicle on your left. Wait. Check again.',
  expired: 'Check expired. Check again.',
  stopped: 'Stopped. Press Start to try again.',
  alertsOff: 'Vehicle alerts are off, so no check can run. Turn them on in Settings.',
  stationaryResult: 'Vehicle seen, not moving. Check again.',
  notYet: 'Not yet. Check again.',
  practiceOnly: 'Practice only. No cars are checked.',
  crossingEnd: 'You should be near the far side. Use your cane to find the kerb. If the road is wider, keep walking until you feel the kerb.',
  twoLeft: '2 steps left',
} as const;

/** Why a check gave up after 30 s (kept out of CHECK_TEXT, which holds plain lines only). */
export const CHECK_STOP = {
  because: (reason: string) => `Stopped. ${reason} Press Start to try again.`,
  reasons: {
    compass: 'The compass is not working.',
    camera: 'The camera could not see clearly.',
    moving: 'You were moving.',
    tilt: 'The phone was not upright.',
    turn: 'The turn was not finished.',
  },
} as const;

const EVENT_TEXT: Record<CheckEventKind, string> = {
  KEEP_TURNING_RIGHT: 'Keep turning right',
  KEEP_TURNING_LEFT: 'Keep turning left',
  TOO_FAR: 'Too far, turn back a little',
  HOLD: 'Hold',
  HOLD_STILL: 'Hold still',
  LITTLE_MORE: 'A little more',
  LITTLE_BACK: 'A little back',
  TURN_LEFT: 'Right side checked. Now turn all the way round to your left, past the road, until the phone points down the road.',
  FACE_ROAD: 'Left side checked. Face the road again.',
  WRONG_WAY: 'Wrong way. Turn the other way.',
  DONE: '',
};
export const checkEventText = (kind: CheckEventKind): string => EVENT_TEXT[kind];

/** The spoken result. URGENT speech; never the word "safe". */
export const CHECK_RESULT_TEXT: Record<CheckSummary, string> = {
  NONE_SEEN: 'No vehicles seen on either side. Cross if you judge it clear.',
  MOVING_RIGHT: 'Vehicle on your right, moving. Wait.',
  MOVING_LEFT: 'Vehicle on your left, moving. Wait.',
  MOVING_BOTH: 'Vehicles on both sides, moving. Wait.',
  UNSURE: 'Vehicle seen, motion unclear. Check again.',
  NOT_CHECKED: 'Camera could not see clearly. Check again.',
};

export const crossingStartText = (steps: number): string =>
  `Crossing. About ${steps} steps. Use your cane to find the far kerb.`;
export const crossingHalfText = (left: number): string => `Halfway. About ${left} steps left.`;

/** The dock buttons. */
export const CHECK_BUTTON = { again: 'Check again', cross: 'Cross', start: 'Start' } as const;
