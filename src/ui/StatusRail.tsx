import { MaterialIcons } from '@expo/vector-icons';
import { type ReactNode, useEffect, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import { CROSSWALK, STAND, WALK_FRAMES } from '../../assets/icons/ui';
import { nowMs } from '../core/geometry';
import { AssistMode } from '../crossing/crossingEngine';
import { Side } from '../crossing/hazardMonitor';
import { VeerState } from '../crossing/veerMonitor';
import { isVehicle, ObjectCategory } from '../perception/detection';
import { SignalPhase } from '../signal/signalPhaseTracker';
import type { UiState } from '../state/controller';
import { S } from '../strings';
import { categoryName, compassPoint, confidence, crosswalkSeen, nearby, signalAgeSeconds, signalClock } from './scene';
import { Colors, Dimens, useType } from './theme';

const TILE = 52;
const ICON = 30;
const LAMP_RED = '#FF453A';
const LAMP_GREEN = '#30D158';
const LAMP_OFF = '#3A4148';

/**
 * What the camera sees, as icons down the top-left edge: a sighted helper or a low-vision traveler reads it at a
 * glance, and the view stays open. Order: people, crosswalk, you, vehicles, signal.
 *
 * VoiceOver reads the rail as one sentence with the same facts the old text panel listed.
 */
export function StatusRail({ ui }: { ui: UiState }) {
  const snapshot = ui.snapshot;
  const tracks = snapshot.tracks;
  const people = tracks.filter((t) => t.category === ObjectCategory.PERSON).length;
  const vehicles = tracks.filter((t) => isVehicle(t.category)).length;
  const hazard = snapshot.hazards[0] ?? null;
  const crosswalk = crosswalkSeen(snapshot);
  const crossing = snapshot.mode === AssistMode.CROSSING;
  const drift = snapshot.veer?.state ?? VeerState.ON_COURSE;

  return (
    <View style={styles.rail} accessible accessibilityLabel={spokenSummary(ui)} pointerEvents="none">
      <CountTile icon={people >= 2 ? 'people' : 'person'} count={people} />
      <CrosswalkTile seen={crosswalk} />
      <YouTile walking={snapshot.walking} crossing={crossing} drift={drift} />
      <VehicleTile count={vehicles} hazardSide={hazard?.side ?? null} critical={hazard?.level === 'CRITICAL'} />
      <SignalTile ui={ui} />
    </View>
  );
}

/** The same facts as the removed "What the camera sees" card, for VoiceOver. */
function spokenSummary(ui: UiState): string {
  const s = ui.snapshot;
  const lines: string[] = [];
  const clock = signalClock(s);
  const age = signalAgeSeconds(s, nowMs());
  if (clock !== null) lines.push(S.sceneSignalAt(clock, Math.trunc(confidence(s) * 100)));
  else if (age !== null && age > 1) lines.push(S.sceneSignalStale(age));
  else lines.push(S.sceneSignalNone);
  lines.push(crosswalkSeen(s) ? S.sceneCrosswalk : S.sceneNoCrosswalk);
  const near = nearby(s);
  if (near.length === 0) lines.push(S.sceneQuiet);
  for (const item of near.slice(0, 3)) {
    const name = categoryName(item.category, item.count);
    lines.push(
      item.count === 1 ? S.sceneNearby(name, item.nearestClock) : S.sceneNearbyMany(item.count, name, item.nearestClock),
    );
  }
  if (s.aimBearingDeg !== null) {
    lines.push(S.sceneHeading(compassPoint(s.aimBearingDeg), Math.trunc(((s.aimBearingDeg % 360) + 360) % 360)));
  }
  lines.push(s.walking ? S.sceneWalking : S.sceneStanding);
  return lines.join('. ');
}

function Tile({
  children,
  highlight,
  dashed = false,
  dim = false,
}: {
  children: ReactNode;
  highlight?: string;
  dashed?: boolean;
  dim?: boolean;
}) {
  return (
    <View
      style={[
        styles.tile,
        dashed && styles.dashed,
        highlight !== undefined && { backgroundColor: highlight, borderColor: highlight },
        dim && { opacity: 0.55 },
      ]}
    >
      {children}
    </View>
  );
}

function Badge({ children, color = Colors.Accent, text = '#000000' }: { children: ReactNode; color?: string; text?: string }) {
  const type = useType();
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[type.labelMedium, { color: text, fontFamily: type.labelLarge.fontFamily }]}>{children}</Text>
    </View>
  );
}

