import type { EventSubscription } from 'expo-modules-core';
import CrossWiseNative from '../../modules/crosswise-native';
import { nowMs } from '../core/geometry';
import { OrientationMath, type OrientationSample } from './orientationMath';
import { WalkingDetector } from './walkingDetector';

/**
 * Camera heading/pitch from the gyroscope-based attitude (no magnetometer, so parked cars and steel poles do not
 * bend the heading) plus accelerometer-based walking detection. 50 Hz, like Android's SENSOR_DELAY_GAME.
 */
export class MotionSensors {
  private readonly walkingDetector = new WalkingDetector();
  private subscription: EventSubscription | null = null;
  latestOrientation: OrientationSample | null = null;
  isWalking = false;

  get hasHeading(): boolean {
    return CrossWiseNative?.isMotionAvailable() ?? false;
  }

  start(): void {
    if (this.subscription || !CrossWiseNative) return;
    this.subscription = CrossWiseNative.addListener('onMotion', (e) => {
      const now = nowMs();
      const r = OrientationMath.rotationMatrixFromQuaternion([e.qx, e.qy, e.qz, e.qw]);
      this.latestOrientation = OrientationMath.cameraOrientation(r, now);
      this.walkingDetector.onAccelerometer(now, e.ax, e.ay, e.az);
      this.isWalking = this.walkingDetector.isWalking;
    });
    CrossWiseNative.startMotion(20);
  }

  stop(): void {
    if (!this.subscription) return;
    this.subscription.remove();
    this.subscription = null;
    CrossWiseNative?.stopMotion();
    this.walkingDetector.reset();
    this.isWalking = false;
  }
}
