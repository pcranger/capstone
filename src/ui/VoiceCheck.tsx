import { useEffect } from 'react';
import { View } from 'react-native';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { Text } from './ScaledText';
import { BigButton, Hint } from './components';
import { Colors, useType } from './theme';
/** Device integration check stays out of the everyday controls until the phone audio gate passes. */
export function VoiceCheck() {
  const s = useStore(controller.voiceCheck.state);
  const type = useType();
  useEffect(() => () => controller.voiceCheck.stop(), []);
  return <View style={{ gap: 8 }}>
    <Hint>Microphone test: tap, say a short phrase after the vibration, and wait for it to repeat. This does not execute commands. An available offline English recognizer is selected; audio is not saved.</Hint>
    <BigButton color={Colors.Crossing} text={controller.voiceCheck.active ? 'Stop voice check' : 'Test microphone'}
      onPress={() => controller.voiceCheck.active ? controller.voiceCheck.stop() : void controller.voiceCheck.start()} />
    {s.text ? <Text style={type.bodyMedium}>{s.text}</Text> : null}
  </View>;
}
