declare module 'jsfeat' {
  export const U8_t: number; export const C1_t: number; export const F32_t: number;
  export class matrix_t { constructor(cols:number,rows:number,type:number); data: Uint8Array | Float32Array; }
  export class pyramid_t { constructor(levels:number); allocate(w:number,h:number,type:number):void; build(source:matrix_t,skipFirstLevel?:boolean):void; data:matrix_t[]; }
  export class keypoint_t { constructor(x?:number,y?:number,score?:number); x:number;y:number;score:number; }
  export const fast_corners: { set_threshold(t:number):void; detect(source:matrix_t,points:keypoint_t[],border:number):number };
  export const optical_flow_lk: { track(a:pyramid_t,b:pyramid_t,xy:Float32Array,out:Float32Array,count:number,window:number,iterations:number,status:Uint8Array,epsilon:number,minEigen:number):void };
  export class ransac_params_t { constructor(size:number,threshold:number,epsilon:number,probability:number); }
  export const motion_model: { affine2d: new()=>object };
  export const motion_estimator: { ransac(params:ransac_params_t,kernel:object,from:{x:number;y:number}[],to:{x:number;y:number}[],count:number,model:matrix_t,mask:matrix_t,iterations:number):boolean };
}
