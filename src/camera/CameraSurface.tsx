import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, type StyleProp, View, type ViewStyle } from 'react-native';
import type { TfliteModel } from 'react-native-fast-tflite';
import {
  Camera,
  type CameraDevice,
  type CameraRef,
  CommonResolutions,
  type Constraint,
  type Frame,
  useCamera,
  useCameraDevice,
  useAsyncRunner,
  useFrameOutput,
} from 'react-native-vision-camera';
import { useResizer } from 'react-native-vision-camera-resizer';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';
import { NativeVehicleFlow } from './nativeVehicleFlow';
import CrossWiseNative from '../../modules/crosswise-native';
import { controller, type FrameResult, type RawDetection } from '../state/controller';
import { useStore } from '../state/store';
import { estimateSignalColor, meanLuminance, motionLuma, paintLetterboxBars } from '../perception/pixels';
import { paintSegMask, SEG_RGB, segPostProcess } from '../perception/segmentation';
import { decodeCandidates, type Letterbox, letterboxOf } from '../perception/yoloDecoder';

/** Everything the worklet needs about the active model, as plain values plus the interpreter itself. */
interface Plan {
  model: TfliteModel;
  inputWidth: number;
  inputHeight: number;
  planar: boolean;
  headIndex: number;
  outputShape: number[];
  format: string;
  segmentation: boolean;
  protoIndex: number;
  protoWidth: number;
  protoHeight: number;
  /** Per-class flag: true where the class is a generic traffic light that needs the pixel color check. */
  colorCheck: boolean[];
  vehicleClasses: boolean[];
  scoreThreshold: number;
  iouThreshold: number;
  /** One frame's model input and raw output are sent back for offline inspection (see controller.debugCapture). */
  debugCapture: boolean;
}

const CONSTRAINTS: Constraint[] = [
  { fps: 30 },
  // Stabilization crops the frame and would change the field of view the heading math depends on.
  { videoStabilizationMode: 'off' },
];

/**
 * The camera, the detector and the bridge between them.
 *
 * Frames arrive on VisionCamera's frame thread as upright YUV. The GPU resizer letterboxes them
 * into the model's input size as RGB floats; the bars are repainted gray (114) as Ultralytics expects; the model
 * runs synchronously; boxes are decoded right there, and only the short list of boxes crosses to the JS thread.
 * While the worklet is busy, new frames are dropped — the same "keep only latest" policy as the Android app.
 */
