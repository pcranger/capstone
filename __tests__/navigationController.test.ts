import { P } from '../src/strings';
import { InterfaceMode } from '../src/settings/settings';
import { AppState } from 'react-native';
import { CrossWiseController } from '../src/state/controller';
import { AssistMode, UserCommand } from '../src/crossing/crossingEngine';
import { Cues, Phrase, Priority } from '../src/feedback/cue';
import { searchPlaces, walkingRoute, type WalkingRoute } from '../src/nav/navigation';

const mockDispatch = jest.fn();
const mockSilence = jest.fn();
jest.mock('../src/feedback/feedbackEngine', () => ({ FeedbackEngine: class {
  sayAndWait = jest.fn(async () => true); whenIdle = jest.fn(async () => true);
  dispatch = mockDispatch; silenceRoutine = mockSilence; silence = jest.fn();
} }));
jest.mock('../src/sensors/motionSensors', () => ({ MotionSensors: class { start() {} stop() {} latestOrientation = null; isWalking = false; } }));
jest.mock('../src/perception/modelLoader', () => ({ listModels: () => [], resolveSource: jest.fn(() => null), loadModel: jest.fn() }));
jest.mock('../src/perception/modelProbe', () => ({ probeDetector: jest.fn() }));
jest.mock('../src/logging/sessionLogger', () => ({ SessionLogger: class { start() {} stop() {} log() {} } }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; create() {} write() {} }, Directory: class {}, Paths: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock('../src/nav/location', () => ({
  locate: jest.fn(async () => ({ latitude: -33.87, longitude: 151.21, timestamp: Date.now(), accuracy: 5 })),
  ensureLocationPermission: jest.fn(async () => undefined), cachedLocation: jest.fn(async () => null),
  watchLocation: jest.fn(async (onFix: any) => { onFix({ latitude: -33.87, longitude: 151.21, timestamp: Date.now(), accuracy: 5 }); return { remove: jest.fn() }; }),
}));
jest.mock('../src/nav/navigation', () => ({ ...jest.requireActual('../src/nav/navigation'), searchPlaces: jest.fn(), walkingRoute: jest.fn() }));
const point = { latitude: -33.87, longitude: 151.21 };
const destination = { id: 'test', name: 'Library', address: 'Test suburb', point };
const route: WalkingRoute = { destination: 'Library', destinationAddress: 'Test suburb', points: [point, { ...point, latitude: -33.869 }], distanceMeters: 110, durationSeconds: 90, warnings: [],
  steps: [{ instruction: 'Head north on Test Street', maneuver: 'DEPART', distanceMeters: 110, points: [point, { ...point, latitude: -33.869 }] }] };
let c: CrossWiseController;
const originalAppState=AppState.currentState;
beforeEach(async () => {
  jest.useFakeTimers(); mockDispatch.mockClear(); mockSilence.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  (searchPlaces as jest.Mock).mockResolvedValue([destination]); (walkingRoute as jest.Mock).mockResolvedValue(route);
  c = new CrossWiseController(); c.start(); await Promise.resolve(); await Promise.resolve();
  c.model.set({ kind: 'ready', info: { hasPedestrianSignalClasses: true } as any });
  await c.journey.search('Library'); await c.journey.select(destination); await c.startJourney(); mockDispatch.mockClear();
});
afterEach(() => { AppState.currentState=originalAppState;c.stopNavigation(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('journey starts assistance once and disables heuristic crossing detection without changing saved preferences', () => {
  expect(c.assistOn).toBe(true); expect(c.journey.running).toBe(true);
  expect((c as any).engine.settings.autoDetectCrossing).toBe(false); expect(c.settings.value.autoDetectCrossing).toBe(true);
  (c as any).deliverEngine([Cues.speak(Phrase.SIGNAL_CENTERED, Priority.NORMAL), Cues.speak(Phrase.VEHICLE_CLOSE_AHEAD, Priority.CRITICAL)]);
  expect(mockDispatch).toHaveBeenCalledWith([Cues.speak(Phrase.VEHICLE_CLOSE_AHEAD, Priority.CRITICAL)]);
});
test('crossing handoff mutes route speech; explicit footpath finish resumes the same journey and restores route filtering', () => {
  c.crossingForJourney(); expect(c.journey.state.value.crossing).toBe(true);
  c.command(UserCommand.START_CROSSING); expect(c.ui.value.snapshot.mode).toBe(AssistMode.CROSSING);
  mockDispatch.mockClear(); c.journey.repeat(); expect(mockDispatch).not.toHaveBeenCalled();
  c.command(UserCommand.END_CROSSING);
  expect(c.journey.state.value.crossing).toBe(false); expect(c.journey.running).toBe(true); expect(c.assistOn).toBe(true);
  expect(mockDispatch.mock.calls.flat(2).some((cue: any) => cue.text?.includes('Head north on Test Street'))).toBe(true);
});
test('backgrounding stops the camera engine, keeps the crossing unfinished, and requires explicit resume from the footpath', async () => {
  c.crossingForJourney(); c.command(UserCommand.START_CROSSING);
  const onState = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1]; onState('background');
  expect(c.assistOn).toBe(false); expect(c.journey.state.value.phase).toBe('paused'); expect(c.journey.state.value.crossing).toBe(true);
  await c.startJourney(); expect(c.journey.running).toBe(false);
  c.command(UserCommand.END_CROSSING); expect(c.journey.state.value.crossing).toBe(false); await c.startJourney();
  expect(c.journey.running).toBe(true); expect(c.assistOn).toBe(true);
});
test('Stop ends the journey; automatic crossing remains experimental in Developer mode only', () => {
  c.command(UserCommand.STOP_ASSIST); expect(c.journey.hasJourney).toBe(false); expect(c.assistOn).toBe(false);
  expect((c as any).engine.settings.autoDetectCrossing).toBe(false);
  (c as any).onSettings({ ...c.settings.value, interfaceMode: InterfaceMode.DEVELOPER });
  expect((c as any).engine.settings.autoDetectCrossing).toBe(true);
});
test('explicit destination confirmation stops assistance without requiring a second stop', () => {
  c.finishJourney(0); expect(c.journey.state.value.phase).toBe('arrived'); expect(c.assistOn).toBe(false);
});

test('a crossing begun while the route is paused also survives backgrounding as unfinished', () => {
  c.pauseJourney(); c.command(UserCommand.START_ASSIST); c.command(UserCommand.START_CROSSING);
  expect(c.journey.state.value.crossing).toBe(true);
  const onState = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1]; onState('background');
  expect(c.journey.state.value.crossing).toBe(true); expect(c.journey.state.value.phase).toBe('paused');
});
test('Repeat selects the walking instruction during a journey', () => {
  c.repeatGuidance();
  expect(mockDispatch.mock.calls.flat(2).some((cue: any) => cue.text?.includes('Head north on Test Street'))).toBe(true);
});

test('backgrounding ordinary route walking announces that guidance is paused', () => {
  const onState = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1]; onState('background');
  expect(mockDispatch.mock.calls.flat(2).some((cue: any) => cue.text?.startsWith('Navigation paused.'))).toBe(true);
});

test('rapid duplicate crossing taps cannot skip help, start a new crossing, or resume a paused route', async () => {
  c.crossingAction('help'); c.crossingAction('help');
  expect(c.journey.state.value.crossing).toBe(true); expect(c.ui.value.snapshot.mode).toBe(AssistMode.SEARCHING);
  c.crossingAction('start'); c.crossingAction('start'); expect(c.ui.value.snapshot.mode).toBe(AssistMode.CROSSING);
  c.crossingAction('finish'); c.crossingAction('finish');
  expect(c.ui.value.snapshot.mode).not.toBe(AssistMode.CROSSING); expect(c.journey.state.value.crossing).toBe(false);
  c.crossingAction('help'); c.crossingAction('start');
  const onState = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1]; onState('background');
  c.crossingAction('finish'); c.crossingAction('finish'); c.crossingAction('start');
  expect(c.assistOn).toBe(false); expect(c.journey.state.value.phase).toBe('paused'); expect(c.journey.state.value.crossing).toBe(false);
});

