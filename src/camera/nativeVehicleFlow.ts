import type { FlowPoint } from '../tracking/pixelFlow';
import type { GrayFrame } from '../tracking/vehicleMotion';

export type NativeFlow = (previous: Uint8Array, current: Uint8Array, width: number, height: number,
  regions: number[][]) => Promise<{ points: FlowPoint[]; workerMs: number }>;

/** Keeps native image history off the engine/UI path; only sparse flow crosses back. */
export class NativeVehicleFlow {
  private previous: GrayFrame | null = null;
  reset(): void { this.previous = null; }

  async prepare(image: GrayFrame, regions: number[][], sourceWallMs: number, track: NativeFlow): Promise<{ image: GrayFrame; workerMs: number }> {
    const previous = this.previous;
    this.previous = { ...image, sourceWallMs };
    const sameSize = previous?.width === image.width && previous?.height === image.height;
    const result = sameSize
      ? await track(previous.pixels instanceof Uint8Array ? previous.pixels : new Uint8Array(previous.pixels), image.pixels instanceof Uint8Array ? image.pixels : new Uint8Array(image.pixels), image.width, image.height, regions)
      : { points: [], workerMs: 0 };
    return {
      image: { width: image.width, height: image.height, pixels: [], flow: result.points,
        sourceWallMs, flowFromWallMs: sameSize ? previous.sourceWallMs : undefined },
      workerMs: result.workerMs,
    };
  }
}
