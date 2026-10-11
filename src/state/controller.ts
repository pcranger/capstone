import { EMPTY_PIPELINE, perceptionMessage } from '../perception/pipelineHealth';
import { NativeSpeechInput } from '../voice/nativeSpeech';
import { VoiceAudioCheck } from '../voice/audioCheck';
import { V } from '../voice/speechCatalog';
import { CONFIRM_WINDOW_MS, VT } from '../text/voiceText';
import { NavigationVoice, voiceIntent, VOICE_QUICK_START } from '../voice/navigationVoice';
import { speechStatus } from '../voice/speechStatus';
import { Haptics } from '../feedback/haptics';
import { HapticPattern } from '../feedback/cue';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState, type AppStateStatus } from 'react-native';
import { BoxF, nowMs } from '../core/geometry';
import {
  AssistMode,
  type CameraGeometry,
  CrossingEngine,
  EMPTY_SNAPSHOT,
  type EngineSnapshot,
  UserCommand,
} from '../crossing/crossingEngine';
import { type Cue, Cues, Phrase, Priority } from '../feedback/cue';
import { FeedbackEngine } from '../feedback/feedbackEngine';
import { SessionLogger } from '../logging/sessionLogger';
import type { Detection, FrameDetections, ObjectCategory, SignalColor } from '../perception/detection';
import {
  displayNameOf,
  importModelFile,
  listModels,
  type LoadedModel,
  loadModel,
  type ModelInfo,
  type ModelSource,
  referenceOf,
  resolveSource,
  fileOf,
} from '../perception/modelLoader';
import { MotionSensors } from '../sensors/motionSensors';
import { probeDetector } from '../perception/modelProbe';
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  engineSettingsOf,
  feedbackConfigOf,
  SettingsRepository,
  InterfaceMode,
} from '../settings/settings';
import { cueText, phraseText, P, S } from '../strings';
import { Store } from './store';

export type ModelState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; info: ModelInfo }
  | { kind: 'failed'; message: string };

export interface UiState {
  snapshot: EngineSnapshot;
  fps: number;
  inferenceMs: number;
  /** Width / height of the upright analysis frame, used to place overlay boxes. */
  frameAspect: number;
  /** Last spoken message, shown as a caption. */
  caption: string | null;
  /** Mean luminance of the last analysed frame, 0..1 — feeds the "too dark / lens covered" warning. */
  frameBrightness: number;
}

/** One box from the camera worklet: plain numbers, labels attached here. */
export interface RawDetection {
  left: number;
  top: number;
  right: number;
  bottom: number;
  classIndex: number;
  score: number;
  color: SignalColor | null;
}

export interface FrameResult {
  capturedWallMs?: number;
  motionWorkerMs?: number;
  motionImage?: import("../tracking/vehicleMotion").GrayFrame;
  detections: RawDetection[];
  frameWidth: number;
  frameHeight: number;
  inferenceMs: number;
  brightness: number;
  /** Segmentation mask, RGBA premultiplied, at prototype resolution. */
  mask: { buffer: ArrayBuffer; width: number; height: number } | null;
  /** Present on the one frame captured for debugging: the exact model input and raw head output. */
  debug: { input: ArrayBuffer; head: ArrayBuffer; orientation: string; letterbox: object } | null;
}

export type MaskImage = { buffer: ArrayBuffer; width: number; height: number } | null;


/**
 * The app's brain on the JS thread — the port of the Android CrossWiseViewModel. Screens read its stores; the
 * camera view feeds it frames; everything that speaks, vibrates or logs goes through here.
 */
export class CrossWiseController {
  readonly settingsRepository = new SettingsRepository();
  readonly settings = new Store<AppSettings>(DEFAULT_SETTINGS);
  readonly settingsLoaded = new Store(false);
  readonly model = new Store<ModelState>({ kind: 'loading' });
  /** The interpreter and tensor layout the camera worklet runs; null while none is loaded. */
  readonly loadedModel = new Store<LoadedModel | null>(null);
  readonly modelLibrary = new Store<ModelSource[]>([]);
  readonly ui = new Store<UiState>({
    snapshot: EMPTY_SNAPSHOT,
    fps: 0,
    inferenceMs: 0,
    frameAspect: 9 / 16,
    caption: null,
    frameBrightness: 0.5,
  });
  readonly mask = new Store<MaskImage>(null);
  readonly notice = new Store<string | null>(null);
  readonly pipeline = new Store({...EMPTY_PIPELINE});
  readonly cameraDetail = new Store<string|null>(null);
  readonly cameraStatus = new Store<'starting' | 'running' | 'unavailable'>('starting');
  /**
   * Set when a file named `capture.request` appears in the app's Documents folder (Files app, or `devicectl device
   * copy to`). The next analysed frame is then written to Documents/debug: the model input tensor, the raw output and
   * the decoded boxes, so a developer can check the on-phone pipeline against a desktop run of the same model.
   */
  readonly debugCapture = new Store(false);

