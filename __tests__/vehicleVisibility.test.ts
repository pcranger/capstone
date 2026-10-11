jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn()}));
jest.mock('expo-file-system',()=>({File:class {},Paths:{}}));
import { visibleVehicle } from '../src/ui/vehicleVisibility';
import { DEFAULT_SETTINGS,mergeSettings } from '../src/settings/settings';
import { ObjectCategory } from '../src/perception/detection';
import { perceptionMessage,EMPTY_PIPELINE } from '../src/perception/pipelineHealth';
import { P } from '../src/strings';

test('motion box switches persist independently without disabling alerts',()=>{
  let s={...DEFAULT_SETTINGS};
  const track=(motion:string)=>({category:ObjectCategory.CAR,motion,motionSupported:true} as any);
  expect(visibleVehicle(track('STATIONARY'),s)).toBe(false);
  s=mergeSettings(s,{showStationaryVehicles:true,showMovingVehicles:false});
  expect(visibleVehicle(track('STATIONARY'),s)).toBe(true);
  expect(visibleVehicle(track('MOVING'),s)).toBe(false);
  expect(visibleVehicle(track(undefined as any),s)).toBe(false);
  expect(s.vehicleAlerts).toBe(true);
  expect(mergeSettings(s,{showStationaryVehicles:'false'}).showStationaryVehicles).toBe(true);
});
test('a STATIONARY track without motion evidence is shown with default settings',()=>{
  const car=(motionSupported:boolean)=>({category:ObjectCategory.CAR,motion:'STATIONARY',motionSupported} as any);
  expect(visibleVehicle(car(false))).toBe(true);
  expect(visibleVehicle(car(true))).toBe(false);
});
test('latency alone does not cause a warning; unavailable streams still report failure',()=>{
  const slow={...EMPTY_PIPELINE,receivedAt:1000,latencyMs:900,slowFrames:4};
  expect(perceptionMessage('running',true,slow,1200)).toBeNull();
  expect(perceptionMessage('running',false,slow,1200)).toBe(P.detectionUnavailable);
  expect(perceptionMessage('running',false,slow,7000)).toBe(P.detectionUnavailable);
  expect(perceptionMessage('unavailable',false,slow,1200)).toBe(P.cameraUnavailable);
  expect(perceptionMessage('starting',false,slow,1200)).toBe(P.cameraStarting);
  expect(perceptionMessage('running',true,{...slow,latencyMs:90},1200)).toBeNull();
});
