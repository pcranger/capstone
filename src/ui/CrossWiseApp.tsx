import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCameraPermission } from 'react-native-vision-camera';
import { controller } from '../state/controller';
import { cameraAccess } from '../state/cameraAccess';
import { pressBack } from '../state/safetyGuards';
import { askForCamera } from './askForCamera';
import { useStore } from '../state/store';
import { P, S } from '../strings';
import { liveRegionFor, useScreenReaderEnabled } from '../voice/useScreenReader';
import { GuideScreen } from './GuideScreen';
import { JourneyScreen } from './JourneyScreen';
import { PracticeScreen } from './PracticeScreen';
import { SettingsScreen } from './SettingsScreen';
import { Colors, Dimens, useType } from './theme';

const NOTICE_MS = 8_000;
// The Voice commands switch (64 dp) sits just above the dock on the right; the notice goes above it so they never overlap.
const VOICE_TOGGLE_ROW = Dimens.touchTarget + 8 + 8;
type Panel = 'settings' | 'guide' | 'practice' | null;
export function CrossWiseApp() {
  const type = useType();
  const loaded = useStore(controller.settingsLoaded);
  const notice = useStore(controller.notice);
  const speechOn = useStore(controller.settings).speech;
  // "Vehicle detection unavailable." is also spoken by the app (announceDetectionError); a screen reader must not repeat it.
  const live = liveRegionFor(useScreenReaderEnabled());
  const permission = useCameraPermission();
  const [panel, setPanel] = useState<Panel>(null);
  const [dockHeight, setDockHeight] = useState(120);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) { setPanel(panel === 'settings' ? null : 'settings'); return true; }
      // Back on the home screen closes the app, and with it the vehicle warnings: ask first.
      return pressBack();
    });
    return () => subscription.remove();
  }, [panel]);
  const close = useCallback(() => setPanel(null), []);
  // The controller refuses voice "Start" without the camera, and voice "Allow camera" asks through here. The hook re-reads the
  // permission whenever the app returns to the foreground, so the dock and this stay current after a trip to system Settings.
  useEffect(() => {
    cameraAccess.has = permission.hasPermission;
    cameraAccess.ask = () => { void askForCamera(permission.canRequestPermission, permission.requestPermission); };
  }, [permission.hasPermission, permission.canRequestPermission, permission.requestPermission]);
  const requestedCamera = useRef(false);
  const [permissionsReady, setPermissionsReady] = useState(false);
  useEffect(() => {
    if (!loaded || requestedCamera.current) return;
    requestedCamera.current = true;
    void (async () => {
      // The spoken welcome and safety note come first, so the permission dialog does not cover them.
      try { await controller.welcomeDone; } catch { /* the welcome is best effort */ }
      try { if (!permission.hasPermission && permission.canRequestPermission) await permission.requestPermission(); }
      catch { /* The camera panel keeps its permission/retry control; the camera permission control remains available. */ }
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
    // TalkBack user has time to reach it; it never resizes the camera view.
    const timer = setTimeout(() => controller.clearNotice(), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  // J19: a spinner plus the words, announced politely as one progress element.
  if (!loaded) return <SafeAreaView style={styles.root}>
    <View accessible accessibilityRole="progressbar" accessibilityLabel={S.startingApp} accessibilityLiveRegion="polite" style={styles.loading}>
      <ActivityIndicator size="large" color={Colors.Accent} />
      <Text style={type.bodyLarge}>{S.startingApp}</Text>
    </View>
  </SafeAreaView>;
  return <SafeAreaView style={styles.root}>
    <View style={{ flex: 1 }}>
      <JourneyScreen onSettings={() => setPanel('settings')}
        hidden={panel !== null} onDockHeight={setDockHeight} {...permission} />
      {panel && <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
        {panel === 'settings' && <SettingsScreen onBack={close} onOpenGuide={() => setPanel('guide')} onOpenPractice={() => setPanel('practice')} />}
        {panel === 'guide' && <GuideScreen onBack={() => setPanel('settings')} />}
        {panel === 'practice' && <PracticeScreen onBack={() => setPanel('settings')} />}
      </View>}
      {notice && <Pressable accessibilityRole="alert" accessibilityLiveRegion={notice === P.detectionUnavailable ? live : 'polite'} accessibilityLabel={notice}
        accessibilityHint={S.noticeDismissHint} onPress={() => controller.clearNotice()}
        style={[styles.notice, { bottom: dockHeight + 8 + (permission.hasPermission && speechOn ? VOICE_TOGGLE_ROW : 0) }]}>
        <Text style={type.bodyLarge}>{notice}</Text>
      </Pressable>}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.Background },
  notice: { position: 'absolute', left: 12, right: 12, minHeight: 56, justifyContent: 'center', padding: 12, borderRadius: Dimens.radiusRow, backgroundColor: Colors.Crossing },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Dimens.gapMedium, padding: Dimens.gapLarge },
});
