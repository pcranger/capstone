import { useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Pressable, ScrollView, View, type AccessibilityActionEvent } from 'react-native';
import { Text } from './ScaledText';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { Verbosity } from '../feedback/cue';
import { BUNDLED_MODEL, displayNameOf, referenceOf } from '../perception/modelLoader';
import { AppFont, InterfaceMode, type AppSettings } from '../settings/settings';
import { InterfaceModeSelector } from './InterfaceModeSelector';
import { S } from '../strings';
import { STEER } from '../text/steerText';
import { BackButton, BigButton, Hint, RadioRow, SectionCard, SliderRow, SwitchRow, TextButton } from './components';
import { Colors, Dimens, familyOf, useType } from './theme';
import { SpeechPreview } from './SpeechPreview';
import { VehicleVisibilityControls } from './VehicleVisibilityControls';
import { VoiceHelp } from './VoiceHelp';

const FONT_CHOICES: [AppFont, string][] = [
  [AppFont.MODERN, S.fontModern],
  [AppFont.CLASSIC, S.fontClassic],
  [AppFont.HYPERLEGIBLE, S.fontHyperlegible],
];

/**
 * A whole number with minus and plus buttons. For a screen reader the row is one adjustable control (swipe up or down
 * to change it); the two buttons are for touch and stay out of the reading order, like the slider's thumb.
 */
export function StepperRow({ label, valueText, value, min, max, onChange, testID }: {
  label: string; valueText: string; value: number; min: number; max: number; onChange: (v: number) => void; testID?: string;
}) {
  const type = useType();
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') step(1);
    else if (e.nativeEvent.actionName === 'decrement') step(-1);
  };
  const button = (name: 'remove' | 'add', delta: number, disabled: boolean) => (
    <Pressable testID={`${testID}-${delta > 0 ? 'up' : 'down'}`} disabled={disabled} onPress={() => step(delta)}
      accessibilityRole="button" accessibilityLabel={delta > 0 ? STEER.stepperIncrease : STEER.stepperDecrease}
      style={{ width: Dimens.touchTarget, height: Dimens.touchTarget, borderRadius: Dimens.touchTarget / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: Colors.SurfaceVariant, opacity: disabled ? 0.4 : 1 }}>
      <MaterialIcons name={name} size={24} color={Colors.OnSurface} />
    </Pressable>
  );
  return (
    <View testID={testID} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={onAction}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Dimens.gapMedium }}>
      <Text style={[type.titleMedium, { flex: 1 }]}>{`${label}: ${valueText}`}</Text>
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', gap: Dimens.gapSmall }}>
        {button('remove', -1, value <= min)}
        {button('add', 1, value >= max)}
      </View>
    </View>
  );
}

