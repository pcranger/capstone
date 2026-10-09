import { type EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';

export interface MotionEvent {
  /** Attitude quaternion, device -> world (gravity-aligned, arbitrary but stable heading). */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Acceleration including gravity, m/s², device axes. */
  ax: number;
  ay: number;
  az: number;
}

export interface CameraFieldOfView {
  /** Horizontal field of view across `width`, the long side of the active format. */
  fovDeg: number;
  width: number;
  height: number;
}

interface CrossWiseNativeModule {
  speechCapabilities(locales: string[]): { locale: string; supported: boolean; available: boolean; onDevice: boolean }[];
  onDeviceSpeechAvailable(locale: string): boolean;
  isMotionAvailable(): boolean;
  startMotion(intervalMs: number): void;
  stopMotion(): void;
  supportsHaptics(): boolean;
  playHaptic(timings: number[], amplitudes: number[]): void;
  cancelHaptics(): void;
  headphonesConnected(): boolean;
  batteryPercent(): Promise<number>;
  cameraFieldOfView(deviceId: string | null): CameraFieldOfView | null;
  addListener(event: 'onMotion', listener: (e: MotionEvent) => void): EventSubscription;
}

/** Null in environments without the native build (unit tests, Expo Go). Callers degrade gracefully. */
const native = requireOptionalNativeModule<CrossWiseNativeModule>('CrossWiseNative');

export default native;
