import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';
import { useState, type ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { Text } from './ScaledText';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { S } from '../strings';
import { BackButton, Hint, StatRow, styles, TextButton } from './components';
import { Dimens, useType } from './theme';
import { Collapsible, VoiceHelp } from './VoiceHelp';

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

      <Section title="Voice help" defaultOpen>{body(S.guideVoiceButton)}<VoiceHelp /></Section>
      <Section title={S.guideSectionSafety}>{body(S.safetyBody)}</Section>
      <Section title={S.guideSectionHolding}>{body(S.guideHolding)}</Section>

      <Section title="Map and saved places">
        {body(S.guideMapOpen)}
        {body(S.guideMapSaved)}
        {body(S.guideMapPanel)}
      </Section>

      <Section title={S.guideSectionSounds}>
        <Legend name={S.practiceSonar} meaning={S.guideSoundSonar} />
        <Legend name={S.practiceCentered} meaning={S.guideSoundCentered} />
        <Legend name={S.practiceWalk} meaning={S.guideSoundWalk} />
        <Legend name={S.practiceDontWalk} meaning={S.guideSoundStop} />
        <Legend name={S.practiceVehicleLeft} meaning={S.guideSoundAlert} />
        <Legend name={S.practiceVehicleClose} meaning={S.guideSoundCritical} />
        <Legend name={S.practiceLost} meaning={S.guideSoundLost} />
      </Section>

      <Section title={S.guideSectionHaptics}>
        {body(S.guideHapticWalk)}
        {body(S.guideHapticDont)}
        {body(S.guideHapticFlashing)}
        {body(S.guideHapticAlert)}
        {body(S.guideHapticTick)}
      </Section>

      <Section title={S.guideSectionTrouble}>
        {body(S.guideTroubleNoSignal)}
        {body(S.guideTroubleNoSound)}
        {body(S.guideTroubleSlow)}
        {body(S.guideTroubleModel)}
      </Section>

      <Section title={S.guideSectionSessions}>
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
      </Section>

      <Section title={S.guideSectionAbout}>
        {body(S.guideAboutVersion(Constants.expoConfig?.version ?? '0.1.0'))}
        {body(S.guideAboutModel(model.kind === 'ready' ? model.info.displayName : S.modelMissing))}
        <Hint>{S.guideAboutLicenses}</Hint>
        {body(S.guideAboutMaps)}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Dimens.gapMedium }}>
          <TextButton label={S.guideLinkMapsTerms} onPress={() => { void Linking.openURL('https://maps.google.com/help/terms_maps/'); }} />
          <TextButton label={S.guideLinkPrivacy} onPress={() => { void Linking.openURL('https://policies.google.com/privacy'); }} />
        </View>
      </Section>
    </ScrollView>
    </View>
  );
}

/** One collapsible card per section; only the first starts open. */
function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return <View style={styles.sectionCard}><Collapsible title={title} defaultOpen={defaultOpen}>{children}</Collapsible></View>;
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
