import { NativeVehicleFlow } from '../src/camera/nativeVehicleFlow';
import { VehicleMotion } from '../src/tracking/vehicleMotion';
import { ObjectTracker } from '../src/tracking/objectTracker';
import { BoxF } from '../src/core/geometry';
import { ObjectCategory } from '../src/perception/detection';
import { det } from './fixtures';

test('native adapter retains image pairs but only returns sparse flow to the engine', async () => {
  const adapter = new NativeVehicleFlow();
  const image = { width: 32, height: 32, pixels: new Uint8Array(1024).fill(80) };
  const track = jest.fn(async () => ({ points: [{ x: .5, y: .5, dx: 2, dy: 0 }], workerMs: 4 }));
  const first = await adapter.prepare(image, [], 1000, track);
  expect(track).not.toHaveBeenCalled();
  expect(first.image.pixels).toHaveLength(0);
  const second = await adapter.prepare(image, [[.2,.2,.8,.8]], 1500, track);
  expect(track).toHaveBeenCalledWith(image.pixels, image.pixels, 32, 32, [[.2,.2,.8,.8]]);
  expect(second.image.flowFromWallMs).toBe(1000);
  expect(second.image.flow).toHaveLength(1);
  expect(second.workerMs).toBe(4);
  adapter.reset();
  await adapter.prepare(image, [], 2000, track);
  expect(track).toHaveBeenCalledTimes(1);
});

test.each([-1, 1])('native sparse flow preserves direction (%i) and background compensation at 500ms intervals', direction => {
  const motion = new VehicleMotion(), tracker = new ObjectTracker();
  const d = det(ObjectCategory.CAR, new BoxF(.35,.3,.65,.75));
  const points = [
    ...Array.from({length:40}, (_,i) => ({x:.05+(i%5)*.04,y:.1+Math.floor(i/5)*.1,dx:1,dy:0})),
    ...Array.from({length:8}, (_,i) => ({x:.4+(i%4)*.04,y:.4+Math.floor(i/4)*.1,dx:1+direction*6,dy:0})),
  ];
  let result;
  for (let t=0;t<=2000;t+=500) {
    result=motion.update(tracker.update([d],t),[d],{
      width:192,height:108,pixels:[],flow:points,sourceWallMs:t,flowFromWallMs:t-500,
    },t);
  }
  expect([...result!.values()][0]).toEqual({state:'MOVING',direction:direction>0?'LEFT_TO_RIGHT':'RIGHT_TO_LEFT',supported:true});
  // A worker image from before a reset must never supply motion for a different pair.
  const invalid=motion.update(tracker.update([d],2500),[d],{
    width:192,height:108,pixels:[],flow:points,sourceWallMs:2500,flowFromWallMs:1000,
  },2500);
  expect([...invalid.values()][0].supported).toBe(false);
});
