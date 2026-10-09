import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function parseServices(raw: unknown) {
  const values = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const text = (key: string) => typeof values[key] === 'string' ? (values[key] as string).trim() : '';
  return {
    mapsRestApiKey: text('mapsRestApiKey'),
    geminiApiKey: text('geminiApiKey'),
    googleMapsIosConfigured: values.googleMapsIosConfigured === true,
    googleMapsAndroidConfigured: values.googleMapsAndroidConfigured === true,
    iosBundleIdentifier: text('iosBundleIdentifier'),
  };
}

export const services = parseServices(Constants.expoConfig?.extra?.services);
export const nativeMapConfigured = Platform.OS === 'ios' ? services.googleMapsIosConfigured : services.googleMapsAndroidConfigured;

/** Google supports this identifier for appropriately restricted direct iOS web-service requests. */
export function googleApplicationHeaders(): Record<string, string> {
  return Platform.OS === 'ios' && services.iosBundleIdentifier
    ? { 'X-Ios-Bundle-Identifier': services.iosBundleIdentifier } : {};
}
