import * as Location from 'expo-location';
import type { LocationFix } from './navigation';

/** Native location calls cannot be cancelled; bound the wait and discard late results. */
export function bounded<T>(operation: Promise<T>, signal: AbortSignal | undefined, disposeLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const cancel = () => finish(new Error('Request cancelled.'));
    const timer = setTimeout(() => finish(new Error('Location timed out. Retry from the footpath.')), 25_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    signal?.addEventListener('abort', cancel);
    if (signal?.aborted) cancel();
    operation.then(value => {
      if (settled) { disposeLate?.(value); return; }
      settled = true; cleanup(); resolve(value);
    }, error => { if (!settled) { settled = true; cleanup(); reject(error); } });
  });
}
export function fixOf(location: Location.LocationObject): LocationFix {
  return { latitude: location.coords.latitude, longitude: location.coords.longitude,
    accuracy: location.coords.accuracy, timestamp: location.timestamp };
}
let permissionRequest: Promise<Location.LocationPermissionResponse> | null = null;
let permissionAsked = false;
async function locationPermission(): Promise<Location.LocationPermissionResponse> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted || !current.canAskAgain) return current;
  if (permissionRequest) return permissionRequest;
  // Android permission activities pause/resume the host. Do not prompt again on that resume.
  if (permissionAsked) return current;
  permissionAsked = true;
  permissionRequest = Location.requestForegroundPermissionsAsync();
  try { return await permissionRequest; } finally { permissionRequest = null; }
}
export async function ensureLocationPermission(): Promise<void> {
  const permission = await bounded(locationPermission(), undefined);
  if (!permission.granted) throw new Error('Enable location for CrossWise in app settings.');
}
export async function cachedLocation(): Promise<LocationFix | null> {
  const location = await bounded(Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 }), undefined);
  return location ? fixOf(location) : null;
}
export async function locate(signal: AbortSignal): Promise<LocationFix> {
  const permission = await bounded(locationPermission(), signal);
  if (!permission.granted) throw new Error('Location permission off. Enable CrossWise location in app settings.');
  if (signal.aborted) throw new Error('Request cancelled.');
  const location = await bounded(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), signal);
  return fixOf(location);
}
export async function watchLocation(onFix: (fix: LocationFix) => void, onError: () => void): Promise<Location.LocationSubscription> {
  return bounded(Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 2_000 },
    location => onFix(fixOf(location)), onError), undefined, subscription => subscription.remove());
}
