import { createVeerCue, veerCue, VEER_CUE_MIN_GAP_MS, VEER_CUE_SUSTAIN_MS, VEER_CUE_THRESHOLD_DEG } from '../src/crossing/veerMonitor';
import { DEFAULT_SETTINGS, engineSettingsOf } from '../src/settings/settings';
import { HAPTIC_PATTERNS } from '../src/feedback/haptics';
import { HapticPattern } from '../src/feedback/cue';
import { S } from '../src/strings';
import { STEER } from '../src/text/steerText';

jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) }));

describe('steering hint default and wording', () => {
  test('veerGuidance is off by default, in the app settings and in what the engine receives', () => {
    expect(DEFAULT_SETTINGS.veerGuidance).toBe(false);
    expect(engineSettingsOf(DEFAULT_SETTINGS).veerGuidance).toBe(false);
  });
  test('the wording is about the phone, not the body, and the old "disabled" claims are gone', () => {
    expect(STEER.cuePhoneLeft).toBe('Phone pointing left of the crossing. Point it straight ahead.');
    expect(STEER.cuePhoneRight).toBe('Phone pointing right of the crossing. Point it straight ahead.');
    expect(STEER.settingsSteerHints).toBe('Steering hints (experimental, off by default)');
    expect(STEER.settingsSteerHintsExplain).toBe('Uses the phone’s direction, not your body. May be wrong.');
    for (const text of [S.guideSoundVeer, STEER.developerNote, STEER.practiceNote]) {
      expect(text).toMatch(/experimental/i);
      expect(text).not.toMatch(/disabled/i);
    }
  });
});

describe('veerCue timing, threshold and rate limit', () => {
  test('constants are 15 degrees, 1.5 s and 4 s', () => {
    expect([VEER_CUE_THRESHOLD_DEG, VEER_CUE_SUSTAIN_MS, VEER_CUE_MIN_GAP_MS]).toEqual([15, 1_500, 4_000]);
  });
  test('no cue at or under 15 degrees however long it lasts', () => {
    const cue = createVeerCue();
    for (let t = 0; t <= 20_000; t += 100) {
      expect(cue(100, 115, true, t)).toBeNull();
      expect(cue(100, 85, true, t + 1)).toBeNull();
    }
  });
  test('a cue only after 1.5 s continuously off, to the left or the right', () => {
    const left = createVeerCue();
    expect(left(0, -20, true, 0)).toBeNull();
    expect(left(0, -20, true, 1_499)).toBeNull();
    expect(left(0, -20, true, 1_500)).toBe('DRIFT_LEFT');
    const right = createVeerCue();
    expect(right(0, 16, true, 0)).toBeNull();
    expect(right(0, 16, true, 1_500)).toBe('DRIFT_RIGHT');
  });
  test('compass wrap-around: anchor 350, heading 10 is 20 degrees to the right', () => {
    const cue = createVeerCue();
    cue(350, 10, true, 0);
    expect(cue(350, 10, true, 1_600)).toBe('DRIFT_RIGHT');
  });
  test('never while not walking, and not-walking resets the timer', () => {
    const cue = createVeerCue();
    expect(cue(0, 30, false, 0)).toBeNull();
    expect(cue(0, 30, false, 5_000)).toBeNull();
    expect(cue(0, 30, true, 5_100)).toBeNull();
    expect(cue(0, 30, true, 6_599)).toBeNull();
    expect(cue(0, 30, true, 6_600)).toBe('DRIFT_RIGHT');
  });
  test('coming back inside 15 degrees, or switching side, restarts the 1.5 s', () => {
    const cue = createVeerCue();
    cue(0, 30, true, 0);
    cue(0, 5, true, 1_000);
    expect(cue(0, 30, true, 1_100)).toBeNull();
    expect(cue(0, 30, true, 2_000)).toBeNull();
    expect(cue(0, 30, true, 2_600)).toBe('DRIFT_RIGHT');
    const flip = createVeerCue();
    flip(0, 30, true, 0);
    expect(flip(0, -30, true, 1_400)).toBeNull();
    expect(flip(0, -30, true, 2_800)).toBeNull();
    expect(flip(0, -30, true, 2_900)).toBe('DRIFT_LEFT');
  });
  test('at most one cue every 4 s while the drift continues', () => {
    const cue = createVeerCue();
    cue(0, 30, true, 0);
    const times: number[] = [];
    for (let t = 100; t <= 14_000; t += 100) if (cue(0, 30, true, t)) times.push(t);
    expect(times).toEqual([1_500, 5_500, 9_500, 13_500]);
  });
  test('reset clears the timers, and the shared instance starts quiet', () => {
    const cue = createVeerCue();
    cue(0, 30, true, 0);
    expect(cue(0, 30, true, 1_500)).toBe('DRIFT_RIGHT');
    cue.reset();
    expect(cue(0, 30, true, 1_600)).toBeNull();
    expect(cue(0, 30, true, 3_100)).toBe('DRIFT_RIGHT');
    expect(veerCue(0, 0, true, 0)).toBeNull();
  });
});

describe('buzz patterns', () => {
  const onTimes = (p: HapticPattern) => HAPTIC_PATTERNS[p][0].filter((_, i) => i % 2 === 1);
  test('vehicle warning is one 600 ms buzz plus two short ones', () => {
    const on = onTimes(HapticPattern.ALERT);
    expect(on[0]).toBe(600);
    expect(on.slice(1).every(ms => ms <= 100)).toBe(true);
    expect(on).toHaveLength(3);
  });
  test('no walk-family pattern has a long buzz or the vehicle warning rhythm', () => {
    for (const p of [HapticPattern.WALK, HapticPattern.FLASHING]) {
      expect(HAPTIC_PATTERNS[p]).not.toEqual(HAPTIC_PATTERNS[HapticPattern.ALERT]);
      expect(Math.max(...onTimes(p))).toBeLessThan(200);
    }
  });
  test('mic-ready is its own double tick, not the single centred tick', () => {
    expect(onTimes(HapticPattern.MIC_READY)).toHaveLength(2);
    expect(onTimes(HapticPattern.CENTERED_TICK)).toHaveLength(1);
    expect(HAPTIC_PATTERNS[HapticPattern.MIC_READY]).not.toEqual(HAPTIC_PATTERNS[HapticPattern.CENTERED_TICK]);
  });
  test('every pattern has matching timing and amplitude lengths', () => {
    for (const [timings, amps] of Object.values(HAPTIC_PATTERNS)) expect(amps).toHaveLength(timings.length);
  });
  test('the written descriptions match the real timings', () => {
    expect(S.guideHapticAlert).toBe('One long buzz, then two short ones: vehicle warning.');
    expect(S.guideHapticAlert).not.toMatch(/four/i);
    expect(S.guideHapticWalk).toMatch(/^Three/);
    expect(S.guideHapticFlashing).toMatch(/^Three/);
    expect(STEER.guideHapticMicReady).toMatch(/^Double tick/);
  });
});
