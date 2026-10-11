import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { DEFAULT_ENGINE_SETTINGS, type EngineSettings } from '../crossing/crossingEngine';
import { Verbosity } from '../feedback/cue';
import type { FeedbackConfig } from '../feedback/feedbackEngine';
import { clamp } from '../core/geometry';

export enum InterfaceMode {
  USER = 'USER',
  DEVELOPER = 'DEVELOPER',
}

/** Typeface for the whole app; see docs/UI_DESIGN.md. */
export enum AppFont {
  MODERN = 'MODERN',
  CLASSIC = 'CLASSIC',
  HYPERLEGIBLE = 'HYPERLEGIBLE',
}

export interface AppSettings {
  interfaceMode: InterfaceMode;
  speech: boolean;
  tones: boolean;
  haptics: boolean;
  speechRate: number;
  verbosity: Verbosity;
  aimSonar: boolean;
  veerGuidance: boolean;
  vehicleAlerts: boolean;
  autoDetectCrossing: boolean;
  useGpu: boolean;
  scoreThreshold: number;
  showPreview: boolean;
  showOverlay: boolean;
  showMovingVehicles: boolean;
  showStationaryVehicles: boolean;
  logSessions: boolean;
  appFont: AppFont;
  /** Everything below covers the camera, so each one is opt-in and off by default unless it is a warning. */
  showWarnings: boolean;
  /** The icon rail at the top left: people, crosswalk, you, vehicles, signal. */
  showStatusIcons: boolean;
  showModelLine: boolean;
  /** Low-vision mode: the phase word takes the whole bottom panel instead of a compact line. */
  largeStatus: boolean;
  /**
   * The active model: `asset:<name>` for one bundled with the app, `documents:<relative path>` for one imported
   * or copied into the app's Documents folder, or null for the default bundled model. Paths are relative because
   * iOS moves the app container between installs.
   */
  customModelPath: string | null;
  acceptedSafetyNotice: boolean;
  /** How long each side of the crossing check is held, in seconds (3-8). */
  holdSeconds: number;
  /** Road width for the step count, in lanes (1-4, about 6 steps per lane). */
  roadLanes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  interfaceMode: InterfaceMode.USER,
  speech: true,
  tones: true,
  haptics: true,
  speechRate: 0.85,
  verbosity: Verbosity.NORMAL,
  aimSonar: true,
  veerGuidance: true,
  vehicleAlerts: true,
  autoDetectCrossing: true,
  useGpu: true,
  scoreThreshold: 0.35,
  showPreview: true,
  showOverlay: true,
  showMovingVehicles: true,
  showStationaryVehicles: false,
  logSessions: false,
  appFont: AppFont.MODERN,
  showWarnings: true,
  showStatusIcons: true,
  showModelLine: false,
  largeStatus: false,
  customModelPath: null,
  acceptedSafetyNotice: false,
  holdSeconds: 5,
  roadLanes: 2,
};

export function engineSettingsOf(s: AppSettings): EngineSettings {
  return {
    ...DEFAULT_ENGINE_SETTINGS,
    aimSonar: s.aimSonar,
    veerGuidance: s.veerGuidance,
    vehicleAlerts: s.vehicleAlerts,
    autoDetectCrossing: s.autoDetectCrossing,
    verbosity: s.verbosity,
    holdSeconds: s.holdSeconds,
    roadLanes: s.roadLanes,
  };
}

export function feedbackConfigOf(s: AppSettings): FeedbackConfig {
  return { speech: s.speech, tones: s.tones, haptics: s.haptics, speechRate: s.speechRate };
}

const STORE_KEY = 'crosswise_settings';
export const CONF_FILE_NAME = 'crosswise.conf.json';

/** The keys the conf file carries. The safety notice is deliberately not one of them. */
const FILE_KEYS: (keyof AppSettings)[] = [
  'speech', 'tones', 'haptics', 'speechRate', 'verbosity', 'appFont', 'largeStatus', 'showWarnings', 'showStatusIcons',
  'showMovingVehicles', 'showStationaryVehicles',
  'showModelLine', 'showPreview', 'showOverlay', 'aimSonar', 'veerGuidance', 'vehicleAlerts', 'autoDetectCrossing',
  'useGpu', 'scoreThreshold', 'logSessions', 'customModelPath', 'interfaceMode',
  'holdSeconds', 'roadLanes',
];