test('Repeat crossing status reports unavailable camera observations instead of repeating stale signal state', () => {
  c.crossingAction('help'); c.crossingAction('start'); mockDispatch.mockClear();
  c.cameraStatus.set('unavailable'); c.repeatGuidance();
  const cues = mockDispatch.mock.calls.flat(2);
  expect(cues.some((cue: any) => cue.text === P.cameraUnavailable)).toBe(true);
  expect(cues.some((cue: any) => cue.phrase === Phrase.WALK_STARTED)).toBe(false);
});

test('finishing a foreground paused crossing stops local guidance and keeps the route paused', () => {
  c.crossingAction('help'); c.crossingAction('start'); c.pauseJourney();
  expect(c.assistOn).toBe(true); mockDispatch.mockClear(); c.crossingAction('finish');
  expect(c.assistOn).toBe(false); expect(c.journey.state.value.phase).toBe('paused'); expect(c.journey.state.value.crossing).toBe(false);
  expect(mockDispatch.mock.calls.flat(2).some((cue: any) => cue.text === P.crossingPaused)).toBe(true);
});

test('camera recovery waits for a new analysed frame instead of reviving the last session', () => {
  c.loadedModel.set({ info: { labels: [] }, categories: [] } as any);
  const frame = { detections: [], frameWidth: 720, frameHeight: 1280, inferenceMs: 0, brightness: 0.5, mask: null, debug: null };
  jest.advanceTimersByTime(100); c.setCameraStatus('running'); c.onFrame(frame); expect(c.hasRecentFrame).toBe(true);
  c.setCameraStatus('unavailable'); c.setCameraStatus('running'); expect(c.hasRecentFrame).toBe(false);
  jest.advanceTimersByTime(100); c.onFrame(frame); expect(c.hasRecentFrame).toBe(true);
});

