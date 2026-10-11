import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import { IconPill, TextButton } from './components';
import { S } from '../strings';
import { VT } from '../text/voiceText';
import { liveRegionFor, useScreenReaderEnabled } from '../voice/useScreenReader';
import { Colors, Dimens, useType } from './theme';

/** One recovery control; the usual entry is the automatic spoken startup. */
export function VoiceControl({ onHelp }: { onHelp?: () => void }) {
  const state = useStore(controller.voice.state);
  const settings = useStore(controller.settings);
  const active = !['off', 'error'].includes(state.phase);
  if (!settings.speech) return <IconPill icon="mic-off" label="Voice settings" onPress={() => onHelp?.()} />;
  return <IconPill icon={active ? 'mic' : 'mic-off'} label={active ? S.voiceStop : state.phase === 'error' ? S.voiceRetry : S.voiceStart}
    onPress={() => active ? controller.stopVoice() : controller.startVoice(true)} />;
}

/**
 * A large, always reachable on/off switch for voice commands, drawn above the dock. The camera double-tap sits behind a layer
 * a screen reader cannot focus, so this is the way in for TalkBack and VoiceOver users. It shows what the user chose
 * (voiceMode), not the microphone's momentary state, so its label does not flip between prompts.
 */
export function VoiceToggle({ bottom }: { bottom: number }) {
  const on = useStore(controller.voiceMode);
  const settings = useStore(controller.settings);
  const type = useType();
  // With speech switched off the top control already sends the user to Settings; a button that does nothing would only confuse.
  if (!settings.speech) return null;
  return <View pointerEvents="box-none" style={[styles.slot, { bottom }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={on ? VT.toggleOn : VT.toggleOff} accessibilityHint={VT.toggleHint}
      onPress={() => controller.toggleVoice()} style={[styles.toggle, { backgroundColor: on ? Colors.Crossing : Colors.SurfaceVariant }]}>
      <MaterialIcons name={on ? 'mic' : 'mic-off'} size={28} color={Colors.OnSurface} />
      <Text style={type.titleMedium} maxFontSizeMultiplier={1.3}>{on ? VT.toggleOnText : VT.toggleOffText}</Text>
    </Pressable>
  </View>;
}

export function VoiceStatus({ onHelp }: { onHelp: () => void }) {
  const state = useStore(controller.voice.state);
  const settings = useStore(controller.settings);
  const type = useType();
  const screenReaderOn = useScreenReaderEnabled();
  // The line appears only when there is something to say: listening, working, an error, or speech switched off.
  if (settings.speech && !['listening', 'working', 'error'].includes(state.phase)) return null;
  const text = !settings.speech ? 'Voice commands are off. Enable Speech in Settings.' : state.phase === 'listening' ? 'Listening…' : state.phase === 'working' ? 'Working…'
    : state.text;
  // The app speaks "Listening." and its errors itself, so with a screen reader on they are not announced twice. "Voice commands are
  // off" is never spoken (speech is off), so it stays polite.
  const live = liveRegionFor(screenReaderOn && settings.speech);
  return <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}>
    <Text style={type.bodyMedium} accessibilityLiveRegion={live}>{text}</Text>
    {(state.phase === 'error' || !settings.speech) && <TextButton label="Voice help" onPress={onHelp} />}
  </View>;
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', right: 12, alignItems: 'flex-end' },
  // 64 dp: above the 56 dp minimum for a primary control.
  toggle: { minWidth: Dimens.touchTarget + 8, minHeight: Dimens.touchTarget + 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, borderRadius: Dimens.radiusPill },
});
