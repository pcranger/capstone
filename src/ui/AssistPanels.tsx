import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import CrossWiseNative from '../../modules/crosswise-native';
import type { ModelState, UiState } from '../state/controller';
import { AssistMode } from '../crossing/crossingEngine';
import { S } from '../strings';
import { Colors, Dimens, useType } from './theme';

function usePolled<T>(initial: T, read: () => T | Promise<T>, intervalMs: number): T {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      Promise.resolve(read())
        .then((v) => alive && setValue(v))
        .catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [read, intervalMs]);
  return value;
}

const readHeadphones = () => CrossWiseNative?.headphonesConnected() ?? true;
const readBattery = () => CrossWiseNative?.batteryPercent() ?? Promise.resolve(100);

/** Headphones and battery, polled. Shared by the full WarningsPanel and the slim line on the camera screen (UI P3e J16). */
export function useDeviceState() {
  return { headphones: usePolled(true, readHeadphones, 4_000), battery: usePolled(100, readBattery, 60_000) };
}

export function deviceWarnings({ headphones, battery }: { headphones: boolean; battery: number }): [string, string][] {
  const out: [string, string][] = [];
  if (!headphones) out.push(['headphones', S.warnNoHeadphones]);
  if (battery <= 20) out.push(['battery', S.warnBattery(battery)]);
  return out;
}

/**
 * Conditions that quietly break detection. A covered lens or a dark street looks exactly like "nothing detected",
 * so the app has to say which one it is rather than report an empty, confident-looking scene.
 */
export function WarningsPanel({
  ui,
  model,
  expanded,
  dismissed,
  onDismiss,
  dismissible = true,
}: {
  ui: UiState;
  model: ModelState;
  expanded: boolean;
  dismissed: Set<string>;
  onDismiss: (id: string) => void;
  dismissible?: boolean;
}) {
  const type = useType();
  const assistOn = ui.snapshot.mode !== AssistMode.IDLE;
  const device = useDeviceState();

  // Each warning has a stable id so dismissing one does not silence the others, and a warning that comes back
  // (the lens is covered again) is a new event rather than something already waved away.
  const all: [string, string][] = [];
  if (assistOn && ui.frameBrightness < 0.04) all.push(['covered', S.warnCovered]);
  else if (assistOn && ui.frameBrightness < 0.12) all.push(['dark', S.warnDark]);
  if (ui.snapshot.pitchDeg !== null && ui.snapshot.pitchDeg < -45) all.push(['tilt', S.warnTilt]);
  if (assistOn && ui.fps >= 0.1 && ui.fps <= 8) all.push(['slow', S.warnSlow(ui.fps)]);
  all.push(...deviceWarnings(device));
  if (model.kind === 'ready' && !model.info.hasPedestrianSignalClasses) all.push(['baseline', S.warnBaselineModel]);
  const warnings = all.filter(([id]) => !dismissed.has(id));
  if (warnings.length === 0) return null;

  // Collapsed, it is one line that says how many checks failed; open, it lists them. Either way it is
  // never silently hidden.
  const shown = expanded ? warnings : warnings.slice(0, 1);
  return (
    <View style={styles.warnings}>
      {expanded && (
        <Text style={[type.labelLarge, { color: '#FFFFFF' }]}>
          {`${S.warnTitle.toUpperCase()}${dismissible ? `  ·  ${S.warnTapToDismiss}` : ''}`}
        </Text>
      )}
      {shown.map(([id, text]) => (
        <Pressable
          key={id}
          onPress={dismissible ? () => onDismiss(id) : undefined}
          accessible
          accessibilityRole={dismissible ? 'button' : 'text'}
          accessibilityLabel={dismissible ? `${text} ${S.warnTapToDismiss}` : text}
          style={styles.warningRow}
        >
          {!expanded && warnings.length > 1 && (
            <Text style={[type.labelLarge, { color: '#FFFFFF' }]}>{warnings.length}</Text>
          )}
          <Text style={[type.bodyMedium, { color: '#FFFFFF', flex: 1 }]} numberOfLines={expanded ? undefined : 1}>
            {text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  warnings: {
    backgroundColor: Colors.Caution,
    borderRadius: Dimens.radiusCard,
    paddingHorizontal: Dimens.cardPadding,
    paddingVertical: Dimens.gapSmall,
    gap: Dimens.gapSmall / 2,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Dimens.gapSmall,
    paddingVertical: Dimens.gapSmall / 2,
    minHeight: 32,
  },
});
