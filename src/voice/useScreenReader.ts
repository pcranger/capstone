import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** True while TalkBack or VoiceOver is on. Used so the app's own voice and the screen reader do not both announce one event. */
export function useScreenReaderEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled().then(v => { if (alive) setOn(v); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => { alive = false; subscription.remove(); };
  }, []);
  return on;
}

/** Live regions announce changes on Android. With a screen reader on, the app's own speech says it, so the text stays readable by swipe only. */
export const liveRegionFor = (screenReaderOn: boolean): 'none' | 'polite' => screenReaderOn ? 'none' : 'polite';
