import { useEffect, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { type PlaceCandidate, WALKING_WARNING } from '../nav/navigation';
import { S } from '../strings';
import { Text } from './ScaledText';
import { BigButton, TextButton, TextField } from './components';
import { Colors, useType } from './theme';

export function PlaceRow({ place, index, saved, busy, onSelect, onSave }: {
  place: Pick<PlaceCandidate, 'id' | 'name' | 'address'>; index?: number; saved: boolean; busy: boolean; onSelect?: () => void; onSave: () => void;
}) {
  const type = useType();
  return <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.Hairline, gap: 8 }}>
    <Pressable disabled={!onSelect} style={{ flex: 1, paddingVertical: 12, minHeight: 52 }} accessibilityRole={onSelect ? 'button' : 'text'}
      accessibilityLabel={`${index === undefined ? '' : `${index + 1}. `}${place.name}. ${place.address}`} onPress={onSelect}>
      <Text style={type.titleMedium}>{index === undefined ? '' : `${index + 1}. `}{place.name}</Text>
      <Text style={type.bodyMedium}>{place.address}</Text>
    </Pressable>
    <Pressable style={{ width: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center' }} disabled={busy}
      accessibilityRole="button" accessibilityLabel={saved ? `Remove ${place.name} from saved places` : `Save ${place.name}`}
      accessibilityState={{ selected: saved, disabled: busy }} onPress={onSave}>
      <MaterialIcons name={saved ? 'star' : 'star-border'} size={28} color={saved ? '#FFD87A' : Colors.OnSurface} />
    </Pressable>
  </View>;
}

export function DestinationSheet({ visible }: { visible: boolean }) {
  const type = useType();
  const s = useStore(controller.planner.state);
  const saved = useStore(controller.savedPlaces.state);
  const details = useStore(controller.savedDetails);
  const [alias, setAlias] = useState('');
  const [showAlias, setShowAlias] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [selectedId, setSelectedId] = useState(s.selected?.id);
  if (selectedId !== s.selected?.id) {
    setSelectedId(s.selected?.id); setAlias(''); setShowAlias(false); setShowSteps(false);
  }
  const savedMode = s.page === 'entry' || s.page === 'saved';
  const entries = saved.items.slice(0, s.allSaved && s.page === 'saved' ? undefined : 3);
  const ids = entries.slice(0, 3).map(p => p.placeId).join('|');
  useEffect(() => {
    if (!visible || !savedMode) return;
    const request = new AbortController(); void controller.loadSavedDetails(ids ? ids.split('|') : [], request.signal);
    return () => request.abort();
  }, [visible, savedMode, ids]);
  const expand = () => controller.presentation.update(p => ({ ...p, expanded: true }));
  const search = () => { controller.stopVoice(); Keyboard.dismiss(); expand(); void controller.planner.search(); };
  const select = (place: PlaceCandidate) => { controller.stopVoice(); Keyboard.dismiss(); expand(); controller.planner.select(place); setAlias(''); setShowAlias(false); };
  const has = (id: string) => saved.items.some(p => p.placeId === id);
  const toggle = async (place: PlaceCandidate) => { controller.stopVoice(); controller.sayNavigation(await (has(place.id) ? controller.removeSaved(place.id) : controller.savePlace(place))); };
  const button = (text: string, onPress: () => void, enabled = true, primary = false) => <BigButton text={text} onPress={() => { controller.stopVoice(); onPress(); }} multiline primary={primary} color={Colors.Crossing} enabled={enabled} />;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 8 }}>
    {s.replacing && <Text style={type.bodyMedium}>Original journey paused. Cancel to keep it.</Text>}
    <TextField label={S.fieldDestination} value={s.query} maxLength={240} accessibilityLabel="Destination name and suburb" placeholder="Where to?"
      returnKeyType="search" onSubmitEditing={search}
      onFocus={() => { controller.stopVoice(); expand(); controller.planner.edit(); }} onChangeText={text => { controller.stopVoice(); controller.planner.edit(text); }} />
    {s.page === 'entry' && !!s.query.trim() && button('Search places', search, !!s.query.trim() && !s.busy)}
    {s.busy && <View><Text accessibilityLiveRegion="polite" style={type.bodyMedium}>{s.busy === 'searching' ? 'Finding places…' : s.busy === 'details' ? 'Checking place…' : s.busy === 'routing' ? 'Finding route…' : 'Checking location…'}</Text>
      <TextButton label="Cancel request" onPress={() => { controller.stopVoice(); controller.planner.cancel(); }} /></View>}
    {s.error && <Text accessibilityRole="alert" style={[type.bodyMedium, { color: '#FFD87A' }]}>{s.error}</Text>}
    {savedMode && saved.status === 'loading' && <Text accessibilityLiveRegion="polite" style={type.bodyMedium}>Loading saved places…</Text>}
    {saved.error && <Text accessibilityRole="alert" style={type.bodyMedium}>{saved.error}</Text>}
    {savedMode && saved.status === 'error' && <TextButton label="Retry saved places" onPress={() => { void controller.savedPlaces.load(); }} />}
    {savedMode && entries.length > 0 && <>
      <Text style={[type.titleLarge, { color: Colors.Accent }]} accessibilityRole="header">{s.allSaved ? 'Saved places' : 'Recently saved'}</Text>
      {entries.map((entry, i) => {
        const place = details[entry.placeId];
        const name = entry.alias || place?.name || entry.queryLabel || `Saved place ${i + 1}`;
        return <PlaceRow key={entry.placeId} place={{ id: entry.placeId, name, address: place?.address ?? 'Open to check place details.' }}
          index={i} saved busy={saved.busy || saved.status !== 'ready'} onSelect={() => { controller.stopVoice(); expand(); void controller.planner.resolve(entry.placeId); }}
          onSave={() => { controller.stopVoice(); void controller.removeSaved(entry.placeId).then(text => controller.sayNavigation(text)); }} />;
      })}
      {saved.items.length > 3 && !s.allSaved && <TextButton label="All saved places" onPress={() => { controller.stopVoice(); expand(); controller.planner.saved(true); }} />}
    </>}
    {s.page === 'results' && s.candidates.map((place, i) => <PlaceRow key={place.id} place={place} index={i} saved={has(place.id)} busy={saved.busy || saved.status !== 'ready'}
      onSelect={() => select(place)} onSave={() => { void toggle(place); }} />)}
    {s.page === 'place' && s.selected && <>
      <PlaceRow place={s.selected} saved={has(s.selected.id)} busy={saved.busy || saved.status !== 'ready'} onSave={() => { void toggle(s.selected!); }} />
      {s.selected.unavailableReason && <Text style={type.bodyMedium}>{s.selected.unavailableReason}</Text>}
      {button('Confirm place', () => { Keyboard.dismiss(); void controller.planner.confirm(s.selected!.id); }, !s.busy && !s.selected.unavailableReason, true)}
      <TextButton label="Save with a name" onPress={() => { controller.stopVoice(); setShowAlias(v => !v); }} />
      {showAlias && <><TextField label={S.fieldPlaceName} value={alias} maxLength={160} onChangeText={setAlias} placeholder="Home, work, pharmacy…" />
        {button('Save name', () => { void controller.savePlace(s.selected!, alias).then(text => controller.sayNavigation(text)); Keyboard.dismiss(); }, !!alias.trim() && !saved.busy && saved.status === 'ready')}</>}
    </>}
    {s.page === 'route' && s.route && <>
      <Text style={type.titleLarge}>{s.route.destination}</Text><Text style={type.bodyMedium}>{s.route.destinationAddress}</Text>
      <Text style={type.bodyLarge}>{Math.round(s.route.distanceMeters)} metres · About {Math.max(1, Math.round(s.route.durationSeconds / 60))} {s.route.durationSeconds < 90 ? 'minute' : 'minutes'}</Text>
      {button('Start journey', () => { Keyboard.dismiss(); void controller.startPlannedJourney(); }, !s.busy, true)}
      <Text style={type.bodyMedium}>{WALKING_WARNING}</Text>
      {s.route.warnings.map((w, i) => <Text key={i} style={type.bodyMedium}>{w}</Text>)}
      <TextButton label={showSteps ? 'Hide route instructions' : 'Review all instructions'} onPress={() => setShowSteps(v => !v)} />
      {showSteps && s.route.steps.map((step, i) => <Text key={i} style={type.bodyMedium}>{i + 1}. {step.instruction}</Text>)}
    </>}
    {saved.undo && <TextButton label="Undo remove saved place" onPress={() => { void controller.undoSaved().then(text => controller.sayNavigation(text)); }} />}
    {(s.page !== 'entry' || s.replacing) && <TextButton label={s.replacing ? 'Cancel destination change' : 'New search'} onPress={() => {
      controller.stopVoice();
      if (s.replacing) controller.cancelPlanning(); else controller.planner.edit();
    }} />}
    {(s.candidates.length > 0 || s.selected || entries.some(p => details[p.placeId])) && <Text style={{ fontFamily: 'System', color: '#FFFFFF', fontSize: 14 }}>Google Maps</Text>}
    <Text style={type.bodyMedium}>Searches and place checks use Google Maps. Saved place IDs and your labels stay on this phone.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      <TextButton label="Google Maps terms" onPress={() => { void Linking.openURL('https://maps.google.com/help/terms_maps/'); }} />
      <TextButton label="Google privacy policy" onPress={() => { void Linking.openURL('https://policies.google.com/privacy'); }} />
    </View>
  </ScrollView>;
}
