import { type ReactElement, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { Animated, BackHandler, Easing, Keyboard, Modal, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ScaledText';
import { AssistMode, UserCommand } from '../crossing/crossingEngine';
import { WALKING_WARNING } from '../nav/navigation';
import { InterfaceMode } from '../settings/settings';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { S } from '../strings';
import { BigButton, IconPill, TextButton } from './components';
import { MainScreen } from './MainScreen';
import { MapPanel } from './MapPanel';
import { DestinationSheet } from './DestinationSheet';
import { Colors, Dimens, useType } from './theme';
import { useReducedMotion } from './useReducedMotion';
import { VoiceControl, VoiceStatus } from './VoiceControl';

/**
 * X2: when the sheet changes height it slides 200 ms ease-out on transform instead of jumping. The layout height
 * changes at once; translateY starts at the old top edge and eases to 0. Instant with Reduce Motion.
 */
function useSheetSlide(height: number, reduceMotion: boolean) {
  const [slide] = useState(() => new Animated.Value(0));
  const last = useRef(height);
  useLayoutEffect(() => {
    const delta = height - last.current;
    last.current = height;
    slide.stopAnimation();
    if (!delta || reduceMotion) { slide.setValue(0); return; }
    slide.setValue(delta);
    Animated.timing(slide, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [height, reduceMotion, slide]);
  return slide;
}

/** Two views; neither map interaction nor the keyboard resizes the camera. */
export function JourneyScreen({ onSettings, hidden, onDockHeight, hasPermission, canRequestPermission, requestPermission }: {
  onSettings: () => void; hidden: boolean; onDockHeight?: (height: number) => void;
  hasPermission: boolean; canRequestPermission: boolean; requestPermission: () => unknown;
}) {
  const type = useType();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const settings = useStore(controller.settings);
  const journey = useStore(controller.journey.state);
  const { mapOpen, expanded } = useStore(controller.presentation);
  const planner = useStore(controller.planner.state);
  const setMapOpen = (value: boolean) => { if (value) controller.openMap(); else controller.closeMap(); };
  const setExpanded = (value: boolean) => controller.presentation.update(s => ({ ...s, expanded: value }));
  const [height, setHeight] = useState(window.height - 90);
  const [headerHeight, setHeaderHeight] = useState(56);
  const [dockHeight, setDockHeight] = useState(114);
  const [keyboard, setKeyboard] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(200);
  const active = journey.phase === 'walking' || journey.phase === 'paused';
  const available = Math.max(120, height - keyboard - 56);
  const requestedHeight = Math.min(available, expanded || keyboard ? height * 0.76 : Math.max(190, height * 0.3));
  const sheetSlide = useSheetSlide(requestedHeight, useReducedMotion());
  const [sheetGesture] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderRelease: (_, gesture) => {
      Keyboard.dismiss(); controller.presentation.update(s => ({ ...s, expanded: Math.abs(gesture.dy) < 24 ? !s.expanded : gesture.dy < 0 }));
    },
  }));
  const closeMap = () => { Keyboard.dismiss(); setMapOpen(false); };
  const collapse = () => { Keyboard.dismiss(); setExpanded(false); };
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillChangeFrame', e => setKeyboard(Math.max(0, window.height - e.endCoordinates.screenY - insets.bottom)));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, [window.height, insets.bottom]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (hidden || !mapOpen) return false;
      if (keyboard || expanded) { Keyboard.dismiss(); controller.presentation.update(s => ({ ...s, expanded: false })); }
      else controller.closeMap();
      return true;
    });
    return () => listener.remove();
  }, [mapOpen, hidden, keyboard, expanded]);
  return <View style={styles.root} onLayout={event => setHeight(event.nativeEvent.layout.height)}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    <MainScreen hasPermission={hasPermission} canRequestPermission={canRequestPermission} requestPermission={requestPermission}
      topInset={headerHeight} bottomInset={dockHeight} hidden={mapOpen} />
    <View style={[styles.header, mapOpen && { opacity: 0 }]} pointerEvents={mapOpen ? 'none' : 'auto'}
      accessibilityElementsHidden={mapOpen} importantForAccessibility={mapOpen ? 'no-hide-descendants' : 'auto'}
      onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' }}>
      <Text style={[type.titleMedium, { flex: 1 }]} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        {settings.interfaceMode === InterfaceMode.DEVELOPER ? 'CrossWise · Developer' : 'CrossWise'}
      </Text>
      <VoiceControl onHelp={onSettings} />
      <IconPill icon="settings" label="Settings" onPress={onSettings} />
      </View>
      <VoiceStatus onHelp={onSettings} />
    </View>
    <View testID="full-map" style={[StyleSheet.absoluteFill, !mapOpen && { opacity: 0 }]}
      pointerEvents={mapOpen ? 'auto' : 'none'} accessibilityElementsHidden={!mapOpen}
      importantForAccessibility={mapOpen ? 'auto' : 'no-hide-descendants'} accessibilityViewIsModal={mapOpen}
      onAccessibilityEscape={closeMap}>
      <MapPanel height={height} fullScreen toolsHidden={expanded || keyboard > 0} bottomInset={sheetHeight + keyboard + 12} onInteract={() => { controller.stopVoice(); collapse(); }} preview={(!active || planner.replacing) ? planner : undefined}
        onCandidate={place => { controller.stopVoice(); controller.planner.select(place); setExpanded(true); }}
        onPlaceId={id => { controller.stopVoice(); if (active && !planner.replacing && !controller.changeDestination()) return; setExpanded(true); void controller.planner.resolve(id); }} />
      <Animated.View style={[styles.sheet, { height: requestedHeight, bottom: keyboard, transform: [{ translateY: sheetSlide }] }]}
        onLayout={e => setSheetHeight(e.nativeEvent.layout.height)}>
        <VoiceStatus onHelp={onSettings} />
        <View style={styles.sheetHandle} {...sheetGesture.panHandlers} accessible accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse destination panel' : 'Expand destination panel'}
          accessibilityState={{ expanded }} onAccessibilityTap={() => { Keyboard.dismiss(); setExpanded(!expanded); }}>
          <MaterialIcons name={expanded ? 'keyboard-arrow-down' : 'keyboard-arrow-up'} size={26} color={Colors.Accent} />
        </View>
        {active && !planner.replacing ? <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
          <RouteSummary onDestination={() => setExpanded(true)} />
          <JourneyControls stacked={window.fontScale > 1.3} />
          <TextButton label="Change destination" onPress={() => controller.changeDestination()} />
        </ScrollView> : <DestinationSheet visible={mapOpen && !hidden} />}
      </Animated.View>
      <View style={[styles.exitMap, { bottom: sheetHeight + keyboard + 12 }]}>
        <VoiceControl onHelp={onSettings} />
        <IconPill icon="fullscreen-exit" label="Close full-screen map" onPress={closeMap} />
      </View>
    </View>
    <View style={[styles.dock, mapOpen && { opacity: 0 }]} pointerEvents={mapOpen ? 'none' : 'auto'}
      accessibilityElementsHidden={mapOpen} importantForAccessibility={mapOpen ? 'no-hide-descendants' : 'auto'}
      onLayout={event => { setDockHeight(event.nativeEvent.layout.height); onDockHeight?.(event.nativeEvent.layout.height); }}>
      {/* J12: no scroll area over the camera. Large text sizes and User mode keep the primary action; the rest opens a sheet. */}
      <JourneyControls stacked={window.fontScale > 1.3} compact={settings.interfaceMode === InterfaceMode.USER || window.fontScale > 1.3} />
      <Pressable accessibilityRole="button" accessibilityLabel="Show map" accessibilityState={{ expanded: mapOpen }}
        onPress={() => setMapOpen(true)} style={styles.mapToggle}>
        <MaterialIcons name="keyboard-arrow-up" size={28} color={Colors.OnSurface} />
      </Pressable>
    </View>
  </View>;
}

