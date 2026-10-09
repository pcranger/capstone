import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Build configuration, never user preferences. Client credentials are extractable from a distributed app. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const common = process.env.GOOGLE_MAP_API_KEY?.trim() ?? '';
  const iosKey = process.env.GOOGLE_MAPS_IOS_API_KEY?.trim() || common;
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || common;
  return {
    ...config,
    name: config.name ?? 'CrossWise',
    slug: config.slug ?? 'crosswise',
    plugins: [...(config.plugins ?? []), ['react-native-maps', {
      iosGoogleMapsApiKey: iosKey,
      androidGoogleMapsApiKey: androidKey,
    }]],
    extra: {
      ...config.extra,
      services: {
        mapsRestApiKey: process.env.GOOGLE_MAPS_REST_API_KEY?.trim() || common,
        geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
        googleMapsIosConfigured: Boolean(iosKey),
        googleMapsAndroidConfigured: Boolean(androidKey),
        iosBundleIdentifier: config.ios?.bundleIdentifier ?? '',
      },
    },
  };
};
