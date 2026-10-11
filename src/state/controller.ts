import { EMPTY_PIPELINE, perceptionMessage } from '../perception/pipelineHealth';
import { NativeSpeechInput } from '../voice/nativeSpeech';
import { VoiceAudioCheck } from '../voice/audioCheck';
import { V, spokenError } from '../voice/speechCatalog';
import { NavigationVoice, voiceIntent, VOICE_QUICK_START } from '../voice/navigationVoice';
import { speechStatus } from '../voice/speechStatus';
import { Haptics } from '../feedback/haptics';
import { HapticPattern } from '../feedback/cue';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState, type AppStateStatus } from 'react-native';
import { type CapturedView, describeSurroundings } from '../ai/gemini';
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
import { searchPlaces, walkingRoute, placeDetails, usableFix, type PlaceCandidate, type WalkingRoute } from '../nav/navigation';
import { DestinationPlanner } from '../nav/planner';
import { SavedPlacesRepository } from '../nav/savedPlaces';
import { Journey } from '../nav/journey';
import { cachedLocation, ensureLocationPermission, watchLocation } from '../nav/location';
import { LocationCoordinator } from '../nav/locationCoordinator';
import { walkingCue } from '../nav/feedbackPolicy';
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
import { services } from '../config/services';

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

/** Takes one still for the Gemini scan; registered by the camera view. Returns base64 JPEG, ≤ 768 px. */
export type FrameCapturer = () => Promise<string | null>;

