import { type ReactElement, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Text } from './ScaledText';
import { AssistMode, UserCommand } from '../crossing/crossingEngine';
import { InterfaceMode } from '../settings/settings';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { noteLabelChange, pressStop, pressUnlessLabelJustChanged } from '../state/safetyGuards';
import { T } from '../text/safetyText';
import { S } from '../strings';
import { CHECK_BUTTON } from '../text/checkText';
import { BigButton, IconPill, TextButton } from './components';
import { askForCamera } from './askForCamera';
import { MainScreen } from './MainScreen';
import { Colors, Dimens, useType } from './theme';
import { useReducedMotion } from './useReducedMotion';
import { VoiceControl, VoiceStatus } from './VoiceControl';

/** One camera view with a header and a dock; nothing resizes the camera. */
export function JourneyScreen({ onSettings, hidden, onDockHeight, hasPermission, canRequestPermission, requestPermission }: {
  onSettings: () => void; hidden: boolean; onDockHeight?: (height: number) => void;
  hasPermission: boolean; canRequestPermission: boolean; requestPermission: () => unknown;
}) {
  const type = useType();
  const window = useWindowDimensions();
  const settings = useStore(controller.settings);
  const [headerHeight, setHeaderHeight] = useState(56);
  const [dockHeight, setDockHeight] = useState(114);
  return <View style={styles.root}
    accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    <MainScreen hasPermission={hasPermission} canRequestPermission={canRequestPermission} requestPermission={requestPermission}
      topInset={headerHeight} bottomInset={dockHeight} />
    <View style={styles.header} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' }}>
      <Text style={[type.titleMedium, { flex: 1 }]} maxFontSizeMultiplier={1.3} accessibilityRole="header">
        {settings.interfaceMode === InterfaceMode.DEVELOPER ? 'CrossWise · Developer' : 'CrossWise'}
      </Text>
      <VoiceControl onHelp={onSettings} />
      <IconPill icon="settings" label="Settings" onPress={onSettings} />
      </View>
      <VoiceStatus onHelp={onSettings} />
    </View>
    <View style={styles.dock}
      onLayout={event => { setDockHeight(event.nativeEvent.layout.height); onDockHeight?.(event.nativeEvent.layout.height); }}>
      {/* J12: no scroll area over the camera. Large text sizes and User mode keep the primary action; the rest opens a sheet. */}
      <JourneyControls stacked={window.fontScale > 1.3} compact={settings.interfaceMode === InterfaceMode.USER || window.fontScale > 1.3}
        permission={{ hasPermission, canRequestPermission, requestPermission }} />
    </View>
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

interface CameraPermission { hasPermission: boolean; canRequestPermission: boolean; requestPermission: () => unknown }
interface Extra { text: string; press: () => void; color?: string; enabled?: boolean }

/**
 * These per-frame consumers are separate from the rest of the layout. `compact` keeps only the
 * primary button in view; the other actions open in the More controls sheet.
 */
export function JourneyControls({ stacked, compact = false, permission }: { stacked: boolean; compact?: boolean; permission?: CameraPermission }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { snapshot } = useStore(controller.ui);
  const assistOn = snapshot.mode !== AssistMode.IDLE;
  const crossing = snapshot.mode === AssistMode.CROSSING;
  const type = useType();
  const check = !crossing && assistOn ? snapshot.check : undefined;
  const showResult = check?.stage === 'result' || check?.stage === 'expired';
  const stopped = check?.stage === 'stopped';
  // After a result, screen-reader focus goes to the result text, so the answer is read before the buttons.
  const resultRef = useRef<View>(null);
  useEffect(() => {
    const handle = showResult || stopped ? findNodeHandle(resultRef.current) : null;
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [showResult, stopped, check?.text]);
  const button = (text: string, onPress: () => void, color = Colors.SurfaceVariant, enabled = true, primary = false, fill = !stacked && !primary) =>
    <BigButton key={text} text={text} onPress={onPress} multiline color={color} enabled={enabled} primary={primary}
      style={fill ? { flex: 1 } : undefined} />;

  // One primary button (56 dp), always in the same place, that walks through the states. (ui-p2c J2)
  const [primaryLabel, primaryPress]: [string, () => void] = crossing ? [S.actionEndCrossing, () => controller.crossingAction('finish')]
    : assistOn ? [S.actionStartCrossing, () => controller.crossingAction('start')]
    // SIM-1: no camera permission, no camera help. The primary button asks for the camera instead.
    : permission && !permission.hasPermission
      ? [permission.canRequestPermission ? S.actionGrantCamera : S.actionOpenSettings,
        () => { void askForCamera(permission.canRequestPermission, permission.requestPermission); }]
    : [S.actionStartAssist, () => controller.command(UserCommand.START_ASSIST, true)];
  // The same place on screen means something else after each press: say what it does now, and hold off further presses briefly.
  const lastLabel = useRef(primaryLabel);
  useEffect(() => {
    if (lastLabel.current === primaryLabel) return;
    const lead = lastLabel.current === S.actionStartAssist && primaryLabel === S.actionStartCrossing ? T.cameraHelpOnLead : '';
    lastLabel.current = primaryLabel;
    noteLabelChange();
    controller.speakHigh(T.nextButton(primaryLabel, lead));
  }, [primaryLabel]);
  const primary = button(primaryLabel, () => pressUnlessLabelJustChanged(primaryPress), Colors.Crossing, true, true);
  const extras = [
    assistOn && { text: 'Repeat', press: () => controller.repeatGuidance() },
    assistOn && { text: S.actionStopAssist, press: pressStop, color: Colors.DontWalk },
  ].filter(Boolean) as Extra[];
  // At most two buttons share a row; a lone button, or the larger text sizes, take the full width. (ui-p2c J11)
  const more = extras.map(x => button(x.text, x.press, x.color, x.enabled));
  const rows: ReactElement[][] = [];
  for (let i = 0; i < more.length; i += stacked ? 1 : 2) rows.push(more.slice(i, i + (stacked ? 1 : 2)));

  return <View style={styles.footer}>
    {!compact && rows.map((row, i) => <View key={i} style={styles.controls}>{row}</View>)}
    {(showResult || stopped) && check?.text && <View ref={resultRef} accessible accessibilityLiveRegion="assertive" style={styles.result}>
      <Text style={type.titleMedium} maxFontSizeMultiplier={1.3}>{check.text}</Text>
    </View>}
    {showResult ? <View style={styles.controls}>
      {/* "Check again" comes first: it is always allowed. "Cross" only works on a fresh no-vehicle or unsure result. */}
      {button(CHECK_BUTTON.again, () => controller.command(UserCommand.CHECK_AGAIN), Colors.SurfaceVariant, true, true, true)}
      {button(CHECK_BUTTON.cross, () => controller.crossingAction('start'), Colors.Crossing, !!check?.canCross, true, true)}
    </View> : stopped ? button(CHECK_BUTTON.start, () => controller.command(UserCommand.CHECK_AGAIN), Colors.Crossing, true, true)
      : primary}
    {compact && extras.length > 0 && <TextButton size="large" label={S.actionMoreControls} onPress={() => setSheetOpen(true)} />}
    {compact && <MoreControlsSheet visible={sheetOpen && extras.length > 0} onClose={() => setSheetOpen(false)}>
      {extras.map(x => button(x.text, () => { setSheetOpen(false); x.press(); }, x.color, x.enabled, false, false))}
    </MoreControlsSheet>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.Background, overflow: 'hidden' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, minHeight: 56, paddingHorizontal: 12, backgroundColor: Colors.Glass },
  dock: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.Glass },
  footer: { backgroundColor: Colors.Glass, padding: 10, borderTopWidth: 1, borderTopColor: Colors.Hairline, gap: 6 },
  result: { paddingVertical: 6 },
  controls: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.TopScrim[0] },
  moreSheet: { backgroundColor: Colors.Surface, borderTopLeftRadius: Dimens.radiusCard, borderTopRightRadius: Dimens.radiusCard, padding: Dimens.gutter, gap: Dimens.gapMedium },
});
