import { File, Paths } from 'expo-file-system';
import { Store } from '../state/store';

export interface SpeechCapability { locale: string; supported: boolean; available: boolean; onDevice: boolean }
export const ENGLISH_LOCALES = ['en-AU', 'en-US', 'en-GB', 'en-CA', 'en-NZ'];
export const SPEECH_RECOVERY = 'Voice unavailable. Open Voice help in Settings.';
export const speechStatus = new Store<{ locale: string | null; capabilities: SpeechCapability[]; error: string | null;
  event?: 'listening' | 'recognized' | 'silent' | 'cancelled' | 'error'; input?: 'fixture' | 'microphone';
  nativeError?: { kind: string; message: string } }>({ locale: null, capabilities: [], error: null });
export function selectEnglishLocale(capabilities: SpeechCapability[]): string | null {
  return ENGLISH_LOCALES.find(locale => capabilities.some(c => c.locale === locale && c.supported && c.available && c.onDevice)) ?? null;
}
/** Capability-only diagnostic: never contains microphone audio, transcripts, location or credentials. */
export function reportSpeechStatus(value: typeof speechStatus.value): void {
  speechStatus.set(value);
  try {
    const file = new File(Paths.document, 'speech-status.json');
    file.write(JSON.stringify({ ...value, checkedAt: new Date().toISOString() }, null, 2));
  } catch { /* Diagnostics cannot prevent voice recovery. */ }
}
