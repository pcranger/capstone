import type { BoxF } from '../core/geometry';
import * as cv from 'jsfeat';
import type { GrayFrame } from './vehicleMotion';
export interface FlowPoint { x:number; y:number; dx:number; dy:number }

/** Pyramidal Lucas–Kanade, forward/backward checked; bounded to 400 corners (native Android flow uses the same budget). */
export function pixelFlow(previous:GrayFrame,current:GrayFrame,regions:BoxF[]=[]):FlowPoint[] {
  const w=current.width,h=current.height;
  const a=new cv.pyramid_t(3),b=new cv.pyramid_t(3);
  a.allocate(w,h,cv.U8_t|cv.C1_t);b.allocate(w,h,cv.U8_t|cv.C1_t);
  a.data[0].data.set(current.pixels);b.data[0].data.set(previous.pixels);
  a.build(a.data[0],true);b.build(b.data[0],true);
  const corners=Array.from({length:w*h},()=>new cv.keypoint_t());
  cv.fast_corners.set_threshold(12);
  const count=cv.fast_corners.detect(a.data[0],corners,8);
  const occupied=new Set<string>();
  const distributed=corners.slice(0,count).sort((p,q)=>q.score-p.score).filter(p=>{
    const cell=`${Math.floor(p.x/5)},${Math.floor(p.y/5)}`;
    if(occupied.has(cell))return false;occupied.add(cell);return true;
  });
  // Merge note: 50 corners per vehicle box (Hieu's 413aa1a/fd3b115 used 20). With 20, a closing car drops below the 10 nearby corners VehicleMotion needs, so CW-14's closing-car guard tests (approachingVehicle, falseAlarms) fail.
  const regional=regions.slice(0,12).flatMap(b=>distributed.filter(p=>p.x/w>b.left && p.x/w<b.right && p.y/h>b.top && p.y/h<b.bottom).slice(0,50));
  const selected=[...new Set([...regional,...distributed.slice(0,160)])].slice(0,400);
  const n=selected.length;if(n<6)return [];
  const xy=new Float32Array(n*2),q=new Float32Array(n*2),back=new Float32Array(n*2);
  const status=new Uint8Array(n),reverse=new Uint8Array(n);
  selected.forEach((p,i)=>{xy[i*2]=p.x;xy[i*2+1]=p.y;});
  cv.optical_flow_lk.track(a,b,xy,q,n,15,25,status,.01,.0001);
  cv.optical_flow_lk.track(b,a,q,back,n,15,25,reverse,.01,.0001);
  const points:FlowPoint[]=[];
  for(let i=0;i<n;i++)if(status[i]&&reverse[i]&&Math.hypot(xy[2*i]-back[2*i],xy[2*i+1]-back[2*i+1])<1)
    points.push({x:xy[2*i]/w,y:xy[2*i+1]/h,dx:xy[2*i]-q[2*i],dy:xy[2*i+1]-q[2*i+1]});
  return points;
}

export function backgroundAffine(points:FlowPoint[],w:number,h:number):number[] | null {
  if(points.length<20)return null;
  const from=points.map(p=>({x:p.x*w-p.dx,y:p.y*h-p.dy})),to=points.map(p=>({x:p.x*w,y:p.y*h}));
  const model=new cv.matrix_t(3,3,cv.F32_t|cv.C1_t),mask=new cv.matrix_t(points.length,1,cv.U8_t|cv.C1_t);
  const ok=cv.motion_estimator.ransac(new cv.ransac_params_t(3,1,.5,.99),new cv.motion_model.affine2d(),from,to,points.length,model,mask,200);
  if(!ok)return null;
  const selected=points.filter((_,i)=>mask.data[i]);
  if(selected.length/points.length<.7 || Math.max(...selected.map(p=>p.x))-Math.min(...selected.map(p=>p.x))<.4 || Math.max(...selected.map(p=>p.y))-Math.min(...selected.map(p=>p.y))<.3)return null;
  const m=Array.from(model.data).slice(0,9);
  const det=m[0]*m[4]-m[1]*m[3];
  return m.every(Number.isFinite)&&det>.8&&det<1.2?m:null;
}
