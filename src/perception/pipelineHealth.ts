import { P } from '../strings';
export interface PipelineHealth { receivedAt:number;latencyMs:number;slowFrames:number;error:string|null }
export const EMPTY_PIPELINE:PipelineHealth={receivedAt:0,latencyMs:0,slowFrames:0,error:null};
/** Camera session availability and inference freshness are separate failures. */
export function perceptionMessage(camera:'starting'|'running'|'unavailable',fresh:boolean,pipeline:PipelineHealth,now:number):string|null {
  if(camera==='starting')return P.cameraStarting;
  if(camera==='unavailable')return P.cameraUnavailable;
  if(pipeline.error)return P.detectionUnavailable;
  if(fresh)return null;
  if(pipeline.receivedAt>0 && now-pipeline.receivedAt<5000 && pipeline.latencyMs>350)return P.detectionTooSlow;
  return pipeline.receivedAt===0?P.detectionWaiting:P.detectionUnavailable;
}
