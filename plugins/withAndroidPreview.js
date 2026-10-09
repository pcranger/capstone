const { withAppBuildGradle, withStringsXml } = require('expo/config-plugins');

// The standalone USB preview uses the existing local debug certificate, preserving installed preview data.
// Distribution signing must be configured separately before a store release.
module.exports = config => {
  config = withAppBuildGradle(config, config => {
    config.modResults.contents = config.modResults.contents.replace(
      /storeFile file\(['"]debug\.keystore['"]\)/g,
      'storeFile file(System.getProperty("user.home") + "/.android/debug.keystore")',
    );
    return config;
  });
  return withStringsXml(config, config => {
    const appName = config.modResults.resources.string.find(item => item.$.name === 'app_name');
    if (appName) appName._ = 'CrossWise Preview';
    return config;
  });
};
