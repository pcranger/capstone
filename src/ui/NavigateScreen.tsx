import { useState } from 'react';
import { Linking, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { Text } from './ScaledText';
import { WALKING_WARNING } from '../nav/navigation';
import { services } from '../config/services';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { BigButton, Hint, SectionCard, TextButton, styles } from './components';
import { Colors, Dimens, useType } from './theme';

/** Text-first route guidance: a confirmed place, a reviewable route, then one instruction at a time. */
export function NavigateScreen({ onStarted, onBack, embedded = false, onExpand }: { onStarted: () => void; onBack: () => void; embedded?: boolean; onExpand?: () => void }) {
  const type = useType();
  const { fontScale } = useWindowDimensions();
  const s = useStore(controller.journey.state);
  const [destination, setDestination] = useState('');
  const [showSteps, setShowSteps] = useState(false);
  const active = s.phase === 'walking' || s.phase === 'paused';
  const configured = services.mapsRestApiKey.trim().length > 0;
  const route = s.route;
  const search = () => { if (configured && !s.busy && destination.trim()) { onExpand?.(); void controller.journey.search(destination); } };
  const button = (text: string, action: () => void, primary = false, enabled = true) =>
    <BigButton text={text} onPress={action} primary={primary} enabled={enabled} multiline color={primary ? Colors.Crossing : Colors.SurfaceVariant} />;

  return (
    <ScrollView contentContainerStyle={{ padding: Dimens.gutter, gap: Dimens.gapMedium }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {!embedded && <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={[type.headlineMedium, { flex: 1 }]} accessibilityRole="header">Destination</Text><TextButton label="Back to journey" onPress={() => { if (s.busy) controller.journey.pause(); onBack(); }} /></View>}
      {!embedded && !active && s.phase !== 'arrived' && <Hint>Choose a place and check its address. Start once for the whole journey. At a road, open Crossing help; route speech resumes after you confirm you are on the footpath.</Hint>}
      {!configured && <SectionCard title="Walking routes unavailable">
        <Text style={type.bodyLarge}>This build is not configured for walking routes. You can still use camera assistance.</Text>

      </SectionCard>}
      {!active && s.phase !== 'arrived' && <SectionCard title="Destination">
        <TextInput key={fontScale} value={destination} onChangeText={setDestination} onFocus={onExpand} style={[type.bodyLarge, styles.input]}
          accessibilityLabel="Destination name and suburb" placeholder="Place name and suburb" placeholderTextColor={Colors.OnSurfaceMuted}
          returnKeyType="search" editable={!s.busy} onSubmitEditing={search} />
        {button('Search places', search, true, configured && !!destination.trim() && !s.busy)}
      </SectionCard>}
      {s.busy && <View accessibilityLiveRegion="polite">
        <Text style={type.bodyLarge}>{s.busy === 'searching' ? 'Finding matching places…' : s.busy === 'routing' ? 'Finding a walking route…' : 'Checking location and starting guidance…'}</Text>
        {button('Cancel request', () => { if (active) controller.pauseJourney(); else controller.journey.end(); })}
      </View>}
      {s.error && <Text style={type.bodyLarge} accessibilityRole="alert">{s.error}</Text>}
      {!active && !route && s.candidates.length > 0 && <SectionCard title="Choose the correct place">
        <GoogleAttribution />
        {s.candidates.map(place => <BigButton key={place.id} text={`${place.name}\n${place.address}`} multiline
          color={Colors.SurfaceVariant} enabled={!s.busy} onPress={() => { onExpand?.(); void controller.journey.select(place); }} />)}
      </SectionCard>}
      {route && !active && s.phase !== 'arrived' && <SectionCard title="Review your route">
        <GoogleAttribution />
        <Text style={type.titleLarge}>{route.destination}</Text>
        <Text style={type.bodyLarge}>{route.destinationAddress}</Text>
        <Text style={type.bodyLarge}>{Math.round(route.distanceMeters)} metres · About {Math.max(1, Math.round(route.durationSeconds / 60))} {route.durationSeconds < 90 ? 'minute' : 'minutes'}</Text>
        <Text style={type.bodyLarge}>{WALKING_WARNING}</Text>
        {route.warnings.map((warning, i) => <Text key={`${i}:${warning}`} style={type.bodyLarge}>{warning}</Text>)}
        <Hint>Distances are approximate. Confirm when each route instruction is complete; GPS will not skip instructions. Keep the app open for guidance.</Hint>
        <Text style={type.bodyLarge}>First instruction: {route.steps[0].instruction}</Text>
        {button('Start journey', () => { void controller.startJourney().then(() => { if (controller.journey.running) onStarted(); }); }, true, !s.busy)}
        {button(showSteps ? 'Hide route instructions' : 'Review all instructions', () => setShowSteps(!showSteps))}
        {showSteps && route.steps.map((step, i) => <Text key={`${i}:${step.instruction}`} style={type.bodyLarge}>{i + 1}. {step.instruction} · {Math.round(step.distanceMeters)} m</Text>)}
        {button('Choose another place', () => controller.journey.end(), false, !s.busy)}
      </SectionCard>}
      {s.phase === 'arrived' && <SectionCard title="Journey completed">
        <Text style={type.bodyLarge}>You confirmed arrival at {route?.destination}.</Text>
        {button('Plan another journey', () => controller.journey.end(), true)}
      </SectionCard>}
      {(route || s.candidates.length > 0) && <Hint>Only route and place information above is provided by Google Maps. Crossing assistance uses the phone camera.</Hint>}
      <Hint>Search sends your destination query and current location to Google Maps to find a walking route. The app keeps routes in memory until the journey is ended or the app closes.</Hint>
      <Text style={type.bodyMedium} accessibilityRole="link" onPress={() => { void Linking.openURL('https://maps.google.com/help/terms_maps/'); }}>Google Maps terms</Text>
      <Text style={type.bodyMedium} accessibilityRole="link" onPress={() => { void Linking.openURL('https://policies.google.com/privacy'); }}>Google privacy policy</Text>
    </ScrollView>
  );
}
function GoogleAttribution() {
  return <Text style={{ fontFamily: 'System', fontWeight: '400', color: '#FFFFFF', fontSize: 14 }} numberOfLines={1}>Google Maps</Text>;
}
