const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Detection models ship as .tflite assets (see assets/models/).
config.resolver.assetExts.push('tflite');

module.exports = config;
