import { isVehicle } from '../perception/detection';
import type { TrackView } from '../crossing/crossingEngine';
export interface VehicleVisibility { showMovingVehicles:boolean;showStationaryVehicles:boolean }
export const DEFAULT_VEHICLE_VISIBILITY:VehicleVisibility={showMovingVehicles:true,showStationaryVehicles:false};
export function visibleVehicle(track:TrackView,visibility:VehicleVisibility=DEFAULT_VEHICLE_VISIBILITY):boolean {
  if(!isVehicle(track.category))return false;
  return track.motion==='MOVING'?visibility.showMovingVehicles:track.motion==='STATIONARY'?(track.motionSupported!==true||visibility.showStationaryVehicles):false;
}
