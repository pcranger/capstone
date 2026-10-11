import { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from './ScaledText';
import { type EngineSnapshot } from '../crossing/crossingEngine';
import { ObjectCategory, isVehicle } from '../perception/detection';
import { useType } from './theme';

export const DeveloperTelemetry = memo(function DeveloperTelemetry({ snapshot: s, fresh, fps, inferenceMs, brightness, model }: {
  snapshot: EngineSnapshot; fresh: boolean; fps: number; inferenceMs: number; brightness: number; model: string;
}) {
  const type = useType();
  // Never present retained tracks as live counts after camera interruption.
  const tracks = fresh ? s.tracks : [];
  const count = (category: ObjectCategory) => fresh ? String(tracks.filter(t => t.category === category).length) : '—';
  const metric = (icon: React.ComponentProps<typeof MaterialIcons>['name'], label: string, value: string) =>
    <View key={label} style={styles.metric} accessible accessibilityLabel={`${label}: ${value}`}>
      <MaterialIcons name={icon} size={20} color="#80DEEA" />
      <Text style={type.titleMedium}>{value}</Text><Text style={type.labelMedium}>{label}</Text>
    </View>;
  return <View testID="developer-telemetry" style={{ gap: 8 }}>
    <Text style={type.labelLarge}>LIVE DIAGNOSTICS · {fresh ? s.mode : 'STALE FRAME'}</Text>
    <View style={styles.grid}>
      {metric('directions-car', 'Cars', count(ObjectCategory.CAR))}
      {metric('two-wheeler', 'Motorbikes', count(ObjectCategory.MOTORCYCLE))}
      {metric('local-shipping', 'Bus / truck', fresh ? String(tracks.filter(t => [ObjectCategory.BUS, ObjectCategory.TRUCK].includes(t.category)).length) : '—')}
      {metric('directions-bike', 'Bicycles', count(ObjectCategory.BICYCLE))}
      {metric('person', 'People', count(ObjectCategory.PERSON))}
      {metric('warning', 'Alerts', fresh ? String(s.hazards.length) : '—')}
    </View>
    <Text style={type.labelMedium}>{model}</Text>
    <Text style={type.labelMedium}>{fresh ? `${Math.round(fps)} FPS · ${Math.round(inferenceMs)} ms · Light ${Math.round(brightness * 100)}%` : 'Frame unavailable · measurements paused'}</Text>
    <Text style={type.labelMedium}>Pitch {fresh && s.pitchDeg !== null ? `${Math.round(s.pitchDeg)}°` : '—'} · Aim {fresh && s.aimBearingDeg !== null ? `${Math.round(s.aimBearingDeg)}°` : '—'} · {fresh ? s.walking ? 'Walking' : 'Still' : 'Motion unverified'}</Text>
    <Text style={type.labelMedium}>Signal {fresh ? s.signal.phase : '—'} · {fresh && s.signal.trusted ? 'model evidence' : 'unverified'}</Text>
    {fresh && s.veer && <Text style={type.labelMedium}>Heading {Math.round(s.veer.lockedHeadingDeg)}° · Drift {Math.round(s.veer.deviationDeg)}°</Text>}
    {s.crossingElapsedMs !== null && <Text style={type.labelMedium}>Crossing {(s.crossingElapsedMs / 1000).toFixed(1)} s</Text>}
    <Text style={type.labelLarge}>TRACKS · {fresh ? tracks.length : '—'}</Text>
    {fresh && tracks.length === 0 && <Text style={type.labelMedium}>No tracked objects</Text>}
    {tracks.map(t => {
      const hazard = s.hazards.find(h => h.trackId === t.id);
      const side = t.box.centerX < 0.38 ? 'LEFT' : t.box.centerX > 0.62 ? 'RIGHT' : 'AHEAD';
      return <View key={t.id} style={styles.track}>
        <Text style={type.labelLarge}>#{t.id} {t.category.replaceAll('_', ' ')} · {Math.round(t.confidence * 100)}% · {side}</Text>
        <Text style={type.labelMedium}>Box {Math.round(t.box.width * 100)} × {Math.round(t.box.height * 100)}% of frame{t.isPrimarySignal ? ' · PRIMARY' : ''}</Text>
        {isVehicle(t.category) && <Text style={type.labelMedium}>{t.motion ?? 'VEHICLE'}{t.motionSupported ? '' : ' (unsure)'} · {t.direction ?? 'UNKNOWN'}</Text>}
        {isVehicle(t.category) && <Text style={[type.labelMedium, hazard && { color: '#FFD87A' }]}>{hazard
          ? `${hazard.level} · optical TTC ${hazard.ttcSeconds.toFixed(1)} s`
          : 'Motion / approach unconfirmed'}</Text>}
      </View>;
    })}
    <Text style={type.labelMedium}>Counts include stationary objects. Optical TTC is an image-expansion estimate; speed and distance are not measured.</Text>
  </View>;
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metric: { flexGrow: 1, flexBasis: '29%', backgroundColor: '#182B32', borderRadius: 8, padding: 8, gap: 2 },
  track: { borderTopWidth: 1, borderTopColor: '#40505A', paddingTop: 6, gap: 2 },
});
