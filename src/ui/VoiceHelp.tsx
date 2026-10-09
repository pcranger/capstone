import { Linking, Platform } from 'react-native';
import { useStore } from '../state/store';
import { speechStatus } from '../voice/speechStatus';
import { controller } from '../state/controller';
import { Hint, TextButton } from './components';
import { VOICE_QUICK_START } from '../voice/navigationVoice';

/** The guide is shared by Settings and Help so the advertised commands cannot diverge. */
export function VoiceHelp() {
  const status = useStore(speechStatus);
  const settings = useStore(controller.settings);
  return <>
    {settings.speech ? <TextButton label="Read voice instructions" onPress={() => controller.sayNavigation(VOICE_QUICK_START)} />
      : <TextButton label="Enable spoken guidance" onPress={() => controller.updateSettings(s => ({ ...s, speech: true }))} />}
    <Hint>A short double beep means the microphone is ready. Say “manual” or “man” for commands.</Hint>
    <Hint>“Navigate to Sydney Town Hall” starts a route. Include the suburb. For multiple matches, say “first”, “second” or “third”.</Hint>
    <Hint>“Search for a library” searches only. Say “start” or “confirm” to navigate.</Hint>
    <Hint>“Save as Home” saves the selected place, not your GPS position. Later say “navigate to Home”.</Hint>
    <Hint>Commands: repeat, pause, resume, next instruction, arrived, finish crossing, stop navigation, cancel, retry.</Hint>
    <Hint>The app cannot hear commands while speaking or finding a route. “Stop listening” turns voice off; tap Voice to restart. Destination controls pause voice. Settings and backgrounding stop listening.</Hint>
    <Hint>Say “next instruction” after completing a route step, “arrived” at the destination, and “finish crossing” only on the far footpath, beyond any refuge island. “Confirm” starts a reviewed route; it does not complete a crossing.</Hint>
    <Hint>{status.error ?? (status.locale ? `Recognition: ${status.locale}, on this phone.` : 'Recognition is checked when voice starts.')}</Hint>
    <Hint>{Platform.OS === 'android' ? 'Allow Microphone in Android app settings. Install offline English in your speech recognition service, then reopen CrossWise. Offline language checks require Android 13 or later.' : 'If voice fails: allow Microphone and Speech Recognition for CrossWise in iPhone Settings. If offline English remains unavailable, check General → Keyboard → Enable Dictation and an English keyboard, connect to Wi-Fi, use English dictation once, then reopen CrossWise. Availability is checked again; downloading a speaking voice does not install a recognizer.'}</Hint>
    <Hint>The app tries available offline English recognizers automatically. It does not upload audio or silently switch to online recognition. You can use the map textbox and your screen reader if recognition remains unavailable.</Hint>
    <TextButton label="Open app settings" onPress={() => { void Linking.openSettings(); }} />
  </>;
}
