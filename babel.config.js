module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Turns functions marked 'worklet' into code the camera's frame-processor runtime can run.
    plugins: ['react-native-worklets/plugin'],
  };
};
