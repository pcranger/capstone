import { useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Text } from './ScaledText';
import { type Image, Images, NitroImage } from 'react-native-nitro-image';
import type { MaskImage } from '../state/controller';
import type { EngineSnapshot } from '../crossing/crossingEngine';
import { isVehicle, ObjectCategory } from '../perception/detection';
import { SEG_COLORS, SEG_LABELS } from '../perception/segmentation';
import { S } from '../strings';
import { Colors, Dimens, useType } from './theme';
import { type VehicleVisibility, visibleVehicle } from './vehicleVisibility';
import { containRect, coverRect } from './previewGeometry';

function useLayout(): [{ width: number; height: number }, (e: LayoutChangeEvent) => void] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  return [size, (e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })];
}

function colorOf(category: ObjectCategory): string {
  switch (category) {
    case ObjectCategory.PED_WALK:
      return '#00E676';
    case ObjectCategory.PED_DONT_WALK:
      return '#FF5252';
    case ObjectCategory.TRAFFIC_LIGHT:
    case ObjectCategory.PED_COUNTDOWN:
      return '#FFD600';
    case ObjectCategory.CROSSWALK:
      return '#FFFFFF';
    case ObjectCategory.PERSON:
      return '#E040FB';
    default:
      return isVehicle(category) ? '#00E5FF' : '#9E9E9E';
  }
}

/** Draws tracked objects over the center-cropped preview (same crop as the preview's "cover"). */
export function DetectionOverlay({ snapshot, frameAspect, resizeMode = 'cover', visibility }: {
  snapshot: EngineSnapshot; frameAspect: number; resizeMode?: 'cover' | 'contain'; visibility?:VehicleVisibility;
}) {
  const type = useType();
  const [size, onLayout] = useLayout();
  const rect = size.width > 0 ? (resizeMode === 'contain' ? containRect : coverRect)(size.width, size.height, frameAspect) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout} accessibilityElementsHidden>
      {rect &&
        snapshot.tracks.filter(t => visibleVehicle(t,visibility)).map((t) => (
          <View
            key={t.id}
            style={{
              position: 'absolute',
              left: rect.x + t.box.left * rect.width,
              top: rect.y + t.box.top * rect.height,
              width: t.box.width * rect.width,
              height: t.box.height * rect.height,
              borderWidth: t.isPrimarySignal ? 4 : 2,
              borderColor: t.motion === 'MOVING' ? '#FF5252' : t.motion === 'STATIONARY' && t.motionSupported ? '#69DB92' : '#FFD600',
            }}
          >
            <Text style={[type.labelMedium, { backgroundColor: '#071318E8', color: colorOf(t.category), alignSelf: 'flex-start', paddingHorizontal: 3 }]}>
              #{t.id} {t.motion ?? 'VEHICLE'} {t.direction === 'LEFT_TO_RIGHT' ? '→' : t.direction === 'RIGHT_TO_LEFT' ? '←' : ''}
            </Text>
          </View>
        ))}
    </View>
  );
}

/**
 * Paints the segmentation mask over the camera, in the same crop as the preview.
 * Drawn only while a segmentation model is loaded — a box model has no mask, and the view must stay clear.
 */
export function SegmentationOverlay({ mask, frameAspect, resizeMode = 'cover' }: {
  mask: MaskImage; frameAspect: number; resizeMode?: 'cover' | 'contain';
}) {
  const [size, onLayout] = useLayout();
  const image = useMemo<Image | null>(() => {
    if (!mask) return null;
    try {
      return Images.loadFromRawPixelData({ ...mask, pixelFormat: 'RGBA' });
    } catch {
      return null;
    }
  }, [mask]);
  const rect = size.width > 0 ? (resizeMode === 'contain' ? containRect : coverRect)(size.width, size.height, frameAspect) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout} accessibilityElementsHidden>
      {rect && image && (
        <NitroImage
          image={image}
          resizeMode="stretch"
          style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      )}
    </View>
  );
}

/**
 * The colour key for those masks. Without it the overlay is decoration: the legend is what turns a wash of colour
 * into "that purple area is road, that yellow strip is a step".
 */
export function SegmentationLegend() {
  const type = useType();
  const rows: number[][] = [];
  for (let i = 0; i < SEG_LABELS.length; i += 2) rows.push([i, i + 1].filter((j) => j < SEG_LABELS.length));
  return (
    <View style={[styles.legend]} accessible>
      <Text style={[type.labelLarge, { color: Colors.Accent }]}>{S.segLegend.toUpperCase()}</Text>
      {rows.map((pair) => (
        <View key={pair[0]} style={{ flexDirection: 'row', gap: Dimens.gapSmall }}>
          {pair.map((i) => (
            <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: Dimens.gapSmall }}>
              <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: SEG_COLORS[i] }} />
              <Text style={type.bodyMedium}>{SEG_LABELS[i]}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    backgroundColor: Colors.Glass,
    borderRadius: Dimens.radiusCard,
    padding: Dimens.cardPadding,
    gap: Dimens.gapSmall / 2,
  },
});