function CountTile({ icon, count }: { icon: keyof typeof MaterialIcons.glyphMap; count: number }) {
  const type = useType();
  return (
    <Tile dim={count === 0}>
      <MaterialIcons name={icon} size={ICON - 4} color={Colors.OnSurface} />
      <Text style={[type.titleMedium, styles.count]}>{count}</Text>
    </Tile>
  );
}

/** An empty dashed slot until markings are seen; then the zebra lights up. */
function CrosswalkTile({ seen }: { seen: boolean }) {
  const [opacity] = useState(() => new Animated.Value(seen ? 1 : 0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: seen ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [seen, opacity]);
  return (
    <Tile dashed={!seen}>
      <Image source={CROSSWALK} style={[styles.icon, { tintColor: Colors.OnSurface, opacity: 0.15 }]} />
      <Animated.Image source={CROSSWALK} style={[styles.icon, styles.overlay, { tintColor: '#FFFFFF', opacity }]} />
    </Tile>
  );
}

/**
 * The traveler, as a round "you are here" tile so it never reads as a signal: an animated walking figure while
 * walking, a standing figure when still. Blue during crossing mode; an amber arrow when drift needs correcting.
 */
function YouTile({ walking, crossing, drift }: { walking: boolean; crossing: boolean; drift: VeerState }) {
  const tint = crossing ? '#FFFFFF' : Colors.OnSurface;
  return (
    <View style={[styles.you, crossing && { backgroundColor: Colors.Crossing, borderColor: Colors.Accent }]}>
      {walking ? <WalkingFigure tint={tint} size={ICON + 2} /> : <Image source={STAND} style={[styles.icon, { tintColor: tint }]} />}
      {drift !== VeerState.ON_COURSE && (
        // Drifted right means bear left: the arrow shows where to go, as the voice does.
        <View style={styles.cornerBadge}>
          <MaterialIcons
            name={drift === VeerState.DRIFTED_RIGHT ? 'arrow-back' : 'arrow-forward'}
            size={14}
            color="#000000"
          />
        </View>
      )}
    </View>
  );
}

/** Cycles the 20 walking frames at 12.5 fps. All frames stay mounted, so switching never flickers. */
function WalkingFigure({ tint, size }: { tint: string; size: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % WALK_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={{ width: size, height: size }}>
      {WALK_FRAMES.map((source, i) => (
        <Image
          key={source}
          source={source}
          style={[{ width: size, height: size, tintColor: tint, opacity: i === frame ? 1 : 0 }, styles.overlay]}
        />
      ))}
    </View>
  );
}

function usePulse(active: boolean, periodMs: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!active) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.25, duration: periodMs / 2, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: periodMs / 2, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, periodMs, value]);
  return value;
}

/** Vehicles in view; an approaching one turns the tile into a pulsing hazard sign with the side it comes from. */
function VehicleTile({ count, hazardSide, critical }: { count: number; hazardSide: Side | null; critical: boolean }) {
  const type = useType();
  const pulse = usePulse(hazardSide !== null, critical ? 400 : 800);
  const warn = hazardSide !== null;
  const color = warn ? Colors.OnHazard : Colors.OnSurface;
  return (
    <Animated.View style={{ opacity: pulse }}>
      <Tile highlight={warn ? Colors.Hazard : undefined} dim={count === 0 && !warn}>
        <MaterialIcons name="directions-car" size={ICON - 4} color={color} />
        <Text style={[type.titleMedium, styles.count, { color }]}>{count}</Text>
        {warn && (
          <View style={[styles.cornerBadge, { backgroundColor: Colors.OnHazard }]}>
            <MaterialIcons
              name={hazardSide === Side.LEFT ? 'arrow-back' : hazardSide === Side.RIGHT ? 'arrow-forward' : 'arrow-upward'}
              size={14}
              color={Colors.Hazard}
            />
          </View>
        )}
      </Tile>
    </Animated.View>
  );
}

