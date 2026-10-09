import { googleApplicationHeaders } from '../config/services';

/** Google supplies route instructions; it does not establish the pedestrian's pavement or signal phase. */
export interface GeoPoint { latitude: number; longitude: number }
export interface LocationFix extends GeoPoint { accuracy: number | null; timestamp: number }
export interface PlaceCandidate { id: string; name: string; address: string; point: GeoPoint; unavailableReason?: string }
export interface RouteStep { instruction: string; distanceMeters: number; points: GeoPoint[]; maneuver: string }
export interface WalkingRoute {
  destination: string;
  destinationAddress: string;
  points: GeoPoint[];
  steps: RouteStep[];
  distanceMeters: number;
  durationSeconds: number;
  warnings: string[];
}

export const WALKING_WARNING = 'Google walking routes are in beta and may omit sidewalks or pedestrian paths.';
export const validPoint = (p: GeoPoint): boolean => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
export function usableFix(fix: LocationFix, now: number): boolean {
  return validPoint(fix) && fix.accuracy !== null && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 &&
    fix.accuracy <= 25 && Number.isFinite(fix.timestamp) && now - fix.timestamp <= 15_000 && fix.timestamp <= now + 1_000;
}

async function post(url: string, body: unknown | undefined, apiKey: string, fieldMask: string, signal?: AbortSignal): Promise<any> {
  if (!apiKey.trim()) throw new Error('Walking routes are not configured in this build. Camera help is still available.');
  const request = new AbortController();
  const cancel = () => request.abort();
  signal?.addEventListener('abort', cancel);
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 20_000);
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST', headers: { ...googleApplicationHeaders(), 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
      body: body === undefined ? undefined : JSON.stringify(body), signal: request.signal,
    }).catch(() => { throw new Error('Cannot connect to Google Maps. Check your internet connection and try again.'); });
    // Do not echo service bodies: they can contain credentials, queries or precise locations.
    if (!response.ok) throw new Error(response.status === 403
      ? 'The route service is unavailable for this build. Camera help is still available.'
      : response.status === 429 ? 'Google Maps usage limit reached. Try again later.'
      : `Google Maps could not complete the request (${response.status}).`);
    return await response.json();
  } catch (error) {
    if (request.signal.aborted) throw new Error(signal?.aborted ? 'Request cancelled.' : 'Google Maps timed out. Try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function searchPlaces(query: string, from: GeoPoint | null, key: string, signal?: AbortSignal): Promise<PlaceCandidate[]> {
  const center = from ? { latitude: from.latitude, longitude: from.longitude } : null;
  const data = await post('https://places.googleapis.com/v1/places:searchText', {
    textQuery: query.trim(), pageSize: 5, languageCode: 'en',
    ...(center ? { locationBias: { circle: { center, radius: 5_000 } } } : {}),
  }, key, 'places.id,places.displayName,places.location,places.formattedAddress', signal);
  const places: PlaceCandidate[] = (Array.isArray(data?.places) ? data.places : []).flatMap((p: any) =>
    p && typeof p.id === 'string' && p.id && typeof p.displayName?.text === 'string' && p.displayName.text.trim() && p.location && validPoint(p.location)
      ? [{ id: p.id, name: p.displayName.text, address: typeof p.formattedAddress === 'string' ? p.formattedAddress : '', point: p.location }]
      : []);
  if (!places.length) throw new Error('No matching places found. Try a name with a suburb or street.');
  return places;
}

/** Fresh details by ID. No durable provider-content cache and no automatic moved-place substitution. */
export async function placeDetails(id: string, key: string, signal?: AbortSignal): Promise<PlaceCandidate> {
  if (!id || id.length > 512) throw new Error('Place unavailable. Search again.');
  const p = await post(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, undefined, key,
    'id,displayName,formattedAddress,location,businessStatus,movedPlaceId', signal);
  if (typeof p?.id !== 'string' || typeof p.displayName?.text !== 'string' || !p.displayName.text.trim() || !p.location || !validPoint(p.location)) {
    throw new Error('Place details unavailable. Search again.');
  }
  return { id: p.id, name: p.displayName.text, address: typeof p.formattedAddress === 'string' ? p.formattedAddress : '', point: p.location,
    unavailableReason: p.movedPlaceId || p.id !== id ? 'This place has moved. Search for its new location.'
      : p.businessStatus === 'CLOSED_PERMANENTLY' ? 'This place is marked permanently closed. Choose another place.' : undefined };
}

export async function walkingRoute(from: GeoPoint, to: PlaceCandidate, key: string, signal?: AbortSignal): Promise<WalkingRoute> {
  const data = await post('https://routes.googleapis.com/directions/v2:computeRoutes', {
    origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } }, destination: { placeId: to.id }, travelMode: 'WALK',
    polylineEncoding: 'ENCODED_POLYLINE', polylineQuality: 'HIGH_QUALITY', languageCode: 'en-AU', units: 'METRIC',
  }, key, 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration,routes.warnings,' +
    'routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.polyline.encodedPolyline', signal);
  return parseWalkingRoute(data, to);
}

