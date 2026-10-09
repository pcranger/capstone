import type { SignalColor } from './detection';
import type { Candidate, Letterbox } from './yoloDecoder';

/*
 * Pixel reads on the model input tensor (RGB floats in 0..1), done inside the camera worklet.
 * The Android app read the full camera bitmap; here the letterboxed tensor is what is on the CPU, so boxes are
 * mapped into it. At 640 px that is half the camera resolution, which is plenty for a lit-lamp color check.
 */

/** Reads one pixel of an RGB float tensor, planar (CHW) or interleaved (HWC). */
function rgbAt(
  input: Float32Array,
  width: number,
  height: number,
  planar: boolean,
  x: number,
  y: number,
  out: number[],
): void {
  'worklet';
  if (planar) {
    const area = width * height;
    const i = y * width + x;
    out[0] = input[i];
    out[1] = input[area + i];
    out[2] = input[2 * area + i];
  } else {
    const o = (y * width + x) * 3;
    out[0] = input[o];
    out[1] = input[o + 1];
    out[2] = input[o + 2];
  }
}

/** Pure decision rule, split out for unit tests. */
export function classifySignalColor(redPixels: number, greenPixels: number, totalPixels: number): SignalColor | null {
  'worklet';
  if (totalPixels === 0) return null;
  const r = redPixels / totalPixels;
  const g = greenPixels / totalPixels;
  if (r >= 0.06 && r > 2.5 * g) return 'RED';
  if (g >= 0.06 && g > 2.5 * r) return 'GREEN';
  return null;
}

const MAX_SAMPLES_PER_AXIS = 32;

/**
 * Baseline-only: estimates whether a generic "traffic light" box is lit red or green from its pixels.
 *
 * Used when the loaded model (e.g. plain COCO) has no pedestrian-signal classes. It cannot tell a
 * pedestrian signal from a vehicle signal, so results are always reported to the user as unverified.
 */
export function estimateSignalColor(
  input: Float32Array,
  width: number,
  height: number,
  planar: boolean,
  lb: Letterbox,
  box: Candidate,
): SignalColor | null {
  'worklet';
  // Normalized source box -> tensor pixels.
  const toX = (v: number) => lb.padX + v * lb.srcWidth * lb.scale;
  const toY = (v: number) => lb.padY + v * lb.srcHeight * lb.scale;
  const left = Math.min(Math.max(Math.floor(toX(box.left)), 0), width - 1);
  const right = Math.min(Math.max(Math.floor(toX(box.right)), left + 1), width);
  const top = Math.min(Math.max(Math.floor(toY(box.top)), 0), height - 1);
  const bottom = Math.min(Math.max(Math.floor(toY(box.bottom)), top + 1), height);
  const stepX = Math.max(1, Math.floor((right - left) / MAX_SAMPLES_PER_AXIS));
  const stepY = Math.max(1, Math.floor((bottom - top) / MAX_SAMPLES_PER_AXIS));
  const rgb = [0, 0, 0];
  let red = 0;
  let green = 0;
  let total = 0;
  for (let y = top; y < bottom; y += stepY) {
    for (let x = left; x < right; x += stepX) {
      rgbAt(input, width, height, planar, x, y, rgb);
      total++;
      // HSV as Android's Color.colorToHSV computes it: h in degrees, s and v in 0..1.
      const max = Math.max(rgb[0], rgb[1], rgb[2]);
      const min = Math.min(rgb[0], rgb[1], rgb[2]);
      const v = max;
      if (v <= 0.5) continue;
      const delta = max - min;
      const s = max === 0 ? 0 : delta / max;
      let h = 0;
      if (delta > 0) {
        if (max === rgb[0]) h = ((rgb[1] - rgb[2]) / delta) % 6;
        else if (max === rgb[1]) h = (rgb[2] - rgb[0]) / delta + 2;
        else h = (rgb[0] - rgb[1]) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      if (s > 0.45 && (h < 20 || h > 335)) red++;
      // Pedestrian "green" LEDs often look cyan on camera sensors.
      else if (s > 0.3 && h >= 90 && h <= 200) green++;
    }
  }
  return classifySignalColor(red, green, total);
}

/**
 * Average brightness of a coarse grid of the frame's pixels (the letterboxed part only). A lens covered by a
 * finger or a pocket looks the same to the detector as an empty street — it simply finds nothing — so the app
 * has to notice it and say so.
 */
export function meanLuminance(
  input: Float32Array,
  width: number,
  height: number,
  planar: boolean,
  lb: Letterbox,
): number {
  'worklet';
  // The Android grid was every 16th pixel of a 720 px wide frame: 45 columns. Keep the same density.
  const step = Math.max(1, Math.round(lb.scaledWidth / 45));
  const x0 = Math.ceil(lb.padX);
  const y0 = Math.ceil(lb.padY);
  const x1 = Math.floor(lb.padX + lb.scaledWidth);
  const y1 = Math.floor(lb.padY + lb.scaledHeight);
  const rgb = [0, 0, 0];
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      rgbAt(input, width, height, planar, x, y, rgb);
      sum += (rgb[0] * 77 + rgb[1] * 150 + rgb[2] * 29) / 256;
      count++;
    }
  }
  return count === 0 ? 0.5 : sum / count;
}

