import { type AudioBuffer, type AudioBufferSourceNode, AudioContext, AudioManager } from 'react-native-audio-api';
import { ToneKind } from './cue';
import { renderTone } from './toneSynth';

const PAN_STEPS = 4;
const VOLUME = 0.8;

interface Scheduled {
  source: AudioBufferSourceNode;
  startAt: number;
}

/**
 * Plays synthesized stereo earcons back to back, like the Android AudioTrack stream: a cue never overlaps the
 * previous one, sonar ticks are dropped rather than queued (a stale tick points the wrong way), and a backlog
 * of more than four cues is flushed.
 */
export class TonePlayer {
  private context: AudioContext | null = null;
  private readonly cache = new Map<string, AudioBuffer>();
  private scheduled: Scheduled[] = [];
  private nextFreeTime = 0;

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    try {
      // Recognition owns playAndRecord while listening and restores playback afterward.
      // A readiness tone must not switch the shared session back to playback mid-capture.
      AudioManager.disableSessionManagement();
      this.context = new AudioContext();
    } catch {
      this.context = null;
    }
    return this.context;
  }

  play(kind: ToneKind, pan: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.scheduled = this.scheduled.filter((s) => s.startAt > now);
    // Sonar ticks are only useful if they are current: never let them queue up.
    if (kind === ToneKind.SONAR && this.scheduled.length > 0) return;
    if (this.scheduled.length > 4) {
      for (const s of this.scheduled) {
        try {
          s.source.stop();
        } catch {
          // already stopped
        }
      }
      this.scheduled = [];
      this.nextFreeTime = now;
    }
    const buffer = this.bufferFor(ctx, kind, pan);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(now + 0.005, this.nextFreeTime);
    source.start(startAt);
    this.nextFreeTime = startAt + buffer.duration;
    this.scheduled.push({ source, startAt });
  }

  private bufferFor(ctx: AudioContext, kind: ToneKind, pan: number): AudioBuffer {
    const panStep = Math.round(Math.min(Math.max(pan, -1), 1) * PAN_STEPS);
    const key = `${kind}:${panStep}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const rate = ctx.sampleRate;
    const [l, r] = renderTone(kind, panStep / PAN_STEPS, rate, VOLUME);
    const buffer = ctx.createBuffer(2, l.length, rate);
    buffer.copyToChannel(l, 0);
    buffer.copyToChannel(r, 1);
    this.cache.set(key, buffer);
    return buffer;
  }

  release(): void {
    this.scheduled = [];
    this.cache.clear();
    const ctx = this.context;
    this.context = null;
    ctx?.close().catch(() => undefined);
  }
}