const SCAN_STEPS: [string, string][] = [
  ['left', S.geminiPointLeft],
  ['front', S.geminiPointFront],
  ['right', S.geminiPointRight],
];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  readonly describing = new Store(false);
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
  readonly locations = new LocationCoordinator({ now: Date.now, prepare: ensureLocationPermission,
    cached: cachedLocation, watch: watchLocation });
  readonly journey = new Journey({
    now: Date.now, locate: signal => this.locations.fresh(signal), watch: (fix, error) => this.locations.watch(fix, error),
    search: (query, fix, signal) => searchPlaces(query, fix, services.mapsRestApiKey, signal),
    route: (fix, to, signal) => walkingRoute(fix, to, services.mapsRestApiKey, signal),
    say: text => { if (this.engine.mode !== AssistMode.CROSSING && !this.voice.processing) this.deliver([Cues.speakText(text, Priority.NORMAL)]); },
    silence: () => this.feedback.silenceRoutine(),
  });

  readonly presentation = new Store({ mapOpen: false, expanded: false });
  readonly savedPlaces = new SavedPlacesRepository();
  readonly savedDetails = new Store<Record<string, PlaceCandidate>>({});
  readonly planner = new DestinationPlanner({
    search: (query, signal) => {
      const fix = this.journey.location.value;
      return searchPlaces(query, fix && usableFix(fix, Date.now()) ? fix : null, services.mapsRestApiKey, signal);
    },
    details: (id, signal) => placeDetails(id, services.mapsRestApiKey, signal),
    route: async (to, signal) => {
      const fix = await this.locations.fresh(signal);
      if (signal.aborted) throw new Error('Request cancelled.');
      if (!usableFix(fix, Date.now())) throw new Error('Location uncertain. Retry from the footpath.');
      this.journey.location.set(fix);
      return walkingRoute(fix, to, services.mapsRestApiKey, signal);
    },
    start: async plan => {
      const started = await this.startJourney(plan);
      if (!started) throw new Error(this.engine.mode === AssistMode.CROSSING ? P.confirmFootpath
        : this.journey.state.value.error ?? 'Could not start. Check location and retry.');
      return true;
    },
    cancelStart: () => this.journey.pause(),
    progress: text => this.voiceProgress(text, () => AppState.currentState === 'active'),
    silenceProgress: () => this.feedback.silenceRoutine(),
  });
  private homeVisible = false;
  private unknownCommands = 0;
  private queuedScanToken=-1;
  private assistStartedAt=0;
  private trafficFailure:string|null=null;
  private voiceMuted = false;
  private preserveVoicePlan = false;
  private voiceAudioGeneration = 0;
  private voiceNavigate = false;
  private lastVoiceQuery = '';
  private lastVoicePrompt = '';
  private resumeAfterBackground = false;
  /** Prevents a recurring native/service error from talking over itself while it remains unresolved. */
  private announcedErrors = new Map<string, string>();
  readonly voice = new NavigationVoice({
    input: new NativeSpeechInput(),
    say: async text => {
      this.lastVoicePrompt = text;
      this.ui.update(s => ({ ...s, caption: text }));
      return this.feedback.sayAndWait(text);
    },
    ready: () => this.feedback.dispatch([Cues.haptic(HapticPattern.CENTERED_TICK)]),
    handle: (text, current) => this.handleVoice(text, current),
    cancel: () => { if (!this.preserveVoicePlan) this.planner.cancel(); },
    stopSpeech: () => this.feedback.stopForInterruption(),
    announceListening: () => this.feedback.sayAndWait('Listening.'),
  });
  setHomeVisible(visible: boolean): void {
    this.homeVisible = visible;
    if (visible) {
      this.announceStateError('location', this.locations.state.value.error);
      this.announceStateError('route', this.planner.state.value.error);
      this.announceStateError('saved places', this.savedPlaces.state.value.error);
      const modelState = this.model.value;
      this.announceStateError('detection', modelState.kind === 'failed' ? modelState.message : null);
      void this.locations.start().then(() => this.startVoice());
    }
    else { ++this.voiceAudioGeneration; this.voice.stop(); this.feedback.silenceRoutine(); }
  }
  startVoice(force = false): void {
    if (force) this.voiceMuted = false;
    if (!this.homeVisible || AppState.currentState !== 'active' || this.voiceMuted || !this.settings.value.speech) return;
    if (this.voice.active) return;
    if (this.voiceCheck.active) this.voiceCheck.stop();
    const id = ++this.voiceAudioGeneration;
    void this.feedback.whenIdle().then(idle => {
      if (!idle || id !== this.voiceAudioGeneration || !this.homeVisible || this.voiceMuted || AppState.currentState !== 'active') return;
      this.voice.start(null);
    });
  }
  stopVoice(preservePlan = false): void {
    this.voiceMuted = true; this.voiceNavigate = false;
    ++this.voiceAudioGeneration;
    this.preserveVoicePlan = preservePlan;
    this.voice.stop(); this.preserveVoicePlan = false;
    this.feedback.silenceRoutine();
  }
  toggleVoiceFromGesture(): void {
    if (this.voice.active) {
      this.stopVoice();
      void this.feedback.sayAndWait('Listening stopped.');
    } else {
      this.startVoice(true);
    }
  }
  private async handleVoice(text: string, current: () => boolean): Promise<string | null> {
    if (!current()) return null;
    const intent = voiceIntent(text);
    if (!intent && this.planner.state.value.awaitingLongTrip) return V.longTripAnswer;
    if (!intent) return ++this.unknownCommands >= 2 ? V.unknownHelp : V.unknown;
    this.unknownCommands = 0;
    const describeRoute = () => {
      const s = this.journey.state.value;
      return s.route ? `${s.phase === 'paused' ? 'Navigation paused. ' : ''}${s.route.destination}. ${this.journey.guidanceText()}` : V.destination;
    };
    switch (intent.kind) {
      case 'yes':
        if (!this.planner.state.value.awaitingLongTrip) return V.noConfirmation;
        return await this.startPlannedJourney(true) ? describeRoute() : V.startFailed;
      case 'no':
        if (!this.planner.state.value.awaitingLongTrip) return V.noConfirmation;
        this.cancelPlanning(); return V.cancelled;
      case 'stopListening': this.stopVoice(); return null;
      case 'help': return VOICE_QUICK_START;
      case 'pause':
        if (!this.journey.hasJourney) return V.noRoute;
        this.pauseJourney(); return V.paused;
      case 'resume':
        if (this.planner.state.value.awaitingLongTrip) return V.longTrip;
        if (this.journey.running) return V.running;
        return await this.startJourney() && current() ? describeRoute() : this.journey.state.value.error ? spokenError(this.journey.state.value.error) : V.noPausedRoute;
      case 'end': this.stopNavigation(); return V.stopped;
      case 'repeat':
        if (this.planner.state.value.awaitingLongTrip) return V.longTrip;
        if (this.journey.state.value.crossing || this.engine.mode === AssistMode.CROSSING) { this.repeatGuidance(); return null; }
        return this.journey.hasJourney ? describeRoute() : this.lastVoicePrompt || V.destination;
      case 'cancel': this.cancelPlanning(); return V.cancelled;
      case 'save': {
        const place = this.planner.state.value.selected ?? this.journey.state.value.destination;
        return place ? this.savePlace(place, intent.alias) : V.chooseBeforeSave;
      }
      case 'destination': {
        if (this.journey.state.value.crossing || this.engine.mode === AssistMode.CROSSING) return V.changeBlocked;
        this.voiceNavigate = intent.navigate; this.lastVoiceQuery = intent.query;
        if (this.journey.hasJourney) this.journey.pause();
        this.planner.replace();
        await this.savedPlaces.load(); if (!current()) return null;
        const query = intent.query.toLocaleLowerCase('en-AU').trim();
        const saved = this.savedPlaces.state.value.items.filter(p => (p.alias ?? p.queryLabel ?? '').toLocaleLowerCase('en-AU').trim() === query);
        if (saved.length === 1) {
          await this.planner.resolve(saved[0].placeId); if (!current()) return null;
          return this.voicePlace(current);
        }
        await this.planner.search(intent.query); if (!current()) return null;
        const s = this.planner.state.value;
        if (s.error) return spokenError(s.error);
        if (s.candidates.length === 1) { this.planner.select(s.candidates[0]); return this.voicePlace(current); }
        this.presentation.set({ mapOpen: true, expanded: true });
        if(!s.candidates.length)return V.noPlaces;
        return s.candidates.slice(0, 3).map((p, i) => `${i + 1}. ${p.name}, ${p.address}.`).join(' ')
          + (s.candidates.length === 2 ? ' Say one or two.' : ' Say one, two, or three.');
      }
      case 'choose': {
        const s = this.planner.state.value;
        const place = s.page === 'results' ? s.candidates[intent.index] : null;
        if (!place) return V.resultUnavailable;
        this.planner.select(place); return this.voicePlace(current);
      }
      case 'retry': {
        const selected = this.planner.state.value.selected;
        if (selected) return this.voicePlace(current);
        return this.lastVoiceQuery ? this.handleVoice(`${this.voiceNavigate ? 'navigate to' : 'search'} ${this.lastVoiceQuery}`, current) : V.destination;
      }
      case 'next': {
        const s = this.journey.state.value;
        if (s.crossing || this.engine.mode === AssistMode.CROSSING) return V.finishCrossingFirst;
        if (!this.journey.running || !s.route) return s.phase === 'paused' ? V.paused : V.noRoute;
        if (s.stepIndex === s.route.steps.length - 1) return V.finalInstruction;
        this.journey.next(s.stepIndex); return describeRoute();
      }
      case 'arrived': {
        const s = this.journey.state.value;
        if (s.crossing || this.engine.mode === AssistMode.CROSSING) return V.finishCrossingFirst;
        if (!this.journey.running || !s.route) return s.phase === 'paused' ? V.paused : V.noRoute;
        if (s.stepIndex !== s.route.steps.length - 1) return V.arrivalTooSoon;
        this.finishJourney(s.stepIndex); return P.arrived(s.route.destination);
      }
      case 'finishCrossing': {
        if (!this.journey.state.value.crossing && this.engine.mode !== AssistMode.CROSSING) return V.noCrossing;
        this.command(UserCommand.END_CROSSING);
        return this.journey.running ? describeRoute() : this.journey.state.value.phase === 'paused' ? P.crossingPaused : V.crossingEnded;
      }
      case 'confirm':
        if (this.planner.state.value.awaitingLongTrip) return V.longTrip;
        if (this.journey.state.value.crossing || this.engine.mode===AssistMode.CROSSING) return V.changeBlocked;
        if (this.journey.hasJourney && !this.planner.state.value.selected) return V.completionCommands;
        this.voiceNavigate = true; return this.voicePlace(current);
    }
  }
  private async voiceProgress(text: string, current: () => boolean): Promise<boolean> {
    if (!current() || this.feedback.busy) return false;
    this.ui.update(s => ({ ...s, caption: text }));
    return await this.feedback.sayAndWait(text) && current();
  }
  private async voicePlace(current: () => boolean): Promise<string | null> {
    const selected = this.planner.state.value.selected;
    if (!selected) return this.planner.state.value.error ? spokenError(this.planner.state.value.error) : V.destination;
    if (!this.voiceNavigate) return V.place(selected.name, selected.address);
    await this.planner.confirm(selected.id); if (!current()) return null;
    const s = this.planner.state.value;
    if (s.error || !s.route) return s.error ? spokenError(s.error) : V.routeUnavailable;
    const started = await this.startPlannedJourney();
    if (!current()) return null;
    if (this.planner.state.value.awaitingLongTrip) return V.longTrip;
    if (!started) return this.journey.state.value.error ? spokenError(this.journey.state.value.error) : V.startFailed;
    return V.routeStarted(selected.name, this.journey.guidanceText());
  }
  openMap(): void { this.presentation.update(s => ({ ...s, mapOpen: true })); }
  closeMap(): void { this.planner.cancel(); this.presentation.set({ mapOpen: false, expanded: false }); }
  changeDestination(): boolean {
    if (this.journey.state.value.crossing || this.engine.mode === AssistMode.CROSSING) { this.sayNavigation(P.confirmFootpath); return false; }
    if (this.journey.hasJourney) this.pauseJourney();
    this.planner.replace(); this.presentation.set({ mapOpen: true, expanded: true }); return true;
  }
  cancelPlanning(): void { this.planner.reset(); this.presentation.update(s => ({ ...s, expanded: false })); }
  async startPlannedJourney(longTripConfirmed = false): Promise<boolean> {
    if (longTripConfirmed && !this.planner.state.value.awaitingLongTrip) return false;
    if (longTripConfirmed && !this.voice.processing) this.stopVoice(true);
    const started = await this.planner.start(this.planner.state.value.revision, longTripConfirmed);
    if (started) this.presentation.set({ mapOpen: false, expanded: false });
    else if (this.planner.state.value.awaitingLongTrip && !this.voice.processing && this.settings.value.speech && AppState.currentState === 'active') {
      this.voiceMuted = false;
      this.voice.start(V.longTrip);
    }
    return started;
  }
  sayNavigation(text: string): void { this.deliver([Cues.speakText(text, Priority.NORMAL)]); }
  async savePlace(place: PlaceCandidate, alias?: string): Promise<string> {
    try {
      const draft = this.planner.state.value;
      const queryLabel = draft.candidates.some(p => p.id === place.id) ? draft.query || undefined : undefined;
      const result = await this.savedPlaces.save(place.id, queryLabel, alias);
      this.savedDetails.update(s => ({ ...s, [place.id]: place }));
      return alias ? V.savedAs(alias) : result === 'saved' ? V.saved : V.alreadySaved;
    } catch (e) { return spokenError(e, 'save'); }
  }
  async removeSaved(placeId: string): Promise<string> {
    try { await this.savedPlaces.remove(placeId); return V.removed; }
    catch (e) { return spokenError(e, 'remove'); }
  }
  async undoSaved(): Promise<string> {
    try { await this.savedPlaces.undo(); return V.restored; }
    catch (e) { return spokenError(e, 'restore'); }
  }
  /** Resolve only visible shortcuts; cancellation cannot publish a late result. */
  async loadSavedDetails(ids: string[], signal: AbortSignal): Promise<void> {
    for (const id of ids.slice(0, 3)) {
      if (signal.aborted) return;
      if (this.savedDetails.value[id]) continue;
      try {
        const place = await placeDetails(id, services.mapsRestApiKey, signal);
        if (!signal.aborted) this.savedDetails.update(s => ({ ...s, [id]: place }));
      } catch { /* The local bookmark remains usable; selection offers an explicit retry. */ }
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
  private capturer: FrameCapturer | null = null;
  private probeRunning = false;
  private speechProbeRunning = false;
  private keptAwake = false;
  private started = false;

  /** Idempotent: called once when the app mounts. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.locations.state.subscribe(() => {
      const s = this.locations.state.value;
      if (!this.journey.running) this.journey.location.set(s.status === 'ready' ? s.fix : null);
      this.announceStateError('location', s.error);
    });
    this.planner.state.subscribe(() => this.announceStateError('route', this.planner.state.value.error));
    this.savedPlaces.state.subscribe(() => this.announceStateError('saved places', this.savedPlaces.state.value.error));
    this.model.subscribe(() => {
      const state = this.model.value;
      this.announceStateError('detection', state.kind === 'failed' ? state.message : null);
    });
    this.journey.state.subscribe(() => {
      this.applyEngineSettings();
      this.updateKeepAwake(this.engine.mode !== AssistMode.IDLE || this.journey.running);
    });
    this.settingsRepository.subscribe((s) => this.onSettings(s));
    this.settingsRepository
      .load()
      .catch(() => undefined)
      .finally(() => this.settingsLoaded.set(true));
    void this.savedPlaces.load();
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

  /** Put recoverable service failures through the same audio queue as normal guidance. */
  private announceStateError(source: string, error: string | null): void {
    if (!error) {
      this.announcedErrors.delete(source);
      return;
    }
    // Keep the state error for the next foreground turn; do not consume it while
    // the app is hidden and unable to deliver audio.
    if (!this.homeVisible || AppState.currentState !== 'active') return;
    if (this.announcedErrors.get(source) === error) return;
    this.announcedErrors.set(source, error);
    // A voice command receives its own concise error response. Announcing the state
    // transition as well would duplicate it and make the user lose the next turn.
    if (this.voice.processing || !this.homeVisible || AppState.currentState !== 'active') return;
    const text = source === 'detection' ? P.detectionUnavailable : source === 'saved places' ? V.savedUnavailable : spokenError(error, 'route');
    this.deliver([Cues.speakText(text, Priority.HIGH)]);
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
    if (this.journey.hasJourney || this.settings.value.interfaceMode !== InterfaceMode.DEVELOPER) settings.autoDetectCrossing = false;
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
    this.announceStateError('location', this.locations.state.value.error);
    this.announceStateError('route', this.planner.state.value.error);
    this.announceStateError('saved places', this.savedPlaces.state.value.error);
    const modelState = this.model.value;
    this.announceStateError('detection', modelState.kind === 'failed' ? modelState.message : null);
    // First launch waits for the camera permission screen before requesting location.
    // Existing journeys can recover immediately when returning from the background.
    if (this.homeVisible || this.journey.hasJourney) void this.locations.start().then(async () => {
      if (AppState.currentState !== 'active') return;
      if (this.resumeAfterBackground && this.journey.state.value.phase === 'paused' && !this.journey.state.value.crossing) {
        this.resumeAfterBackground = false;
        await this.startJourney();
      }
      this.startVoice();
    });
    // A conf file edited in the Files app while we were away takes effect now.
    if (this.settingsLoaded.value) void this.settingsRepository.load();
    this.refreshModelLibrary();
  }

  private onBackground(): void {
    // The camera stops in the background, so any signal state would go stale: say so and stop.
    ++this.voiceAudioGeneration; this.voice.stop();
    ++this.descriptionGeneration;
    this.resumeAfterBackground = this.journey.running && !this.journey.state.value.crossing;
    this.planner.cancel();
    const hadJourney = this.journey.hasJourney;
    this.journey.pause();
    this.locations.stop(); this.journey.location.set(null);
    if (this.engine.mode !== AssistMode.IDLE) this.command(UserCommand.STOP_ASSIST, true);
    if (hadJourney) this.deliver([Cues.speakText(P.journeyPaused, Priority.NORMAL)]);
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
    this.pipeline.update(p=>({receivedAt:nowMs(),latencyMs:age,slowFrames:p.slowFrames+(age>350?1:0),error:null}));
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
    // Preserve requested diagnostics even when inference is too old for live guidance.
    if(age < 0 || age > 350) return;
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
    if (this.speechProbeRunning || this.journey.hasJourney || this.assistOn || AppState.currentState !== 'active') return;
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
        if (AppState.currentState !== 'active' || this.journey.hasJourney) throw new Error('Test interrupted.');
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

  registerCapturer(capturer: FrameCapturer | null): void {
    this.capturer = capturer;
  }

  // ---- User actions -----------------------------------------------------------------------------

  command(command: UserCommand, preserveJourney = false): void {
    // Explicit Assist controls can also enter/leave the crossing handoff while a journey is running.
    const wasCrossing = this.engine.mode === AssistMode.CROSSING;
    if (command === UserCommand.STOP_ASSIST && !preserveJourney) this.journey.end();
    if (this.journey.hasJourney && (command === UserCommand.START_CROSSING ||
        (command === UserCommand.TOGGLE_CROSSING && !wasCrossing))) this.journey.enterCrossing();
    const output = this.engine.command(command, nowMs());
    if (this.journey.state.value.phase === 'paused' && this.journey.state.value.crossing &&
        (command === UserCommand.END_CROSSING || (command === UserCommand.TOGGLE_CROSSING && wasCrossing))) {
      this.journey.leaveCrossing();
      this.stopJourneyEngine();
      this.speakNow(P.crossingPaused);
      return;
    }
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
    const confirmations = preserveJourney || this.voice.processing
      ? output.cues.filter(c => c.kind !== 'speak' || ![Phrase.ASSIST_STARTED, Phrase.ASSIST_STOPPED, Phrase.CROSSING_ENDED].includes(c.phrase)) : output.cues;
    this.deliverEngine([...confirmations, ...extra]);
    if (this.journey.state.value.crossing && (command === UserCommand.END_CROSSING ||
        (command === UserCommand.TOGGLE_CROSSING && wasCrossing))) this.journey.leaveCrossing();
    this.publish(output.snapshot, { force: true });
    this.updateKeepAwake(output.snapshot.mode !== AssistMode.IDLE || this.journey.running);
  }

  private previewGeneration=0;
  async previewSpeech(cues: Cue[]): Promise<boolean> {
    if (this.assistOn || this.journey.hasJourney || !this.settings.value.speech || AppState.currentState!=='active') return false;
    const generation=this.previewGeneration;
    this.voice.stop();
    this.feedback.dispatch(cues);
    const complete=await this.feedback.whenIdle();
    return complete && generation===this.previewGeneration && !this.assistOn && !this.journey.hasJourney;
  }
  stopSpeechPreview(): void {
    ++this.previewGeneration;
    if(!this.assistOn && !this.journey.hasJourney)this.feedback.silence();
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
  crossingAction(expected: 'help' | 'start' | 'finish'): void {
    const s = this.journey.state.value;
    const mode = this.engine.mode;
    const actual = mode === AssistMode.CROSSING || (s.phase === 'paused' && s.crossing) ? 'finish'
      : this.journey.running && !s.crossing ? 'help' : 'start';
    if (expected !== actual) return;
    if (expected === 'finish') this.command(UserCommand.END_CROSSING);
    else if (expected === 'help') this.crossingForJourney();
    else if (mode !== AssistMode.IDLE && s.phase !== 'paused') this.command(UserCommand.START_CROSSING);
  }

  repeatGuidance(): void {
    if (this.journey.running && !this.journey.state.value.crossing) this.journey.repeat();
    else if (this.model.value.kind !== 'ready' || this.cameraStatus.value !== 'running' || !this.hasRecentFrame) {
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

  // ---- Describe surroundings (Gemini) -------------------------------------------------------------

  /**
   * The three-view scan from AN-S3: the traveler is asked to point left, ahead and right, one frame is taken at
   * each, and Gemini answers in a sentence or two. Spoken, because the person who needs it is not reading.
   */
  private descriptionGeneration=0;
  describeSurroundings(): void {
    if (this.describing.value || this.engine.mode===AssistMode.CROSSING || this.journey.state.value.crossing) return;
    const descriptionGeneration=++this.descriptionGeneration;
    const key = services.geminiApiKey;
    if (key.trim().length === 0) {
      this.notice.set(S.geminiNoKey);
      this.speakNow(S.geminiNoKey);
      return;
    }
    this.describing.set(true);
    void (async () => {
      const views: CapturedView[] = [];
      try {
        for (const [label, phrase] of SCAN_STEPS) {
          if(descriptionGeneration!==this.descriptionGeneration || this.engine.mode===AssistMode.CROSSING || this.journey.state.value.crossing)return;
          this.speakNow(phrase);
          await sleep(2_200);
          const jpeg = await this.captureFrame();
          if (jpeg) views.push({ direction: label, jpegBase64: jpeg });
        }
        let text: string;
        try {
          text = await describeSurroundings(views, key);
        } catch (e) {
          console.warn('describeSurroundings failed', e);
          text = S.geminiFailed;
        }
        if(descriptionGeneration!==this.descriptionGeneration || this.engine.mode===AssistMode.CROSSING || this.journey.state.value.crossing)return;
        this.notice.set(text);
        this.speakNow(text);
      } finally {
        this.describing.set(false);
      }
    })();
  }

  private async captureFrame(): Promise<string | null> {
    try {
      return (await this.capturer?.()) ?? null;
    } catch (e) {
      console.warn('Capture failed', e);
      return null;
    }
  }

  // ---- Walking navigation -----------------------------------------------------------------------

  async startJourney(plan?: { destination: PlaceCandidate; route: WalkingRoute }): Promise<boolean> {
    const draft = this.journey.state.value;
    if (!plan && draft.phase === 'idle' && draft.route && draft.destination && draft.route.distanceMeters > 1000) {
      this.planner.review(draft.destination, draft.route);
      this.presentation.set({ mapOpen: true, expanded: true });
      return this.startPlannedJourney();
    }
    const crossingNow = () => this.engine.mode === AssistMode.CROSSING;
    if (crossingNow()) {
      this.notice.set(P.confirmFootpath);
      this.speakNow(P.confirmFootpath);
      return false;
    }
    // Silence old signal-search speech before the route takes over.
    this.feedback.silenceRoutine();
    if (await this.journey.start(plan)) {
      this.applyEngineSettings();
      if (this.engine.mode === AssistMode.CROSSING) this.journey.enterCrossing();
      if (this.engine.mode === AssistMode.IDLE) this.command(UserCommand.START_ASSIST, true);
      return true;
    }
    return false;
  }

  crossingForJourney(): void {
    if (!this.journey.running) return;
    this.journey.enterCrossing();
    if (this.engine.mode === AssistMode.IDLE) this.command(UserCommand.START_ASSIST, true);
    this.deliver([Cues.speakText(P.crossingHelp, Priority.NORMAL)]);
  }

  pauseJourney(): void {
    this.resumeAfterBackground = false;
    const active = this.journey.hasJourney;
    this.journey.pause();
    const location = this.locations.state.value;
    if (location.status === 'ready') this.journey.location.set(location.fix);
    // Keep micro guidance available when the traveler pauses only the route in the foreground.
    if (!this.journey.state.value.crossing && this.engine.mode !== AssistMode.IDLE) this.command(UserCommand.STOP_ASSIST, true);
    if (active && !this.voice.processing) this.speakNow(P.journeyPaused);
  }

  finishJourney(step: number): void {
    this.journey.arrive(step);
    if (this.journey.state.value.phase === 'arrived') this.stopJourneyEngine();
  }

  stopNavigation(): void {
    this.planner.reset();
    this.resumeAfterBackground = false;
    this.journey.end();
    this.stopJourneyEngine();
    if (!this.voice.processing) this.speakNow(P.journeyEnded);
  }

  private stopJourneyEngine(): void {
    const output = this.engine.command(UserCommand.STOP_ASSIST, nowMs());
    this.logger.stop();
    this.publish(output.snapshot, { force: true });
    this.updateKeepAwake(false);
  }

  private checkTrafficAvailability():void {
    if(!this.assistOn || !this.homeVisible || AppState.currentState!=='active' || nowMs()-this.assistStartedAt<3000)return;
    const failure=this.model.value.kind!=='ready'?P.detectionUnavailable:
      !this.hasRecentFrame || nowMs()-this.lastFrameMs>2000?V.trafficUnavailable:this.brightness<.12?V.cameraBlocked:null;
    if(failure===this.trafficFailure)return;
    const wasFailed=!!this.trafficFailure;this.trafficFailure=failure;
    if(failure){this.engine.invalidatePerception();this.feedback.silenceRoutine();this.deliver([Cues.speakText(failure,Priority.HIGH)]);}
    else if(wasFailed)this.sayNavigation(V.trafficRestored);
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
    const s = this.journey.state.value;
    const relevant = this.journey.hasJourney && !s.crossing ? cues.filter(walkingCue) : cues;
    // Search tutorials are available in Help/Repeat; do not repeat them into street noise.
    this.deliver(relevant);
  }

  // ---- Internals --------------------------------------------------------------------------------

  private speakNow(text: string): void {
    this.deliver([Cues.speakText(text, Priority.NORMAL)]);
  }

  private deliver(cues: Cue[]): void {
    if (cues.length === 0) return;
    const trafficWarning=cues.some(c=>c.kind==='speak' && (c.phrase.startsWith('VEHICLE_') || c.phrase===Phrase.TRAFFIC_UNAVAILABLE));
    if(trafficWarning)++this.descriptionGeneration;
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
        // A spoken direction or warning ends this listening turn. The user can
        // deliberately double-tap the camera to start another turn.
        for (const cue of cues) { const text = cueText(cue); if (text) this.ui.update(s => ({ ...s, caption: text })); }
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
