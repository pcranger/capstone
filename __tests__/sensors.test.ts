import { VeerMonitor, VeerState } from '../src/crossing/veerMonitor';
import { OrientationMath } from '../src/sensors/orientationMath';
import { WalkingDetector } from '../src/sensors/walkingDetector';
import { seededRandom } from './fixtures';

const rad = (deg: number) => (deg * Math.PI) / 180;

function rotX(deg: number): number[] {
  const a = rad(deg);
  return [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
}

function rotZ(deg: number): number[] {
  const a = rad(deg);
  return [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
}

function mul(a: number[], b: number[]): number[] {
  return Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    let sum = 0;
    for (let k = 0; k < 3; k++) sum += a[r * 3 + k] * b[k * 3 + c];
    return sum;
  });
}

describe('OrientationMath', () => {
  test('quaternion matches the Android / CoreMotion convention', () => {
    // +90° about X: phone upright, screen toward the user.
    const s = Math.sin(Math.PI / 4);
    const r = OrientationMath.rotationMatrixFromQuaternion([s, 0, 0, s]);
    const expected = rotX(90);
    r.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });

  test('upright phone facing north and east', () => {
    const north = OrientationMath.cameraOrientation(mul(rotZ(0), rotX(90)), 0);
    expect(north.pitchDeg).toBeCloseTo(0, 3);
    expect(north.headingDeg).toBeCloseTo(0, 3);

    // Turning right (clockwise seen from above) is a negative rotation about world Z.
    const east = OrientationMath.cameraOrientation(mul(rotZ(-90), rotX(90)), 0);
    expect(east.headingDeg).toBeCloseTo(90, 3);
  });

  test('tilting up raises pitch', () => {
    const up = OrientationMath.cameraOrientation(mul(rotZ(-30), rotX(110)), 0);
    expect(up.pitchDeg).toBeCloseTo(20, 3);
    expect(up.headingDeg).toBeCloseTo(30, 3);
  });

  test('flat phone uses top edge as heading', () => {
    const flat = OrientationMath.cameraOrientation(mul(rotZ(-45), rotX(0)), 0);
    expect(flat.pitchDeg).toBeCloseTo(-90, 3);
    expect(flat.headingDeg).toBeCloseTo(45, 3);
  });
});

describe('WalkingDetector', () => {
  test('sees steps, not stillness', () => {
    const walking = new WalkingDetector();
    for (let t = 0; t < 3_000; t += 20) {
      const bounce = 2 * Math.sin((2 * Math.PI * 1.8 * t) / 1000);
      walking.onAccelerometer(t, 0, 9.81 + bounce, 0.3);
    }
    expect(walking.isWalking).toBe(true);

    const still = new WalkingDetector();
    const rng = seededRandom(1);
    for (let t = 0; t < 3_000; t += 20) {
      still.onAccelerometer(t, rng() * 0.1, 9.81 + rng() * 0.1, 0.2);
    }
    expect(still.isWalking).toBe(false);
  });
});

describe('VeerMonitor', () => {
  test('warns after sustained drift across north', () => {
    const veer = new VeerMonitor();
    veer.lock(350, 0);
    let t = 0;
    let state = VeerState.ON_COURSE;
    for (; t <= 3_000; t += 50) state = veer.update(8, t)!.state; // 18° to the right of the locked heading
    expect(state).toBe(VeerState.DRIFTED_RIGHT);
    for (; t <= 6_000; t += 50) state = veer.update(352, t)!.state;
    expect(state).toBe(VeerState.ON_COURSE);
  });

  test('ignores body sway', () => {
    const veer = new VeerMonitor();
    veer.lock(90, 0);
    let worst = 0;
    for (let t = 0; t <= 10_000; t += 20) {
      // ±15° sway at step frequency averages out.
      const heading = 90 + 15 * Math.sin((2 * Math.PI * 1.8 * t) / 1000);
      const status = veer.update(heading, t)!;
      expect(status.state).toBe(VeerState.ON_COURSE);
      worst = Math.max(worst, Math.abs(status.deviationDeg));
    }
    expect(worst).toBeLessThan(12);
  });
});
