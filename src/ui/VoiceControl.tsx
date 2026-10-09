import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { View } from 'react-native';
import { Text } from './ScaledText';
import { IconPill, TextButton } from './components';
import { useType } from './theme';

/** One recovery control; the usual entry is the automatic spoken startup. */
export function VoiceControl({ onHelp }: { onHelp?: () => void }) {
  const state = useStore(controller.voice.state);
  const settings = useStore(controller.settings);
  const active = !['off', 'error'].includes(state.phase);
  if (!settings.speech) return <IconPill icon="mic-off" label="Voice settings" onPress={() => onHelp?.()} />;
  return <IconPill icon={active ? 'mic' : 'mic-off'} label={active ? 'Stop listening' : state.phase === 'error' ? 'Retry voice' : 'Voice'}
    onPress={() => active ? controller.stopVoice() : controller.startVoice(true)} />;
}

export function VoiceStatus({ onHelp }: { onHelp: () => void }) {
  const state = useStore(controller.voice.state);
  const settings = useStore(controller.settings);
  const type = useType();
  const text = !settings.speech ? 'Voice commands are off. Enable Speech in Settings.' : state.phase === 'listening' ? 'Listening…' : state.phase === 'working' ? 'Working…'
    : state.phase === 'off' ? 'Voice off' : state.text;
  return <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}>
    <Text style={type.bodyMedium}>{text}</Text>
    {(state.phase === 'error' || !settings.speech) && <TextButton label="Voice help" onPress={onHelp} />}
  </View>;
}
