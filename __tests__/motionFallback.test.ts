import { DeviceMotion } from 'expo-sensors';
import { MotionSensors } from '../src/sensors/motionSensors';

// Only the sensor source is replaced: no CrossWiseNative (Android build today) and a scripted expo-sensors DeviceMotion.
jest.mock('../modules/crosswise-native', () => ({ __esModule: true, default: null }));
jest.mock('expo-sensors', () => ({
  DeviceMotion: { isAvailableAsync: jest.fn(), setUpdateInterval: jest.fn(), addListener: jest.fn() },
}));

const dm = jest.mocked(DeviceMotion);
type Listener = Parameters<typeof DeviceMotion.addListener>[0];
type Measurement = Parameters<Listener>[0];

let listener: Listener | null = null;
const remove = jest.fn();
let clock = 0;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const emit = (rotation: [number, number, number], a: [number, number, number]) => {
  clock += 20;
  listener?.({
    rotation: { alpha: rotation[0], beta: rotation[1], gamma: rotation[2], timestamp: clock },
    accelerationIncludingGravity: { x: a[0], y: a[1], z: a[2], timestamp: clock },
  } as unknown as Measurement);
};
/** Steps at 1.8 Hz, as in the WalkingDetector test; `sign` -1 is how Expo's Android reports gravity (accel - 2 * gravity). */
const walk = (ms: number, sign: number) => {
  for (let t = 0; t < ms; t += 20) emit([0, Math.PI / 2, 0], [0, sign * (9.81 + 2 * Math.sin((2 * Math.PI * 1.8 * clock) / 1000)), sign * 0.3]);
};

beforeEach(() => {
  listener = null;
  clock = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  dm.isAvailableAsync.mockResolvedValue(true);
  dm.setUpdateInterval.mockClear();
  dm.addListener.mockClear();
  remove.mockClear();
  dm.addListener.mockImplementation((l) => {
    listener = l;
    return { remove } as never;
  });
});
afterEach(() => jest.restoreAllMocks());

describe('MotionSensors without the native module', () => {
  test('feeds heading, pitch and walking from DeviceMotion', async () => {
    const sensors = new MotionSensors();
    expect(sensors.hasHeading).toBe(false);
    sensors.start();
    await flush();
    expect(dm.setUpdateInterval).toHaveBeenCalledWith(20);
    expect(sensors.hasHeading).toBe(true);

    // Upright, turned 90 deg right: Expo alpha = -90 deg.
    emit([-Math.PI / 2, Math.PI / 2, 0], [0, 9.81, 0]);
    expect(sensors.latestOrientation?.headingDeg).toBeCloseTo(90, 3);
    expect(sensors.latestOrientation?.pitchDeg).toBeCloseTo(0, 3);
    expect(sensors.isWalking).toBe(false);

    walk(3_000, 1);
    expect(sensors.isWalking).toBe(true);
    for (let i = 0; i < 125; i++) emit([0, Math.PI / 2, 0], [0, 9.81, 0.3]); // 2.5 s standing still
    expect(sensors.isWalking).toBe(false);

    sensors.stop();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(sensors.isWalking).toBe(false);
  });

  test('walking is detected whichever way gravity is signed', async () => {
    const sensors = new MotionSensors();
    sensors.start();
    await flush();
    walk(3_000, -1);
    expect(sensors.isWalking).toBe(true);
  });

  test('DeviceMotion unavailable: no orientation, never walking, as before', async () => {
    dm.isAvailableAsync.mockResolvedValue(false);
    const sensors = new MotionSensors();
    sensors.start();
    await flush();
    expect(dm.addListener).not.toHaveBeenCalled();
    expect(sensors.hasHeading).toBe(false);
    expect(sensors.latestOrientation).toBeNull();
    expect(sensors.isWalking).toBe(false);
  });

  test('stop before the availability check finishes leaves nothing subscribed', async () => {
    const sensors = new MotionSensors();
    sensors.start();
    sensors.stop();
    await flush();
    expect(dm.addListener).not.toHaveBeenCalled();
  });
});