/** Allowlisted preferences only. Legacy credentials and volume shortcuts are intentionally discarded. */
export function mergeSettings(current: AppSettings, raw: Record<string, unknown>): AppSettings {
  const next: AppSettings = { ...current };
  const target = next as unknown as Record<string, unknown>;
  for (const key of FILE_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    const def = DEFAULT_SETTINGS[key];
    if (key === 'customModelPath') {
      target[key] = typeof value === 'string' && value.trim().length > 0 ? value : null;
    } else if (key === 'verbosity') {
      if (Object.values(Verbosity).includes(value as Verbosity)) target[key] = value;
    } else if (key === 'interfaceMode') {
      if (Object.values(InterfaceMode).includes(value as InterfaceMode)) target[key] = value;
    } else if (key === 'appFont') {
      if (Object.values(AppFont).includes(value as AppFont)) target[key] = value;
    } else if (key === 'holdSeconds') {
      if (typeof value === 'number' && Number.isFinite(value)) target[key] = clamp(value, 3, 8);
    } else if (key === 'roadLanes') {
      if (typeof value === 'number' && Number.isFinite(value)) target[key] = clamp(Math.round(value), 1, 4);
    } else if (typeof value === typeof def) {
      target[key] = value;
    }
  }
  return next;
}

/**
 * Mirrors the user's settings to a readable JSON file in the app's Documents folder.
 *
 * The file carries ordinary preferences for bench testing. Service credentials come from build configuration;
 * legacy key properties are ignored on read and removed on the next startup/write.
 *
 * Location: Files app → On My iPhone → CrossWise → crosswise.conf.json (file sharing is on in Info.plist).
 */
export class SettingsFile {
  private readonly file = new File(Paths.document, CONF_FILE_NAME);

  get path(): string {
    return this.file.uri;
  }

  write(settings: AppSettings): void {
    try {
      const json: Record<string, unknown> = {};
      for (const key of FILE_KEYS) json[key] = settings[key];
      if (!this.file.exists) this.file.create();
      this.file.write(JSON.stringify(json, null, 2));
    } catch {
      console.warn(`Could not write ${CONF_FILE_NAME}`);
    }
  }

  mergeInto(current: AppSettings): AppSettings {
    // Write it the first time it is read, so the file is there to be edited without changing a setting first.
    if (!this.file.exists) {
      this.write(current);
      return current;
    }
    try {
      return mergeSettings(current, JSON.parse(this.file.textSync()) as Record<string, unknown>);
    } catch {
      console.warn(`Could not read ${CONF_FILE_NAME}`);
      return current;
    }
  }
}

type Listener = (s: AppSettings) => void;

export class SettingsRepository {
  readonly file = new SettingsFile();
  private current: AppSettings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<Listener>();
  private chain: Promise<void> = Promise.resolve();

  get value(): AppSettings {
    return this.current;
  }

  /** Reads the store and applies the conf file on top of it. */
  async load(): Promise<AppSettings> {
    let stored: AppSettings = DEFAULT_SETTINGS;
    try {
      const raw = await AsyncStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        stored = mergeSettings(DEFAULT_SETTINGS, parsed);
        if (typeof parsed.acceptedSafetyNotice === 'boolean') stored.acceptedSafetyNotice = parsed.acceptedSafetyNotice;
      }
    } catch {
      console.warn('Could not read settings');
    }
    this.current = this.file.mergeInto(stored);
    // Rewrite both legacy stores now, not only after the user next changes a preference.
    this.file.write(this.current);
    try { await AsyncStorage.setItem(STORE_KEY, JSON.stringify(this.current)); }
    catch { console.warn('Could not migrate settings'); }
    this.emit();
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Serialized, so two quick toggles never overwrite each other. */
  update(transform: (s: AppSettings) => AppSettings): Promise<void> {
    this.chain = this.chain.then(async () => {
      const next = transform(this.file.mergeInto(this.current));
      this.current = next;
      this.file.write(next);
      this.emit();
      try {
        await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch (e) {
        console.warn('Could not save settings', e);
      }
    });
    return this.chain;
  }

  private emit(): void {
    for (const l of this.listeners) l(this.current);
  }
}
