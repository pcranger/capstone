export interface ContentRect { x: number; y: number; width: number; height: number }

/** Upright source frame in the same centre-cropped coordinate space as Camera resizeMode="cover". */
export function coverRect(viewWidth: number, viewHeight: number, frameAspect: number): ContentRect {
  const viewAspect = viewWidth / viewHeight;
  const width = viewAspect > frameAspect ? viewWidth : viewHeight * frameAspect;
  const height = viewAspect > frameAspect ? viewWidth / frameAspect : viewHeight;
  return { x: (viewWidth - width) / 2, y: (viewHeight - height) / 2, width, height };
}

/** Full upright frame fitted inside a viewport; identical to Camera resizeMode="contain". */
export function containRect(viewWidth: number, viewHeight: number, frameAspect: number): ContentRect {
  if (viewWidth <= 0 || viewHeight <= 0 || !Number.isFinite(frameAspect) || frameAspect <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.min(viewWidth, viewHeight * frameAspect);
  const height = width / frameAspect;
  return { x: (viewWidth - width) / 2, y: (viewHeight - height) / 2, width, height };
}