/**
 * The GPU resizer letterboxes with black bars; Ultralytics trains with gray (114). Repaint the bars so the model
 * sees what it was trained on. Pixels are "outside" by the same test the resizer's shader uses.
 */
export function paintLetterboxBars(
  input: Float32Array,
  width: number,
  height: number,
  planar: boolean,
  lb: Letterbox,
): void {
  'worklet';
  const gray = 114 / 255;
  const exactW = lb.srcWidth * lb.scale;
  const exactH = lb.srcHeight * lb.scale;
  const offX = (width - exactW) / 2;
  const offY = (height - exactH) / 2;
  // First and last pixel whose center falls inside the rendered image.
  const firstX = Math.max(0, Math.ceil(offX - 0.5));
  const lastX = Math.min(width - 1, Math.floor(offX + exactW - 0.5));
  const firstY = Math.max(0, Math.ceil(offY - 0.5));
  const lastY = Math.min(height - 1, Math.floor(offY + exactH - 0.5));
  if (firstX === 0 && lastX === width - 1 && firstY === 0 && lastY === height - 1) return;

  if (planar) {
    const area = width * height;
    for (let c = 0; c < 3; c++) {
      const base = c * area;
      for (let y = 0; y < height; y++) {
        const row = base + y * width;
        if (y < firstY || y > lastY) {
          input.fill(gray, row, row + width);
        } else {
          if (firstX > 0) input.fill(gray, row, row + firstX);
          if (lastX < width - 1) input.fill(gray, row + lastX + 1, row + width);
        }
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row = y * width * 3;
      if (y < firstY || y > lastY) {
        input.fill(gray, row, row + width * 3);
      } else {
        if (firstX > 0) input.fill(gray, row, row + firstX * 3);
        if (lastX < width - 1) input.fill(gray, row + (lastX + 1) * 3, row + width * 3);
      }
    }
  }
}

/** Upright, unletterboxed luma for the motion classifier; bounded bridge payload. */
export function motionLuma(input: Float32Array, width: number, height: number, planar: boolean, lb: Letterbox): { width: number; height: number; pixels: number[] } {
  'worklet';
  const scale = 384 / Math.max(lb.srcWidth, lb.srcHeight);
  const w = Math.max(32, Math.round(lb.srcWidth * scale));
  const h = Math.max(32, Math.round(lb.srcHeight * scale));
  const pixels = new Array<number>(w * h);
  const rgb = [0, 0, 0];
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const px=Math.min(width-1,Math.floor(lb.padX+(x+.5)/w*lb.scaledWidth));
    const py=Math.min(height-1,Math.floor(lb.padY+(y+.5)/h*lb.scaledHeight));
    rgbAt(input,width,height,planar,px,py,rgb);
    pixels[y*w+x]=Math.round(255*(.299*rgb[0]+.587*rgb[1]+.114*rgb[2]));
  }
  return {width:w,height:h,pixels};
}
