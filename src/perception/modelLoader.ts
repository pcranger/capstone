import { Directory, File, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';
import { Image, Platform } from 'react-native';
import type { TensorflowModelDelegate, TfliteModel } from 'react-native-fast-tflite';
import type { HybridObject } from 'react-native-nitro-modules';
import { NitroModules } from 'react-native-nitro-modules';
import { BUNDLED_MODELS } from '../../assets/models';
import { ObjectCategory } from './detection';
import { categoryFor } from './labelMapper';
import { parseModelMetadata } from './modelMetadata';
import { segmentationLabels, segCategoryFor } from './segmentation';
import { expectedAnchors, inferFormat, type YoloOutputFormat } from './yoloDecoder';

/** Stored in settings to mean "this bundled asset" or "this file under Documents". */
export const ASSET_PREFIX = 'asset:';
export const DOCUMENTS_PREFIX = 'documents:';

export type ModelSource =
  /** A model bundled with the app (assets/models, registered in assets/models/index.ts). */
  | { kind: 'asset'; name: string; module: number }
  /** A model imported by the user, or dropped into the app's folder with the Files app. */
  | { kind: 'file'; relativePath: string };

export function displayNameOf(source: ModelSource): string {
  return source.kind === 'asset' ? source.name : (source.relativePath.split('/').pop() ?? source.relativePath);
}

export function referenceOf(source: ModelSource): string {
  return source.kind === 'asset' ? ASSET_PREFIX + source.name : DOCUMENTS_PREFIX + source.relativePath;
}

export function fileOf(source: Extract<ModelSource, { kind: 'file' }>): File {
  return new File(Paths.document, source.relativePath);
}

export interface ModelInfo {
  displayName: string;
  inputWidth: number;
  inputHeight: number;
  channelsFirst: boolean;
  outputShape: number[];
  format: YoloOutputFormat;
  labels: string[];
  backend: string;
  /** False for e.g. a plain COCO model: phases then come from the (unverified) color heuristic. */
  hasPedestrianSignalClasses: boolean;
}

/** What the camera worklet needs to run one model: the interpreter plus its tensor layout. */
export interface LoadedModel {
  info: ModelInfo;
  model: TfliteModel;
  /** Index of the 3D detection head among the outputs. */
  headIndex: number;
  /** Segmentation only: index and shape of the [1, H, W, 32] prototype tensor. */
  protoIndex: number;
  protoShape: number[];
  categories: ObjectCategory[];
}

interface AssetLoader extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  loadAsset(path: string): Promise<ArrayBuffer>;
}

interface TfliteModule extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  createModel(modelData: ArrayBuffer, delegates: TensorflowModelDelegate[]): TfliteModel;
}

let assetLoader: AssetLoader | null = null;
let tfliteModule: TfliteModule | null = null;

function natives(): { loader: AssetLoader; tflite: TfliteModule } {
  assetLoader ??= NitroModules.createHybridObject<AssetLoader>('AssetLoader');
  tfliteModule ??= NitroModules.createHybridObject<TfliteModule>('TfliteModule');
  return { loader: assetLoader, tflite: tfliteModule };
}

async function readBytes(source: ModelSource): Promise<ArrayBuffer> {
  if (source.kind === 'asset') {
    if (Platform.OS === 'android') {
      // Android release assets are resource identifiers, not URLs accepted by the Nitro URL loader.
      const asset = await Asset.fromModule(source.module).downloadAsync();
      if (!asset.localUri) throw new Error('Bundled model could not be opened.');
      const bytes = await new File(asset.localUri).bytes();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    }
    const uri = Image.resolveAssetSource(source.module).uri;
    return natives().loader.loadAsset(uri);
  }
  const bytes = await fileOf(source).bytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Everything the app can load right now: models shipped with the app plus every .tflite in Documents. */
export function listModels(): ModelSource[] {
  const assets: ModelSource[] = BUNDLED_MODELS.map((m) => ({ kind: 'asset', name: m.name, module: m.module }));
  const files: ModelSource[] = [];
  const scan = (dir: Directory, prefix: string) => {
    try {
      if (!dir.exists) return;
      for (const entry of dir.list()) {
        if (entry instanceof File && entry.name.toLowerCase().endsWith('.tflite')) {
          files.push({ kind: 'file', relativePath: prefix + entry.name });
        }
      }
    } catch {
      // unreadable folder: nothing to offer from it
    }
  };
  // Imported models, then anything dropped at the top level of the app's folder in the Files app.
  scan(new Directory(Paths.document, 'models'), 'models/');
  scan(Paths.document, '');
  files.sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b)));
  return [...assets, ...files];
}

export const BUNDLED_MODEL = 'crosswise.tflite';

/** Resolves a settings reference to a source, falling back to the bundled model like the Android app. */
export function resolveSource(reference: string | null, library: ModelSource[]): ModelSource | null {
  const bundled =
    library.find((s) => s.kind === 'asset' && s.name === BUNDLED_MODEL) ??
    library.find((s) => s.kind === 'asset') ??
    null;
  if (reference === null) return bundled ?? library[0] ?? null;
  return library.find((s) => referenceOf(s) === reference) ?? bundled ?? library[0] ?? null;
}

