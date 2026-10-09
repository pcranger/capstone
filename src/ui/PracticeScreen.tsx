import { VoiceCheck } from './VoiceCheck';
import { ScrollView, View } from 'react-native';
import { Text } from './ScaledText';
import { controller } from '../state/controller';
import { type Cue, Cues, HapticPattern, Phrase, Priority, ToneKind } from '../feedback/cue';
import { S } from '../strings';
import { BigButton, Hint, SectionCard, TextButton } from './components';
import { Colors, Dimens, useType } from './theme';

/**
 * Every cue the app can produce, on demand, indoors.
 *
 * A traveler cannot learn what a rising chime versus a falling tone means while standing at a live curb — that is
 * the one place where getting it wrong is expensive. This screen is the rehearsal room, and it drives the real
 * feedback engine, not a recording, so what is learned here is exactly what is heard out there.
 */
export function PracticeScreen({ onBack }: { onBack?: () => void }) {
  const type = useType();
  return (
    <ScrollView contentContainerStyle={{ padding: Dimens.gutter, gap: Dimens.gapMedium }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[type.headlineMedium, { flex: 1 }]} accessibilityRole="header">
          {S.practiceTitle}
        </Text>
        {onBack && <TextButton label={S.actionBackToSettings} onPress={onBack} />}
      </View>
      <Hint>{S.practiceIntro}</Hint>

      <SectionCard title="Voice check"><VoiceCheck /></SectionCard>

      <SectionCard title={S.practiceSignals}>
        <Hint>Demonstration sounds. Live pedestrian signal recognition requires a suitable model.</Hint>
        <Practice label={S.practiceWalk} color={Colors.Walk}>
          {[Cues.speak(Phrase.WALK_STARTED, Priority.HIGH), Cues.tone(ToneKind.WALK_CHIME), Cues.haptic(HapticPattern.WALK)]}
        </Practice>
        <Practice label={S.practiceWalkOld} color={Colors.Caution}>
          {[Cues.speak(Phrase.WALK_ALREADY_ON, Priority.HIGH), Cues.haptic(HapticPattern.WALK)]}
        </Practice>
        <Practice label={S.practiceFlashing} color={Colors.Caution}>
          {[Cues.speak(Phrase.WALK_FLASHING, Priority.HIGH), Cues.haptic(HapticPattern.FLASHING)]}
        </Practice>
        <Practice label={S.practiceDontWalk} color={Colors.DontWalk}>
          {[Cues.speak(Phrase.DONT_WALK, Priority.NORMAL), Cues.tone(ToneKind.STOP), Cues.haptic(HapticPattern.DONT_WALK)]}
        </Practice>
        <Practice label={S.practiceLost} color={Colors.Unknown}>
          {[Cues.speak(Phrase.SIGNAL_LOST, Priority.NORMAL), Cues.tone(ToneKind.LOST), Cues.haptic(HapticPattern.LOST)]}
        </Practice>
      </SectionCard>

      <SectionCard title={S.practiceHazards}>
        <Practice label={S.practiceVehicleLeft} color={Colors.Hazard}>
          {[
            Cues.speak(Phrase.VEHICLE_LEFT, Priority.HIGH),
            Cues.tone(ToneKind.ALERT, -1),
            Cues.haptic(HapticPattern.ALERT),
          ]}
        </Practice>
        <Practice label={S.practiceVehicleAhead} color={Colors.Hazard}>
          {[Cues.speak(Phrase.VEHICLE_AHEAD, Priority.HIGH), Cues.tone(ToneKind.ALERT)]}
        </Practice>
        <Practice label={S.practiceVehicleRight} color={Colors.Hazard}>
          {[
            Cues.speak(Phrase.VEHICLE_RIGHT, Priority.HIGH),
            Cues.tone(ToneKind.ALERT, 1),
            Cues.haptic(HapticPattern.ALERT),
          ]}
        </Practice>
        <Practice label={S.practiceVehicleClose} color={Colors.DontWalk}>
          {[
            Cues.speak(Phrase.VEHICLE_CLOSE_LEFT, Priority.CRITICAL),
            Cues.tone(ToneKind.CRITICAL, -1),
            Cues.haptic(HapticPattern.CRITICAL),
          ]}
        </Practice>
      </SectionCard>

      <SectionCard title={S.practiceGuidance}>
        <Practice label={S.practiceSonar} color={Colors.Crossing}>
          {[Cues.tone(ToneKind.SONAR, -0.6), Cues.tone(ToneKind.SONAR, 0.6)]}
        </Practice>
        <Practice label={S.practiceCentered} color={Colors.Crossing}>
          {[
            Cues.speak(Phrase.SIGNAL_CENTERED, Priority.NORMAL),
            Cues.tone(ToneKind.CENTERED),
            Cues.haptic(HapticPattern.CENTERED_TICK),
          ]}
        </Practice>
        <Hint>Turning the phone does not establish walking drift. Steering cues are disabled.</Hint>
        <Practice label={S.practiceCrossing} color={Colors.Crossing}>
          {[Cues.speak(Phrase.CROSSING_STARTED, Priority.HIGH)]}
        </Practice>
      </SectionCard>
    </ScrollView>
  );
}

function Practice({ label, color, children }: { label: string; color: string; children: Cue[] }) {
  return <BigButton text={label} color={color} onPress={() => controller.practice(children)} />;
}
