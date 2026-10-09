# Shared React Native Android migration — 6 October 2026

## Source of truth

The React Native source is now checked into this repository at the project root.
The Android host is `android/`; the earlier Kotlin/Compose implementation is
retained in `android-legacy/`. The iOS checkout remains a separate sibling
working copy, but cloning this repository is sufficient to build Android.

## Changes

- Android Expo module for orientation/acceleration, vibration, battery, headphones and camera field of view.
- Shared TypeScript source and the Android native host were consolidated into this repository on 9 October 2026; the former `mobile` symlink was removed.
- Android offline recognition capability/installed-language discovery; iOS-only audio-session calls excluded on Android. Unavailable offline recognition uses the existing recovery/touch interface, never an implicit online recognizer.
- Bundled Android model loading uses Expo asset/file APIs so release resources work without Metro. YOLO26n is the default; explicit model selections remain respected.
- Android Back closes settings, guide and full-screen map before leaving the app.
- Platform-neutral permission/manual wording, shared interface and settings.
- Google Maps padding waits for native map readiness, fixing a launch crash found on the Samsung. Regression test covers first mount and map retry.
- Standalone ARM64 preview build script with bounded worker count and Gradle heap/metaspace settings. The first build exhausted disk space in temporary native build output; only regenerable CrossWise build intermediates/simulator products and a failed SDK download were removed. Existing iPhone release product and source were preserved.

## Installation and data

Package `com.crosswise.app.preview`, version code 2, launcher label **CrossWise Preview**. Local Android debug signing matches the previous preview, so installation updates it without uninstalling. The original differently signed `com.crosswise.app` remains installed.

Kotlin preferences and saved places are not automatically imported into React Native AsyncStorage. Existing package data is retained, but the RN UI starts with its own settings/storage. This is a preview build, not store distribution signing.

## Validation

241 shared tests across 27 suites pass, including Android offline recognition, Android Back and map initialization regression coverage. Typecheck and lint pass. The final release build, including all device-found fixes, passes Android release lint and assembles successfully.

Earlier Kotlin unit/instrumentation results do not validate this React Native binary. No new iPhone binary has been installed in this migration. Outdoor motion detection, left/right alerts, live spoken-command accuracy and route traversal need real-world validation; unit tests and a stationary phone cannot establish those outcomes.

## Final Samsung checks

Installed and launched the standalone React Native release APK on Galaxy S22+ (SM-S906E), Android 16/API 36, using `adb install -r`. No Metro process is needed. Build output: `android/app/build/outputs/apk/release/app-release.apk`.

- Found and fixed a native Google Maps launch crash caused by padding before map readiness.
- Found and fixed repeated permission requests that triggered Android activity pause/resume cycles, repeatedly interrupting camera startup. Permission checks reuse grants; concurrent location requests share one prompt and a denial does not automatically prompt again on resume. Tests cover existing grants, concurrent requests, denial and later grant from settings.
- Android uses the platform default rear camera; the physical-lens filter used on iOS selected a different Samsung camera. iOS retains its explicit wide-angle selection.
- Developer diagnostics showed YOLO26n, Android GPU, 640 px input, 16–17 FPS and 46–51 ms inference. Pitch was about −89 degrees; camera brightness was 0%. These measurements verify live frame processing, not vehicle detection accuracy: the phone's lens view was dark. No visible-scene or outdoor accuracy result is claimed.
- Offline speech preparation succeeded and the UI entered Listening, including after returning from Settings. No live spoken command was supplied, so recognition accuracy/end-to-end voice navigation is unverified.
- Full-screen Google map displayed, including location marker/accuracy about 6–8 m and destination drawer. Collapse icon returns to the camera. Android Back returns from Settings and map. Camera inference resumes after map interaction.
- Destination search attempted, but Android DNS could not resolve `places.googleapis.com` or `google.com`. This prevents live search, route preview and saving a searched result from being verified. Raw Android network exceptions now become a concise connection message, with regression coverage. Map tiles visible in this session do not prove that live Places/Routes requests can connect.
- Left installed app in User mode. Original CrossWise app is untouched. No new iPhone binary was installed or physically tested.

Build logs and test output from this session are in `/tmp/crosswise-rn-android-build8.log`, `/tmp/crosswise-rn-tests4.log`, `/tmp/crosswise-rn-typecheck4.log` and `/tmp/crosswise-rn-lint4.log`. These temporary logs are not a permanent artifact.
