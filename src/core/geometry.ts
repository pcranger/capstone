/** Axis-aligned box in normalized image coordinates (0..1, origin top-left, upright frame). */
export class BoxF {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly right: number,
    readonly bottom: number,
  ) {}

  get width(): number {
    return Math.max(0, this.right - this.left);
  }
  get height(): number {
    return Math.max(0, this.bottom - this.top);
  }
  get area(): number {
    return this.width * this.height;
  }
  get centerX(): number {
    return (this.left + this.right) / 2;
  }
  get centerY(): number {
    return (this.top + this.bottom) / 2;
  }
  get diagonal(): number {
    return Math.sqrt(this.width * this.width + this.height * this.height);
  }

  iou(other: BoxF): number {
    const ix = Math.min(this.right, other.right) - Math.max(this.left, other.left);
    const iy = Math.min(this.bottom, other.bottom) - Math.max(this.top, other.top);
    if (ix <= 0 || iy <= 0) return 0;
    const inter = ix * iy;
    const union = this.area + other.area - inter;
    return union <= 0 ? 0 : inter / union;
  }

  centerDistance(other: BoxF): number {
    const dx = this.centerX - other.centerX;
    const dy = this.centerY - other.centerY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  offset(dx: number, dy: number): BoxF {
    return new BoxF(this.left + dx, this.top + dy, this.right + dx, this.bottom + dy);
  }

  clamp01(): BoxF {
    return new BoxF(clamp(this.left, 0, 1), clamp(this.top, 0, 1), clamp(this.right, 0, 1), clamp(this.bottom, 0, 1));
  }

  /** True when the box touches the frame border (object probably truncated). */
  touchesEdge(margin = 0.01): boolean {
    return this.left <= margin || this.top <= margin || this.right >= 1 - margin || this.bottom >= 1 - margin;
  }

  static fromCenter(cx: number, cy: number, w: number, h: number): BoxF {
    return new BoxF(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export const Angles = {
  /** Wraps any angle in degrees into (-180, 180]. */
  wrap180(deg: number): number {
    let a = deg % 360;
    if (a <= -180) a += 360;
    if (a > 180) a -= 360;
    return a;
  },

  wrap360(deg: number): number {
    const a = deg % 360;
    return a < 0 ? a + 360 : a;
  },

  toDeg(rad: number): number {
    return (rad * 180) / Math.PI;
  },

  toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  },

  /**
   * Horizontal bearing (degrees, + = right of the optical axis) of a point at normalized x,
   * for a pinhole camera with the given horizontal field of view.
   */
  bearingFromImageX(xNorm: number, hfovDeg: number): number {
    const halfTan = Math.tan(Angles.toRad(hfovDeg / 2));
    return Angles.toDeg(Math.atan((xNorm - 0.5) * 2 * halfTan));
  },

  /** Vertical elevation (degrees, + = above the optical axis) of a point at normalized y. */
  elevationFromImageY(yNorm: number, vfovDeg: number): number {
    const halfTan = Math.tan(Angles.toRad(vfovDeg / 2));
    return Angles.toDeg(Math.atan((0.5 - yNorm) * 2 * halfTan));
  },
};

/** Monotonic milliseconds, the counterpart of Android's SystemClock.elapsedRealtime(). */
export function nowMs(): number {
  return performance.now();
}
