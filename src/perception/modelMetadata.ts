import { inflateSync, strFromU8 } from 'fflate';

/**
 * Metadata that Ultralytics appends to exported `.tflite` files as a zip entry `metadata.json`
 * (class names, input size, whether the head is NMS-free). MediaPipe/TFLite-Task models append a
 * `labels.txt` the same way. Reading it lets the app accept a new model file with no code change.
 */
export interface ModelMetadata {
  names: string[];
  imageSize: [number, number] | null;
  endToEnd: boolean | null;
  task: string | null;
  description: string | null;
}

export function parseModelMetadata(modelBytes: Uint8Array): ModelMetadata | null {
  const json = AppendedZip.readEntry(modelBytes, 'metadata.json');
  if (json) {
    try {
      return fromUltralyticsJson(strFromU8(json));
    } catch {
      return null;
    }
  }
  const txt = AppendedZip.readEntry(modelBytes, 'labels.txt');
  if (txt) {
    const names = strFromU8(txt)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return { names, imageSize: null, endToEnd: null, task: null, description: null };
  }
  return null;
}

export function fromUltralyticsJson(json: string): ModelMetadata {
  const root = JSON.parse(json) as Record<string, unknown>;
  const namesObj = root.names;
  let names: string[] = [];
  if (namesObj && typeof namesObj === 'object' && !Array.isArray(namesObj)) {
    const indexed = new Map<number, string>();
    for (const [k, v] of Object.entries(namesObj as Record<string, unknown>)) {
      const i = Number.parseInt(k, 10);
      if (Number.isInteger(i) && String(i) === k) indexed.set(i, String(v));
    }
    const max = indexed.size > 0 ? Math.max(...indexed.keys()) : -1;
    names = Array.from({ length: max + 1 }, (_, i) => indexed.get(i) ?? `class_${i}`);
  } else if (Array.isArray(namesObj)) {
    names = namesObj.map(String);
  }
  const imgsz = Array.isArray(root.imgsz) && root.imgsz.length >= 2 ? root.imgsz : null;
  return {
    names,
    imageSize: imgsz ? [Number(imgsz[0]), Number(imgsz[1])] : null,
    endToEnd: 'end2end' in root ? Boolean(root.end2end) : null,
    task: typeof root.task === 'string' && root.task.length > 0 ? root.task : null,
    description: typeof root.description === 'string' && root.description.length > 0 ? root.description : null,
  };
}

/** Minimal reader for a zip archive appended to the end of another file. */
export const AppendedZip = {
  readEntry(bytes: Uint8Array, entryName: string): Uint8Array | null {
    const eocd = findEocd(bytes);
    if (eocd === null) return null;
    const entries = u16(bytes, eocd + 10);
    const cenSize = u32(bytes, eocd + 12);
    const cenOffset = u32(bytes, eocd + 16);
    const cenStart = eocd - cenSize;
    if (cenStart < 0) return null;
    // Offsets may be relative to the start of the appended archive or absolute in the file.
    const archiveBase = cenStart - cenOffset;

    let p = cenStart;
    for (let e = 0; e < entries; e++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== CEN_SIG) return null;
      const method = u16(bytes, p + 10);
      const compSize = u32(bytes, p + 20);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const localOffset = u32(bytes, p + 42);
      const name = strFromU8(bytes.subarray(p + 46, p + 46 + nameLen));
      if (name === entryName) {
        const loc = [archiveBase + localOffset, localOffset].find(
          (o) => o >= 0 && o + 30 <= bytes.length && u32(bytes, o) === LOC_SIG,
        );
        if (loc === undefined) return null;
        const dataStart = loc + 30 + u16(bytes, loc + 26) + u16(bytes, loc + 28);
        if (dataStart + compSize > bytes.length) return null;
        const data = bytes.subarray(dataStart, dataStart + compSize);
        if (method === 0) return data.slice();
        if (method === 8) {
          try {
            return inflateSync(data);
          } catch {
            return null;
          }
        }
        return null;
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  },
};

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(bytes: Uint8Array): number | null {
  const minPos = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (u32(bytes, i) === EOCD_SIG) return i;
  }
  return null;
}

function u16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

/** Unsigned; a signed read would turn large offsets negative. */
function u32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}
