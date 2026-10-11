import { useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from './ScaledText';
import { useStore } from '../state/store';
import { speechStatus } from '../voice/speechStatus';
import { controller } from '../state/controller';
import { Hint, TextButton } from './components';
import { VOICE_QUICK_START } from '../voice/navigationVoice';
import { Colors, useType } from './theme';
import { S } from '../strings';

/** A heading that expands and collapses its content; same pattern as the Settings "Manual" card. */
export function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const type = useType();
  const [open, setOpen] = useState(defaultOpen);
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(v => !v)} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={type.titleMedium}>{title}</Text>
      <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={24} color={Colors.OnSurface} />
    </Pressable>
    {open && children}
  </View>;
}

/** The guide is shared by Settings and Help so the advertised commands cannot diverge. */
export function VoiceHelp() {
  const status = useStore(speechStatus);
  const settings = useStore(controller.settings);
  const type = useType();
  const say = (text: string) => <Text key={text} style={type.bodyMedium}>{text}</Text>;
  return <>
    {settings.speech ? <TextButton label="Read voice instructions" onPress={() => controller.speakNow(VOICE_QUICK_START)} />
      : <TextButton label="Enable spoken guidance" onPress={() => controller.updateSettings(s => ({ ...s, speech: true }))} />}
    <Text style={type.titleMedium} accessibilityRole="header">{S.voiceSayHeading}</Text>
    {S.voiceSayLines.map(say)}
    <Collapsible title={S.voiceFailsHeading}>
      <Hint>A light vibration means the microphone is ready. “Listening” is spoken once per voice session. Say “manual” or “man” for commands.</Hint>
      <Hint>Double-tap the camera to start a voice turn. CrossWise says “Listening.” Double-tap again to stop it.</Hint>
      <Hint>The app cannot hear commands while it is speaking. “Stop listening” turns voice off; tap Voice to restart. Settings and backgrounding stop listening.</Hint>
      <Hint>{status.error ?? (status.locale ? `Recognition: ${status.locale}, on this phone.` : 'Recognition is checked when voice starts.')}</Hint>
      <Hint>{Platform.OS === 'android' ? 'Allow Microphone in Android app settings. Install offline English in your speech recognition service, then reopen CrossWise. Offline language checks require Android 13 or later.' : 'If voice fails: allow Microphone and Speech Recognition for CrossWise in iPhone Settings. If offline English remains unavailable, check General → Keyboard → Enable Dictation and an English keyboard, connect to Wi-Fi, use English dictation once, then reopen CrossWise. Availability is checked again; downloading a speaking voice does not install a recognizer.'}</Hint>
      <Hint>The app tries available offline English recognizers automatically. It does not upload audio or silently switch to online recognition. You can use the buttons and your screen reader if recognition remains unavailable.</Hint>
      <TextButton label="Open app settings" onPress={() => { void Linking.openSettings(); }} />
    </Collapsible>
  </>;
}
