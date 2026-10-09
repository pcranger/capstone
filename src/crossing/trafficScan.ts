import { Angles } from '../core/geometry';

/** A camera-observation summary, never a crossing authorization. */
export class TrafficScan {
  private anchor: number | null = null;
  private leftSince: number | null = null;
  private rightSince: number | null = null;
  private leftDone: number | null = null;
  private rightDone: number | null = null;
  private lastFrame: number | null = null;
  private finished = false;
  private restartPrompt = false;
  reset(): void { this.anchor=null; this.leftSince=null; this.rightSince=null; this.leftDone=null; this.rightDone=null; this.lastFrame=null; this.finished=false; this.restartPrompt=false; }
  pause(t:number):void { this.lastFrame=t;this.leftSince=null;this.rightSince=null; }
  interrupt(t:number):void { this.finished=false;this.leftSince=null;this.rightSince=null;this.leftDone=null;this.rightDone=null;this.lastFrame=t;this.restartPrompt=true; }
  update(t: number, heading: number | null, usable: boolean, blocked: boolean): 'START' | 'RESTART' | 'RIGHT' | 'COMPLETE' | null {
    if (this.finished) return null;
    if (!usable || heading===null || (this.lastFrame!==null && (t-this.lastFrame>400 || t<=this.lastFrame))) { this.restartPrompt ||= this.leftDone!==null;this.leftSince=null;this.rightSince=null;this.leftDone=null;this.rightDone=null;this.lastFrame=t;return null; }
    this.lastFrame=t;
    if(this.anchor===null) { if(blocked)return null;this.anchor=heading; return 'START'; }
    // Any vehicle uncertainty/movement invalidates evidence from BOTH sides.
    if(blocked) { this.restartPrompt ||= this.leftDone!==null;this.leftSince=null;this.rightSince=null;this.leftDone=null;this.rightDone=null;return null; }
    if((this.leftDone!==null && t-this.leftDone>8000) || (this.rightDone!==null && t-this.rightDone>8000)) { this.leftSince=null;this.rightSince=null;this.leftDone=null;this.rightDone=null;this.restartPrompt=true; }
    if(this.restartPrompt) { this.restartPrompt=false;return 'RESTART'; }
    const angle=Angles.wrap180(heading-this.anchor);
    if(angle<=-30 && angle>=-100) {
      this.leftSince??=t;this.rightSince=null;
      if(t-this.leftSince>=2000 && this.leftDone===null) {this.leftDone=t;return 'RIGHT';}
    } else if(angle>=30 && angle<=100 && this.leftDone!==null) {
      this.rightSince??=t;this.leftSince=null;
      if(t-this.rightSince>=2000) this.rightDone=t;
    } else {this.leftSince=null;this.rightSince=null;}
    if(this.leftDone!==null && this.rightDone!==null) {this.finished=true;return 'COMPLETE';}
    return null;
  }
}
