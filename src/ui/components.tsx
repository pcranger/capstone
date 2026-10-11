import { MaterialIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { type ReactNode, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type StyleProp,
  StyleSheet,
  Switch,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { S } from '../strings';
import { Text } from './ScaledText';
import { Colors, Dimens, useType } from './theme';
import { useReducedMotion } from './useReducedMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * J17: press feedback for buttons. Scales to 0.97 over 120 ms ease-out and dips to 0.8 opacity; with Reduce Motion the
 * scale is skipped and only the opacity dip remains, applied at once.
 */
function usePressFeedback() {
  const reduceMotion = useReducedMotion();
  const [pressed] = useState(() => new Animated.Value(0));
  const to = (toValue: number) => {
    if (reduceMotion) pressed.setValue(toValue);
    else Animated.timing(pressed, { toValue, duration: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };
  return {
    onPressIn: () => to(1),
    onPressOut: () => to(0),
    style: {
      opacity: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] }),
      transform: reduceMotion ? [] : [{ scale: pressed.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }],
    },
  };
}

/** A group of related settings. One heading, one surface, rows inside — instead of a flat wall of switches. */
export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  const type = useType();
  return (
    <View style={styles.sectionCard}>
      <Text style={[type.titleLarge, { color: Colors.Accent }]} accessibilityRole="header">
        {title}
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
      {/* The word, not only the position and colour, carries the state (the track edge alone is under 3:1). */}
      <Text
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[type.titleMedium, styles.stateWord, { color: value ? Colors.OnSurface : Colors.OnSurfaceMuted }]}
      >
        {value ? S.stateOn : S.stateOff}
      </Text>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} trackColor={{ true: Colors.Accent, false: Colors.OnSurfaceMuted }} thumbColor="#FFFFFF" />
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

/** Wraps one set of RadioRows so TalkBack can say "1 of 3" and treat them as a group. */
export function RadioGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {children}
    </View>
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
  hint,
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
  /** What TalkBack adds after the name (for example, that a practice button is not a live signal). */
  hint?: string;
  multiline?: boolean;
}) {
  const type = useType();
  const feedback = usePressFeedback();
  // Amber is the one state color that white text cannot sit on (1.1:1); it always takes black.
  const content = color === Colors.Hazard ? Colors.OnHazard : '#FFFFFF';
  // A quiet (SurfaceVariant) button is 1.3:1 against the dock, so it gets a 2 dp outline. A disabled one loses its
  // fill and gets a dashed outline at half strength, so "off" is a shape, not just a shade.
  const quiet = color === Colors.SurfaceVariant;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={description ?? text}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !enabled }}
      style={[
        styles.button,
        {
          minHeight: primary ? Dimens.primaryButton : Dimens.secondaryButton,
          backgroundColor: enabled ? color : 'transparent',
          borderColor: enabled && !quiet ? color : Colors.OnSurfaceMuted,
          borderStyle: enabled ? 'solid' : 'dashed',
        },
        style,
        enabled ? feedback.style : { opacity: 0.5 },
      ]}
    >
      <Text
        numberOfLines={multiline ? undefined : 1}
        style={[primary ? type.titleLarge : type.titleMedium, { color: enabled ? content : Colors.OnSurfaceMuted }]}
      >
        {text}
      </Text>
    </AnimatedPressable>
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
  const feedback = usePressFeedback();
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={[styles.iconPill, feedback.style]}
    >
      <MaterialIcons name={icon} size={24} color={enabled ? Colors.OnSurface : Colors.OnSurfaceMuted} />
    </AnimatedPressable>
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
        style={{ height: Dimens.touchTarget }}
      />
    </View>
  );
}

/** Link-style action. 48 dp by default; `size="large"` gives the 56 dp the journey screen asks for. */
export function TextButton({
  label,
  onPress,
  muted = false,
  disabled = false,
  size = 'default',
}: {
  label: string;
  onPress: () => void;
  muted?: boolean;
  disabled?: boolean;
  size?: 'default' | 'large';
}) {
  const type = useType();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        minHeight: size === 'large' ? Dimens.touchTarget : Dimens.secondaryButton,
        justifyContent: 'center',
        paddingHorizontal: Dimens.gapSmall,
      }}
    >
      <Text style={[type.titleMedium, { color: muted || disabled ? Colors.OnSurfaceMuted : Colors.Accent }]}>{label}</Text>
    </Pressable>
  );
}

/** The way out of a page: arrow plus word, 56 dp, top left. Pair it with the hardware back key, never replace it. */
export function BackButton({ onPress, label = S.actionBack }: { onPress: () => void; label?: string }) {
  const type = useType();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={styles.backButton}
    >
      <MaterialIcons name="arrow-back" size={24} color={Colors.Accent} />
      <Text style={[type.titleMedium, { color: Colors.Accent }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A text box with its name written above it. The visible word is the accessibility label (or starts it), so a
 * Voice Access user can say what they see and a TalkBack user hears the same word.
 */
export function TextField({ label, accessibilityLabel, style, ...rest }: { label: string } & TextInputProps) {
  const type = useType();
  return (
    <View>
      <Text importantForAccessibility="no" style={[type.bodyMedium, { color: Colors.OnSurfaceMuted }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        placeholderTextColor={Colors.OnSurfaceMuted}
        style={[type.bodyLarge, styles.input, style]}
        {...rest}
      />
    </View>
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
  stateWord: {
    minWidth: 32,
    textAlign: 'right',
    marginRight: Dimens.gapMedium,
  },
  backButton: {
    minHeight: Dimens.touchTarget,
    minWidth: Dimens.touchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Dimens.gapSmall,
    paddingRight: Dimens.gapMedium,
  },
  button: {
    borderWidth: 2,
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
    minHeight: 48,
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
    minHeight: Dimens.touchTarget,
    fontSize: 20,
    lineHeight: 26,
    borderWidth: 1,
    borderColor: Colors.Hairline,
    borderRadius: Dimens.radiusRow,
    paddingHorizontal: Dimens.gapMedium,
    paddingVertical: Dimens.gapSmall,
    marginVertical: Dimens.gapSmall,
    backgroundColor: Colors.SurfaceVariant,
  },
});