export function SettingsScreen({ onBack, onOpenGuide, onOpenPractice }: {
  onBack: () => void;
  onOpenGuide?: () => void;
  onOpenPractice?: () => void;
}) {
  const type = useType();
  const [previewOpen,setPreviewOpen]=useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [precautionsOpen, setPrecautionsOpen] = useState(false);
  const [confirmDeveloper, setConfirmDeveloper] = useState(false);
  const settings = useStore(controller.settings);
  const developer = settings.interfaceMode === InterfaceMode.DEVELOPER;
  const model = useStore(controller.model);
  const library = useStore(controller.modelLibrary);
  const update = (transform: (s: AppSettings) => AppSettings) => controller.updateSettings(transform);
  const set = <K extends keyof AppSettings>(key: K) => (value: AppSettings[K]) =>
    update((s) => ({ ...s, [key]: value }));

  /** Turning Developer on asks first (it shows test tools); turning it off, or going back to User, never does. */
  const chooseMode = (mode: InterfaceMode) => {
    if (mode === InterfaceMode.DEVELOPER) { setConfirmDeveloper(true); return; }
    setConfirmDeveloper(false); set('interfaceMode')(mode);
  };

  const importModel = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    controller.importModel(asset.uri, asset.name ?? null);
  };

  const active = settings.customModelPath;
  const modelHint = (() => {
    switch (model.kind) {
      case 'loading':
        return S.modelLoading;
      case 'missing':
        return S.modelMissing;
      case 'failed':
        return S.modelFailed(model.message);
      case 'ready': {
        const i = model.info;
        return `${i.displayName}\n${i.inputWidth}×${i.inputHeight} · ${i.format} · ${i.backend}\n${i.labels.join(', ')}`;
      }
    }
  })();

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Dimens.gapSmall, paddingHorizontal: Dimens.gutter, paddingVertical: 8 }}>
        <BackButton onPress={onBack} />
        <Text style={[type.headlineMedium, { flex: 1 }]} accessibilityRole="header">
          {S.settingsTitle}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: Dimens.gutter, gap: Dimens.gapMedium }}>
      <SectionCard title={S.settingsSectionFeedback}>
        <SwitchRow label={S.settingsSpeech} value={settings.speech} onChange={set('speech')} />
        <SwitchRow label={S.settingsTones} value={settings.tones} onChange={set('tones')} />
        <Hint>{S.warnNoHeadphones}</Hint>
        <SwitchRow label={S.settingsHaptics} value={settings.haptics} onChange={set('haptics')} />
        <SwitchRow label={STEER.settingsSteerHints} value={settings.veerGuidance} onChange={set('veerGuidance')} />
        <Hint>{STEER.settingsSteerHintsExplain}</Hint>
        <SliderRow
          label={S.settingsSpeechRate}
          value={settings.speechRate}
          min={0.6}
          max={2.0}
          format={(v) => `${v.toFixed(1)}×`}
          onCommit={set('speechRate')}
        />
        <Text style={[type.titleMedium, { marginTop: Dimens.gapSmall }]}>{S.settingsVerbosity}</Text>
        <View accessibilityRole="radiogroup">
        {[
          [Verbosity.MINIMAL, S.verbosityMinimal],
          [Verbosity.NORMAL, S.verbosityNormal],
          [Verbosity.DETAILED, S.verbosityDetailed],
        ].map(([level, label]) => (
          <RadioRow
            key={level}
            label={label}
            selected={settings.verbosity === level}
            onPress={() => set('verbosity')(level as Verbosity)}
          />
        ))}
        </View>
      </SectionCard>

      <SectionCard title={STEER.settingsSectionCrossingCheck}>
        <StepperRow label={STEER.settingsHoldName} valueText={STEER.settingsHoldValue(settings.holdSeconds)} value={settings.holdSeconds} min={3} max={8}
          onChange={set('holdSeconds')} testID="stepper-hold" />
        <StepperRow label={STEER.settingsRoadName} valueText={STEER.settingsRoadValue(settings.roadLanes)} value={settings.roadLanes} min={1} max={4}
          onChange={set('roadLanes')} testID="stepper-lanes" />
      </SectionCard>

      <SectionCard title={S.settingsSectionDisplay}>
        <Text style={type.titleMedium}>{S.settingsFont}</Text>
        <View accessibilityRole="radiogroup">
          {FONT_CHOICES.map(([font, label]) => (
            <RadioRow
              key={font}
              label={label}
              selected={settings.appFont === font}
              onPress={() => set('appFont')(font)}
              labelStyle={{ fontFamily: familyOf(font) }}
            />
          ))}
        </View>
        <SwitchRow label={S.settingsLargeStatus} value={settings.largeStatus} onChange={set('largeStatus')} />
        {developer && <>
          <SwitchRow label={S.settingsPreview} value={settings.showPreview} onChange={set('showPreview')} />
          <SwitchRow label={S.settingsOverlay} value={settings.showOverlay} onChange={set('showOverlay')} />
        </>}
      </SectionCard>

      {(onOpenGuide || onOpenPractice) && (
        <SectionCard title={S.settingsSectionHelp}>
          {onOpenGuide && <TextButton label={S.settingsOpenGuide} onPress={onOpenGuide} />}
          {onOpenPractice && <TextButton label={S.practiceTitle} onPress={onOpenPractice} />}
        </SectionCard>
      )}

      <SectionCard title="Manual">
        <Pressable accessibilityRole="button" accessibilityLabel="Commands and voice setup" accessibilityState={{ expanded: manualOpen }}
          onPress={() => setManualOpen(v => !v)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={type.titleMedium}>Commands and voice setup</Text>
          <MaterialIcons name={manualOpen ? 'expand-less' : 'expand-more'} size={24} color={Colors.OnSurface} />
        </Pressable>
        {manualOpen && <VoiceHelp />}
      </SectionCard>
      <SectionCard title="Precautions and limitations">
        <Pressable accessibilityRole="button" accessibilityLabel="Read limitations" accessibilityState={{ expanded: precautionsOpen }}
          onPress={() => setPrecautionsOpen(v => !v)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={type.titleMedium}>Read limitations</Text>
          <MaterialIcons name={precautionsOpen ? 'expand-less' : 'expand-more'} size={24} color={Colors.OnSurface} />
        </Pressable>
        {precautionsOpen && <>
        <Text style={type.bodyMedium}>{S.safetyBody}</Text>
        <Text style={type.bodyMedium}>Stereo headphones separate left and right tones. Phone speakers may play both together.</Text>
        {model.kind === 'ready' && !model.info.hasPedestrianSignalClasses && <Text style={type.bodyMedium}>{S.warnBaselineModel}</Text>}
        </>}
      </SectionCard>
      <SectionCard title={S.settingsSectionAdvanced}>
        <InterfaceModeSelector value={settings.interfaceMode} onChange={chooseMode} />
        {confirmDeveloper && <View style={{ gap: Dimens.gapSmall }}>
          <Text accessibilityLiveRegion="polite" style={type.titleMedium}>{S.developerConfirm}</Text>
          <View style={{ flexDirection: 'row', gap: Dimens.gapSmall }}>
            <BigButton text={S.developerTurnOn} color={Colors.Crossing} style={{ flex: 1 }}
              onPress={() => { setConfirmDeveloper(false); set('interfaceMode')(InterfaceMode.DEVELOPER); }} />
            <BigButton text={S.developerCancel} color={Colors.SurfaceVariant} style={{ flex: 1 }} onPress={() => setConfirmDeveloper(false)} />
          </View>
        </View>}
      </SectionCard>

      {developer && <SectionCard title="Vehicle boxes">
        <Hint>Tap an icon to show or hide that motion state. A slash means hidden. Alerts are unchanged.</Hint>
        <VehicleVisibilityControls />
      </SectionCard>}
      {developer && <SectionCard title="Speech preview">
        <TextButton label={previewOpen?'Close speech preview':'Open speech preview'} onPress={()=>setPreviewOpen(v=>!v)} />
        {previewOpen && <SpeechPreview />}
      </SectionCard>}

      {developer && <SectionCard title={S.settingsSectionGuidance}>
        <SwitchRow label={S.settingsAimSonar} value={settings.aimSonar} onChange={set('aimSonar')} />
        <Hint>{STEER.developerNote}</Hint>
        <SwitchRow label={S.settingsVehicleAlerts} value={settings.vehicleAlerts} onChange={set('vehicleAlerts')} />
        <SwitchRow label={S.settingsAutoCrossing} value={settings.autoDetectCrossing} onChange={set('autoDetectCrossing')} />
        <Hint>Automatic crossing detection is experimental: Developer camera assistance only, never in User mode.</Hint>
      </SectionCard>}

      {developer && (
        <>
      <SectionCard title={S.settingsSectionDetection}>
        <SwitchRow label={S.settingsGpu} value={settings.useGpu} onChange={set('useGpu')} />
        <SliderRow
          label={S.settingsThreshold}
          value={settings.scoreThreshold}
          min={0.2}
          max={0.7}
          format={(v) => v.toFixed(2)}
          onCommit={set('scoreThreshold')}
        />
      </SectionCard>

      <SectionCard title={S.settingsSectionModel}>
        {/* A library, not a single slot: comparing the trained detector with a baseline is the whole point of
            being able to load another one. */}
        {library.map((source) => {
          const ref = referenceOf(source);
          const name = displayNameOf(source);
          const selected = active === ref || (active === null && name === BUNDLED_MODEL);
          const kind = name.startsWith('crosswise')
            ? S.modelKindTrained
            : source.kind === 'asset'
              ? S.modelKindCoco
              : S.modelKindImported;
          return (
            <View key={ref}>
              <RadioRow
                label={name}
                selected={selected}
                onPress={() => controller.selectModel(source)}
                trailing={
                  source.kind === 'file' ? (
                    <TextButton label={S.settingsModelDelete} muted onPress={() => controller.deleteModel(source)} />
                  ) : undefined
                }
              />
              <Hint style={{ marginLeft: 36, marginTop: -Dimens.gapSmall }}>{kind}</Hint>
            </View>
          );
        })}
        <Hint>{modelHint}</Hint>
        <BigButton
          text={S.settingsImportModel}
          color={Colors.Crossing}
          onPress={importModel}
          style={{ marginTop: Dimens.gapSmall }}
        />
      </SectionCard>

      <SectionCard title={S.settingsSectionData}>
        <SwitchRow label={S.settingsLog} value={settings.logSessions} onChange={set('logSessions')} />
        <Hint>{S.settingsLogLocation}</Hint>
      </SectionCard>
        </>
      )}
      </ScrollView>
    </View>
  );
}
