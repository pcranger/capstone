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
    <Hint>A light vibration means the microphone is ready. “Listening” is spoken once per voice session. Say “manual” or “man” for commands.</Hint>
    <Hint>Double-tap the camera to start a voice turn. CrossWise says “Listening.” Double-tap again to stop it.</Hint>
    <Hint>“Navigate to Sydney Town Hall” finds a walking route. Include the suburb. For multiple matches, say “one”, “two” or “three”.</Hint>
    <Hint>“Search for a library” searches only. Say “start” or “confirm” to navigate.</Hint>
    <Hint>“Save as Home” saves the selected place, not your GPS position. Later say “navigate to Home”.</Hint>
    <Hint>Trips over 1 kilometre wait for your answer: “yes” or “proceed” starts the trip; “no” cancels it. These answers never start a crossing.</Hint>
    <Hint>“Pause navigation” keeps the route. “Resume navigation” continues it. “Cancel search” closes the pending search. “Stop navigation” ends the journey.</Hint>
    <Hint>While a request is pending, “Searching” or “Finding route” repeats every five seconds. Vehicle warnings take priority.</Hint>
    <Hint>Walking guidance gives route headings such as southwest, distance, and approximate steps. Step estimates assume 70 centimetres per step; your stride may differ. These are route directions, not a measurement of which way you face. Step estimates are not used to judge when a crossing is complete.</Hint>
    <Hint>Commands: repeat, pause, resume, next instruction, arrived, finish crossing, stop navigation, cancel, retry.</Hint>
    <Hint>Questions and place choices keep listening on for your answer. Directions end the voice turn. “Stop listening” turns voice off; double-tap the camera to start another turn. Destination controls pause voice. Settings and backgrounding stop listening.</Hint>
    <Hint>Say “next instruction” after completing a route step, “arrived” at the destination, and “finish crossing” only on the far footpath, beyond any refuge island. “Confirm” starts a reviewed route; it does not complete a crossing.</Hint>
    <Hint>{status.error ?? (status.locale ? `Recognition: ${status.locale}, on this phone.` : 'Recognition is checked when voice starts.')}</Hint>
    <Hint>{Platform.OS === 'android' ? 'Allow Microphone in Android app settings. Install offline English in your speech recognition service, then reopen CrossWise. Offline language checks require Android 13 or later.' : 'If voice fails: allow Microphone and Speech Recognition for CrossWise in iPhone Settings. If offline English remains unavailable, check General → Keyboard → Enable Dictation and an English keyboard, connect to Wi-Fi, use English dictation once, then reopen CrossWise. Availability is checked again; downloading a speaking voice does not install a recognizer.'}</Hint>
    <Hint>The app tries available offline English recognizers automatically. It does not upload audio or silently switch to online recognition. You can use the map textbox and your screen reader if recognition remains unavailable.</Hint>
    <TextButton label="Open app settings" onPress={() => { void Linking.openSettings(); }} />
  </>;
}