export function RouteSummary({ onDestination }: { onDestination: () => void }) {
  const type = useType();
  const s = useStore(controller.journey.state);
  const route = s.route;
  const active = s.phase === 'walking' || s.phase === 'paused';
  return <View style={styles.summary}>
    {active && route ? <>
      <Text style={[type.titleLarge, { color: Colors.Accent }]} accessibilityRole="header">{s.phase === 'paused' ? 'Journey paused' : s.crossing ? 'Crossing' : `Step ${s.stepIndex + 1} of ${route.steps.length}`}</Text>
      <Text style={type.bodyMedium}>To {route.destination}</Text>
      {s.crossing ? <>
        <Text style={type.titleMedium}>Route speech is paused.</Text>
        <Text style={type.bodyMedium}>{S.crossingFinishHint}</Text>
        {s.phase === 'paused' && <Text style={type.bodyMedium}>The crossing is unfinished. Confirm the far footpath before resuming the route.</Text>}
      </> : s.phase === 'paused' ? <Text style={type.bodyLarge}>Guidance is paused. Check your position before resuming.</Text> : <>
        <Text style={type.titleLarge}>{route.steps[s.stepIndex].instruction}</Text>
        <Text style={type.bodyMedium}>{s.remaining !== null ? `About ${s.remaining} metres remaining` :
          s.locationStatus === 'off-route' ? 'Away from this instruction. Check your position from the footpath.' : 'Location uncertain — distance updates paused.'}</Text>
        <TextButton label={s.stepIndex < route.steps.length - 1 ? 'I completed this instruction' : 'I am at my destination'}
          onPress={() => { if (s.stepIndex < route.steps.length - 1) controller.journey.next(s.stepIndex); else controller.finishJourney(s.stepIndex); }} />
      </>}
    </> : <>
      {s.phase === 'arrived' && <Text style={type.titleMedium}>Journey completed at {route?.destination}.</Text>}
      <BigButton text={route && s.phase !== 'arrived' ? 'Review destination' : 'Choose destination'} multiline
        color={Colors.Crossing} onPress={() => { if (s.phase === 'arrived') controller.journey.end(); onDestination(); }} />
    </>}
    {s.error && <Text style={[type.bodyMedium, { color: Colors.Warn }]} accessibilityRole="alert">{s.error}</Text>}
    {/* The beta warning is shown once, under Start journey in the destination sheet; not again while walking. */}
    {route && !active && <Text style={type.bodyMedium}>{WALKING_WARNING}</Text>}
  </View>;
}

