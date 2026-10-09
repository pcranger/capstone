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

function rotY(deg: number): number[] {
  const a = rad(deg);
  return [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
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

describe('OrientationMath.quaternionFromDeviceRotation (Expo DeviceMotion rotation)', () => {
  const fromRotation = (alphaDeg: number, betaDeg: number, gammaDeg: number) =>
    OrientationMath.cameraOrientation(
      OrientationMath.rotationMatrixFromQuaternion(
        OrientationMath.quaternionFromDeviceRotation(rad(alphaDeg), rad(betaDeg), rad(gammaDeg)),
      ),
      0,
    );
  // What Expo's Android DeviceMotionModule.kt does: getOrientation(R) -> alpha = -azimuth, beta = -pitch, gamma = roll.
  const expoRotationOf = (r: number[]) => ({
    alpha: -Math.atan2(r[1], r[4]),
    beta: -Math.asin(-r[7]),
    gamma: Math.atan2(-r[6], r[8]),
  });
  const headingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  test('phone flat, face up: camera at the ground, heading from the top edge', () => {
    const flat = fromRotation(0, 0, 0);
    expect(flat.pitchDeg).toBeCloseTo(-90, 3);
    expect(flat.headingDeg).toBeCloseTo(0, 3);
    // Turned 45 deg clockwise seen from above: Expo alpha = -azimuth = -45.
    expect(fromRotation(-45, 0, 0).headingDeg).toBeCloseTo(45, 3);
  });

  test('phone upright, camera at the horizon: pitch 0; turning right 90 deg adds 90 to the heading', () => {
    const north = fromRotation(0, 90, 0);
    expect(north.pitchDeg).toBeCloseTo(0, 3);
    expect(north.headingDeg).toBeCloseTo(0, 3);
    expect(fromRotation(-90, 90, 0).headingDeg).toBeCloseTo(90, 3);
    expect(fromRotation(90, 90, 0).headingDeg).toBeCloseTo(270, 3);
    expect(fromRotation(-90, 90, 0).pitchDeg).toBeCloseTo(0, 3);
  });

  test('camera tilted 30 deg below the horizon: pitch -30, heading unchanged', () => {
    const down = fromRotation(-30, 60, 0);
    expect(down.pitchDeg).toBeCloseTo(-30, 3);
    expect(down.headingDeg).toBeCloseTo(30, 3);
  });

  test('matches the native quaternion path for the same pose, including at the upright singularity', () => {
    const rng = seededRandom(7);
    for (let i = 0; i < 300; i++) {
      const near = i % 3 === 0; // a third of the poses within 1 deg of upright, where Euler angles are worst
      const r = mul(rotZ(rng() * 360 - 180), mul(rotX(near ? 90 + rng() * 2 - 1 : rng() * 360 - 180), rotY(rng() * 360 - 180)));
      const { alpha, beta, gamma } = expoRotationOf(r);
      const got = OrientationMath.cameraOrientation(
        OrientationMath.rotationMatrixFromQuaternion(OrientationMath.quaternionFromDeviceRotation(alpha, beta, gamma)),
        0,
      );
      const want = OrientationMath.cameraOrientation(r, 0);
      expect(got.pitchDeg).toBeCloseTo(want.pitchDeg, 3);
      expect(headingGap(got.headingDeg, want.headingDeg)).toBeLessThan(0.01);
    }
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
