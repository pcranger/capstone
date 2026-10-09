import { Directory, File, Paths } from 'expo-file-system';
import type { EngineSnapshot } from '../crossing/crossingEngine';
import type { Cue } from '../feedback/cue';
import { cueText } from '../strings';

const HEADER =
  't_ms,fps,infer_ms,detections,mode,phase,trusted,walk_ev,dont_walk_ev,fresh_walk,' +
  'signal_cx,aim_bearing_deg,pitch_deg,veer_dev_deg,walking,hazards,min_ttc_s,spoken';

const fixed = (v: number | null | undefined, digits: number) => (v == null ? '' : v.toFixed(digits));

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Writes one CSV row per analyzed frame so field tests can be evaluated afterwards
 * (latency, phase accuracy against a video annotated by a sighted observer, false alerts).
 *
 * Files land in Documents/logs, visible in the Files app, with the same columns as the Android logs.
 */
export class SessionLogger {
  readonly directory = new Directory(Paths.document, 'logs');
  private file: File | null = null;
  private buffer: string[] = [];
  private lastFlushMs = 0;

  start(): void {
    if (this.file) return;
    try {
      if (!this.directory.exists) this.directory.create({ intermediates: true });
      const d = new Date();
      const name =
        `session_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
        `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}.csv`;
      const file = new File(this.directory, name);
      file.create();
      file.write(`${HEADER}\n`);
      this.file = file;
      this.buffer = [];
    } catch (e) {
      console.warn('Cannot open log', e);
      this.file = null;
    }
  }

  log(
    timestampMs: number,
    fps: number,
    inferenceMs: number,
    detections: number,
    snapshot: EngineSnapshot,
    cues: readonly Cue[],
  ): void {
    if (!this.file) return;
    const s = snapshot.signal;
    const minTtc = snapshot.hazards.length > 0 ? Math.min(...snapshot.hazards.map((h) => h.ttcSeconds)) : null;
    const spoken = cues
      .filter((c) => c.kind === 'speak')
      .map((c) => cueText(c) ?? '')
      .join(' | ');
    const row = [
      Math.round(timestampMs),
      fixed(fps, 1),
      Math.round(inferenceMs),
      detections,
      snapshot.mode,
      s.phase,
      s.trusted,
      fixed(s.walkEvidence, 2),
      fixed(s.dontWalkEvidence, 2),
      s.freshWalk,
      fixed(s.primaryBox?.centerX, 3),
      fixed(snapshot.aimBearingDeg, 1),
      fixed(snapshot.pitchDeg, 1),
      fixed(snapshot.veer?.deviationDeg, 1),
      snapshot.walking,
      snapshot.hazards.length,
      minTtc === null || !Number.isFinite(minTtc) ? '' : minTtc.toFixed(2),
      `"${spoken.replace(/"/g, "'")}"`,
    ].join(',');
    this.buffer.push(row);
    if (timestampMs - this.lastFlushMs > 1_000) {
      this.flush();
      this.lastFlushMs = timestampMs;
    }
  }

  private flush(): void {
    if (!this.file || this.buffer.length === 0) return;
    try {
      this.file.write(`${this.buffer.join('\n')}\n`, { append: true });
    } catch (e) {
      console.warn('Cannot write log', e);
    }
    this.buffer = [];
  }

  stop(): void {
    this.flush();
    this.file = null;
  }

  /** Recorded sessions, newest first. */
  sessions(): { name: string; uri: string; sizeKb: number; modified: number }[] {
    try {
      if (!this.directory.exists) return [];
      return this.directory
        .list()
        .filter((f): f is File => f instanceof File && f.name.endsWith('.csv'))
        .map((f) => ({
          name: f.name,
          uri: f.uri,
          sizeKb: Math.round((f.size ?? 0) / 1024),
          modified: f.modificationTime ?? 0,
        }))
        .sort((a, b) => b.modified - a.modified);
    } catch {
      return [];
    }
  }
}