export function CameraSurface({ showPreview, style, resizeMode = 'cover' }: {
  showPreview: boolean; style?: StyleProp<ViewStyle>; resizeMode?: 'cover' | 'contain';
}) {
  const loaded = useStore(controller.loadedModel);
  const cameraRef = useRef<CameraRef>(null);
  const runner = useAsyncRunner();
  // This gate stays locked through native motion AND JS delivery, so neither queue grows.
  const frameBusy = useMemo(() => createSynchronizable(false), []);
  const nativeFlow = useMemo(() => new NativeVehicleFlow(), []);
  const settings = useStore(controller.settings);
  const debugCapture = useStore(controller.debugCapture);
  const device = useCameraDevice('back', Platform.OS === 'android' ? undefined : { physicalDevices: ['wide-angle'] });
  const active = useAppActive();
  const info = loaded?.info;
  const segmentation = info?.format === 'SEGMENTATION';
  const { resizer, error: resizerError } = useResizer({
    width: info?.inputWidth ?? 640,
    height: info?.inputHeight ?? 640,
    channelOrder: 'rgb',
    dataType: 'float32',
    // The segmenter was trained on a plain resize, the detector on a letterbox.
    scaleMode: segmentation ? 'stretch' : 'contain',
    pixelLayout: info?.channelsFirst ? 'planar' : 'interleaved',
  });

  useEffect(() => {
    if (resizerError) { controller.inferenceFailed(`Resizer: ${resizerError.message}`); }
  }, [resizerError]);

  const plan = useMemo<Plan | null>(() => {
    if (!loaded) return null;
    const i = loaded.info;
    return {
      model: loaded.model,
      inputWidth: i.inputWidth,
      inputHeight: i.inputHeight,
      planar: i.channelsFirst,
      headIndex: loaded.headIndex,
      outputShape: i.outputShape,
      format: i.format,
      segmentation: i.format === 'SEGMENTATION',
      protoIndex: loaded.protoIndex,
      protoHeight: loaded.protoShape[1] ?? 0,
      protoWidth: loaded.protoShape[2] ?? 0,
      vehicleClasses: loaded.categories.map(c => ['CAR','TRUCK','BUS','MOTORCYCLE','BICYCLE'].includes(c)),
      colorCheck: loaded.categories.map((c) => Platform.OS !== 'android' && !i.hasPedestrianSignalClasses && c === 'TRAFFIC_LIGHT'),
      scoreThreshold: settings.scoreThreshold,
      iouThreshold: 0.5,
      debugCapture,
    };
  }, [loaded, settings.scoreThreshold, debugCapture]);

  useEffect(() => { nativeFlow.reset(); }, [active, loaded, nativeFlow]);
  const deliver = useCallback(async (result: FrameResult) => {
    try {
      if (!active || controller.loadedModel.value !== loaded) return;
      if (Platform.OS === 'android' && result.motionImage) {
        if (!CrossWiseNative?.trackVehicleFlow) throw new Error('Native vehicle motion is unavailable. Reinstall the Android build.');
        const regions = result.detections.filter(d => loaded && ['CAR','TRUCK','BUS','MOTORCYCLE','BICYCLE'].includes(loaded.categories[d.classIndex]))
          .map(d => [d.left, d.top, d.right, d.bottom]);
        const prepared = await nativeFlow.prepare(result.motionImage, regions, result.capturedWallMs ?? Date.now(),
          (...args) => CrossWiseNative!.trackVehicleFlow!(...args));
        result = { ...result, motionImage: prepared.image, motionWorkerMs: prepared.workerMs };
      }
      if (AppState.currentState === 'active' && controller.loadedModel.value === loaded) controller.onFrame(result);
    } catch (error) {
      nativeFlow.reset();
      controller.inferenceFailed(`Motion: ${String(error)}`);
    } finally { frameBusy.setBlocking(false); }
  }, [active, loaded, nativeFlow, frameBusy]);

  const inferenceError = useCallback((message:string)=>controller.inferenceFailed(message),[]);
  const diagnostic = useCallback((stage: string) => controller.cameraDiagnostic(stage), []);
  const processFrame = useCallback(
    (frame: Frame, capturedWallMs: number) => {
      'worklet';
      if (plan === null || resizer == null) {
        if(debugCapture) scheduleOnRN(diagnostic, `waiting: model=${plan!==null}, resizer=${resizer!=null}`);
        frame.dispose();
        frameBusy.setBlocking(false);
        return;
      }
      const trace = globalThis as unknown as { __cwDebugTraced?: boolean };
      if (!plan.debugCapture) trace.__cwDebugTraced=false;
      const tracing=plan.debugCapture && !trace.__cwDebugTraced;
      if(tracing) { trace.__cwDebugTraced=true;scheduleOnRN(diagnostic, 'frame received'); }
      let frameReleased=false;
      let resizedFrame: { dispose: () => void } | null = null;
      try {
      const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const start = clock();
      const orientation = frame.orientation;
      const sideways = orientation === 'left' || orientation === 'right';
      const frameWidth = sideways ? frame.height : frame.width;
      const frameHeight = sideways ? frame.width : frame.height;

      const W = plan.inputWidth;
      const H = plan.inputHeight;
      const resized = resizer.resize(frame);
      resizedFrame = resized;
      frame.dispose();frameReleased=true;
      if(tracing) scheduleOnRN(diagnostic, `resized ${resized.width}x${resized.height}, expected ${W}x${H}`);
      if (resized.width !== W || resized.height !== H) {
        // The resizer for a newly selected model is still being created.
        frameBusy.setBlocking(false);
        return;
      }
      const n = W * H * 3;
      const pixelBuffer = resized.getPixelBuffer();
      // TFLite already copies its input. Avoid a second 4.9 MB copy when the GPU buffer
      // has the exact tensor size; retain the GPUFrame until all reads have finished.
      const input = pixelBuffer.byteLength === n * 4
        ? new Float32Array(pixelBuffer)
        : new Float32Array(new Float32Array(pixelBuffer, 0, n));

      let lb: Letterbox;
      if (plan.segmentation) {
        lb = {
          srcWidth: frameWidth,
          srcHeight: frameHeight,
          dstWidth: W,
          dstHeight: H,
          scale: 1,
          scaledWidth: W,
          scaledHeight: H,
          padX: 0,
          padY: 0,
        };
      } else {
        lb = letterboxOf(frameWidth, frameHeight, W, H);
        paintLetterboxBars(input, W, H, plan.planar, lb);
      }
      const brightness = meanLuminance(input, W, H, plan.planar, lb);

      if(tracing) scheduleOnRN(diagnostic, 'inference started');
      const outputs = plan.model.runSync([input.buffer as ArrayBuffer]);
      if(tracing) scheduleOnRN(diagnostic, 'inference finished');
      const head = new Float32Array(outputs[plan.headIndex]);
      const detections: RawDetection[] = [];
      let mask: FrameResult['mask'] = null;

      if (plan.segmentation) {
        const found = segPostProcess(
          head,
          plan.outputShape[1],
          plan.outputShape[2],
          plan.scoreThreshold,
          plan.iouThreshold,
        );
        if (found.length > 0) {
          const protos = new Float32Array(outputs[plan.protoIndex]);
          const pixels = paintSegMask(found, protos, plan.protoWidth, plan.protoHeight, SEG_RGB);
          mask = { buffer: pixels.buffer as ArrayBuffer, width: plan.protoWidth, height: plan.protoHeight };
        }
        for (let i = 0; i < found.length; i++) {
          const c = found[i];
          detections.push({
            left: c.left,
            top: c.top,
            right: c.right,
            bottom: c.bottom,
            classIndex: c.classIndex,
            score: c.score,
            color: null,
          });
        }
      } else {
        const found = decodeCandidates(
          head,
          plan.outputShape,
          plan.format as 'END_TO_END',
          lb,
          Math.min(.08, plan.scoreThreshold),
          plan.iouThreshold,
        );
        for (let i = 0; i < found.length; i++) {
          const c = found[i];
          if (!plan.vehicleClasses[c.classIndex] && c.score < plan.scoreThreshold) continue;
          const color = plan.colorCheck[c.classIndex] ? estimateSignalColor(input, W, H, plan.planar, lb, c) : null;
          detections.push({
            left: c.left,
            top: c.top,
            right: c.right,
            bottom: c.bottom,
            classIndex: c.classIndex,
            score: c.score,
            color,
          });
        }
      }

      scheduleOnRN(deliver, {
        detections,
        capturedWallMs,
        motionImage: plan.segmentation ? undefined : motionLuma(input, W, H, plan.planar, lb),
        frameWidth,
        frameHeight,
        inferenceMs: clock() - start,
        brightness,
        mask,
        debug: plan.debugCapture
          ? {
              input: input.slice().buffer as ArrayBuffer,
              head: head.slice().buffer as ArrayBuffer,
              orientation,
              letterbox: lb,
            }
          : null,
      });
      } catch(e) {
        frameBusy.setBlocking(false);
        if(!frameReleased){try{frame.dispose();}catch{/* Native frame may already be released. */}}
        const state=globalThis as unknown as {__cwLastError?:number};
        if(Date.now()-(state.__cwLastError??0)>1000){state.__cwLastError=Date.now();scheduleOnRN(inferenceError,`Inference: ${String(e)}`);}
      } finally { resizedFrame?.dispose(); }
    },
    [plan, resizer, deliver, diagnostic, debugCapture, inferenceError, frameBusy],
  );

  // Create the worker task on RN, rather than reserializing a worklet through
  // the camera runtime first (VisionCamera 5's nested transfer is not callable).
  const dispatch = useCallback((frame: Frame, capturedWallMs: number) => {
    try {
      const accepted = runner.runAsync(() => {
        'worklet';
        processFrame(frame, capturedWallMs);
      });
      if (!accepted) { frameBusy.setBlocking(false); frame.dispose(); }
    } catch (error) {
      frameBusy.setBlocking(false); frame.dispose();
      inferenceError(`Frame worker: ${String(error)}`);
    }
  }, [runner, processFrame, frameBusy, inferenceError]);
  const onFrame = useCallback((frame: Frame) => {
    'worklet';
    if (frameBusy.getBlocking()) { frame.dispose(); return; }
    frameBusy.setBlocking(true);
    scheduleOnRN(dispatch, frame, Date.now());
  }, [frameBusy, dispatch]);

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    // 854px on the long axis still exceeds the 640px model input, while
    // cutting Android rotation/conversion bandwidth versus a 1280px stream.
    targetResolution: Platform.OS === 'android' && (info?.inputWidth ?? 640) <= 640
      ? CommonResolutions.VGA_16_9 : CommonResolutions.HD_16_9,
    // Let the camera output apply the same orientation as the preview. In resizer 5.2.3,
    // the left/right shader rotation produces a 180-degree mismatch on portrait iOS
    // frames. Upright buffers bypass that rotation before inference, so both model
    // recognition and downstream left/right guidance use the correct image.
    enablePhysicalBufferRotation: true,
    dropFramesWhileBusy: true,
    onFrame,
    onFrameDropped: () => undefined,
  });
  const onStarted = useCallback(() => { updateGeometry(device); controller.setCameraStatus('running'); }, [device]);
  const unavailable = useCallback(() => controller.setCameraStatus('unavailable',AppState.currentState==='active'?'Camera session stopped':'App is in background'), []);
  const interrupted = useCallback((reason:unknown)=>controller.setCameraStatus('unavailable',`Interrupted: ${String(reason)}`),[]);
  const interruptionEnded=onStarted;
  const cameraError = useCallback((error: Error) => { console.warn('Camera session failed', error.message); controller.setCameraStatus('unavailable',error.message); }, []);
  useEffect(() => {
    controller.setCameraStatus(device && active ? 'starting' : 'unavailable');
    return () => controller.setCameraStatus('unavailable');
  }, [device, active]);
  const outputs = useMemo(() => [frameOutput], [frameOutput]);

  if (device == null) return <View style={style} />;
  return showPreview ? (
    <Camera
      ref={cameraRef}
      style={style}
      device={device}
      isActive={active}
      outputs={outputs}
      constraints={CONSTRAINTS}
      orientationSource="interface"
      resizeMode={resizeMode}
      onStarted={onStarted}
      onError={cameraError}
      onStopped={unavailable}
      onInterruptionStarted={interrupted}
      onInterruptionEnded={interruptionEnded}
    />
  ) : (
    <HeadlessCamera device={device} active={active} outputs={outputs} onStarted={onStarted} onUnavailable={unavailable} style={style} />
  );
}

