# Android voice and navigation port — 11 October 2026

Ported from the separate iOS checkout:

- One spoken “Listening” per voice session; quiet retries and haptic readiness.
- Camera double-tap toggles voice. Questions, result choices and long-trip confirmations keep listening; completed directions end the turn.
- Voice interruption of spoken prompts, numeric place selection, slower default speech.
- Shared tone gain, explicit speech gain, queued service error announcements.
- Walking-route compass headings, approximate distances and step counts (0.7 m assumed step length). No crossing-completion countdown.
- Long-trip confirmation over 1 km and progress announcements during searches/routing.

## Android adaptations

`scripts/patch-speech-media.cjs` runs after dependency installation and assigns native TTS to `USAGE_MEDIA`, matching earcons and normal media-volume controls. It does not write system volume.

Android has no equivalent of iOS AVSpeechSynthesizer's word-boundary stop. `Speaker` waits for the next TTS range event, with a 180 ms fallback for engines that omit those events. New speech waits for cancellation; cancelled queued utterances cannot start late. Acoustic click elimination is not established by unit tests.

The SceneKit 3D arrow and iOS screenshot diagnostic were not copied. Spoken headings work independently of that renderer. Android native motion/haptics, package identity, signing, model assets and service configuration remain Android-owned.

## Validation

TypeScript and lint pass. 33 test suites / 301 tests pass, including Android interruption timing, question follow-ups, silent listening retries, compass sectors, step estimates and suppression of crossing countdowns.

Build: `ANDROID_HOME=/Users/hieu/Library/Android/sdk npm run android:preview`.
Output: `android/app/build/outputs/apk/release/app-release.apk`.
Connected test device: Samsung SM-S906E, Android 16.

Standalone release build succeeded and was installed using `adb install -r`; cold launch succeeded. On-device UI inspection confirmed camera/model loading completed, voice entered `Listening`, camera double-tap changed it to `Voice off`, and a second double-tap restored `Listening`. No JavaScript startup errors were present in the inspected log. Perceived sound quality and outdoor navigation were not verified acoustically or on a walking trip.
