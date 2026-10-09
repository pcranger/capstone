import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from './ScaledText';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { S } from '../strings';
import { Hint, SectionCard, StatRow, TextButton } from './components';
import { Dimens, useType } from './theme';
import { BackButton } from './SettingsScreen';
import { VoiceHelp } from './VoiceHelp';

/**
 * Everything the app knows that is not a live reading: how to hold the phone, what each sound and vibration means,
 * what to do when something is wrong, what was recorded, and what this software actually is.
 *
 * A cue vocabulary that exists only in a manual nobody has is a cue vocabulary nobody knows.
 */
export function GuideScreen({ onBack }: { onBack?: () => void }) {
  const type = useType();
  const model = useStore(controller.model);
  // Read when the tab opens: the Guide is mounted fresh each time it is shown.
  const [sessions] = useState(() => controller.logger.sessions());

  const body = (text: string) => <Text style={type.bodyMedium}>{text}</Text>;

  return (
    <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Dimens.gapSmall, paddingHorizontal: Dimens.gutter, paddingVertical: 8 }}>
      {onBack && <BackButton label={S.actionBackToSettings} onPress={onBack} />}
      <Text style={[type.headlineMedium, { flex: 1 }]} accessibilityRole="header">
        {S.guideTitle}
      </Text>
    </View>
    <ScrollView contentContainerStyle={{ padding: Dimens.gutter, gap: Dimens.gapMedium }}>

      <SectionCard title="Voice help"><VoiceHelp /></SectionCard>
      <SectionCard title={S.guideSectionSafety}>{body(S.safetyBody)}</SectionCard>
      <SectionCard title={S.guideSectionHolding}>{body(S.guideHolding)}</SectionCard>

      <SectionCard title="Map and saved places">
        {body('Open the map with the bottom arrow. Search in the bottom panel, or choose a saved place. Review the address, Confirm place, then Start journey.')}
        {body('Tap a result’s star to save it. Focus the destination box for your three latest saves; All saved shows the rest. Save with a name adds an optional label.')}
        {body('Drag the panel handle up or down, or use Expand and Collapse. The inward arrows return to the camera. Map controls do not change your journey.')}
      </SectionCard>

      <SectionCard title={S.guideSectionSounds}>
        <Legend name={S.practiceSonar} meaning={S.guideSoundSonar} />
        <Legend name={S.practiceCentered} meaning={S.guideSoundCentered} />
        <Legend name={S.practiceWalk} meaning={S.guideSoundWalk} />
        <Legend name={S.practiceDontWalk} meaning={S.guideSoundStop} />
        <Legend name={S.practiceVehicleLeft} meaning={S.guideSoundAlert} />
        <Legend name={S.practiceVehicleClose} meaning={S.guideSoundCritical} />
        <Legend name={S.practiceLost} meaning={S.guideSoundLost} />
      </SectionCard>

      <SectionCard title={S.guideSectionHaptics}>
        {body(S.guideHapticWalk)}
        {body(S.guideHapticDont)}
        {body(S.guideHapticFlashing)}
        {body(S.guideHapticAlert)}
        {body(S.guideHapticTick)}
      </SectionCard>

      <SectionCard title={S.guideSectionTrouble}>
        {body(S.guideTroubleNoSignal)}
        {body(S.guideTroubleNoSound)}
        {body(S.guideTroubleSlow)}
        {body(S.guideTroubleModel)}
      </SectionCard>

      <SectionCard title={S.guideSectionSessions}>
        {sessions.length === 0 ? (
          <Hint>{S.guideSessionsEmpty}</Hint>
        ) : (
          <>
            <Hint>{S.guideSessionsCount(sessions.length)}</Hint>
            {sessions.slice(0, 5).map((f) => (
              <View key={f.uri} style={{ flexDirection: 'row', alignItems: 'center', gap: Dimens.gapSmall }}>
                <View style={{ flex: 1 }}>
                  <StatRow left={f.name} right={`${f.sizeKb} kB`} />
                </View>
                {/* Sends a CSV somewhere useful (Mail, Files, AirDrop) to compare with the video of a session. */}
                <TextButton
                  label={S.guideShare}
                  onPress={() => Sharing.shareAsync(f.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' })}
                />
              </View>
            ))}
          </>
        )}
      </SectionCard>

      <SectionCard title={S.guideSectionAbout}>
        {body(S.guideAboutVersion(Constants.expoConfig?.version ?? '0.1.0'))}
        {body(S.guideAboutModel(model.kind === 'ready' ? model.info.displayName : S.modelMissing))}
        <Hint>{S.guideAboutLicenses}</Hint>
      </SectionCard>
    </ScrollView>
    </View>
  );
}

function Legend({ name, meaning }: { name: string; meaning: string }) {
  const type = useType();
  return (
    <View style={{ paddingVertical: Dimens.gapSmall / 2 }} accessible>
      <Text style={type.titleMedium}>{name}</Text>
      <Hint>{meaning}</Hint>
    </View>
  );
}
