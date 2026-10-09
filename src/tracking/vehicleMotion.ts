import { pixelFlow } from './pixelFlow';
import type { Detection } from '../perception/detection';
import { isVehicle, ObjectCategory } from '../perception/detection';
import type { Track } from './objectTracker';
export type MotionState='MOVING'|'STATIONARY';
export type MotionDirection='LEFT_TO_RIGHT'|'RIGHT_TO_LEFT'|'UNKNOWN';
export interface GrayFrame {width:number;height:number;pixels:number[]}
export interface MotionEstimate {state:MotionState;direction:MotionDirection;supported:boolean}
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)]??0;
export class VehicleMotion {
 private previous:GrayFrame|null=null;private lastTime=0;
 private histories=new Map<number,{t:number;moving:boolean;dx:number;quality:boolean}[]>();
 reliable=false;readonly diagnostics=new Map<number,unknown>();
 reset(){this.previous=null;this.lastTime=0;this.histories.clear();this.reliable=false;}
 update(tracks:readonly Track[],detections:Detection[],image:GrayFrame|undefined,t:number,cameraTranslating=false):Map<number,MotionEstimate>{
  const result=new Map<number,MotionEstimate>();this.diagnostics.clear();this.reliable=false;
  for(const tr of tracks)if(isVehicle(tr.category))result.set(tr.id,{state:'STATIONARY',direction:'UNKNOWN',supported:false});
  if(!image||image.pixels.length!==image.width*image.height){this.reset();return result;}
  const prev=this.previous,dt=(t-this.lastTime)/1000;this.previous=image;this.lastTime=t;
  if(!prev||prev.width!==image.width||prev.height!==image.height||dt<.04||dt>.35){this.histories.clear();return result;}
  const w=image.width,h=image.height;
  const points=pixelFlow(prev,image,detections.filter(d=>isVehicle(d.category)).map(d=>d.box));
  const inside=(x:number,y:number,b:{left:number;right:number;top:number;bottom:number},margin=0)=>x>b.left-margin&&x<b.right+margin&&y>b.top-margin&&y<b.bottom+margin;
  const bg=points.filter(p=>!detections.some(d=>(isVehicle(d.category)||d.category===ObjectCategory.PERSON)&&inside(p.x,p.y,d.box,.01)));
  this.reliable=bg.length>=20;
  for(const tr of tracks){
   if(!isVehicle(tr.category)||!tr.isSeenAt(t))continue;
   const b=tr.box,history=this.histories.get(tr.id)??[];
   const local=points.filter(p=>inside(p.x,p.y,b));
   const nearby=[...bg].sort((p,q)=>{
    const distance=(p:{x:number;y:number})=>((p.x-b.centerX)*w/Math.max(30,b.width*w))**2+((p.y-b.centerY)*h/Math.max(20,b.height*h*.65))**2;
    return distance(p)-distance(q);
   }).slice(0,40);
   const cx=median(nearby.map(p=>p.dx)),cy=median(nearby.map(p=>p.dy));
   const fx=median(local.map(p=>p.dx)),fy=median(local.map(p=>p.dy));
   const noise=median(nearby.map(p=>Math.hypot(p.dx-cx,p.dy-cy)));
   const dx=fx-cx,dy=fy-cy,residual=Math.hypot(dx,dy),diagonal=Math.max(12,Math.hypot(b.width*w,b.height*h));
   const quality=local.length>=3&&nearby.length>=10&&noise<1.5;
   const moving=residual>Math.max(.3,noise*2)&&residual/dt/diagonal>.10;
   history.push({t,moving,dx,quality});while(history.length&&t-history[0].t>700)history.shift();this.histories.set(tr.id,history);
   const votes=history.filter(s=>s.quality),ratio=votes.length?votes.filter(s=>s.moving).length/votes.length:0;
   const state=ratio>=.5&&votes.length?'MOVING':'STATIONARY';
   const supported=quality&&votes.length>=3&&!cameraTranslating;
   const direction=state==='MOVING'&&supported&&Math.abs(dx)>.3?(dx>0?'LEFT_TO_RIGHT':'RIGHT_TO_LEFT'):'UNKNOWN';
   result.set(tr.id,{state,direction,supported});this.diagnostics.set(tr.id,{features:local.length,background:nearby.length,noise,speed:residual/dt/diagonal,supported,votes:votes.length});
  }
  for(const id of this.histories.keys())if(!tracks.some(tr=>tr.id===id))this.histories.delete(id);
  return result;
 }
}