function hasNaN(buffers: ArrayBuffer[]): boolean {
  for (const b of buffers) {
    const f = new Float32Array(b);
    for (let i = 0; i < f.length; i++) if (Number.isNaN(f[i])) return true;
  }
  return false;
}

/**
 * Loads a model and works out how to feed it.
 *
 * Handles NCHW (litert-torch) and NHWC (onnx2tf) inputs, raw and NMS-free outputs, segmentation heads, and reads
 * the class names embedded in the model. Tries the Core ML delegate (Neural Engine / GPU) first when asked and
 * falls back to the CPU; a broken delegate tends to return NaNs, so the warm-up output is checked.
 */
export async function loadModel(source: ModelSource, preferAccelerator: boolean): Promise<LoadedModel> {
  const bytes = await readBytes(source);
  const metadata = parseModelMetadata(new Uint8Array(bytes));
  const { tflite } = natives();

  let model = tflite.createModel(bytes, []);
  let backend = 'CPU';

  const input = model.inputs[0];
  if (!input) throw new Error('Model has no input tensor');
  if (input.dataType !== 'float32') {
    throw new Error(`Model input must be FLOAT32 (got ${input.dataType}). Export with Ultralytics format=litert.`);
  }
  const inShape = input.shape;
  if (inShape.length !== 4) throw new Error(`Expected a 4D image input, got [${inShape.join(', ')}]`);

  const outputs = model.outputs;
  const protoIndex = outputs.findIndex((o) => o.shape.length === 4);
  const headIndex = outputs.findIndex((o) => o.shape.length === 3);
  if (headIndex < 0) throw new Error('No 3D detection output found; is this a detection model?');
  const segmentation = outputs.length >= 2 && protoIndex >= 0;

  // A YOLO-seg export from the AN-S3 project is NHWC; detection models may be either.
  const channelsFirst = !segmentation && inShape[1] === 3 && inShape[3] !== 3;
  const inputHeight = channelsFirst ? inShape[2] : inShape[1];
  const inputWidth = channelsFirst ? inShape[3] : inShape[2];
  const outShape = outputs[headIndex].shape;

  let labels: string[];
  let format: YoloOutputFormat;
  if (segmentation) {
    const classes = outShape[1] - 4 - 32;
    labels = segmentationLabels(classes, metadata?.names);
    format = 'SEGMENTATION';
  } else {
    if (metadata && metadata.names.length > 0) {
      labels = metadata.names;
    } else {
      const channels = Math.min(outShape[1], outShape[2]);
      labels =
        outShape[2] === 6 && outShape[1] !== expectedAnchors(inputWidth, inputHeight)
          ? []
          : Array.from({ length: channels - 4 }, (_, i) => `class_${i}`);
    }
    format = inferFormat(outShape, inputWidth, inputHeight, labels.length > 0 ? labels.length : null, metadata?.endToEnd ?? null);
  }

  if (preferAccelerator && !segmentation) {
    try {
      const accelerated = tflite.createModel(bytes, [Platform.OS === 'android' ? 'android-gpu' : 'core-ml']);
      const probe = new Float32Array(inShape.reduce((a, b) => a * b, 1)).fill(0.5);
      const result = await accelerated.run([probe.buffer]);
      if (result.length > 0 && !hasNaN(result)) {
        model.dispose?.();
        model = accelerated;
        backend = Platform.OS === 'android' ? 'Android GPU' : 'Core ML';
      } else {
        accelerated.dispose?.();
      }
    } catch (e) {
      console.warn('Accelerator unavailable, using CPU', e);
    }
  }

  const categories = segmentation ? labels.map(segCategoryFor) : labels.map(categoryFor);
  const info: ModelInfo = {
    displayName: displayNameOf(source),
    inputWidth,
    inputHeight,
    channelsFirst,
    outputShape: outShape,
    format,
    labels,
    backend,
    hasPedestrianSignalClasses: labels
      .map(categoryFor)
      .some((c) => c === ObjectCategory.PED_WALK || c === ObjectCategory.PED_DONT_WALK),
  };
  return {
    info,
    model,
    headIndex,
    protoIndex: segmentation ? protoIndex : -1,
    protoShape: segmentation ? outputs[protoIndex].shape : [],
    categories,
  };
}

/** Copies a picked file into Documents/models and returns its source. Imports accumulate into a library. */
export function importModelFile(pickedUri: string, pickedName: string | null): ModelSource {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create({ intermediates: true });
  const base = pickedName && pickedName.toLowerCase().endsWith('.tflite') ? pickedName : `imported_${Date.now()}.tflite`;
  const target = new File(dir, base);
  if (target.exists) target.delete();
  new File(pickedUri).copySync(target);
  return { kind: 'file', relativePath: `models/${base}` };
}
