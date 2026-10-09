import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { controller } from './src/state/controller';
import { useStore } from './src/state/store';
import { CrossWiseApp } from './src/ui/CrossWiseApp';
import { TypeContext, typographyFor } from './src/ui/theme';

export default function App() {
  useEffect(() => controller.start(), []);
  // The typeface is a user setting, so the theme has to follow it live.
  const font = useStore(controller.settings).appFont;
  const type = useMemo(() => typographyFor(font), [font]);
  return (
    <SafeAreaProvider>
      <TypeContext.Provider value={type}>
        <StatusBar style="light" />
        <CrossWiseApp />
      </TypeContext.Provider>
    </SafeAreaProvider>
  );
}
