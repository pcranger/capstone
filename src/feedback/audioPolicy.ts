/** Keep output routing and processing identical while speaking and listening.
 * These gains scale app audio; they never write the device's system volume.
 */
export const IOS_AUDIO_SESSION = {
  category: 'playAndRecord' as const,
  mode: 'default' as const,
  categoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'] as ('defaultToSpeaker' | 'allowBluetooth' | 'mixWithOthers')[],
};
export const SPEECH_GAIN = 1;
export const TONE_GAIN = 0.45;
