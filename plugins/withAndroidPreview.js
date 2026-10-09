const { withAppBuildGradle, withStringsXml } = require('expo/config-plugins');

// Groovy for android { defaultConfig { } }: fills the ${googleMapsApiKey} manifest placeholder at build time
// from the environment or the repo-root .env, so the Maps key is never written into the tracked android/ folder.
const MAPS_KEY_MARKER = '// CrossWise: Maps key from env at build time';
const MAPS_KEY_GROOVY = [
  `        ${MAPS_KEY_MARKER}`,
  "        def mapsKey = System.getenv('GOOGLE_MAPS_ANDROID_API_KEY') ?: System.getenv('GOOGLE_MAP_API_KEY')",
  '        if (!mapsKey) {',
  "            def envFile = rootProject.file('../.env')",
  '            if (envFile.exists()) {',
  '                def envProps = new java.util.Properties()',
  '                envFile.withInputStream { envProps.load(it) }',
  "                mapsKey = envProps.getProperty('GOOGLE_MAPS_ANDROID_API_KEY') ?: envProps.getProperty('GOOGLE_MAP_API_KEY')",
  '            }',
  '        }',
  "        manifestPlaceholders += [googleMapsApiKey: (mapsKey ?: '').trim().replaceAll(/^[\"']|[\"']$/, '')]",
  '',
].join('\n');

// The standalone USB preview uses the existing local debug certificate, preserving installed preview data.
// Distribution signing must be configured separately before a store release.
module.exports = config => {
  config = withAppBuildGradle(config, config => {
    config.modResults.contents = config.modResults.contents.replace(
      /storeFile file\(['"]debug\.keystore['"]\)/g,
      'storeFile file(System.getProperty("user.home") + "/.android/debug.keystore")',
    );
    if (!config.modResults.contents.includes(MAPS_KEY_MARKER)) {
      config.modResults.contents = config.modResults.contents.replace(/defaultConfig\s*\{\r?\n/, m => m + MAPS_KEY_GROOVY);
    }
    return config;
  });
  return withStringsXml(config, config => {
    const appName = config.modResults.resources.string.find(item => item.$.name === 'app_name');
    if (appName) appName._ = 'CrossWise Preview';
    return config;
  });
};
