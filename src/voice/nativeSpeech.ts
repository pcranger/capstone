import { Platform } from 'react-native';
import type { ExpoSpeechRecognitionModule as RecognitionModule } from 'expo-speech-recognition';
import CrossWiseNative from '../../modules/crosswise-native';
import { ENGLISH_LOCALES, reportSpeechStatus, selectEnglishLocale, SPEECH_RECOVERY, speechStatus, type SpeechCapability } from './speechStatus';

type NativeModule = typeof RecognitionModule;
type AudioSession = ReturnType<NativeModule['getAudioSessionCategoryAndOptionsIOS']>;
export interface SpeechInput {
  prepare(): Promise<void>;
  listen(onReady: () => void): Promise<string>;
  cancel(): void;
}
/** One native turn at a time. Only its final result, after audio capture ends, leaves this adapter. */
export class NativeSpeechInput implements SpeechInput {
  private native: NativeModule | null = null;
  private cancelTurn: (() => void) | null = null;
  private pending: Promise<string> | null = null;
  private poisoned = false;
  private savedAudio: AudioSession | null = null;
  private locale: string | null = null;
  private androidCapabilities: SpeechCapability[] = [];
  private async capabilities(): Promise<SpeechCapability[]> {
    if (Platform.OS === 'ios') return CrossWiseNative?.speechCapabilities(ENGLISH_LOCALES) ?? [];
    const m = this.module();
    if (!m.supportsOnDeviceRecognition()) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        m.getSupportedLocales({}),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Speech capability check timed out.')), 4000); }),
      ]);
      const normalize = (locale: string) => locale.replace(/_/g, '-').toLowerCase();
      const installed = new Set(result.installedLocales.map(normalize));
      this.androidCapabilities = ENGLISH_LOCALES.map(locale => ({ locale, supported: installed.has(normalize(locale)),
        available: installed.has(normalize(locale)), onDevice: installed.has(normalize(locale)) }));
      return this.androidCapabilities;
    } catch { this.androidCapabilities = []; return []; }
    finally { clearTimeout(timer); }
  }
  /** File input is exclusively for USB fixture tests, never command execution. */
  constructor(private readonly audioSourceUri?: string) {}
  private module(): NativeModule {
    // Lazy: app launch and camera assistance must not depend on microphone availability.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- defer native loading until the microphone is used
    return this.native ??= require('expo-speech-recognition').ExpoSpeechRecognitionModule as NativeModule;
  }
  async prepare(): Promise<void> {
    if (this.poisoned) throw new Error('Voice unavailable. Reopen the app to retry.');
    const m = this.module();
    let permission = await m.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await m.requestPermissionsAsync();
    if (!permission.granted) {
      const error = Platform.OS === 'ios' ? 'Allow microphone and speech recognition for CrossWise in iPhone Settings.' : 'Allow microphone for CrossWise in Android Settings.';
      reportSpeechStatus({ locale: null, capabilities: [], error }); throw new Error(error);
    }
    // iOS installedLocales includes unsupported offline locales. Inspect each recognizer, and retry initialization.
    for (let attempt = 0; attempt < 3; attempt++) {
      const capabilities = Platform.OS === 'ios' ? CrossWiseNative?.speechCapabilities(ENGLISH_LOCALES) ?? [] : await this.capabilities();
      this.locale = selectEnglishLocale(capabilities);
      reportSpeechStatus({ locale: this.locale, capabilities, error: this.locale ? null : SPEECH_RECOVERY });
      if (this.locale) return;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw new Error(SPEECH_RECOVERY);
  }
  cancel(): void { this.cancelTurn?.(); }
  async listen(onReady: () => void): Promise<string> {
    if (this.pending) throw new Error('Voice is still stopping. Try again.');
    if (this.poisoned) throw new Error('Voice unavailable. Reopen the app to retry.');
    const m = this.module();
    if (!this.locale) await this.prepare();
    if (!this.locale || !selectEnglishLocale(Platform.OS === 'ios' ? CrossWiseNative?.speechCapabilities([this.locale]) ?? [] : this.androidCapabilities.filter(c => c.locale === this.locale && m.supportsOnDeviceRecognition()))) {
      reportSpeechStatus({ ...speechStatus.value, locale: null, error: SPEECH_RECOVERY });
      this.locale = null; throw new Error(SPEECH_RECOVERY);
    }
    const locale = this.locale;
    this.savedAudio = Platform.OS === 'ios' ? m.getAudioSessionCategoryAndOptionsIOS() : null;
    const turn = new Promise<string>((resolve, reject) => {
      let final: string | null = null;
      let failure: Error | null = null;
      let done = false;
      let stopping: ReturnType<typeof setTimeout> | undefined;
      const subscriptions: { remove(): void }[] = [];
      const timeout = setTimeout(() => abort(new Error('Voice timed out. Use Retry voice.')), 20_000);
      const finish = () => {
        if (done) return;
        done = true; clearTimeout(timeout); clearTimeout(stopping);
        for (const subscription of subscriptions) subscription.remove();
        this.cancelTurn = null;
        try {
          if (this.savedAudio) m.setCategoryIOS(this.savedAudio);
          if (Platform.OS === 'ios') m.setAudioSessionActiveIOS(true);
        } catch { failure = new Error('Audio could not recover. Reopen the app.'); this.poisoned = true; }
        this.savedAudio = null;
        const silent = /No speech heard|Voice timed out/.test(failure?.message ?? '') || (!failure && !final);
        const cancelled = failure?.message === 'Voice off.';
        reportSpeechStatus({ ...speechStatus.value, input: this.audioSourceUri ? 'fixture' : 'microphone',
          event: cancelled ? 'cancelled' : silent ? 'silent' : failure ? 'error' : 'recognized',
          error: failure && !silent && !cancelled ? failure.message : null });
        if (failure) reject(failure);
        else if (final) resolve(final);
        else reject(new Error('No speech heard. Use Retry voice.'));
      };
      const abort = (error: Error) => {
        if (done) return;
        failure = error; final = null;
        // Do not re-arm if native never acknowledges shutdown: prevents old events entering a new turn.
        stopping ??= setTimeout(() => { this.poisoned = true; finish(); }, 2_000);
        try { m.abort(); } catch { this.poisoned = true; finish(); }
      };
      this.cancelTurn = () => abort(new Error('Voice off.'));
      subscriptions.push(m.addListener('audiostart', () => {
        if (!failure && !done) {
          reportSpeechStatus({ ...speechStatus.value, event: 'listening', input: this.audioSourceUri ? 'fixture' : 'microphone', error: null });
          onReady();
        }
      }));
      subscriptions.push(m.addListener('result', event => {
        if (failure || final !== null || !event.isFinal) return;
        final = event.results[0]?.transcript.trim() || null;
        // Non-continuous iOS recognition ends itself. Bound a missing native end without accepting stale speech.
        stopping ??= setTimeout(() => { stopping = undefined; abort(new Error('Voice did not stop. Use Retry voice.')); }, 2_000);
      }));
      subscriptions.push(m.addListener('error', event => {
        reportSpeechStatus({ ...speechStatus.value, nativeError: { kind: event.error, message: event.message.slice(0, 500) } });
        if (!failure) failure = new Error(event.error === 'not-allowed' ? (Platform.OS === 'ios' ? 'Enable microphone and speech recognition in iPhone Settings.' : 'Enable microphone in Android Settings.') :
          event.error === 'interrupted' ? 'Voice interrupted. Use Retry voice.' :
          event.error === 'no-speech' ? 'No speech heard. Use Retry voice.' : 'Voice unavailable. Use Retry voice.');
        stopping ??= setTimeout(() => { this.poisoned = true; finish(); }, 2_000);
      }));
      subscriptions.push(m.addListener('end', finish));
      try {
        m.start({ lang: locale, requiresOnDeviceRecognition: true, continuous: false,
          ...(this.audioSourceUri ? { audioSource: { uri: this.audioSourceUri } } : {}),
          interimResults: false, addsPunctuation: false, maxAlternatives: 1, iosTaskHint: 'dictation',
          recordingOptions: { persist: false },
          contextualStrings: ['Navigate to', 'Search for', 'Save as Home', 'Confirm', 'Start journey', 'Pause', 'Resume', 'Repeat',
            'End journey', 'Stop navigation', 'Help', 'Voice help', 'Manual', 'Man', 'Next instruction', 'Arrived', 'Finish crossing', 'Cancel', 'Retry', 'First', 'Second', 'Third', 'Stop listening', 'Sydney Town Hall'],
          iosCategory: { category: 'playAndRecord', mode: 'measurement', categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers', 'duckOthers'] } });
      } catch { abort(new Error('Microphone unavailable. Use Retry voice.')); }
    });
    this.pending = turn;
    try { return await turn; } finally { this.pending = null; }
  }
}