/**
 * A small pedestrian signal head, the two-lamp kind used in Australia and Japan: the standing figure on top lights
 * red for don't walk, the walking figure below lights green for walk, both stay dark when nothing is tracked. A lit
 * lamp blinks through a flashing phase. Below the head, an arrow points toward the signal and a counter shows the
 * seconds of a walk phase it saw start. Colour from the pixel heuristic of a baseline model is marked with "?".
 */
function SignalTile({ ui }: { ui: UiState }) {
  const type = useType();
  const signal = ui.snapshot.signal;
  const phase = signal.phase;
  const walk = phase === SignalPhase.WALK || phase === SignalPhase.WALK_FLASHING;
  const dontWalk = phase === SignalPhase.DONT_WALK || phase === SignalPhase.DONT_WALK_FLASHING;
  const flashing = phase === SignalPhase.WALK_FLASHING || phase === SignalPhase.DONT_WALK_FLASHING;
  const pulse = usePulse(flashing, 700);
  const freshSeconds =
    phase === SignalPhase.WALK && signal.freshWalk && signal.phaseOnsetMs !== null
      ? Math.trunc((nowMs() - signal.phaseOnsetMs) / 1000)
      : null;
  const bearing = signal.primaryBox !== null ? ui.snapshot.aimBearingDeg : null;

  return (
    <View style={styles.lampWrap}>
      <View style={styles.head}>
        <Lamp source={STAND} color={LAMP_RED} lit={dontWalk} pulse={pulse} />
        <Lamp source={WALK_FRAMES[0]} color={LAMP_GREEN} lit={walk} pulse={pulse} />
        {!signal.trusted && phase !== SignalPhase.UNKNOWN && (
          <View style={styles.cornerBadge}>
            <Text style={[type.labelLarge, { color: '#000000' }]}>?</Text>
          </View>
        )}
      </View>
      {bearing !== null && (
        // Straight up is straight ahead; the arrow leans toward the signal.
        <View style={{ marginTop: 2, transform: [{ rotate: `${Math.max(-60, Math.min(60, bearing))}deg` }] }}>
          <MaterialIcons name="navigation" size={14} color={Colors.OnSurface} />
        </View>
      )}
      {freshSeconds !== null && <Badge color={LAMP_GREEN}>{`${freshSeconds}s`}</Badge>}
    </View>
  );
}

function Lamp({ source, color, lit, pulse }: { source: number; color: string; lit: boolean; pulse: Animated.Value }) {
  return (
    <View style={[styles.lamp, lit && { shadowColor: color, shadowOpacity: 0.9 }]}>
      <Animated.View style={{ opacity: lit ? pulse : 1 }}>
        <Image source={source} style={[styles.lampIcon, { tintColor: lit ? color : LAMP_OFF }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    alignSelf: 'flex-start',
    gap: Dimens.gapSmall,
    marginTop: Dimens.gapSmall,
  },
  tile: {
    width: TILE,
    minHeight: TILE,
    paddingVertical: 4,
    borderRadius: Dimens.radiusRow + 2,
    backgroundColor: Colors.Glass,
    borderWidth: 1,
    borderColor: Colors.Hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashed: {
    backgroundColor: 'rgba(13,18,22,0.45)',
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  count: {
    color: Colors.OnSurface,
    lineHeight: 18,
    marginTop: -2,
  },
  icon: {
    width: ICON,
    height: ICON,
  },
  overlay: {
    position: 'absolute',
  },
  cornerBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.Hazard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badge: {
    marginTop: 4,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignSelf: 'center',
  },
  lampWrap: {
    width: TILE,
    alignItems: 'center',
  },
  head: {
    width: TILE,
    paddingVertical: 5,
    gap: 3,
    borderRadius: 10,
    backgroundColor: '#050607',
    borderWidth: 2,
    borderColor: '#2A2F34',
    alignItems: 'center',
  },
  lamp: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#0E1114',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0,
  },
  lampIcon: {
    width: 30,
    height: 30,
  },
  you: {
    width: TILE,
    height: TILE,
    borderRadius: TILE / 2,
    backgroundColor: Colors.Glass,
    borderWidth: 2,
    borderColor: Colors.Accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
