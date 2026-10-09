import { createContext, useContext } from 'react';
import type { TextStyle } from 'react-native';
import { AppFont } from '../settings/settings';

/**
 * The design system: see docs/UI_DESIGN.md.
 *
 * Dark only, on purpose — it is the readable option at a night crossing, it does not turn the phone into a lamp in
 * the traveler's face, and it lets the camera be the surface everything else floats over. Color means state.
 */
export const Colors = {
  Background: '#0B0F12',
  Surface: '#161C21',
  SurfaceVariant: '#222A30',
  OnSurface: '#F2F5F7',
  OnSurfaceMuted: '#A8B4BD',

  /** Panels that float over the camera: dark enough to read on, sheer enough to keep the street visible. */
  Glass: 'rgba(13,18,22,0.90)',
  GlassLight: 'rgba(255,255,255,0.10)',
  Hairline: 'rgba(255,255,255,0.20)',

  // State colors. Each keeps at least 6:1 against the text placed on it.
  Walk: '#1B5E20',
  Caution: '#7A5C00',
  DontWalk: '#B71C1C',
  Crossing: '#0D47A1',
  Unknown: '#37474F',
  Hazard: '#FFD600',
  OnHazard: '#000000',

  /** Chrome accent — lighter and less saturated than Crossing, so it never reads as a state. */
  Accent: '#8AB4F8',

  /** Notices and non-state icons. Same values the screens used before they became tokens (UI P3e J18). */
  Warn: '#FFD87A',
  Info: '#80DEEA',
  RouteLine: '#1464C0',
  RouteFill: 'rgba(20,100,192,0.14)',
  VehicleMoving: '#FF7777',
  VehicleStationary: '#69DB92',
  VehicleOff: '#89959B',

  /** Keeps the top and bottom chrome legible over a bright sky without hiding the view. */
  TopScrim: ['rgba(0,0,0,0.70)', 'rgba(0,0,0,0)'] as const,
  BottomScrim: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.80)'] as const,
};

/** One 4-pt scale for the whole app; no view invents its own numbers. */
export const Dimens = {
  gutter: 16,
  cardPadding: 16,
  gapSmall: 8,
  gapMedium: 12,
  gapLarge: 20,

  /** Three radii: 12 rows and fields, 18 cards and sheets, pill for chips and strips. */
  radiusRow: 12,
  radiusCard: 18,
  radiusPill: 28,

  /** Apple's floor is 44 pt; this app is used standing and one-handed, so controls stay at 56. */
  touchTarget: 56,
  primaryButton: 56,
  secondaryButton: 48,
};

interface Family {
  regular: string;
  bold: string;
}

/** Fonts are embedded by expo-font's config plugin and referenced by PostScript name. */
const FAMILIES: Record<AppFont, Family> = {
  [AppFont.MODERN]: { regular: 'Inter-Regular', bold: 'Inter-Bold' },
  /** Tinos: metric-compatible with Times New Roman, and the closest thing to it that can be redistributed. */
  [AppFont.CLASSIC]: { regular: 'Tinos-Regular', bold: 'Tinos-Bold' },
  /**
   * Atkinson Hyperlegible (Braille Institute, SIL OFL 1.1) — drawn for low-vision readers: the glyphs that blur
   * together in other faces (I l 1, O 0, a e s) are given distinct shapes.
   */
  [AppFont.HYPERLEGIBLE]: { regular: 'AtkinsonHyperlegible-Regular', bold: 'AtkinsonHyperlegible-Bold' },
};

export function familyOf(font: AppFont, bold = true): string {
  return bold ? FAMILIES[font].bold : FAMILIES[font].regular;
}

export interface Typography {
  displayMedium: TextStyle;
  headlineMedium: TextStyle;
  titleLarge: TextStyle;
  titleMedium: TextStyle;
  bodyLarge: TextStyle;
  bodyMedium: TextStyle;
  labelLarge: TextStyle;
  labelMedium: TextStyle;
}

/**
 * Five sizes only: 15 / 17 / 20 / 26 / 34 sp. They scale with system Dynamic Type.
 */
export function typographyFor(font: AppFont): Typography {
  const f = FAMILIES[font];
  const style = (size: number, bold: boolean, line: number, tracking = 0): TextStyle => ({
    fontFamily: bold ? f.bold : f.regular,
    fontSize: size,
    lineHeight: line,
    letterSpacing: tracking,
    color: Colors.OnSurface,
  });
  return {
    displayMedium: style(34, true, 38, -0.3), // the phase word, compact mode
    headlineMedium: style(26, true, 32),
    titleLarge: style(20, true, 26),
    titleMedium: style(17, true, 22),
    bodyLarge: style(17, false, 22),
    bodyMedium: style(15, false, 21),
    labelLarge: style(15, true, 21, 0.5),
    labelMedium: style(15, false, 21),
  };
}

export const TypeContext = createContext<Typography>(typographyFor(AppFont.MODERN));

export function useType(): Typography {
  return useContext(TypeContext);
}
