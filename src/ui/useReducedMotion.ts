import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * True while the system Reduce Motion (Remove animations) setting is on. Every animation in the app asks this first
 * and runs instantly when it is true (UI review X1).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (alive) setReduced(value); })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { alive = false; subscription.remove(); };
  }, []);
  return reduced;
}
