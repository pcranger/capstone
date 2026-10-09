import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { S } from '../strings';
import { GuideScreen } from './GuideScreen';
import { JourneyScreen } from './JourneyScreen';
import { PracticeScreen } from './PracticeScreen';
import { SettingsScreen } from './SettingsScreen';
import { Colors, useType } from './theme';

const NOTICE_MS = 8_000;
type Panel = 'settings' | 'guide' | 'practice' | null;
export function CrossWiseApp() {
  const type = useType();
  const loaded = useStore(controller.settingsLoaded);
  const notice = useStore(controller.notice);
  const permission = useCameraPermission();
  const [panel, setPanel] = useState<Panel>(null);
  const [dockHeight, setDockHeight] = useState(120);
  const presentation = useStore(controller.presentation);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) { setPanel(panel === 'settings' ? null : 'settings'); return true; }
      if (presentation.mapOpen) { controller.closeMap(); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [panel, presentation.mapOpen]);
  const close = useCallback(() => setPanel(null), []);
  const requestedCamera = useRef(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  useEffect(() => {
    if (!loaded || requestedCamera.current) return;
    requestedCamera.current = true;
    void (async () => {
      try { if (!permission.hasPermission && permission.canRequestPermission) await permission.requestPermission(); }
      catch { /* The camera panel keeps its permission/retry control; route entry remains available. */ }
      finally { setPermissionsReady(true); }
    })();
  }, [loaded, permission]);
  useEffect(() => {
    controller.setHomeVisible(loaded && permissionsReady && panel === null);
    return () => controller.setHomeVisible(false);
  }, [loaded, permissionsReady, panel]);
  useEffect(() => {
    if (!notice) return;
    // Spoken failures/confirmations use the feedback coordinator once. The visual copy stays 8 s (or until tapped) so a
    // TalkBack user has time to reach it; it never resizes the journey view.
    const timer = setTimeout(() => controller.clearNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!loaded) return <SafeAreaView style={styles.root}><Text style={[type.bodyMedium, { padding: 24 }]}>Starting CrossWise…</Text></SafeAreaView>;
  return <SafeAreaView style={styles.root}>
    <View style={{ flex: 1 }}>
      <JourneyScreen onSettings={() => setPanel('settings')}
        hidden={panel !== null} onDockHeight={setDockHeight} {...permission} />
      {panel && <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
        {panel === 'settings' && <SettingsScreen onBack={close} onOpenGuide={() => setPanel('guide')} onOpenPractice={() => setPanel('practice')} />}
        {panel === 'guide' && <GuideScreen onBack={() => setPanel('settings')} />}
        {panel === 'practice' && <PracticeScreen onBack={() => setPanel('settings')} />}
      </View>}
      {notice && <Pressable accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityLabel={notice}
        accessibilityHint={S.noticeDismissHint} onPress={() => controller.clearNotice()}
        style={[styles.notice, { bottom: dockHeight + 8 }]}>
        <Text style={type.bodyLarge}>{notice}</Text>
      </Pressable>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.Background },
  notice: { position: 'absolute', left: 12, right: 12, minHeight: 56, justifyContent: 'center', padding: 12, borderRadius: 12, backgroundColor: Colors.Crossing },
});