  private readonly engine = new CrossingEngine();
  private readonly feedback = new FeedbackEngine();
  readonly voiceCheck = new VoiceAudioCheck(new NativeSpeechInput(), text => this.feedback.sayAndWait(text),
    () => this.feedback.silenceRoutine(), () => { if (this.settings.value.haptics) Haptics.play(HapticPattern.CENTERED_TICK); });
  private readonly sensors = new MotionSensors();
  readonly logger = new SessionLogger();
  private homeVisible = false;
  private unknownCommands = 0;
  private queuedScanToken=-1;
  private assistStartedAt=0;
  private trafficFailure:string|null=null;
  private voiceMuted = false;
  /** What the user chose: true until Stop listening or the Voice commands button switches it off. Drives the toggle's label. */
  readonly voiceMode = new Store<boolean>(true);
  private pendingConfirm: { word: 'cancel' | 'stop'; at: number } | null = null;
  /** Prevents a recurring native/service error from talking over itself while it remains unresolved. */
  private announcedErrors = new Map<string, string>();
  private voiceAudioGeneration = 0;
  readonly voice = new NavigationVoice({
    input: new NativeSpeechInput(),
    say: async text => {
      this.ui.update(s => ({ ...s, caption: text }));
      return this.feedback.sayAndWait(text);
    },
    ready: () => this.feedback.dispatch([Cues.haptic(HapticPattern.CENTERED_TICK)]),
    handle: (text, current) => this.handleVoice(text, current),
    cancel: () => undefined,
    stopSpeech: () => this.feedback.stopForInterruption(),
    announceListening: () => this.feedback.sayAndWait('Listening.'),
  });
  setHomeVisible(visible: boolean): void {
    this.homeVisible = visible;
    if (visible) {
      this.announceDetectionError();
      this.startVoice();
    }
    else { ++this.voiceAudioGeneration; this.voice.stop(); this.feedback.silenceRoutine(); }
  }
  /** `announce` false is a re-arm between prompts: the microphone opens without saying "Listening." again. */
  startVoice(force = false, announce = true): void {
    if (force) { this.voiceMuted = false; this.voiceMode.set(true); }
    if (!this.homeVisible || AppState.currentState !== 'active' || this.voiceMuted || !this.settings.value.speech) return;
    if (this.voice.active) return;
    if (this.voiceCheck.active) this.voiceCheck.stop();
    const id = ++this.voiceAudioGeneration;
    void this.feedback.whenIdle().then(idle => {
      if (!idle || id !== this.voiceAudioGeneration || !this.homeVisible || this.voiceMuted || AppState.currentState !== 'active') return;
      this.voice.start(null, announce);
      // Each command ends its turn. When voice mode is still on, open the microphone again once the app has finished speaking.
      void this.voice.whenStopped().then(() => this.rearmVoice(id));
    });
  }
  /** Re-opens the microphone after a finished turn. Any stop, hidden screen or newer start bumps the generation and cancels this. */
  private rearmVoice(id: number): void {
    if (id !== this.voiceAudioGeneration || this.voice.state.value.phase === 'error') return;
    // The 4 second confirm window starts when the question has been spoken, not when it was asked.
    if (this.pendingConfirm) this.pendingConfirm.at = nowMs();
    this.startVoice(false, false);
  }
  stopVoice(): void {
    this.voiceMuted = true; this.voiceMode.set(false);
    ++this.voiceAudioGeneration; this.voice.stop(); this.feedback.silenceRoutine();
  }
  /** The large Voice commands button and the camera double-tap gesture. Works between prompts, when the microphone is briefly closed. */
  toggleVoice(): void {
    if (this.voiceMode.value) {
      this.stopVoice();
      void this.feedback.sayAndWait('Listening stopped.');
    } else {
      this.startVoice(true);
    }
  }
  toggleVoiceFromGesture(): void { this.toggleVoice(); }
  /** True on the second matching word inside the window; otherwise records the first and the caller asks again. */
  private confirmedTwice(word: 'cancel' | 'stop'): boolean {
    const now = nowMs(), pending = this.pendingConfirm;
    if (pending && pending.word === word && now - pending.at <= CONFIRM_WINDOW_MS) { this.pendingConfirm = null; return true; }
    this.pendingConfirm = { word, at: now };
    return false;
  }
  private async handleVoice(text: string, current: () => boolean): Promise<string | null> {
    if (!current()) return null;
    const intent = voiceIntent(text);
    if (!intent) return ++this.unknownCommands >= 2 ? V.unknownHelp : V.unknown;
    this.unknownCommands = 0;
    if (intent.kind !== 'cancel' && intent.kind !== 'stop') this.pendingConfirm = null;
    const crossing = this.engine.mode === AssistMode.CROSSING;
    switch (intent.kind) {
      case 'stopListening': this.stopVoice(); return null;
      case 'cross':
        if (!this.assistOn) return VT.crossNeedsHelp;
        if (crossing) return VT.crossAlready;
        // TODO(stage 2b): a dedicated controller method for "cross" once the crossing check lands; this is the Cross button's path.
        this.crossingAction('start'); return null;
      case 'stop':
        if (!this.assistOn) return VT.alreadyOff;
        // Same as the dock Stop. A wrong guess must not silence a crossing, so a crossing needs the word twice.
        if (crossing && !this.confirmedTwice('stop')) return VT.confirmAgain('stop');
        this.command(UserCommand.STOP_ASSIST, true); return V.paused;
      case 'help': return VOICE_QUICK_START;
      case 'start': case 'resume':
        if (this.assistOn) return V.running;
        this.command(UserCommand.START_ASSIST, true); return V.started;
      case 'retry':
        if (!this.assistOn) { this.command(UserCommand.START_ASSIST, true); return V.started; }
        this.repeatGuidance(); return null;
      case 'repeat': this.repeatGuidance(); return null;
      case 'pause':
        // Never switch the traffic watch off in the middle of a crossing.
        if (crossing) return V.finishCrossingFirst;
        this.command(UserCommand.STOP_ASSIST, true); return V.paused;
      case 'cancel':
        if (crossing) {
          if (!this.confirmedTwice('cancel')) return VT.confirmAgain('cancel');
          this.command(UserCommand.END_CROSSING); return V.crossingEnded;
        }
        if (this.assistOn) this.command(UserCommand.STOP_ASSIST, true);
        return V.cancelled;
      case 'finishCrossing':
        if (!crossing) return V.noCrossing;
        this.command(UserCommand.END_CROSSING);
        return V.crossingEnded;
    }
  }

