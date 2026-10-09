import { memo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from './ScaledText';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { nativeMapConfigured } from '../config/services';
import type { PlannerState } from '../nav/planner';
import type { PlaceCandidate } from '../nav/navigation';
import { usableFix } from '../nav/navigation';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { IconPill, TextButton } from './components';
import { Colors, useType } from './theme';

/** Own subscription to GPS, never to per-frame perception. Native Google attribution stays unobstructed. */
export const MapPanel = memo(function MapPanel({ height, fullScreen = false, onExpand, bottomInset = 12, onInteract, toolsHidden = false, preview, onCandidate, onPlaceId }: { height: number; fullScreen?: boolean; onExpand?: () => void; bottomInset?: number; onInteract?: () => void; toolsHidden?: boolean; preview?: PlannerState; onCandidate?: (place: PlaceCandidate) => void; onPlaceId?: (id: string) => void }) {
  const type = useType();
  const stacked = useWindowDimensions().fontScale > 1.3;
  const journey = useStore(controller.journey.state);
  const route = preview ? preview.route : journey.route;
  const destination = preview ? preview.selected : journey.destination;
  const phase = journey.phase;
  const previewing = !!preview;
  const location = useStore(controller.journey.location);
  const map = useRef<MapView>(null);
  const request = useRef<AbortController | null>(null);
  const [following, setFollowing] = useState(true);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const fix = location && usableFix(location, Math.max(now, Date.now())) ? location : null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (loaded || !nativeMapConfigured) return;
    const timer = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(timer);
  }, [loaded, attempt]);
  useEffect(() => {
    if (ready && following && fix) map.current?.animateToRegion({ ...fix, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 350);
  }, [ready, following, fix]);
  useEffect(() => {
    if (ready && route && (phase === 'idle' || previewing)) {
      setFollowing(false);
      map.current?.fitToCoordinates(route.points, { edgePadding: { top: 24, right: 24, bottom: 32, left: 24 }, animated: true });
    }
  }, [ready, route, phase, previewing]);
  useEffect(() => { if (phase === 'walking') setFollowing(true); }, [phase]);

  useEffect(() => {
    if (ready && destination && !route) { setFollowing(false); map.current?.animateToRegion({ ...destination.point, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 300); }
  }, [ready, destination, route]);

  const locate = async () => {
    if (locating) return;
    setFollowing(true); setError(null);
    // Always reacquire when Recenter is requested, so a stale position is not represented as current.
    const pending = new AbortController(); request.current?.abort(); request.current = pending; setLocating(true);
    try { await controller.journey.refreshLocation(pending.signal); }
    catch (e) { if (!pending.signal.aborted) setError(e instanceof Error ? e.message : 'Location unavailable. Try again.'); }
    finally { if (!pending.signal.aborted) setLocating(false); }
  };
  const overview = () => {
    if (!route) return;
    setFollowing(false);
    map.current?.fitToCoordinates(route.points, { edgePadding: { top: 24, right: 24, bottom: 32, left: 24 }, animated: true });
  };

  return <View style={fullScreen ? { height } : undefined}>
    {nativeMapConfigured ? <View style={{ height }}>
      <MapView key={attempt} ref={map} style={StyleSheet.absoluteFill} provider={PROVIDER_GOOGLE}
        initialRegion={{ latitude: 0, longitude: 0, latitudeDelta: 120, longitudeDelta: 120 }}
        userInterfaceStyle="light" rotateEnabled pitchEnabled={false} showsCompass
        scrollEnabled={fullScreen || !onExpand} zoomEnabled={fullScreen || !onExpand}
        // Keep attribution below the route card and to the left of the collapse button.
        {...(ready ? { mapPadding: { top: fullScreen ? 80 : 0, bottom: fullScreen ? bottomInset : 0, left: 0, right: fullScreen ? 72 : 0 } } : {})}
        showsMyLocationButton={false} showsUserLocation={false} toolbarEnabled={false}
        onMapReady={() => setReady(true)} onMapLoaded={() => { setLoaded(true); setSlow(false); }}
        onPanDrag={() => { setFollowing(false); onInteract?.(); }}
        onPress={event => { if (event.nativeEvent.action !== 'marker-press') onInteract?.(); }}
        onPoiClick={event => { if (event.nativeEvent.placeId) onPlaceId?.(event.nativeEvent.placeId); }}
        onRegionChangeComplete={(_, details) => { if (details.isGesture) setFollowing(false); }}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {preview?.page === 'results' && preview.candidates.map((place, i) => <Marker key={place.id} coordinate={place.point}
          title={`${i + 1}. ${place.name}`} description={place.address} onPress={() => onCandidate?.(place)} />)}
        {route && <Polyline coordinates={route.points} strokeColor="#1464C0" strokeWidth={5} />}
        {destination && <Marker coordinate={destination.point} title={destination.name} />}
        {fix && <Circle center={fix} radius={fix.accuracy ?? 0} fillColor="rgba(20,100,192,0.14)" strokeColor="#1464C0" />}
        {fix && <Marker coordinate={fix} title="Approximate current location" pinColor="#1464C0" />}
      </MapView>
      {!fullScreen && onExpand && <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
        accessibilityLabel="Open full-screen map" onPress={onExpand} />}
    </View> : <Text style={[type.bodyLarge, styles.message]}>Map unavailable in this build. Camera help is still available.</Text>}
    <ScrollView accessibilityElementsHidden={toolsHidden} importantForAccessibility={toolsHidden ? 'no-hide-descendants' : 'auto'} style={[toolsHidden && { display: 'none' }, fullScreen ? [styles.floatingTools, { maxHeight: height * 0.3 }] : undefined]}>
    <View style={[styles.tools, stacked && styles.toolsStacked]}>
      <Text style={[type.bodyMedium, { width: '100%', paddingTop: 8, color: Colors.OnSurfaceMuted }]}>
        {locating ? 'Checking location…' : fix ? `Location accuracy: about ${Math.round(fix.accuracy ?? 0)} m` : 'Current location unavailable'}
      </Text>
      <IconPill icon="explore" label="North up" onPress={() => map.current?.animateCamera({ heading: 0, pitch: 0 })} />
      <IconPill icon={locating ? "close" : "my-location"} label={locating ? 'Cancel location check' : fix ? 'Recenter' : 'Locate me'} onPress={locating
        ? () => { request.current?.abort(); setLocating(false); } : locate} />
      {route && ready && <IconPill icon="route" label="Overview" onPress={overview} />}
    </View>
    {error && <Text style={[type.bodyMedium, styles.message]} accessibilityRole="alert">{error}</Text>}
    {slow && <View style={[styles.tools, stacked && styles.toolsStacked]}>
      <Text style={[type.bodyMedium, { flex: stacked ? 0 : 1, width: stacked ? '100%' : undefined }]}>Map display is taking longer than expected. Route text and camera remain available.</Text>
      <TextButton label="Retry map" onPress={() => { setReady(false); setLoaded(false); setSlow(false); setAttempt(a => a + 1); }} />
    </View>}
    </ScrollView>
  </View>;
});

const styles = StyleSheet.create({
  tools: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingHorizontal: 12, gap: 12 },
  toolsStacked: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  message: { padding: 12 },
  floatingTools: { position: 'absolute', top: 12, left: 12, right: 84, borderRadius: 12, backgroundColor: '#161C21' },
});
