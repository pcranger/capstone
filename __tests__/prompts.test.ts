import { Phrase } from '../src/feedback/cue';
import { P, phraseText } from '../src/strings';

test('routine observation prompts are brief, nonempty and do not promise a clear road', () => {
  for (const phrase of Object.values(Phrase)) {
    const text = phraseText(phrase, [3]);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(text).not.toMatch(/safe to cross|road (?:is )?clear|cross now|I will tell|model loaded/i);
  }
  expect(phraseText(Phrase.STATUS_NO_VEHICLES)).toMatch(/in view/);
  expect(phraseText(Phrase.WALK_ALREADY_ON)).toMatch(/Start time unknown/);
});

test('short route narration retains named instructions without repetitive state narration', () => {
  const instruction = 'Turn left onto George Street, then continue towards Bathurst Street';
  const text = P.instruction(1, instruction, null);
  expect(text).toContain(instruction);
  expect(text).not.toContain('Step 2.');
  expect(text).not.toContain('Distance unavailable.');
  expect(text).not.toContain('0 metres');
  expect(P.instruction(1, 'Turn left.', 40)).toBe('Turn left. About 40 metres remaining.');
});

test('Developer preview covers the complete fixed speech catalogs with unique entries',()=>{
  const {SPEECH_SAMPLES,previewCues}=require('../src/voice/speechPreview');
  const {V}=require('../src/voice/speechCatalog');
  const texts=SPEECH_SAMPLES.map((s:any)=>s.text);
  expect(new Set(SPEECH_SAMPLES.map((s:any)=>s.id)).size).toBe(SPEECH_SAMPLES.length);
  for(const catalog of [P,V])for(const value of Object.values(catalog))if(typeof value==='string')expect(texts).toContain(value);
  for(const sample of SPEECH_SAMPLES){
    expect(sample.text.trim()).not.toBe('');expect(sample.trigger.trim()).not.toBe('');
    expect(sample.text).not.toMatch(/welcome|after the tone|bear left|bear right/i);
    expect(previewCues(sample,false)).toEqual([{kind:'speakText',text:sample.text,priority:1}]);
  }
});
