import { Phrase, ToneKind, HapticPattern, type Cue, Cues, Priority } from '../feedback/cue';
import { PHRASES, P, phraseText } from '../strings';
import { V, VOICE_MANUAL } from './speechCatalog';
export interface SpeechSample { id: string; text: string; trigger: string; extras: Cue[] }
const triggers: Partial<Record<Phrase,string>> = {
  [Phrase.VEHICLE_DETECTED]: 'Legacy preview only; unconfirmed and stationary vehicles do not trigger live warnings.',
  [Phrase.VEHICLE_MOVING]: 'Movement confirmed; approach and direction unknown.',
  [Phrase.VEHICLE_AHEAD]: 'Vehicle movement with optical approach evidence.',
  [Phrase.VEHICLE_LEFT]: 'Supported left-to-right motion with the phone facing forward.',
  [Phrase.VEHICLE_RIGHT]: 'Supported right-to-left motion with the phone facing forward.',
  [Phrase.VEHICLE_CLOSE_LEFT]: 'Urgent vehicle warning; direction supported.',
  [Phrase.VEHICLE_CLOSE_RIGHT]: 'Urgent vehicle warning; direction supported.',
  [Phrase.VEHICLE_CLOSE_AHEAD]: 'Urgent vehicle warning; direction unknown.',
  [Phrase.SCAN_LEFT]: 'A new camera scan is ready to begin.',
  [Phrase.SCAN_RESTART]: 'An interruption invalidated the previous scan.',
  [Phrase.SCAN_RIGHT]: 'The left observation is complete; observe the right.',
  [Phrase.SCAN_COMPLETE]: 'Both sides observed with usable evidence and no unresolved vehicles.',
  [Phrase.ASSIST_STARTED]: 'Explicitly enabled camera help.', [Phrase.ASSIST_STOPPED]: 'Explicitly disabled camera help.',
  [Phrase.CROSSING_STARTED]: 'Explicit start of crossing guidance.', [Phrase.CROSSING_DETECTED]: 'Developer automatic guidance transition; not proof of a crossing.',
  [Phrase.CROSSING_ENDED]: 'Explicit finish of crossing guidance.',
  [Phrase.SIGNAL_UNAVAILABLE]: 'Status requested with a model lacking pedestrian-signal classes.',
  [Phrase.TRAFFIC_UNAVAILABLE]: 'Traffic status requested without usable perception.',
  [Phrase.TILT_UP]: 'Phone held too low for a sustained interval.',
  [Phrase.TILT_DOWN]: 'Phone held too high for a sustained interval.',
  [Phrase.SIGNAL_LOST]: 'Previously tracked pedestrian signal is out of view, outside crossing.',
  [Phrase.WALK_STARTED]: 'Observed transition into a verified pedestrian walk signal.',
  [Phrase.WALK_ALREADY_ON]: 'Verified pedestrian walk signal first observed already on.',
  [Phrase.WALK_FLASHING]: 'Verified pedestrian walk signal is flashing.',
  [Phrase.DONT_WALK]: 'Verified don’t-walk signal observed.',
  [Phrase.DONT_WALK_FLASHING]: 'Verified don’t-walk signal is flashing.',
  [Phrase.SIGNAL_CHANGED_DONT_WALK_WHILE_CROSSING]: 'Walk-to-don’t-walk transition during crossing.',
  [Phrase.WALKING_ON_DONT_WALK]: 'Walking towards a verified don’t-walk signal.',
  [Phrase.SIGNAL_CENTERED]: 'Optional detailed aiming: pedestrian signal aligned.',
  [Phrase.CROSSWALK_CENTERED]: 'Optional detailed aiming with a crosswalk-capable model.',
  [Phrase.MODEL_MISSING]: 'Explicit camera help start with detection unavailable.',
};
function extras(id: Phrase): Cue[] {
  if(id.startsWith('VEHICLE_')) return [Cues.tone(id.startsWith('VEHICLE_CLOSE')?ToneKind.CRITICAL:ToneKind.ALERT,
    id.endsWith('LEFT')?-1:id.endsWith('RIGHT')?1:0),Cues.haptic(id.startsWith('VEHICLE_CLOSE')?HapticPattern.CRITICAL:HapticPattern.ALERT)];
  if(id===Phrase.WALK_STARTED)return [Cues.tone(ToneKind.WALK_CHIME),Cues.haptic(HapticPattern.WALK)];
  if(id===Phrase.DONT_WALK)return [Cues.tone(ToneKind.STOP),Cues.haptic(HapticPattern.DONT_WALK)];
  if(id===Phrase.SIGNAL_LOST)return [Cues.tone(ToneKind.LOST),Cues.haptic(HapticPattern.LOST)];
  if(id===Phrase.WALK_ALREADY_ON)return [Cues.haptic(HapticPattern.WALK)];
  if(id===Phrase.WALK_FLASHING||id===Phrase.DONT_WALK_FLASHING)return [Cues.haptic(HapticPattern.FLASHING)];
  return [];
}
const samples: SpeechSample[] = Object.keys(PHRASES).map(id=>({id,
  text:phraseText(id as Phrase,[2]),trigger:triggers[id as Phrase]??'Explicit Repeat status with fresh, supported observations.',extras:extras(id as Phrase)}));
const functionSamples:Record<string,string>={heard:V.heard('Test microphone')};
export const SPEECH_SAMPLES: SpeechSample[] = [...samples,
  ...[P,V].flatMap((catalog,index)=>Object.entries(catalog).map(([id,value])=>({id:`${index===0?'navigation':'voice'}.${id}`,text:typeof value==='string'?value:functionSamples[id]??'',
    trigger:id==='heard'?'Settings microphone test; transcript only.':`Explicit command or recovery: ${id.replace(/([A-Z])/g,' $1').toLowerCase()}.`,extras:[]}))).filter(s=>!!s.text),
  {id:'manual',text:VOICE_MANUAL,trigger:'Explicit Manual command or Read voice instructions.',extras:[]}];
export const previewCues = (sample:SpeechSample, sounds:boolean):Cue[] => [Cues.speakText(sample.text,Priority.NORMAL),...(sounds?sample.extras:[])];
