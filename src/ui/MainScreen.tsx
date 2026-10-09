import { useEffect, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import { deviceWarnings, useDeviceState } from './AssistPanels';
import { DeveloperTelemetry } from './DeveloperTelemetry';
import { VehicleVisibilityControls } from './VehicleVisibilityControls';
import { perceptionMessage } from '../perception/pipelineHealth';
import { nowMs } from '../core/geometry';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './ScaledText';
import { CameraSurface } from '../camera/CameraSurface';
import { AssistMode } from '../crossing/crossingEngine';
import { Side } from '../crossing/hazardMonitor';
import { SignalPhase } from '../signal/signalPhaseTracker';
import { InterfaceMode } from '../settings/settings';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { S } from '../strings';
import { BigButton, TextButton } from './components';
import { DetectionOverlay, SegmentationOverlay } from './Overlays';
import { Colors, Dimens, useType } from './theme';

/** One full-screen camera surface. UI overlays never resize the camera or its box coordinate space. */
export function MainScreen({ height, topInset = 0, bottomInset = 0, hidden = false, hasPermission, canRequestPermission, requestPermission }: {
  height?: number; topInset?: number; bottomInset?: number; hidden?: boolean; hasPermission: boolean; canRequestPermission: boolean; requestPermission: () => unknown;
}) {
  const type = useType();
  const window = useWindowDimensions();
  const settings = useStore(controller.settings);
  const ui = useStore(controller.ui);
  const model = useStore(controller.model);
  const mask = useStore(controller.mask);
  const camera = useStore(controller.cameraStatus);
  const pipeline=useStore(controller.pipeline);
  const cameraDetail=useStore(controller.cameraDetail);
  const journey = useStore(controller.journey.state);
  const warnings = deviceWarnings(useDeviceState());
  const [attempt, setAttempt] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(v => v + 1), 1_000); return () => clearInterval(timer); }, []);
  const developer = settings.interfaceMode === InterfaceMode.DEVELOPER;
  const assistOn = ui.snapshot.mode !== AssistMode.IDLE;
  const fresh = camera === 'running' && controller.hasRecentFrame;
  const routeOnly = journey.phase === 'walking' && !journey.crossing;
  const signal = ui.snapshot.signal;
  const hazard = fresh ? ui.snapshot.hazards[0] : null;
  let status = !assistOn ? S.cameraHelpOff : routeOnly ? 'Watching nearby traffic.' : 'No pedestrian signal verified.';
  if (assistOn && !routeOnly && fresh && signal.phase !== SignalPhase.UNKNOWN) {
    status = !signal.trusted ? 'Signal colour is unverified.' : {
      [SignalPhase.UNKNOWN]: 'No pedestrian signal verified.',
      [SignalPhase.WALK]: signal.freshWalk ? 'Walk signal just appeared.' : 'Walk signal observed; start time unknown.',
      [SignalPhase.WALK_FLASHING]: 'Walk signal is flashing.',
      [SignalPhase.DONT_WALK]: 'Don’t-walk signal observed.',
      [SignalPhase.DONT_WALK_FLASHING]: 'Don’t-walk signal is flashing.',
    }[signal.phase];
  }
  if (hazard && assistOn) status = S.hazardBanner(hazard.side === Side.LEFT ? S.sideLeft : hazard.side === Side.RIGHT ? S.sideRight : S.sideAhead);
  let unavailable: string | null = null;
  if (!hasPermission) unavailable = 'Camera permission is off. Route guidance remains available.';
  else if (model.kind !== 'ready') unavailable = model.kind === 'loading' ? 'Loading detection…' : 'Detection unavailable. Check the model in Settings → Developer.';
  else if (camera !== 'running' || !fresh) unavailable = perceptionMessage(camera,fresh,pipeline,nowMs());
  else if (assistOn && ui.frameBrightness < 0.04) unavailable = 'Camera blocked or too dark. Check the lens.';
  else if (assistOn && ui.frameBrightness < 0.12) unavailable = 'Too dark. Improve the camera view.';
  const pitch = ui.snapshot.pitchDeg;
  const posture = fresh && assistOn && pitch !== null ? pitch < -35 ? 'Raise phone. Point the camera ahead.' : pitch > 50 ? 'Lower phone. Point the camera ahead.' : null : null;
  const message = unavailable ?? (hazard && assistOn ? status : posture ?? status);
  const hazardShown = !unavailable && !!hazard && assistOn;
  // J8: one state banner. Hazard keeps its Package 1 look (yellow fill, black text); every other state uses its colour.
  const signalTone: Record<SignalPhase, string> = {
    [SignalPhase.UNKNOWN]: Colors.Unknown, [SignalPhase.WALK]: Colors.Walk, [SignalPhase.WALK_FLASHING]: Colors.Caution,
    [SignalPhase.DONT_WALK]: Colors.DontWalk, [SignalPhase.DONT_WALK_FLASHING]: Colors.DontWalk,
  };
  const signalShown = assistOn && !routeOnly && fresh && signal.phase !== SignalPhase.UNKNOWN;
  const crossingNow = ui.snapshot.mode === AssistMode.CROSSING || journey.crossing;
  const tone = hazardShown ? Colors.Hazard : unavailable || posture ? Colors.Caution
    : signalShown ? (signal.trusted ? signalTone[signal.phase] : Colors.Caution) : crossingNow ? Colors.Crossing : Colors.Unknown;
  const onTone = tone === Colors.Hazard ? Colors.OnHazard : Colors.OnSurface;
  const hint = hazardShown ? undefined : crossingNow ? S.crossingFinishHint : !assistOn && !unavailable ? S.cameraHelpOffHint
    : journey.phase === 'walking' ? journey.route?.steps[journey.stepIndex]?.instruction : undefined;
  const extras = !settings.showPreview || (hasPermission && camera === 'unavailable') || developer;
  const icon = unavailable ? 'videocam-off' : hazard && assistOn ? 'warning' : posture ? 'screen-rotation' : assistOn ? 'visibility' : 'pause-circle-outline';

  return <View style={[styles.panel, height === undefined ? StyleSheet.absoluteFill : { height }]}
    pointerEvents="box-none" accessibilityElementsHidden={hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
    <View style={StyleSheet.absoluteFill} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {hasPermission && <CameraSurface key={attempt} showPreview={settings.showPreview} resizeMode="cover" style={StyleSheet.absoluteFill} />}
      {developer && fresh && settings.showPreview && model.kind === 'ready' && model.info.format === 'SEGMENTATION' &&
        <SegmentationOverlay mask={mask} frameAspect={ui.frameAspect} resizeMode="cover" />}
      {developer && fresh && settings.showPreview && settings.showOverlay &&
        <DetectionOverlay snapshot={ui.snapshot} frameAspect={ui.frameAspect} resizeMode="cover" visibility={settings} />}
    </View>
    {developer && <View style={[styles.strip, { top: topInset + 8 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={message + '. Show details'}
        onPress={() => setDetailsOpen(v => !v)} style={styles.iconButton}>
        <MaterialIcons name={icon} size={24} color={unavailable || posture || hazard ? Colors.Warn : Colors.Info} />
      </Pressable>
      <VehicleVisibilityControls compact />
      <Pressable accessibilityRole="button" accessibilityLabel={detailsOpen ? 'Close diagnostics' : 'Open diagnostics'}
        accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(v => !v)} style={styles.iconButton}>
        <MaterialIcons name={detailsOpen ? 'close' : 'tune'} size={24} color="#FFFFFF" />
      </Pressable>
    </View>}
    {!hasPermission && <ScrollView style={StyleSheet.absoluteFill} contentContainerStyle={[styles.cardWrap, { paddingTop: topInset + Dimens.gutter, paddingBottom: bottomInset + Dimens.gutter }]}>
      <View style={styles.card}>
        <View accessible accessibilityLabel={`${S.cameraOffTitle}. ${S.cameraOffReason}`} accessibilityLiveRegion="polite" style={{ gap: Dimens.gapSmall }}>
          <Text style={type.titleLarge}>{S.cameraOffTitle}</Text>
          <Text style={type.bodyLarge}>{S.cameraOffReason}</Text>
        </View>
        <BigButton primary text={canRequestPermission ? S.actionGrantCamera : S.actionOpenSettings} color={Colors.Crossing}
          onPress={() => { if (canRequestPermission) void requestPermission(); else void Linking.openSettings(); }} />
        <TextButton size="large" label={S.actionChooseDestination} onPress={() => controller.openMap()} />
      </View>
    </ScrollView>}
    {(developer ? detailsOpen : hasPermission) && <ScrollView style={[styles.status, { top: topInset + (developer ? 60 : 0), maxHeight: Math.max(80, Math.min(window.height * (developer ? 0.38 : 0.28), window.height - topInset - bottomInset - 160)) }]}>
      {hasPermission && <View accessible accessibilityLabel={message} accessibilityHint={hint} accessibilityLiveRegion="polite"
        style={[styles.banner, { backgroundColor: tone }]}>
        <MaterialIcons name={icon} size={28} color={onTone} />
        <View style={{ flex: 1 }}>
          <Text style={[settings.largeStatus ? type.headlineMedium : type.titleLarge, { color: onTone }]}>{message}</Text>
          {hint && <Text style={[type.bodyMedium, { color: onTone }]}>{hint}</Text>}
        </View>
      </View>}
      {/* J16: one slim line for headphones and battery; the label carries every warning. */}
      {hasPermission && warnings.length > 0 && <View accessible accessibilityLabel={warnings.map(w => w[1]).join(' ')} accessibilityLiveRegion="polite" style={styles.warnLine}>
        <MaterialIcons name={warnings[0][0] === 'battery' ? 'battery-alert' : 'headset-off'} size={24} color={Colors.Warn} />
        <Text style={[type.bodyMedium, { flex: 1 }]} numberOfLines={2}>{warnings[0][1]}{warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}</Text>
      </View>}
      {extras && <View style={styles.extras}>
        {!settings.showPreview && <Text style={type.bodyMedium}>Preview hidden.</Text>}
        {hasPermission && camera === 'unavailable' &&
          <TextButton size="large" label="Retry camera" onPress={() => setAttempt(a => a + 1)} />}
        {developer && <Text style={type.labelMedium}>Camera: {camera}{cameraDetail?` · ${cameraDetail}`:''}. Inference: {Math.round(pipeline.latencyMs)} ms · stale frames rejected: {pipeline.slowFrames}{pipeline.error?` · ${pipeline.error}`:''}</Text>}
        {developer && <DeveloperTelemetry snapshot={ui.snapshot} fresh={fresh} fps={ui.fps} inferenceMs={ui.inferenceMs}
          brightness={ui.frameBrightness} model={model.kind === 'ready' ? `${model.info.displayName} · ${model.info.backend} · ${model.info.inputWidth}px` : 'Model unavailable'} />}
      </View>}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#000' },
  strip: { position: 'absolute', right: 12, flexDirection: 'row', backgroundColor: Colors.Glass, borderRadius: Dimens.radiusPill, paddingHorizontal: 4 },
  iconButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 5, flexDirection: 'row', gap: 3, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Dimens.gapMedium, minHeight: Dimens.touchTarget, paddingHorizontal: Dimens.gutter, paddingVertical: 10 },
  warnLine: { flexDirection: 'row', alignItems: 'center', gap: Dimens.gapMedium, minHeight: 40, paddingHorizontal: Dimens.gutter, paddingVertical: Dimens.gapSmall, backgroundColor: Colors.Glass },
  extras: { padding: Dimens.gapMedium, gap: Dimens.gapSmall, backgroundColor: Colors.Glass },
  status: { position: 'absolute', left: 0, right: 0 },
  cardWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Dimens.gutter },
  card: { backgroundColor: Colors.Surface, borderRadius: Dimens.radiusCard, padding: Dimens.cardPadding, gap: Dimens.gapMedium },
});