  /** Field of view of the upright analysis frame; defaults are typical for a phone main camera. */
  geometry: CameraGeometry = { hfovDeg: 40, vfovDeg: 65 };
  private fps = 0;
  private lastFrameMs = 0;
  private brightness = 0.5;
  private lastPublishMs = 0;
  private loadedModelKey: string | null = null;
  private loadGeneration = 0;
  private sensorTimer: ReturnType<typeof setInterval> | null = null;
  private probeRunning = false;
  private speechProbeRunning = false;
  private keptAwake = false;
  private started = false;

  /** Idempotent: called once when the app mounts. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.settingsRepository.subscribe((s) => this.onSettings(s));
    this.model.subscribe(() => this.announceDetectionError());
    this.settingsRepository
      .load()
      .catch(() => undefined)
      .finally(() => this.settingsLoaded.set(true));
    this.refreshModelLibrary();
    // Sensor-driven guidance (veer, tilt, auto crossing) runs at 10 Hz regardless of camera speed.
    this.sensorTimer = setInterval(() => {
      const output = this.engine.onSensors(nowMs(), this.sensors.latestOrientation, this.sensors.isWalking);
      this.deliverEngine(output.cues);
      this.checkTrafficAvailability();
      if (output.snapshot.mode !== AssistMode.IDLE) this.publish(output.snapshot);
    }, 100);
    setInterval(() => {
      this.checkDebugRequest();
      void this.checkModelProbe();
      void this.checkSpeechProbe();
    }, 2_000);
    AppState.addEventListener('change', (s) => this.onAppState(s));
    if (AppState.currentState === 'active') this.onForeground();
  }

  /** Put a model-load failure through the same audio queue as normal guidance. */
  private announceDetectionError(): void {
    const state = this.model.value;
    const error = state.kind === 'failed' ? state.message : null;
    if (!error) {
      this.announcedErrors.delete('detection');
      return;
    }
    // Keep the state error for the next foreground turn; do not consume it while
    // the app is hidden and unable to deliver audio.
    if (!this.homeVisible || AppState.currentState !== 'active') return;
    if (this.announcedErrors.get('detection') === error) return;
    this.announcedErrors.set('detection', error);
    // A voice command receives its own concise response; do not talk over it.
    if (this.voice.processing) return;
    this.deliver([Cues.speakText(P.detectionUnavailable, Priority.HIGH)]);
  }

