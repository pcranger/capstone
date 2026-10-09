import { Angles } from '../core/geometry';

/** Orientation of the rear camera's optical axis in a gravity-aligned world frame. */
export interface OrientationSample {
  timestampMs: number;
  /** Heading of the camera axis projected on the ground plane, 0..360. Reference is arbitrary but stable. */
  headingDeg: number;
  /** Elevation of the camera axis: + when pointing above the horizon, -90 when pointing at the ground. */
  pitchDeg: number;
}

export const OrientationMath = {
  /**
   * Device -> world rotation matrix (row-major) from a unit quaternion (x, y, z, w).
   * Same convention as Android's SensorManager.getRotationMatrixFromVector; CoreMotion's attitude quaternion
   * in the xArbitraryZVertical frame has the same meaning (see the native module).
   */
  rotationMatrixFromQuaternion(values: readonly number[]): number[] {
    const q1 = values[0];
    const q2 = values[1];
    const q3 = values[2];
    let q0: number;
    if (values.length >= 4) {
      q0 = values[3];
    } else {
      const t = 1 - q1 * q1 - q2 * q2 - q3 * q3;
      q0 = t > 0 ? Math.sqrt(t) : 0;
    }
    const sqQ1 = 2 * q1 * q1;
    const sqQ2 = 2 * q2 * q2;
    const sqQ3 = 2 * q3 * q3;
    const q1q2 = 2 * q1 * q2;
    const q3q0 = 2 * q3 * q0;
    const q1q3 = 2 * q1 * q3;
    const q2q0 = 2 * q2 * q0;
    const q2q3 = 2 * q2 * q3;
    const q1q0 = 2 * q1 * q0;
    return [
      1 - sqQ2 - sqQ3, q1q2 - q3q0, q1q3 + q2q0,
      q1q2 + q3q0, 1 - sqQ1 - sqQ3, q2q3 - q1q0,
      q1q3 - q2q0, q2q3 + q1q0, 1 - sqQ1 - sqQ2,
    ];
  },

  /**
   * Heading and pitch of the rear camera (device -Z axis). When the camera points almost straight
   * up or down the heading is taken from the top edge of the phone instead, which is what a user
   * holding the phone flat perceives as "forward".
   */
  cameraOrientation(r: readonly number[], timestampMs: number): OrientationSample {
    const fx = -r[2];
    const fy = -r[5];
    const fz = -r[8];
    const norm = Math.max(Math.sqrt(fx * fx + fy * fy + fz * fz), 1e-6);
    const pitch = Angles.toDeg(Math.asin(Math.min(Math.max(fz / norm, -1), 1)));
    const heading =
      Math.abs(pitch) < 70 ? Angles.toDeg(Math.atan2(fx, fy)) : Angles.toDeg(Math.atan2(r[1], r[4]));
    return { timestampMs, headingDeg: Angles.wrap360(heading), pitchDeg: pitch };
  },
};
