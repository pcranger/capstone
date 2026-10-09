import { DeviceMotion } from 'expo-sensors';
import CrossWiseNative from '../../modules/crosswise-native';
import { nowMs } from '../core/geometry';
import { OrientationMath, type OrientationSample } from './orientationMath';
import { WalkingDetector } from './walkingDetector';

/**
 * Camera heading/pitch from the gyroscope-based attitude (no magnetometer, so parked cars and steel poles do not
 * bend the heading) plus accelerometer-based walking detection. 50 Hz, like Android's SENSOR_DELAY_GAME.
 * Without the native module (current Android build) it falls back to expo-sensors DeviceMotion, whose Android
 * rotation vector does use the magnetometer, so heading can bend near steel.
 */
export class MotionSensors {
  private readonly walkingDetector = new WalkingDetector();
  private subscription: { remove(): void } | null = null;
  private fallbackWanted = false;
  latestOrientation: OrientationSample | null = null;
  isWalking = false;

  get hasHeading(): boolean {
    return CrossWiseNative ? CrossWiseNative.isMotionAvailable() : this.subscription !== null;
  }

  start(): void {
    if (this.subscription || this.fallbackWanted) return;
    if (!CrossWiseNative) {
      this.startFallback();
      return;
    }
    this.subscription = CrossWiseNative.addListener('onMotion', (e) =>
      this.feed(OrientationMath.rotationMatrixFromQuaternion([e.qx, e.qy, e.qz, e.qw]), e.ax, e.ay, e.az),
    );
    CrossWiseNative.startMotion(20);
  }

  private feed(r: number[], ax: number, ay: number, az: number): void {
    const now = nowMs();
    this.latestOrientation = OrientationMath.cameraOrientation(r, now);
    this.walkingDetector.onAccelerometer(now, ax, ay, az);
    this.isWalking = this.walkingDetector.isWalking;
  }

  /**
   * expo-sensors path. Expo's Android accelerationIncludingGravity is accelerometer - 2 * gravity, so the sign
   * differs from the native event, but WalkingDetector only reads magnitude and its oscillation, so it is fed as is.
   */
  private startFallback(): void {
    this.fallbackWanted = true;
    DeviceMotion.isAvailableAsync()
      .then((available) => {
        if (!available || !this.fallbackWanted || this.subscription) return;
        DeviceMotion.setUpdateInterval(20);
        this.subscription = DeviceMotion.addListener(({ rotation: q, accelerationIncludingGravity: a }) => {
          if (!q || !a) return; // Android sends no rotation until the first sensor events arrive.
          const quaternion = OrientationMath.quaternionFromDeviceRotation(q.alpha, q.beta, q.gamma);
          this.feed(OrientationMath.rotationMatrixFromQuaternion(quaternion), a.x, a.y, a.z);
        });
      })
      .catch(() => {
        this.fallbackWanted = false; // sensors unavailable: behave as before (no orientation, not walking)
      });
  }

  stop(): void {
    this.fallbackWanted = false;
    if (!this.subscription) return;
    this.subscription.remove();
    this.subscription = null;
    CrossWiseNative?.stopMotion();
    this.walkingDetector.reset();
    this.isWalking = false;
  }
}
