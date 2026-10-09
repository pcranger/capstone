import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import { InterfaceMode } from '../settings/settings';
import { Colors, Dimens, useType } from './theme';

/** Presentation only: changing mode never issues a crossing command or changes model settings. */
export function InterfaceModeSelector({ value, onChange }: {
  value: InterfaceMode;
  onChange: (mode: InterfaceMode) => void;
}) {
  const type = useType();
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel="Interface mode">
      {[
        { mode: InterfaceMode.USER, label: 'User', hint: 'Simple controls and crossing status.' },
        { mode: InterfaceMode.DEVELOPER, label: 'Developer', hint: 'Camera overlays, model settings and diagnostics.' },
      ].map(({ mode, label, hint }) => {
        const selected = value === mode;
        return (
          <Pressable key={mode} accessibilityRole="tab" accessibilityLabel={`${label} mode`}
            accessibilityHint={hint} accessibilityState={{ selected }}
            onPress={() => { if (!selected) onChange(mode); }}
            style={[styles.option, selected && styles.selected]}>
            <Text style={[type.titleMedium, { textAlign: 'center', color: selected ? Colors.Accent : Colors.OnSurfaceMuted }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Dimens.gapSmall, padding: Dimens.gapSmall },
  option: {
    flex: 1, minHeight: Dimens.touchTarget, padding: Dimens.gapSmall,
    alignItems: 'center', justifyContent: 'center', borderRadius: Dimens.radiusRow,
    borderWidth: 2, borderColor: 'transparent',
  },
  selected: { borderColor: Colors.Accent, backgroundColor: Colors.GlassLight },
});
