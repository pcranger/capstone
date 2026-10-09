import { TrafficScan } from '../src/crossing/trafficScan';
import { VehicleMotion, type GrayFrame } from '../src/tracking/vehicleMotion';
import { ObjectTracker } from '../src/tracking/objectTracker';
import { BoxF } from '../src/core/geometry';
import { ObjectCategory } from '../src/perception/detection';
import { det } from './fixtures';

function noise(): GrayFrame {
  let seed=37;
  return {width:192,height:108,pixels:Array.from({length:192*108},()=>{seed=(seed*1664525+1013904223)>>>0;return seed>>>24;})};
}

describe('Mobile pixel-motion evidence',()=>{
  test('binary stationary output requires support before suppressing alerts',()=>{
    const motion=new VehicleMotion();const tracker=new ObjectTracker();const image=noise();
    const d=det(ObjectCategory.CAR,new BoxF(.35,.3,.65,.75));
    let result;
    for(let t=0;t<=1400;t+=100){const tracks=tracker.update([d],t);result=motion.update(tracks,[d],image,t);if(t<300)expect(result.get(tracks[0].id)?.supported).toBe(false);}
    expect([...result!.values()][0].state).toBe('STATIONARY');
    expect([...motion.update(tracker.activeTracks,[d],undefined,1500).values()][0].supported).toBe(false);
  });
  test('walking invalidates stationary support and direction',()=>{
    const motion=new VehicleMotion(), tracker=new ObjectTracker(), image=noise();
    const d=det(ObjectCategory.CAR,new BoxF(.35,.3,.65,.75));
    for(let t=0;t<=1400;t+=100)motion.update(tracker.update([d],t),[d],image,t);
    const states=motion.update(tracker.update([d],1500),[d],image,1500,true);
    expect([...states.values()][0]).toEqual({state:'STATIONARY',direction:'UNKNOWN',supported:false});
    expect([...motion.update(tracker.update([d],1600),[d],image,1600).values()][0].state).toBe('STATIONARY');
  });
  test('flat or black images never prove stationary',()=>{
    const motion=new VehicleMotion(),tracker=new ObjectTracker();const image={width:192,height:108,pixels:new Array(192*108).fill(0)};
    const d=det(ObjectCategory.CAR,new BoxF(.35,.3,.65,.75));
    for(let t=0;t<1800;t+=100)expect([...motion.update(tracker.update([d],t),[d],image,t).values()][0].supported).toBe(false);
    expect(motion.reliable).toBe(false);
  });
  test('camera translation alone is not vehicle motion',()=>{
    const motion=new VehicleMotion(),tracker=new ObjectTracker(),source=noise();
    for(let i=0;i<10;i++){
      const image={...source,pixels:source.pixels.map((_,n)=>source.pixels[Math.floor(n/192)*192+(n%192-i+192)%192])};
      const d=det(ObjectCategory.CAR,new BoxF(.35+i/192,.3,.65+i/192,.75));
      const state=[...motion.update(tracker.update([d],i*100),[d],image,i*100).values()][0].state;
      expect(state).not.toBe('MOVING');
    }
  });
  test('foreground translating over static background gives left-to-right motion',()=>{
    const motion=new VehicleMotion(),tracker=new ObjectTracker(),source=noise(),texture=noise();let result;
    for(let i=0;i<10;i++){
      const pixels=[...source.pixels];const x0=50+i*2;
      for(let y=30;y<80;y++)for(let x=0;x<60;x++)pixels[y*192+x0+x]=texture.pixels[(y+10)*192+x];
      const image={...source,pixels};const d=det(ObjectCategory.CAR,new BoxF(x0/192,30/108,(x0+60)/192,80/108));
      result=motion.update(tracker.update([d],i*100),[d],image,i*100);
    }
    expect([...result!.values()][0]).toEqual({state:'MOVING',direction:'LEFT_TO_RIGHT',supported:true});
  });
  test('foreground translating left gives right-to-left motion',()=>{
    const motion=new VehicleMotion(),tracker=new ObjectTracker(),source=noise(),texture=noise();let result;
    for(let i=0;i<10;i++){
      const pixels=[...source.pixels];const x0=70-i*2;
      for(let y=30;y<80;y++)for(let x=0;x<60;x++)pixels[y*192+x0+x]=texture.pixels[(y+10)*192+x];
      const image={...source,pixels};const d=det(ObjectCategory.CAR,new BoxF(x0/192,30/108,(x0+60)/192,80/108));
      result=motion.update(tracker.update([d],i*100),[d],image,i*100);
    }
    expect([...result!.values()][0]).toEqual({state:'MOVING',direction:'RIGHT_TO_LEFT',supported:true});
  });
});

describe('Guided camera scan',()=>{
  test('requires two seconds on each side, produces one observation summary',()=>{
    const s=new TrafficScan();expect(s.update(0,0,true,false)).toBe('START');
    let event;
    for(let t=100;t<=2100;t+=100)event=s.update(t,320,true,false);
    expect(event).toBe('RIGHT');
    for(let t=2200;t<=4200;t+=100)event=s.update(t,40,true,false);
    expect(event).toBe('COMPLETE');expect(s.update(4300,40,true,false)).toBeNull();
  });
  test.each(['vehicle','gap','sensor','image'])('%s invalidates both-side evidence',reason=>{
    const s=new TrafficScan();s.update(0,0,true,false);
    for(let t=100;t<=2100;t+=100)s.update(t,320,true,false);
    s.update(reason==='gap'?3000:2200,reason==='sensor'?null:40,reason!=='image',reason==='vehicle');
    const events=[];
    for(let t=3100;t<=5500;t+=100)events.push(s.update(t,40,true,false));
    expect(events).not.toContain('COMPLETE');
  });
  test('interrupted right scan instructs a fresh left scan without changing the forward anchor',()=>{
    const s=new TrafficScan();s.update(0,0,true,false);
    for(let t=100;t<=2100;t+=100)s.update(t,320,true,false);
    s.update(2200,40,true,true);
    expect(s.update(2300,40,true,false)).toBe('RESTART');
    let event;for(let t=2400;t<=4400;t+=100)event=s.update(t,320,true,false);
    expect(event).toBe('RIGHT');
  });
  test('holding forward is not scanning both sides',()=>{
    const s=new TrafficScan();const events=[];
    for(let t=0;t<6000;t+=100)events.push(s.update(t,0,true,false));
    expect(events).not.toContain('COMPLETE');
  });
});
