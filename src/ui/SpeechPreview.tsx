import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from './ScaledText';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { AssistMode } from '../crossing/crossingEngine';
import { Cues, ToneKind, HapticPattern } from '../feedback/cue';
import { SPEECH_SAMPLES, previewCues } from '../voice/speechPreview';
import { Hint, SwitchRow, TextButton } from './components';
import { useType } from './theme';

/** Plays text/cues only. No navigation commands, microphone input or scene fixtures. */
export function SpeechPreview() {
  const type=useType(), settings=useStore(controller.settings), ui=useStore(controller.ui), journey=useStore(controller.journey.state);
  const [sounds,setSounds]=useState(false),[index,setIndex]=useState(0),[playing,setPlaying]=useState(false);
  const generation=useRef(0);
  const blocked=ui.snapshot.mode!==AssistMode.IDLE || journey.phase==='walking' || journey.phase==='paused';
  const stop=()=>{++generation.current;controller.stopSpeechPreview();setPlaying(false);};
  useEffect(()=>()=>{++generation.current;controller.stopSpeechPreview();},[]);
  useEffect(()=>{if(blocked){++generation.current;controller.stopSpeechPreview();}},[blocked]);
  const play=async(start:number,all=false)=>{
    stop();if(blocked||!settings.speech)return;
    const id=generation.current;setPlaying(true);
    for(let i=start;i<SPEECH_SAMPLES.length;i++){
      if(id!==generation.current)break;
      setIndex(i);
      if(!await controller.previewSpeech(previewCues(SPEECH_SAMPLES[i],sounds)) || !all)break;
    }
    if(id===generation.current)setPlaying(false);
  };
  return <>
    <Hint>Sample speech only. Stop navigation and camera help before previewing. Signal examples require a pedestrian-signal model in live use.</Hint>
    {blocked && <Hint>Stop navigation and camera help to enable preview.</Hint>}
    {!settings.speech && <Hint>Enable Speech in Settings to hear previews.</Hint>}
    <SwitchRow label="Include matching tones and vibration" value={sounds} onChange={setSounds} />
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      <TextButton disabled={blocked||!settings.speech} label="Play all" onPress={()=>{void play(0,true);}} />
      <TextButton disabled={blocked||!settings.speech} label="Next" onPress={()=>{void play((index+1)%SPEECH_SAMPLES.length);}} />
      <TextButton label="Stop" onPress={stop} />
      <TextButton disabled={blocked||!settings.speech} label="Listening cue" onPress={()=>{
        stop();void controller.previewSpeech([Cues.tone(ToneKind.LISTENING),Cues.haptic(HapticPattern.CENTERED_TICK)]);
      }} />
    </View>
    <Text style={type.bodyMedium}>{(playing&&!blocked)?`Playing ${index+1} of ${SPEECH_SAMPLES.length}`:`${SPEECH_SAMPLES.length} speech examples`}</Text>
    {SPEECH_SAMPLES.map((sample,i)=><View key={sample.id} style={{gap:4,paddingVertical:8}}>
      <Text style={type.bodyMedium}>{sample.text}</Text>
      <Hint>{sample.trigger}</Hint>
      <TextButton disabled={blocked||!settings.speech} label={`Play ${sample.id}`} onPress={()=>{void play(i);}} />
    </View>)}
  </>;
}
