import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { type ReactNode, useState } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  Switch,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { Text } from './ScaledText';
import { Colors, Dimens, useType } from './theme';

/** A group of related settings. One heading, one surface, rows inside — instead of a flat wall of switches. */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  const type = useType();
  return (
    <View style={styles.sectionCard}>
      <Text style={[type.labelLarge, { color: Colors.Accent }]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

/** The whole row toggles, not just the switch: a bigger target, and one announcement for VoiceOver. */
export function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const type = useType();
  return (
    <Pressable
      style={styles.row}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
    >
      <Text style={[type.titleMedium, styles.rowLabel]}>{label}</Text>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} trackColor={{ true: Colors.Accent, false: Colors.SurfaceVariant }} thumbColor="#FFFFFF" />
      </View>
    </Pressable>
  );
}

/** One choice of a set; the label can be drawn in its own style (the typeface picker shows each face). */
export function RadioRow({
  label,
  selected,
  onPress,
  labelStyle,
  trailing,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  labelStyle?: StyleProp<TextStyle>;
  trailing?: ReactNode;
}) {
  const type = useType();
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
    >
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={24}
        color={selected ? Colors.Accent : Colors.OnSurfaceMuted}
      />
      <Text style={[type.titleMedium, styles.rowLabel, { marginLeft: Dimens.gapMedium }, labelStyle]}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

/** Quiet explanatory text under a row or card. */
export function Hint({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const type = useType();
  return <Text style={[type.bodyMedium, { color: Colors.OnSurfaceMuted }, style]}>{children}</Text>;
}

/**
 * The one button style in the app. `primary` makes it taller — the button a traveler reaches for without looking
 * is physically bigger, not just a different color.
 */
export function BigButton({
  text,
  color,
  onPress,
  style,
  enabled = true,
  primary = false,
  description,
  multiline = false,
}: {
  text: string;
  color: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
  primary?: boolean;
  /** What VoiceOver says, when the visible label is shortened to fit. */
  description?: string;
  multiline?: boolean;
}) {
  const type = useType();
  // Amber is the one state color that white text cannot sit on (1.1:1); it always takes black.
  const content = color === Colors.Hazard ? Colors.OnHazard : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={description ?? text}
      accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: primary ? Dimens.primaryButton : Dimens.secondaryButton,
          backgroundColor: enabled ? color : Colors.SurfaceVariant,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text
        numberOfLines={multiline ? undefined : 1}
        style={[primary ? type.titleLarge : type.titleMedium, { color: enabled ? content : Colors.OnSurfaceMuted }]}
      >
        {text}
      </Text>
    </Pressable>
  );
}

/** A round icon button sized for a thumb: the compact control the camera-first layout needs. */
export function IconPill({
  icon,
  label,
  onPress,
  enabled = true,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  enabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [styles.iconPill, { opacity: pressed ? 0.7 : 1 }]}
    >
      <MaterialIcons name={icon} size={24} color={enabled ? Colors.OnSurface : Colors.OnSurfaceMuted} />
    </Pressable>
  );
}

/** A compact on/off chip for controls that sit over the camera, like the mask and box switches. */
export function TogglePill({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const type = useType();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      style={[
        styles.togglePill,
        {
          backgroundColor: value ? 'rgba(138,180,248,0.25)' : Colors.Glass,
          borderColor: value ? Colors.Accent : Colors.Hairline,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: value ? Colors.Accent : Colors.OnSurfaceMuted }]} />
      <Text style={[type.titleMedium, { color: value ? Colors.OnSurface : Colors.OnSurfaceMuted }]}>{label}</Text>
    </Pressable>
  );
}

/** Keeps the dragged value locally and persists it once, when the gesture (or VoiceOver adjustment) ends. */
export function SliderRow({
  label,
  value,
  min,
  max,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  const type = useType();
  const [local, setLocal] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  // Synchronise external settings before rendering children, without an extra effect/render cycle.
  if (value !== previousValue) {
    setPreviousValue(value);
    setLocal(value);
  }
  return (
    <View>
      <Text style={type.titleMedium}>{`${label}: ${format(local)}`}</Text>
      <Slider
        value={value}
        minimumValue={min}
        maximumValue={max}
        onValueChange={setLocal}
        onSlidingComplete={onCommit}
        minimumTrackTintColor={Colors.Accent}
        maximumTrackTintColor={Colors.SurfaceVariant}
        accessibilityLabel={label}
        accessibilityValue={{ text: format(local) }}
        style={{ height: 44 }}
      />
    </View>
  );
}

export function TextButton({ label, onPress, muted = false, disabled = false }: { label: string; onPress: () => void; muted?: boolean; disabled?: boolean }) {
  const type = useType();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: Dimens.gapSmall }}
    >
      <Text style={[type.labelLarge, { color: (muted || disabled) ? Colors.OnSurfaceMuted : Colors.Accent }]}>{label}</Text>
    </Pressable>
  );
}

/** Two values side by side, used for session files and route steps. */
export function StatRow({ left, right }: { left: string; right: string }) {
  const type = useType();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: Dimens.gapSmall }}>
      <Text style={[type.bodyMedium, { color: Colors.OnSurfaceMuted, flex: 1 }]}>{left}</Text>
      <Text style={[type.bodyMedium, { textAlign: 'right' }]}>{right}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  sectionCard: {
    backgroundColor: Colors.Surface,
    borderRadius: Dimens.radiusCard,
    padding: Dimens.cardPadding,
    gap: Dimens.gapSmall,
  },
  row: {
    minHeight: Dimens.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    paddingRight: Dimens.gapMedium,
  },
  button: {
    borderRadius: Dimens.radiusCard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Dimens.gapLarge,
  },
  iconPill: {
    width: Dimens.touchTarget,
    height: Dimens.touchTarget,
    borderRadius: Dimens.touchTarget / 2,
    backgroundColor: Colors.Glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  togglePill: {
    minHeight: 44,
    borderRadius: Dimens.radiusPill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Dimens.gapSmall,
    paddingHorizontal: Dimens.gapMedium,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  glassCard: {
    backgroundColor: Colors.Glass,
    borderRadius: Dimens.radiusCard,
    borderWidth: 1,
    borderColor: Colors.Hairline,
    padding: Dimens.cardPadding,
    gap: Dimens.gapSmall / 2,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.Hairline,
    borderRadius: Dimens.radiusRow,
    paddingHorizontal: Dimens.gapMedium,
    paddingVertical: Dimens.gapSmall,
    marginVertical: Dimens.gapSmall,
    backgroundColor: Colors.SurfaceVariant,
  },
});