test('model startup is quiet and supported signal events remain available during crossing help', () => {
  c.stopNavigation(); c.model.set({ kind: 'ready', info: { hasPedestrianSignalClasses: false } as any }); mockDispatch.mockClear();
  c.command(UserCommand.START_ASSIST);
  expect(mockDispatch.mock.calls.flat(2).some((cue: any) => cue.phrase === 'BASELINE_MODEL')).toBe(false);
  mockDispatch.mockClear();
  (c as any).deliverEngine([Cues.speak(Phrase.SIGNAL_CENTERED, Priority.LOW), Cues.speak(Phrase.DONT_WALK, Priority.HIGH),
    Cues.speak(Phrase.VEHICLE_CLOSE_LEFT, Priority.CRITICAL)]);
  expect(mockDispatch).toHaveBeenCalledWith([Cues.speak(Phrase.SIGNAL_CENTERED, Priority.LOW), Cues.speak(Phrase.DONT_WALK, Priority.HIGH), Cues.speak(Phrase.VEHICLE_CLOSE_LEFT, Priority.CRITICAL)]);
});
test('successful model load produces no startup notice or speech', async () => {
  const loader = require('../src/perception/modelLoader');
  loader.resolveSource.mockReturnValueOnce({ kind: 'asset', name: 'test', module: 1 });
  loader.loadModel.mockResolvedValueOnce({ info: { labels: ['car'], displayName: 'test' } });
  mockDispatch.mockClear(); c.notice.set(null);
  await (c as any).loadModelFor(c.settings.value);
  expect(c.model.value.kind).toBe('ready'); expect(c.notice.value).toBeNull(); expect(mockDispatch).not.toHaveBeenCalled();
});


test('cancelled destination replacement preserves the paused original route and instruction', async () => {
  const original = c.journey.state.value.route; const step = c.journey.state.value.stepIndex;
  expect(c.changeDestination()).toBe(true); expect(c.journey.state.value.phase).toBe('paused');
  await c.planner.search('Another destination'); c.cancelPlanning();
  expect(c.journey.state.value.route).toBe(original); expect(c.journey.state.value.stepIndex).toBe(step);
  expect(await c.startJourney()).toBe(true);
});
test('failed replacement start preserves original route, and unfinished crossing refuses replacement', async () => {
  const original = c.journey.state.value.route;
  c.changeDestination(); const next = { ...destination, id: 'next', name: 'Next' };
  c.planner.select(next); await c.planner.confirm(next.id);
  jest.spyOn(c.locations, 'fresh').mockRejectedValueOnce(new Error('GPS unavailable'));
  expect(await c.startPlannedJourney()).toBe(false); expect(c.journey.state.value.route).toBe(original);
  c.cancelPlanning(); await c.startJourney(); c.crossingForJourney();
  expect(c.changeDestination()).toBe(false); expect(c.journey.state.value.crossing).toBe(true);
});