/** Same session without a preview, for when the preview is switched off in Settings. */
function HeadlessCamera({
  device,
  active,
  outputs,
  onStarted,
  onUnavailable,
  style,
}: {
  device: CameraDevice;
  active: boolean;
  outputs: Parameters<typeof useCamera>[0]['outputs'];
  onStarted: () => void;
  onUnavailable: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  useCamera({
    device,
    isActive: active,
    outputs,
    constraints: CONSTRAINTS,
    orientationSource: 'interface',
    onStarted,
    onError: onUnavailable,
    onStopped: onUnavailable,
    onInterruptionStarted: onUnavailable,
    onInterruptionEnded: onStarted,
  });
  return <View style={style} />;
}

/** The camera runs only while the app is in the foreground, as on Android. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Field of view of the upright analysis frame from the active format's field of view. The analysis stream
 * crops the sensor to its own aspect ratio (16:9 here), so the crop is accounted for like on Android.
 */
function updateGeometry(device: CameraDevice | undefined): void {
  const fov = CrossWiseNative?.cameraFieldOfView(device?.id ?? null);
  if (!fov || fov.width <= 0 || fov.height <= 0) return;
  const tanLong = Math.tan((fov.fovDeg * Math.PI) / 360);
  const formatAspect = fov.width / fov.height;
  const frameAspect = 16 / 9;
  let tanL: number;
  let tanS: number;
  if (frameAspect >= formatAspect) {
    tanL = tanLong;
    tanS = tanLong / frameAspect;
  } else {
    tanS = tanLong / formatAspect;
    tanL = tanS * frameAspect;
  }
  const toDeg = (t: number) => (Math.atan(t) * 360) / Math.PI;
  // Portrait: the upright image's width is the sensor's short side.
  const hfovDeg = toDeg(tanS);
  const vfovDeg = toDeg(tanL);
  if (hfovDeg >= 15 && hfovDeg <= 150 && vfovDeg >= 15 && vfovDeg <= 150) {
    controller.setCameraGeometry({ hfovDeg, vfovDeg });
  }
}