/** J12: the extra dock actions live in a bottom sheet, so the dock never grows or scrolls. Back and Close both dismiss it. */
function MoreControlsSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const type = useType();
  const reduceMotion = useReducedMotion();
  const bottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  return <Modal visible={visible} transparent statusBarTranslucent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
    <View style={styles.modalRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} importantForAccessibility="no" />
      <View accessibilityViewIsModal style={[styles.moreSheet, { paddingBottom: bottom + Dimens.gutter }]}>
        <Text style={type.titleLarge} accessibilityRole="header">{S.actionMoreControls}</Text>
        {children}
        <BigButton text={S.actionClose} color={Colors.SurfaceVariant} onPress={onClose} />
      </View>
    </View>
  </Modal>;
}

interface Extra { text: string; press: () => void; color?: string; enabled?: boolean }

/**
 * These per-frame consumers are separate from the map and the rest of the journey layout. `compact` keeps only the
 * primary button in view; the other actions open in the More controls sheet.
 */
export function JourneyControls({ stacked, compact = false }: { stacked: boolean; compact?: boolean }) {
  const type = useType();
  const [sheetOpen, setSheetOpen] = useState(false);
  const s = useStore(controller.journey.state);
  const { snapshot } = useStore(controller.ui);
  const assistOn = snapshot.mode !== AssistMode.IDLE;
  const paused = s.phase === 'paused';
  const walking = s.phase === 'walking';
  const crossing = snapshot.mode === AssistMode.CROSSING || (paused && s.crossing);
  const button = (text: string, onPress: () => void, color = Colors.SurfaceVariant, enabled = true, primary = false, fill = !stacked && !primary) =>
    <BigButton key={text} text={text} onPress={onPress} multiline color={color} enabled={enabled} primary={primary}
      style={fill ? { flex: 1 } : undefined} />;

  // One primary button (56 dp), always in the same place, that walks through the states. (ui-p2c J2)
  const primary = crossing ? button(S.actionEndCrossing, () => controller.crossingAction('finish'), Colors.Crossing, !s.busy, true)
    : paused ? button(S.actionResume, () => { void controller.startJourney(); }, Colors.Crossing, !s.busy, true)
    : walking ? button(S.actionStartCrossing, () => controller.crossingAction('help'), Colors.Crossing, !s.busy, true)
    : assistOn ? button(S.actionStartCrossing, () => controller.crossingAction('start'), Colors.Crossing, !s.busy, true)
    : button(S.actionStartAssist, () => controller.command(UserCommand.START_ASSIST, true), Colors.Crossing, true, true);
  const extras = [
    (assistOn || walking || paused) && { text: 'Repeat', press: () => controller.repeatGuidance(), enabled: assistOn || walking },
    walking && { text: 'Pause', press: () => controller.pauseJourney() },
    paused && { text: 'End journey', press: () => controller.stopNavigation(), color: Colors.DontWalk },
    !walking && !paused && assistOn && { text: S.actionStopAssist, press: () => controller.command(UserCommand.STOP_ASSIST, true), color: Colors.DontWalk },
  ].filter(Boolean) as Extra[];
  // At most two buttons share a row; a lone button, or the larger text sizes, take the full width. (ui-p2c J11)
  const more = extras.map(x => button(x.text, x.press, x.color, x.enabled));
  const rows: ReactElement[][] = [];
  for (let i = 0; i < more.length; i += stacked ? 1 : 2) rows.push(more.slice(i, i + (stacked ? 1 : 2)));

  return <View style={styles.footer}>
    {s.busy === 'starting' && <Text style={type.bodyMedium} accessibilityLiveRegion="polite">Checking location…</Text>}
    {!compact && rows.map((row, i) => <View key={i} style={styles.controls}>{row}</View>)}
    {primary}
    {compact && extras.length > 0 && <TextButton size="large" label={S.actionMoreControls} onPress={() => setSheetOpen(true)} />}
    {compact && <MoreControlsSheet visible={sheetOpen && extras.length > 0} onClose={() => setSheetOpen(false)}>
      {extras.map(x => button(x.text, () => { setSheetOpen(false); x.press(); }, x.color, x.enabled, false, false))}
    </MoreControlsSheet>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.Background, overflow: 'hidden' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, minHeight: 56, paddingHorizontal: 12, backgroundColor: Colors.Glass },
  sheet: { position: 'absolute', left: 0, right: 0, backgroundColor: Colors.Surface, borderTopLeftRadius: Dimens.radiusCard, borderTopRightRadius: Dimens.radiusCard, overflow: 'hidden' },
  sheetHandle: { minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  exitMap: { position: 'absolute', right: 12, gap: 12 },
  dock: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.Glass },
  mapToggle: { alignSelf: 'center', minWidth: 96, height: 56, alignItems: 'center', justifyContent: 'center' },
  summary: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  footer: { backgroundColor: Colors.Glass, padding: 10, borderTopWidth: 1, borderTopColor: Colors.Hairline, gap: 6 },
  controls: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.TopScrim[0] },
  moreSheet: { backgroundColor: Colors.Surface, borderTopLeftRadius: Dimens.radiusCard, borderTopRightRadius: Dimens.radiusCard, padding: Dimens.gutter, gap: Dimens.gapMedium },
});
