# Android design port — 6 October 2026

Source design: `/Users/hieu/Desktop/capstone/capstone_ios`.
Destination: native Kotlin app in `capstone_android/android`. The iOS source was not modified. Existing Android changes were preserved; a pre-port source/configuration backup is at `/tmp/crosswise-android-before-ios-port.tar.gz`.

## Implemented

- Camera-first home screen with a small status area and optional user controls. Developer mode has compact icons, counts, labelled boxes and a collapsible diagnostic panel with model/backend, inference latency, FPS, brightness, pitch, signal, tracks and optical TTC.
- Full-screen Google Maps, bottom destination drawer, expand/collapse, recenter, north-up and close-map controls. Camera remains mounted underneath overlays. Map markers and POIs support destination selection.
- Search, up to three choices, walking-route review/start, pause/resume/end, explicit instruction completion, saved-place stars/aliases, three recent saved places, removal/undo and cancellable destination replacement.
- Foreground GPS stays active when a route is paused. Starting a route requires a recent sufficiently accurate fix; idle route starts reject an origin that has moved too far. GPS does not determine the pavement side.
- Android offline speech recognition with serialized speech/listening turns, permission/error handling, timeout recovery, manual/man and iOS command variants. Settings/backgrounding cancel voice work. No free-form speech is interpreted as a crossing instruction.
- User/Developer setting, compact Manual and Precautions, guide/practice in Settings. Removed bottom navigation tabs, startup safety gate, API-key fields, volume-button crossing shortcuts and model-loaded announcements.
- Build-time keys from the sibling iOS `.env` or environment. Keys are not written into the external settings mirror. Native Android configuration still needs appropriate Google API/key restrictions.
- Bundled local assets: YOLO26n default and custom CrossWise model copied from iOS. These binaries follow the existing Git ignore policy; preserve/distribute them separately when cloning.

## Device evidence

Samsung Galaxy S22+ (SM-S906E), Android 16/API 36, USB connected.

- Final build, **58 JVM tests**, **4 connected-device tests** passed. Lint: no errors; existing/dependency/unused-resource warnings remain.
- Device tests exercised User/Developer changes, diagnostics open/close, map drawer open/close, both bundled models on CPU, YOLO bus/person detections in the Ultralytics reference photograph, and live Google Places search/details plus a walking route between public Sydney landmarks. The live service test is opt-in with `-Pandroid.testInstrumentationRunnerArguments.liveMaps=true` and does not use the phone's location.
- Android Studio mirroring verified the real camera preview, map tiles/location marker, drawer resizing, Settings, User mode and Developer diagnostics. Observed YOLO GPU operation around 10 FPS / 59 ms inference in this indoor scene; this is a sample, not a benchmark.
- Native offline recognizer reached Listening on this phone. Human spoken-command accuracy, TalkBack operation, outdoor moving-traffic accuracy, route walking and crossing scenarios still need acceptance testing. Reference-photo detections do not establish those outcomes.
- Fixed issues exposed during testing: false stale-camera status caused by comparing a new frame against an older UI timer; uncaught tone-thread interruption during activity teardown; speech failure blocking recognition; asynchronous settings timing in the UI test.

## Installation

The pre-existing `com.crosswise.app` has a different signing certificate and cannot be updated with this workspace's debug key. It was left intact. The tested build is installed alongside it as **CrossWise Preview** (`com.crosswise.app.preview`), left in User mode. Existing app data was not deleted.

Final APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

Build/test reports: `android/app/build/reports/`.

```sh
cd android
bash gradlew -PcrosswiseApplicationId=com.crosswise.app.preview \
  -Pandroid.testInstrumentationRunnerArguments.liveMaps=true \
  :app:connectedDebugAndroidTest :app:testDebugUnitTest :app:lintDebug
```

Connected tests may uninstall their target package afterwards; reinstall the APK for manual testing. The default build keeps `com.crosswise.app`; using it to replace the old phone installation requires the matching signing key or a separately approved uninstall/data-loss decision.

## Remaining functional boundaries

This ports the design and supported flows into the existing native Android architecture. It does not copy iOS Core ML/ARKit implementations. Route progression and far-footpath completion remain explicit, and User mode does not automatically authorize crossing. Native model selection, camera capture, sensor and speech implementations differ from iOS and need their own field evaluation.
