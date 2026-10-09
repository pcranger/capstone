/* Build the shared React Native source into a standalone, local-debug-signed ARM64 Android preview. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Java 25 requires explicit native access for the CMake/Nitro build tools.
process.env.JAVA_TOOL_OPTIONS = [process.env.JAVA_TOOL_OPTIONS, '--enable-native-access=ALL-UNNAMED']
  .filter(Boolean).join(' ');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install']);
run('bash', ['./gradlew', ':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2', '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g --enable-native-access=ALL-UNNAMED', '--console=plain'], path.join(root, 'android'));
console.log('APK: ' + path.join(root, 'android/app/build/outputs/apk/release/app-release.apk'));