  // ---- Settings & models ------------------------------------------------------------------------

  private onSettings(s: AppSettings): void {
    this.settings.set(s);
    this.applyEngineSettings();
    this.feedback.config = feedbackConfigOf(s);
    const key = `${s.customModelPath ?? ''}|${s.useGpu}`;
    if (key !== this.loadedModelKey) {
      this.loadedModelKey = key;
      void this.loadModelFor(s);
    }
    if (this.engine.mode !== AssistMode.IDLE) {
      if (s.logSessions) this.logger.start();
      else this.logger.stop();
    }
  }

  private applyEngineSettings(): void {
    const settings = engineSettingsOf(this.settings.value);
    if (this.settings.value.interfaceMode !== InterfaceMode.DEVELOPER) settings.autoDetectCrossing = false;
    settings.pedestrianSignals = this.model.value.kind==='ready' && this.model.value.info.hasPedestrianSignalClasses;
    this.engine.settings = settings;
  }

  updateSettings(transform: (s: AppSettings) => AppSettings): void {
    void this.settingsRepository.update(transform);
  }

  refreshModelLibrary(): void {
    this.modelLibrary.set(listModels());
  }

  private async loadModelFor(s: AppSettings): Promise<void> {
    const generation = ++this.loadGeneration;
    this.engine.invalidatePerception();
    this.model.set({ kind: 'loading' });
    this.refreshModelLibrary();
    const source = resolveSource(s.customModelPath, this.modelLibrary.value);
    if (source === null) {
      this.loadedModel.set(null);
      this.model.set({ kind: 'missing' });
      return;
    }
    try {
      const loaded = await loadModel(source, s.useGpu);
      if (generation !== this.loadGeneration) return; // a newer choice won
      this.loadedModel.set(loaded);
      this.mask.set(null);
      this.model.set({ kind: 'ready', info: loaded.info });
      this.applyEngineSettings();
      // Model details remain in Developer Settings, without a startup announcement.
    } catch (e) {
      if (generation !== this.loadGeneration) return;
      console.warn('Model load failed', e);
      this.loadedModel.set(null);
      this.model.set({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      this.notice.set(P.detectionUnavailable);
    }
  }

  importModel(uri: string, name: string | null): void {
    try {
      const source = importModelFile(uri, name);
      this.refreshModelLibrary();
      this.updateSettings((s) => ({ ...s, customModelPath: referenceOf(source) }));
      this.notice.set(S.noticeModelImported(displayNameOf(source)));
    } catch (e) {
      console.warn('Model import failed', e);
      this.model.set({ kind: 'failed', message: e instanceof Error ? e.message : 'Import failed' });
    }
  }

  selectModel(source: ModelSource): void {
    this.updateSettings((s) => ({ ...s, customModelPath: referenceOf(source) }));
  }

  deleteModel(source: ModelSource): void {
    if (source.kind !== 'file') return;
    if (this.settings.value.customModelPath === referenceOf(source)) {
      this.updateSettings((s) => ({ ...s, customModelPath: null }));
    }
    try {
      fileOf(source).delete();
    } catch (e) {
      console.warn('Could not delete model', e);
    }
    this.refreshModelLibrary();
  }

  clearNotice(): void {
    this.notice.set(null);
  }

  // ---- Lifecycle --------------------------------------------------------------------------------

  private onAppState(state: AppStateStatus): void {
    if (state !== 'active') {this.voiceCheck.stop();this.stopSpeechPreview();}
    if (state === 'active') this.onForeground();
    else if (state === 'background') this.onBackground();
  }

  private onForeground(): void {
    this.sensors.start();
    this.announceDetectionError();
    this.startVoice();
    // A conf file edited in the Files app while we were away takes effect now.
    if (this.settingsLoaded.value) void this.settingsRepository.load();
    this.refreshModelLibrary();
  }

  private onBackground(): void {
    // The camera stops in the background, so any signal state would go stale: say so and stop.
    ++this.voiceAudioGeneration; this.voice.stop();
    if (this.engine.mode !== AssistMode.IDLE) this.command(UserCommand.STOP_ASSIST, true);
    this.sensors.stop();
  }

  // ---- Camera frames ----------------------------------------------------------------------------

  setCameraGeometry(geometry: CameraGeometry): void {
    this.geometry = geometry;
  }

  /** Called on the JS thread with each analysed frame from the camera worklet. */
  onFrame(result: FrameResult): void {
    const loaded = this.loadedModel.value;
    if (!loaded) return;
    // Time the frame was captured, as closely as the JS thread can know it.
    const age = result.capturedWallMs === undefined ? result.inferenceMs : Date.now()-result.capturedWallMs;
    if (nowMs() - this.pipeline.value.receivedAt >= 500 || this.pipeline.value.error !== null)
      this.pipeline.update(p=>({receivedAt:nowMs(),latencyMs:age,slowFrames:p.slowFrames+(age>350?1:0),error:null,processingMs:result.inferenceMs,motionWorkerMs:result.motionWorkerMs}));
    const timestampMs = nowMs() - age;
    const labels = loaded.info.labels;
    const categories = loaded.categories;
    const detections: Detection[] = result.detections.map((d) => ({
      box: new BoxF(d.left, d.top, d.right, d.bottom),
      classIndex: d.classIndex,
      label: labels[d.classIndex] ?? `class_${d.classIndex}`,
      score: d.score,
      category: (categories[d.classIndex] ?? 'OTHER') as ObjectCategory,
      colorHint: d.color,
    }));
    const frame: FrameDetections = {
      timestampMs,
      motionImage: result.motionImage,
      brightness: result.brightness,
      detections,
      frameWidth: result.frameWidth,
      frameHeight: result.frameHeight,
      inferenceMs: result.inferenceMs,
    };
    if (result.debug) this.writeDebugCapture(result, loaded, detections);
    // Accept completed detections regardless of processing latency. Keep capture time
    // for motion calculations; invalid clock values are not usable measurements.
    if (!Number.isFinite(age) || age < 0) return;
    this.brightness = 0.8 * this.brightness + 0.2 * result.brightness;
    if (result.mask) this.mask.set(result.mask);
    else if (this.mask.value !== null) this.mask.set(null);

    const output = this.engine.onFrame(frame, this.geometry);
    this.deliverEngine(output.cues);

    const dt = timestampMs - this.lastFrameMs;
    this.lastFrameMs = timestampMs;
    if (dt >= 1 && dt <= 2_000) this.fps = this.fps === 0 ? 1000 / dt : 0.9 * this.fps + 0.1 * (1000 / dt);

    if (this.settings.value.logSessions && output.snapshot.mode !== AssistMode.IDLE) {
      this.logger.log(timestampMs, this.fps, result.inferenceMs, detections.length, output.snapshot, output.cues);
    }
    this.publish(output.snapshot, {
      inferenceMs: result.inferenceMs,
      frameAspect: result.frameWidth / Math.max(result.frameHeight, 1),
    });
  }

  inferenceFailed(message:string):void {
    this.pipeline.update(p=>({...p,error:message}));this.lastFrameMs=0;this.engine.invalidatePerception();
    this.cameraDiagnostic(message);
  }
  cameraDiagnostic(stage: string): void {
    try { new File(Paths.document, 'capture-pipeline.txt').write(stage); } catch { /* Diagnostic only. */ }
  }

  private checkDebugRequest(): void {
    try {
      const request = new File(Paths.document, 'capture.request');
      if (!request.exists) return;
      request.delete();
      new File(Paths.document, 'capture-status.json').write(JSON.stringify({checkedAt:new Date().toISOString(),motionClassifier:"local-background-binary-v1",model:this.model.value,camera:this.cameraStatus.value,recentFrame:this.hasRecentFrame,pipeline:this.pipeline.value,cameraDetail:this.cameraDetail.value,mode:this.engine.mode,orientation:this.sensors.latestOrientation,walking:this.sensors.isWalking,vehicleHazards:this.engine.snapshot.hazards.length,voice:this.voice.state.value.phase}));
      this.debugCapture.set(true);
    } catch {
      // No file system (tests): nothing to capture.
    }
  }

  /** Explicit USB fixture test; file speech never reaches handleVoice or navigation. */
  private async checkSpeechProbe(): Promise<void> {
    if (this.speechProbeRunning || this.assistOn || AppState.currentState !== 'active') return;
    const request = new File(Paths.document, 'voice-probe.request.json');
    if (!request.exists) return;
    this.speechProbeRunning = true;
    const report: { capabilities?: typeof speechStatus.value; error?: string; results: { fixture: number; text?: string; error?: string }[] } = { results: [] };
    try {
      const { count } = JSON.parse(await request.text()); request.delete();
      if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('Expected 1–8 local voice fixtures.');
      ++this.voiceAudioGeneration; this.voice.stop(); this.feedback.silenceRoutine();
      await this.voice.whenStopped(); await this.feedback.whenIdle();
      for (let i = 1; i <= count; i++) {
        if (AppState.currentState !== 'active') throw new Error('Test interrupted.');
        const file = new File(Paths.document, `voice-probe-${i}.wav`);
        if (!file.exists || file.size > 2_000_000) throw new Error('Missing or oversized voice fixture.');
        const input = new NativeSpeechInput(file.uri);
        try { await input.prepare(); report.results.push({ fixture: i, text: await input.listen(() => {}) }); }
        catch (e) { report.results.push({ fixture: i, error: String(e) }); }
        report.capabilities = speechStatus.value;
      }
    } catch (e) { report.error = String(e); }
    finally {
      try { new File(Paths.document, 'voice-probe-result.json').write(JSON.stringify(report, null, 2)); } catch { /* diagnostic only */ }
      this.speechProbeRunning = false; this.startVoice();
    }
  }

  /** USB diagnostic: fixed filenames, explicit request, Developer mode with assistance off. */
  private async checkModelProbe(): Promise<void> {
    if (this.probeRunning || this.engine.mode !== AssistMode.IDLE || this.settings.value.interfaceMode !== InterfaceMode.DEVELOPER) return;
    const request = new File(Paths.document, 'probe.request.json');
    if (!request.exists) return;
    this.probeRunning = true;
    const report: Record<string, unknown> = { startedAt: new Date().toISOString() };
    try {
      const { width, height } = JSON.parse(await request.text());
      request.delete();
      const source = resolveSource(this.settings.value.customModelPath, this.modelLibrary.value);
      if (!source) throw new Error('No selected model');
      const bytes = await new File(Paths.document, 'probe-input.f32').bytes();
      const threshold = this.settings.value.scoreThreshold;
      // Dedicated interpreters keep the offline input out of live inference and tracking.
      for (const accelerated of [false, true]) {
        const key = accelerated ? 'accelerated' : 'cpu';
        try {
          report[key] = await probeDetector(await loadModel(source, accelerated), bytes, width, height, threshold);
        } catch (e) {
          report[key] = { error: String(e) };
        }
      }
    } catch (e) {
      report.error = String(e);
      if (request.exists) request.delete();
    } finally {
      try {
        const output = new File(Paths.document, 'probe-result.json');
        if (!output.exists) output.create();
        output.write(JSON.stringify(report, null, 2));
      } catch (e) {
        console.warn('Could not save model probe', e);
      }
      this.probeRunning = false;
    }
  }

  private writeDebugCapture(result: FrameResult, loaded: LoadedModel, detections: Detection[]): void {
    // More frames may already be in flight with the old worklet capture flag.
    // Consume only one per request, rather than writing several 5 MB tensors.
    if (!this.debugCapture.value) return;
    this.debugCapture.set(false);
    const debug = result.debug;
    if (!debug) return;
    try {
      const dir = new Directory(Paths.document, 'debug');
      if (!dir.exists) dir.create({ intermediates: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const info = loaded.info;
      const layout = info.channelsFirst ? 'nchw' : 'nhwc';
      const write = (name: string, data: string | Uint8Array) => {
        const f = new File(dir, name);
        if (f.exists) f.delete();
        f.create();
        f.write(data);
      };
      write(`${stamp}_input_${info.inputWidth}x${info.inputHeight}_${layout}.f32`, new Uint8Array(debug.input));
      write(`${stamp}_head.f32`, new Uint8Array(debug.head));
      write(
        `${stamp}_meta.json`,
        JSON.stringify(
          {
            model: info.displayName,
            backend: info.backend,
            format: info.format,
            outputShape: info.outputShape,
            labels: info.labels,
            frame: { width: result.frameWidth, height: result.frameHeight, orientation: debug.orientation },
            letterbox: debug.letterbox,
            brightness: result.brightness,
            inferenceMs: result.inferenceMs,
            geometry: this.geometry,
            detections: detections.map((d) => ({
              label: d.label,
              score: d.score,
              box: [d.box.left, d.box.top, d.box.right, d.box.bottom],
            })),
          },
          null,
          2,
        ),
      );
      this.notice.set('Debug frame saved');
    } catch (e) {
      console.warn('Debug capture failed', e);
    }
  }

  // ---- User actions -----------------------------------------------------------------------------

  command(command: UserCommand, quiet = false): void {
    const output = this.engine.command(command, nowMs());
    const extra: Cue[] = [];
    if (command === UserCommand.START_ASSIST) {
      this.assistStartedAt=nowMs();this.trafficFailure=null;
      if (this.settings.value.logSessions) this.logger.start();
      const m = this.model.value;
      if (m.kind === 'missing' || m.kind === 'failed') extra.push(Cues.speak(Phrase.MODEL_MISSING, Priority.HIGH));
      // Unverified signals are identified when observed, not announced as model metadata.
    } else if (command === UserCommand.STOP_ASSIST) {
      this.logger.stop();
    }
    const confirmations = quiet || this.voice.processing
      ? output.cues.filter(c => c.kind !== 'speak' || ![Phrase.ASSIST_STARTED, Phrase.ASSIST_STOPPED, Phrase.CROSSING_ENDED].includes(c.phrase)) : output.cues;
    this.deliverEngine([...confirmations, ...extra]);
    this.publish(output.snapshot, { force: true });
    this.updateKeepAwake(output.snapshot.mode !== AssistMode.IDLE);
  }

  private previewGeneration=0;
  async previewSpeech(cues: Cue[]): Promise<boolean> {
    if (this.assistOn || !this.settings.value.speech || AppState.currentState!=='active') return false;
    const generation=this.previewGeneration;
    this.voice.stop();
    this.feedback.dispatch(cues);
    const complete=await this.feedback.whenIdle();
    return complete && generation===this.previewGeneration && !this.assistOn ;
  }
  stopSpeechPreview(): void {
    ++this.previewGeneration;
    if(!this.assistOn )this.feedback.silence();
    else this.feedback.silenceRoutine();
  }

  /** Plays cues on demand, for the Practice screen: the real sounds, with no traffic involved. */
  practice(cues: Cue[]): void {
    this.deliver(cues);
  }

  get assistOn(): boolean {
    return this.engine.mode !== AssistMode.IDLE;
  }

  setCameraStatus(status: 'starting' | 'running' | 'unavailable', detail:string|null=null): void {
    this.cameraDetail.set(detail);
    if(status==='starting')this.pipeline.set({...EMPTY_PIPELINE});
    if (status !== 'running') { this.lastFrameMs = 0; this.engine.invalidatePerception(); this.feedback.silenceRoutine(); }
    this.cameraStatus.set(status);
  }

  get hasRecentFrame(): boolean { return this.lastFrameMs > 0 && nowMs() - this.lastFrameMs <= 5_000; }

  /** Explicit expected state protects a changed button label from rapid duplicate taps. */
  crossingAction(expected: 'start' | 'finish'): void {
    const mode = this.engine.mode;
    const actual = mode === AssistMode.CROSSING ? 'finish' : 'start';
    if (expected !== actual) return;
    if (expected === 'finish') this.command(UserCommand.END_CROSSING);
    else if (mode !== AssistMode.IDLE) this.command(UserCommand.START_CROSSING);
  }

  repeatGuidance(): void {
    if (this.model.value.kind !== 'ready' || this.cameraStatus.value !== 'running' || !this.hasRecentFrame) {
      this.speakNow(this.model.value.kind!=='ready'?P.detectionUnavailable:perceptionMessage(this.cameraStatus.value,this.hasRecentFrame,this.pipeline.value,nowMs())??P.detectionUnavailable);
    } else this.command(UserCommand.REPEAT_STATUS);
  }

  private updateKeepAwake(on: boolean): void {
    if (on === this.keptAwake) return;
    this.keptAwake = on;
    // The screen stays on while assisting: a locked phone has no camera.
    if (on) activateKeepAwakeAsync('assist').catch(() => undefined);
    else deactivateKeepAwake('assist').catch(() => undefined);
  }

  private checkTrafficAvailability():void {
    if(!this.assistOn || !this.homeVisible || AppState.currentState!=='active' || nowMs()-this.assistStartedAt<3000)return;
    const failure=this.model.value.kind!=='ready'?P.detectionUnavailable:
      !this.hasRecentFrame || nowMs()-this.lastFrameMs>2000?V.trafficUnavailable:this.brightness<.12?V.cameraBlocked:null;
    if(failure===this.trafficFailure)return;
    const wasFailed=!!this.trafficFailure;this.trafficFailure=failure;
    if(failure){this.engine.invalidatePerception();this.feedback.silenceRoutine();this.deliver([Cues.speakText(failure,Priority.HIGH)]);}
    else if(wasFailed)this.speakNow(V.trafficRestored);
  }

  private speakingScanToken:number|null=null;
  private async deliverScan():Promise<void> {
    const instruction=this.engine.scanInstruction;
    if(!instruction || instruction.token===this.queuedScanToken || !this.homeVisible || this.voice.processing)return;
    this.queuedScanToken=instruction.token;
    try {
      if(!await this.feedback.whenIdle() || !this.homeVisible || !this.engine.canSpeakScan(instruction.token,nowMs()) || this.voice.processing)return;
      ++this.voiceAudioGeneration;this.voice.stop();
      this.speakingScanToken=instruction.token;
      const text=phraseText(instruction.phrase);
      this.ui.update(s=>({...s,caption:text}));
      if(await this.feedback.sayAndWait(text))this.engine.acknowledgeScan(instruction.token);
    } finally {
      if(this.speakingScanToken===instruction.token)this.speakingScanToken=null;
      if(this.engine.scanInstruction?.token===instruction.token)this.queuedScanToken=-1;
    }
  }

  private deliverEngine(cues: Cue[]): void {
    if(this.speakingScanToken!==null && this.engine.scanInstruction?.token!==this.speakingScanToken)this.feedback.silenceRoutine();
    void this.deliverScan().catch(() => { this.queuedScanToken=-1; });
    this.deliver(cues);
  }

  // ---- Internals --------------------------------------------------------------------------------

  speakNow(text: string): void {
    this.deliver([Cues.speakText(text, Priority.NORMAL)]);
  }

  private deliver(cues: Cue[]): void {
    if (cues.length === 0) return;
    const urgent = cues.some(c => (c.kind === 'speak' && c.priority >= Priority.NORMAL && c.phrase !== Phrase.ASSIST_STARTED && c.phrase !== Phrase.ASSIST_STOPPED) ||
      (c.kind === 'speakText' && c.priority >= Priority.HIGH) ||
      (c.kind === 'tone' && c.tone !== 'SONAR' && c.tone !== 'CENTERED'));
    if (this.voiceCheck.active) {
      if (urgent) this.voiceCheck.stop();
      else cues = cues.filter(c => c.kind === 'haptic');
    }
    const spoken = cues.some(c => c.kind === 'speak' || c.kind === 'speakText');
    if (this.voice.active && spoken) {
      // Commands narrate their own result; routine model/route speech cannot feed their recognizer.
      if (this.voice.processing && !urgent) cues = cues.filter(c => c.kind === 'haptic');
      else {
        ++this.voiceAudioGeneration;
        this.voice.stop();
        this.feedback.dispatch(cues);
        // A spoken direction or warning ends this listening turn. The microphone re-opens by itself when the
        // speech ends (startVoice waits for the speaker to go idle), unless the user switched voice off.
        for (const cue of cues) { const text = cueText(cue); if (text) this.ui.update(s => ({ ...s, caption: text })); }
        this.startVoice(false, false);
        return;
      }
    }
    this.feedback.dispatch(cues);
    for (let i = cues.length - 1; i >= 0; i--) {
      const text = cueText(cues[i]);
      if (text !== null) {
        this.ui.update((u) => ({ ...u, caption: text }));
        break;
      }
    }
  }

  private publish(
    snapshot: EngineSnapshot,
    opts: { inferenceMs?: number; frameAspect?: number; force?: boolean } = {},
  ): void {
    const now = nowMs();
    if (!opts.force && now - this.lastPublishMs < 66) return;
    this.lastPublishMs = now;
    this.ui.update((u) => ({
      ...u,
      snapshot,
      fps: this.fps,
      inferenceMs: opts.inferenceMs ?? u.inferenceMs,
      frameAspect: opts.frameAspect ?? u.frameAspect,
      frameBrightness: this.brightness,
    }));
  }
}

export const controller = new CrossWiseController();
