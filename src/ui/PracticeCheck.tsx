import { useEffect, useRef, useState } from 'react';
import { type Cue, Cues, Priority, ToneKind } from '../feedback/cue';
import { controller } from '../state/controller';
import { S } from '../strings';
import { CHECK_TEXT, checkEventText } from '../text/checkText';
import { BigButton, Hint } from './components';
import { Colors } from './theme';

const say = (text: string): Cue => Cues.speakText(text, Priority.HIGH);

/**
 * CW-26: a 3-step rehearsal of the guided check (look right, look left, face the road). Turn prompts only: no
 * camera is used and no cars are checked, and it says so at the start and at the end.
 */
export const PRACTICE_CHECK_SCRIPT: { at: number; cues: Cue[] }[] = [
  { at: 0, cues: [say(CHECK_TEXT.practiceOnly), say(CHECK_TEXT.start)] },
  { at: 6000, cues: [say(checkEventText('HOLD'))] },
  { at: 12000, cues: [Cues.tone(ToneKind.CENTERED), say(checkEventText('TURN_LEFT'))] },
  { at: 18000, cues: [say(checkEventText('HOLD'))] },
  { at: 24000, cues: [Cues.tone(ToneKind.CENTERED), say(checkEventText('FACE_ROAD'))] },
  { at: 28000, cues: [say(CHECK_TEXT.practiceOnly)] },
];

export function PracticeCheck() {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [running, setRunning] = useState(false);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clear, []);
  const run = () => {
    clear();
    setRunning(true);
    PRACTICE_CHECK_SCRIPT.forEach(({ at, cues }, i) => {
      timers.current.push(setTimeout(() => {
        controller.practice(cues);
        if (i === PRACTICE_CHECK_SCRIPT.length - 1) setRunning(false);
      }, at));
    });
  };
  return <>
    <Hint>Rehearse the turns without a camera. No cars are checked.</Hint>
    <BigButton text={running ? 'Practising…' : 'Practise the check'} color={Colors.Crossing} hint={S.practiceHint} onPress={run} enabled={!running} />
  </>;
}