export function parseWalkingRoute(data: any, to: PlaceCandidate): WalkingRoute {
  const route = data?.routes?.[0];
  if (!route) throw new Error('No walking route found for that destination.');
  const points = decodePolyline(route.polyline?.encodedPolyline);
  const steps: RouteStep[] = [];
  for (const leg of Array.isArray(route.legs) ? route.legs : []) for (const step of Array.isArray(leg?.steps) ? leg.steps : []) {
    const geometry = decodePolyline(step.polyline?.encodedPolyline);
    const instruction = step.navigationInstruction?.instructions;
    // Reject incomplete geometry rather than joining unrelated points with a fabricated walkable line.
    if (geometry.length < 2 || typeof instruction !== 'string' || !instruction.trim()) {
      throw new Error('This route has incomplete walking instructions. Try another destination.');
    }
    steps.push({ instruction: instruction.trim(), points: geometry,
      distanceMeters: Number.isFinite(step.distanceMeters) ? Math.max(0, step.distanceMeters) : pathLength(geometry),
      maneuver: step.navigationInstruction?.maneuver ?? 'MANEUVER_UNSPECIFIED' });
  }
  if (points.length < 2 || !steps.length || !Number.isFinite(route.distanceMeters) || route.distanceMeters < 0) {
    throw new Error('Google returned an incomplete walking route.');
  }
  const duration = typeof route.duration === 'string' && /^\d+(?:\.\d+)?s$/.test(route.duration) ? Number.parseFloat(route.duration) : NaN;
  if (!Number.isFinite(duration) || duration < 0) throw new Error('Google returned an invalid route duration.');
  return { destination: to.name, destinationAddress: to.address, points, steps, distanceMeters: route.distanceMeters,
    durationSeconds: duration, warnings: Array.isArray(route.warnings) ? route.warnings.filter((w: unknown) => typeof w === 'string') : [] };
}

/** Bounded decoder: malformed/truncated provider responses must not loop or invent coordinates. */
export function decodePolyline(encoded: unknown): GeoPoint[] {
  if (typeof encoded !== 'string' || encoded.length > 1_000_000) throw new Error('Invalid route geometry.');
  const points: GeoPoint[] = [];
  let index = 0, lat = 0, lng = 0;
  const next = (): number => {
    let result = 0, shift = 0;
    while (true) {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid route geometry.');
      const byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid route geometry.');
      result += (byte & 31) * 2 ** shift;
      if (byte < 32) break;
      shift += 5;
    }
    return result % 2 ? -(Math.floor(result / 2) + 1) : result / 2;
  };
  while (index < encoded.length) {
    lat += next(); lng += next();
    const point = { latitude: lat / 1e5, longitude: lng / 1e5 };
    if (!validPoint(point)) throw new Error('Invalid route coordinates.');
    points.push(point);
  }
  return points;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance (haversine); well under 0.5% from Android's ellipsoidal distanceBetween at walking range. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Local projection onto a segment, with longitude scaled at the segment's latitude. */
export function projectionRatio(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const longitudeScale = Math.cos(toRad((a.latitude + b.latitude) / 2));
  const dx = (b.longitude - a.longitude) * longitudeScale;
  const dy = b.latitude - a.latitude;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  const t = ((p.longitude - a.longitude) * longitudeScale * dx + (p.latitude - a.latitude) * dy) / lengthSquared;
  return Math.min(Math.max(t, 0), 1);
}

export function distanceToSegmentMeters(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const t = projectionRatio(p, a, b);
  return distanceMeters(p, {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  });
}


export function pathLength(points: GeoPoint[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + distanceMeters(points[i], p), 0);
}

/** Distance along this instruction's geometry; no global nearest-segment jump or step advancement. */
export function stepPosition(points: GeoPoint[], here: GeoPoint): { away: number; remaining: number } {
  let best = Infinity, along = 0, walked = 0;
  for (let i = 1; i < points.length; i++) {
    const length = distanceMeters(points[i - 1], points[i]);
    const away = distanceToSegmentMeters(here, points[i - 1], points[i]);
    if (away < best) { best = away; along = walked + length * projectionRatio(here, points[i - 1], points[i]); }
    walked += length;
  }
  return { away: best, remaining: Math.max(0, walked - along) };
}
