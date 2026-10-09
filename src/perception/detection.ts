import { BoxF } from '../core/geometry';

/** What a detected object means for the crossing task, independent of the model's own label names. */
export enum ObjectCategory {
  PED_DONT_WALK = 'PED_DONT_WALK',
  PED_WALK = 'PED_WALK',
  /** A light we can see but whose meaning the model does not know (e.g. COCO "traffic light"). */
  TRAFFIC_LIGHT = 'TRAFFIC_LIGHT',
  PED_COUNTDOWN = 'PED_COUNTDOWN',
  CROSSWALK = 'CROSSWALK',
  PERSON = 'PERSON',
  BICYCLE = 'BICYCLE',
  MOTORCYCLE = 'MOTORCYCLE',
  CAR = 'CAR',
  BUS = 'BUS',
  TRUCK = 'TRUCK',
  OTHER = 'OTHER',
}

const VEHICLES = new Set([
  ObjectCategory.BICYCLE,
  ObjectCategory.MOTORCYCLE,
  ObjectCategory.CAR,
  ObjectCategory.BUS,
  ObjectCategory.TRUCK,
]);
const SIGNALS = new Set([ObjectCategory.PED_DONT_WALK, ObjectCategory.PED_WALK, ObjectCategory.TRAFFIC_LIGHT]);

export function isVehicle(category: ObjectCategory): boolean {
  return VEHICLES.has(category);
}

export function isSignal(category: ObjectCategory): boolean {
  return SIGNALS.has(category);
}

/** Lit color of a generic traffic light, estimated from pixels when the model does not know the phase. */
export type SignalColor = 'RED' | 'GREEN';

export interface Detection {
  box: BoxF;
  classIndex: number;
  label: string;
  score: number;
  category: ObjectCategory;
  colorHint?: SignalColor | null;
}

/** Output of one detector call on one camera frame. */
export interface FrameDetections {
  motionImage?: import("../tracking/vehicleMotion").GrayFrame;
  brightness?: number;
  timestampMs: number;
  detections: Detection[];
  /** Size of the upright frame the normalized boxes refer to. */
  frameWidth: number;
  frameHeight: number;
  inferenceMs: number;
}