test.each([Cues.speak(Phrase.VEHICLE_AHEAD, Priority.HIGH), Cues.speak(Phrase.DONT_WALK, Priority.NORMAL)])('traffic and signal warnings end microphone capture and still reach feedback: %p', cue => {
  c.voiceCheck.state.set({ phase: 'listening', text: 'Listening…' });
  const stop = jest.spyOn(c.voiceCheck, 'stop'); c.practice([cue]);
  expect(stop).toHaveBeenCalledTimes(1); expect(c.voiceCheck.active).toBe(false); expect(mockDispatch).toHaveBeenLastCalledWith([cue]);
});
test('routine narration cannot feed the active recognizer; background stops the check', () => {
  c.voiceCheck.state.set({ phase: 'listening', text: 'Listening…' }); c.sayNavigation('Saved.');
  expect(mockDispatch).toHaveBeenLastCalledWith([]); expect(c.voiceCheck.active).toBe(true);
  const onState = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1]; onState('background');
  expect(c.voiceCheck.active).toBe(false);
});

test('voice destination command starts an unambiguous route through the shared planner', async () => {
  c.stopNavigation();
  const response = await (c as any).handleVoice('navigate to Library', () => true);
  expect(c.journey.running).toBe(true); expect(response).toContain('Library. Head north');
});
test('voice search does not start a route; selecting and saving preserve the same place identity', async () => {
  c.stopNavigation();
  await (c as any).handleVoice('search Library', () => true);
  expect(c.journey.running).toBe(false); expect(c.planner.state.value.selected?.id).toBe(destination.id);
  expect(await (c as any).handleVoice('save as Home', () => true)).toBe('Saved as Home.');
  expect(c.savedPlaces.state.value.items[0]).toMatchObject({ placeId: destination.id, alias: 'Home' });
});
test('multiple voice matches wait for a destination choice, never silently choose the first', async () => {
  c.stopNavigation(); (searchPlaces as jest.Mock).mockResolvedValueOnce([destination, { ...destination, id: 'second', name: 'Another Library' }]);
  const response = await (c as any).handleVoice('navigate to Library', () => true);
  expect(response).toContain('Say first or second'); expect(c.journey.running).toBe(false);
  await (c as any).handleVoice('second', () => true);
  expect(c.journey.state.value.destination?.id).toBe('second');
});
test('a cancelled voice search cannot start a route when its network result arrives', async () => {
  c.stopNavigation(); let resolve!: (places: typeof destination[]) => void;
  (searchPlaces as jest.Mock).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  let current = true;
  const request = (c as any).handleVoice('navigate to Library', () => current);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  current = false; c.planner.cancel(); resolve([destination]); await request;
  expect(c.journey.running).toBe(false);
});
test('pausing route guidance preserves the fresh map location and the foreground GPS owner', () => {
  const fix = c.journey.location.value; c.pauseJourney();
  expect(c.journey.location.value).toEqual(fix); expect(c.locations.state.value.status).toBe('ready');
});

test('ordinary route resumes after background recovery, explicit pause does not', async () => {
  const onState = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1];
  const original = AppState.currentState; AppState.currentState = 'active';
  onState('background'); expect(c.journey.running).toBe(false);
  onState('active'); for (let i = 0; i < 25; i++) await Promise.resolve();
  expect(c.journey.running).toBe(true);
  c.pauseJourney(); onState('background'); onState('active');
  for (let i = 0; i < 25; i++) await Promise.resolve();
  expect(c.journey.state.value.phase).toBe('paused');
  AppState.currentState = original;
});

