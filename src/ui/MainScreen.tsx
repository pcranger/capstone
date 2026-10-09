import { useEffect, useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
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
import { TextButton } from './components';
import { DetectionOverlay, SegmentationOverlay } from './Overlays';
import { Colors, useType } from './theme';

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
  let status = !assistOn ? 'Camera assistance is off.' : routeOnly ? 'Watching nearby traffic.' : 'No pedestrian signal verified.';
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
        <MaterialIcons name={icon} size={24} color={unavailable || posture || hazard ? '#FFD87A' : '#80DEEA'} />
      </Pressable>
      <VehicleVisibilityControls compact />
      <Pressable accessibilityRole="button" accessibilityLabel={detailsOpen ? 'Close diagnostics' : 'Open diagnostics'}
        accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(v => !v)} style={styles.iconButton}>
        <MaterialIcons name={detailsOpen ? 'close' : 'tune'} size={24} color="#FFFFFF" />
      </Pressable>
    </View>}
    {(!developer || detailsOpen) && <ScrollView style={[styles.status, { top: topInset + (developer ? 60 : 8), maxHeight: Math.max(80, Math.min(window.height * (developer ? 0.38 : 0.28), window.height - topInset - bottomInset - 160)) }]}
      contentContainerStyle={{ padding: 12, gap: 8 }}>
      <View accessible accessibilityLabel={message} accessibilityLiveRegion="polite"
        style={[styles.statusRow, hazardShown && styles.hazardRow]}>
        <MaterialIcons name={icon} size={28} color={hazardShown ? Colors.OnHazard : unavailable || posture || hazard ? '#FFD87A' : '#80DEEA'} />
        <Text style={[settings.largeStatus ? type.headlineMedium : hazardShown ? type.titleLarge : type.titleMedium, { flex: 1 },
          (unavailable || posture) && { color: '#FFD87A' }, hazardShown && { color: Colors.OnHazard }]}>{message}</Text>
      </View>
      {ui.snapshot.mode === AssistMode.CROSSING && !['walking', 'paused'].includes(journey.phase) &&
        <Text style={type.bodyMedium}>{S.crossingFinishHint}</Text>}
      {!settings.showPreview && <Text style={type.bodyMedium}>Preview hidden.</Text>}
      {!hasPermission && <TextButton label={canRequestPermission ? 'Allow camera' : 'Open app settings'}
        onPress={() => { if (canRequestPermission) void requestPermission(); else void Linking.openSettings(); }} />}
      {hasPermission && camera === 'unavailable' &&
        <TextButton label="Retry camera" onPress={() => setAttempt(a => a + 1)} />}
      {!developer && journey.phase === 'walking' && journey.route && <Text style={type.bodyMedium}>
        {journey.crossing ? 'Crossing assistance' : journey.route.steps[journey.stepIndex]?.instruction}
      </Text>}
      {developer && <Text style={type.labelMedium}>Camera: {camera}{cameraDetail?` · ${cameraDetail}`:''}. Inference: {Math.round(pipeline.latencyMs)} ms · stale frames rejected: {pipeline.slowFrames}{pipeline.error?` · ${pipeline.error}`:''}</Text>}
      {developer && <DeveloperTelemetry snapshot={ui.snapshot} fresh={fresh} fps={ui.fps} inferenceMs={ui.inferenceMs}
        brightness={ui.frameBrightness} model={model.kind === 'ready' ? `${model.info.displayName} · ${model.info.backend} · ${model.info.inputWidth}px` : 'Model unavailable'} />}

    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#000' },
  strip: { position: 'absolute', right: 12, flexDirection: 'row', backgroundColor: Colors.Glass, borderRadius: 24, paddingHorizontal: 4 },
  iconButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 5, flexDirection: 'row', gap: 3, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hazardRow: { backgroundColor: Colors.Hazard, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  status: { position: 'absolute', left: 12, right: 12, backgroundColor: Colors.Glass, borderRadius: 12 },
});
