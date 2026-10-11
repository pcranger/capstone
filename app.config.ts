import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Build configuration, never user preferences. */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'CrossWise',
  slug: config.slug ?? 'crosswise',
});