test('home entry silently arms voice; Settings cancels it and late speech is ignored', async () => {
  c.stopNavigation(); const original = AppState.currentState; AppState.currentState = 'active';
  let resolve!: (value: string) => void;
  const input = { prepare: jest.fn(async () => undefined), listen: jest.fn(ready => { ready(); return new Promise<string>(r => { resolve = r; }); }), cancel: jest.fn() };
  (c.voice as any).deps.input = input;
  c.setHomeVisible(true); for (let i = 0; i < 25; i++) await Promise.resolve();
  expect((c as any).feedback.sayAndWait).not.toHaveBeenCalled();
  expect(mockDispatch.mock.calls.flat(2).some((cue: any)=>cue.tone==='LISTENING')).toBe(true);
  expect(c.voice.state.value.phase).toBe('listening');
  c.setHomeVisible(false); resolve('navigate to Library');
  for (let i = 0; i < 25; i++) await Promise.resolve();
  expect(c.voice.active).toBe(false); expect(c.journey.running).toBe(false);
  AppState.currentState = original;
});
test('first launch defers the location permission request until camera onboarding has finished', async () => {
  const firstLaunch = new CrossWiseController();
  const startLocation = jest.spyOn(firstLaunch.locations, 'start');
  (firstLaunch as any).onForeground();
  expect(startLocation).not.toHaveBeenCalled();
  firstLaunch.setHomeVisible(true);
  expect(startLocation).toHaveBeenCalledTimes(1);
  firstLaunch.setHomeVisible(false); firstLaunch.locations.stop();
});
test('switching to touch cancels the pending voice navigation intent before selecting a place', async () => {
  c.stopNavigation();
  (searchPlaces as jest.Mock).mockResolvedValueOnce([destination, { ...destination, id: 'second' }]);
  await (c as any).handleVoice('navigate to Library', () => true);
  c.stopVoice();
  const response = await (c as any).handleVoice('first', () => true);
  expect(response).toContain('Say start or save'); expect(c.journey.running).toBe(false);
});
test('voice repeat during a crossing uses current local guidance, never a walking-route instruction', async () => {
  c.crossingAction('help'); c.crossingAction('start'); c.cameraStatus.set('unavailable'); mockDispatch.mockClear();
  expect(await (c as any).handleVoice('repeat', () => true)).toBeNull();
  const cues = mockDispatch.mock.calls.flat(2);
  expect(cues.some((cue: any) => cue.text === P.cameraUnavailable)).toBe(true);
  expect(cues.some((cue: any) => cue.text?.includes('Head north'))).toBe(false);
});

test('voice does not claim a journey was paused when none exists or resume a running route', async () => {
  expect(await (c as any).handleVoice('resume', () => true)).toContain('already running');
  c.stopNavigation(); expect(await (c as any).handleVoice('pause', () => true)).toContain('No active route');
});

test('planner preserves the specific route-start failure for visible recovery', async () => {
  c.journey.end();
  c.planner.state.set({ ...c.planner.state.value, page: 'route', selected: destination,
    route: { ...route, points: [{ latitude: 0, longitude: 0 }, point] }, busy: null });
  expect(await c.planner.start(c.planner.state.value.revision)).toBe(false);
  expect(c.planner.state.value.error).toBe('You moved away from the start. Find a new route.');
});

test('completion commands are explicit and cannot advance or finish an unfinished crossing',async()=>{
  const handle=(text:string)=>(c as any).handleVoice(text,()=>true);
  expect(await handle('confirm')).toContain('next instruction');
  expect(c.journey.running).toBe(true);
  expect(await handle('next instruction')).toContain('Final instruction');
  c.crossingForJourney();c.command(UserCommand.START_CROSSING);
  expect(await handle('arrived')).toContain('Finish crossing');
  expect(await handle('next instruction')).toContain('Finish crossing');
  expect(c.journey.state.value.crossing).toBe(true);
  expect(await handle('finish crossing')).toContain('Head north');
  expect(c.journey.state.value.crossing).toBe(false);
  expect(await handle('arrived')).toBe('Arrived at Library.');
  expect(c.journey.running).toBe(false);
});
test('speech preview is blocked during guidance, plays only cues while idle, and Stop cancels its completion',async()=>{
  AppState.currentState='active';
  const cues=[Cues.speakText('Test sample.',Priority.NORMAL)];
  expect(await c.previewSpeech(cues)).toBe(false);
  c.stopNavigation();mockDispatch.mockClear();
  const handle=jest.spyOn(c as any,'handleVoice');
  let finish!:(value:boolean)=>void;
  jest.spyOn((c as any).feedback,'whenIdle').mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
  const pending=c.previewSpeech(cues);
  expect(mockDispatch).toHaveBeenCalledWith(cues);
  c.stopSpeechPreview();finish(true);
  expect(await pending).toBe(false);
  expect(handle).not.toHaveBeenCalled();expect(c.assistOn).toBe(false);expect(c.journey.running).toBe(false);
});

test('confirm starts a searched replacement destination while retaining an older paused route until success',async()=>{
  const handle=(text:string)=>(c as any).handleVoice(text,()=>true);
  const other={...destination,id:'other',name:'Museum'};
  (searchPlaces as jest.Mock).mockResolvedValueOnce([other]);
  (walkingRoute as jest.Mock).mockResolvedValueOnce({...route,destination:'Museum'});
  expect(await handle('search Museum')).toContain('Say start or save');
  expect(c.journey.state.value.phase).toBe('paused');
  expect(await handle('confirm')).toContain('Museum.');
  expect(c.journey.running).toBe(true);expect(c.journey.state.value.destination?.id).toBe('other');
});
