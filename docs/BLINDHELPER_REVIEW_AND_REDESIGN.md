# CrossWise redesign: BlindHelperApp review and implementation plan

**Latest revision — 6 October 2026:** [Instruction-first research and scenario assessment](INSTRUCTION_FIRST_RESEARCH_AND_SCENARIOS.md). The user rejects routine environmental questions: automatic state estimation and explicit recovery replace roadside/landmark/completion question fallbacks in older plans. Three more repositories inspected; real-photo detector inference executed; conservative segmentation-label correction implemented. The full hands-free journey is not yet implemented.

**Current comprehensive plan — 5 October 2026:** [Hands-free navigation and crossing perception](HANDS_FREE_NAVIGATION_IMPLEMENTATION_PLAN.md). Based on five pinned GitHub source checkouts; supersedes conflicting earlier proposals. Includes native Scene Semantics evaluation, roadside uncertainty, capture/model integration gates and one-feature-at-a-time acceptance. Planning only; no app functionality changed by this assessment.

4 October 2026. **Increment 1 accepted: the user confirmed both physical volume buttons work normally. Increment 2 implemented; physical map/camera acceptance remains pending.**
The original review was planning only. Section 8 records increment 1; section 9 records the original split screen; section 10 records the camera-first map drawer. Section 11 is the latest, unimplemented plan: a fully interactive map, bottom destination sheet, saved places and voice commands.

Reassessed after the user's clutter/usability question. The revisions below are recommendations for the next build,
not evidence of usability validation. In particular, moving Developer access into Settings revises the earlier top-tab
proposal. Section 7 records the remaining uncertainties and the tasks that must work before adding more features.

The original requested direction (superseded by sections 10–11) was one split screen: Google Maps/macro navigation on top, camera/micro navigation below;
remove phone API-key entry; use the existing `.env`; remove unnecessary interactions; adopt useful BlindHelperApp features.
This supersedes the separate Assist/Go screen design in CROSSING_PLAN §10.9. Keep the working vehicle pipeline and the
validated journey cancellation, location-quality and explicit crossing-completion behaviour.

“Up and down” is provisionally interpreted as the volume-button shortcuts. A clarification has been requested about
whether it also includes spoken tilt-up/down prompts. Removing volume interception restores normal phone volume control;
it does not automatically mean removing camera-position warnings.

## 1. What I inspected and what this establishes

Reviewed BlindHelperApp's README, layouts, manifest, Gradle configuration and application code: Activity/View/Renderer,
VoiceAssistant, PathFinder, GuidanceManager/State/data models, Detector, GeminiVlmService, DepthProcessor, distance and
bounding-box views, logger and AR session lifecycle. Followed call sites to distinguish active code from unused helpers.
This is a source review, not a runtime or field evaluation of BlindHelperApp. No app test sources were found in `app/src`.
Vendored OpenCV/AR rendering infrastructure is not evidence that the navigation itself works.

CrossWise review covered navigation, camera/overlay sizing, configuration, volume handling, feedback and screen composition.
`mobile/.env` contains nonempty `GOOGLE_MAP_API_KEY` and `GEMINI_API_KEY`; values were not printed or copied into these notes.
The root `.gitignore` already excludes this `.env`. API enablement, restrictions, billing and key validity have not been
checked by sending requests during this planning pass.

### BlindHelperApp feature inventory

“Active” below means wired in the source, not verified on a device.

| Feature | What the source actually does | CrossWise decision |
|---|---|---|
| Camera and Google map together | Full-screen AR camera with a 250 dp Google map overlay at the **bottom**; route polyline, current-location layer and recenter control. | Adopt simultaneous display, using the requested **map above / micro below** layout with real layout regions. |
| Speak destination | Button opens Android speech recognition; strips prefixes such as “take me to”, “navigate to”, “find”. | Reimplement tap-to-speak on iPhone; retain typed/dictated text fallback. |
| Place search | Places Text Search; sorts returned places by straight-line distance and immediately chooses the nearest. | Adopt nearby category/name search. Retain explicit name/address confirmation so “library” cannot silently select the wrong branch. |
| Walking routes | Routes REST API with WALK; extracts route polyline and text instructions; draws route on Google Maps. | Reuse CrossWise's provider and step geometry, add native map rendering. Do not replace tested request handling. |
| Live progress | Accepts location accuracy up to 30 m; progresses polyline vertices with projection/proximity; treats under 5 m from endpoint as arrival. | Redesign progress. Do not copy proximity-only crossing skips or automatic final arrival. |
| Relative directions | Phone compass becomes clock-face directions to the next vertex; off-route logic points directly toward the nearest vertex. | Do not copy. Phone scanning changes its heading; a straight line to a vertex need not be walkable. |
| Route context shared with micro guidance | `GuidanceState` supplies the current instruction to the renderer and Gemini. | Adopt a structured shared journey context and one speech coordinator. |
| Periodic Gemini guidance | Sends camera image, route instruction, obstacle/depth information and country context. First eligible call, then roughly ten-second scheduling subject to request/speech delays. | Redesign as optional, on-demand scene description first. No generated movement/crossing permission. |
| Local object detection | Renderer requests YOLOv8n through Play Services TFLite and matches a box centre to depth; object under 2 m can trigger Gemini. | Keep CrossWise's working detector/tracker and local hazard path. Consider depth as a separate future experiment. |
| Speech and haptics | TTS, a 500 ms vibration and a processing beep. TTS uses QUEUE_FLUSH. | Keep CrossWise's priority-aware speech/earcons; add restrained listening/confirmation cues. No permanent processing beep. |
| Country/language selection | Reverse-geocodes location, changes speech locale and feeds country-specific instructions into the prompt. | Prefer the user's language setting. Do not infer preferred language or pavement side from country. |
| AR depth and bird's-eye view | Depth/occlusion controls and BEV generation helpers exist. Show BEV sets a flag, but no consuming call was found in the render loop. Renderer BEV view setters are not called by Activity. | Defer. Remove from the everyday design; do not present this as a working navigation feature to port. |
| Bounding-box display | Overlay class exists, but the detector's `setResults` call is commented out. | Retain and correctly resize CrossWise's tested overlays in Developer mode. |
| Local server/streaming alternatives | Local `/predict` and Gemini streaming helpers exist; current render flow calls the non-streaming Firebase Gemini path. | Do not add unused network paths or a server dependency just because these helpers exist. |
| Logging | Writes frequent GPS, response and guidance logs to a local file. | Keep opt-in diagnostic logging, avoiding raw credentials and unnecessary precise-location/provider-response logs. |
| AR demo controls | Depth/instant-placement menus, plane status and sample virtual-object assets. | Do not bring sample/demo scaffolding into the user's walking workflow. |

### Findings that rule out copying the implementation wholesale

1. **The referenced detector asset is missing in this checkout.** Renderer line 332 requests
   `yolo_model/yolov8n_float32.tflite`; only `yolov8n_float16.tflite` is present. The active source also requires a depth
   image before running YOLO. Missing/unavailable depth can therefore prevent that detection path from running.
2. **Detection waits for the AI loop.** Renderer lines 596–615 call `runObjectDetection` only when `isProcessing` is false.
   That flag spans the Gemini request, speech and five-second post-speech delay. This structure is unsuitable for immediate
   vehicle warnings. CrossWise detection must remain independent of network, TTS, map rendering and voice recognition.
3. **The README overstates map-image integration.** The active Gemini request sends a camera image plus text context;
   no Google map snapshot capture/send call was found. Route context is useful without sending a map screenshot.
4. **The navigation heuristics repeat known CrossWise failure cases.** A 15 m proximity rule can advance past a short
   crossing. Phone-relative clock guidance changes while the user scans. Nearest-vertex recovery has no footpath proof.
5. **AI output is treated too confidently.** GeminiVlmService lines 277–285 include a “Path is clear. Go straight.” fallback
   for an empty instruction. Clock-face conflict handling can prefer the map over obstacle advice based solely on angle.
   Neither is a reliable basis for a movement decision. Blank/failed/stale output must become unavailable, not reassurance.
6. **Some demo features are only partially connected.** BEV display, box drawing and streaming/local-server methods are
   present but not part of the current successful call chain. Preserve this distinction in demonstrations and the thesis.
7. **Do not carry over incidental problems.** The inactive local-server client disables TLS verification; that is not
   needed for the redesign. Depth sampling uses a single centre pixel and needs coordinate/confidence validation; it is
   not a validated distance or moving-vehicle system. No tested curb, road-side, crossing-topology or signal-to-route
   association was found.

### Source pointers

All paths in this subsection are relative to `/Users/hieu/Desktop/capstone/BlindHelperApp`.

- `app/src/main/res/layout/activity_main.xml:46`: actual map placement and Speak Destination button.
- `app/src/main/java/com/google/ar/core/examples/kotlin/helloar/HelloArActivity.kt:147`: speech search wiring;
  `:333`: location updates; `:414`: route rendering; `:500`: destination command parsing.
- `app/src/main/java/com/google/ar/core/examples/kotlin/helloar/VoiceAssistant.kt:151`: speech flushing;
  `:283`: recognition intent.
- `app/src/main/java/com/google/ar/core/examples/kotlin/helloar/path/PathFinder.kt:96`: search flow;
  `:145`: nearest-place selection; `:178`: Routes request.
- `app/src/main/java/com/google/ar/core/examples/kotlin/helloar/path/GuidanceManager.kt:130`: progress, arrival and recovery.
- `app/src/main/java/com/google/ar/core/examples/kotlin/helloar/HelloArRenderer.kt:332`: model asset;
  `:501`: Gemini/speech lifecycle; `:596`: detection scheduling; `:648`: capture;
  `:712`: depth-gated obstacle logic; `:807`: BEV helper.
- `app/src/main/java/com/google/ar/core/examples/kotlin/helloar/utils/GeminiVlmService.kt:196`: direction conflict logic;
  `:234`: active Gemini request; `:277`: output/fallback; `:370`: prompt.

## 2. The proposed everyday screen

Recommend moving Developer access into Settings instead of reserving permanent space for User/Developer tabs.
Both modes still use the same journey and screen structure; Developer adds evidence and diagnostics, with a visible
Developer label and an explicit return to the everyday view. Retain the selected mode for demonstrations. Replace
separate Assist and Go tabs with a single Journey screen. Settings remains reachable without ending the journey;
Guide/Practice belong inside Help, not the main navigation bar. Use everyday labels such as Route and Around you,
not Macro, Micro, Assist, or engine-state names.

```text
[ Destination / journey state ]             [Settings]

┌─────────────────────────────────────────────────────┐
│ GOOGLE MAPS — top panel                             │
│ Current location + accuracy, route, destination      │
│ Recenter; route overview available on demand         │
│ Current route instruction + approximate distance    │
├─────────────────────────────────────────────────────┤
│ CAMERA / MICRO GUIDANCE — bottom panel              │
│ Camera preview + one clear current status           │
│ Vehicle alert / signal observation / uncertainty    │
│ Developer: boxes and optional FPS/diagnostics        │
├─────────────────────────────────────────────────────┤
│ Crossing help            Repeat            Pause   │
└─────────────────────────────────────────────────────┘
```

Before a journey: one destination field with a labelled microphone action and a text-entry fallback, then confirm the
place/address and Start journey. Both input methods lead to the same result list and confirmation.
During walking: route instruction above; nearby warnings below. At a crossing: the lower panel becomes the focus of
speech, with one action changing from **Crossing help → I’m crossing → I’m on the footpath**. These are user requests/
reports, not app instructions to enter the road. No tab switch and
no separate restart after each crossing. The map remains visible but does not announce competing movement instructions.
When crossing completes, route speech resumes without resetting the camera or route.

Keep Repeat and Pause in predictable positions. Pause opens a simple paused view with Resume and End journey, avoiding
adjacent Pause/End controls during walking. State explicitly which guidance is inactive while paused. Preserve unfinished
crossing state across pause, background and resume. Guard state-changing actions against rapid repeated activation;
announce the new action label without moving accessibility focus unexpectedly. Do not add hidden long-press shortcuts.

Preserve map above camera, but do not require a fixed 50/50 split. Instructions and usable controls take precedence over
preview area. Start with balanced panels at normal text size and adapt to system text size; do not animate panel sizes in
response to detections or change them under the user's finger. At large text sizes, let text sections scroll rather than
shrink controls or hide them under the map. Stack controls when needed. Give VoiceOver a short route summary and controls
without forcing the user through map labels; detailed map exploration remains optional. Focus must not jump on every
camera frame. The essential journey must work without interpreting either image panel.

Use a stable north-up map initially. A location accuracy circle is more honest than an apparently exact road-side marker.
Do not rotate the route because the user turns the camera to scan traffic. Panning should not be undone by every GPS update;
Recenter explicitly restores following. Route and camera remain useful independently if one permission/provider fails.

## 3. Remove, simplify, retain

| Current CrossWise interaction | Planned treatment |
|---|---|
| Permanent User/Developer top tabs | Recommend Developer access inside Settings; retain diagnostics and the selected mode for demonstrations. This is a revision to the earlier top-tab proposal. |
| Volume-up/down navigation shortcuts | Remove hook, listener, volume reset/HUD interception, setting, help text and unused package. Physical buttons control volume normally. Scope of tilt prompts awaits clarification. |
| API-key editors and “paste a key on the phone” setup | Remove from both modes. Read `.env` during configuration/build; display only service readiness/errors in Developer tools. |
| Separate Assist and Go tabs | Replace with the combined screen. Keep one mounted camera and one journey controller. |
| Start/stop assistance in addition to start/end journey | Remove the duplicate controls during an active journey. Retain one standalone assistance action when there is no route. |
| Manual “I completed this instruction” after every step | Transitional fallback, not the desired permanent interaction. Replace routine confirmations only after robust progress is validated; retain confirmation when a boundary is ambiguous. Do not just hide the button while keeping a stalled state machine. |
| Long lists of instructions during walking | Show the current instruction and a brief next-step preview. Full route details are optional during planning. |
| Confidence/GPU/model/overlay/sonar/automatic-start switches in the daily flow | Move technical controls to Developer tools. User settings concentrate on audio, vibration and Help; respect system accessibility preferences. |
| Multiple typefaces, separate large-status switch and overlapping display preferences | Use system text scaling and contrast preferences first. Remove cosmetic choices that do not solve a demonstrated need; preserve essential audio/vibration choices. |
| Simultaneous Pause and End controls during walking | Keep Pause prominent; show Resume and End journey in the paused view. No ambiguous combined Pause/End button. |
| Multiple repeat/read-status/read-instruction controls | One Repeat action speaks the current relevant guidance; crossing observations take precedence during crossing. Never repeat an expired observation as current. |
| Automatic-start heuristic exposed as a user option | Remove from daily settings; keep any experimentation in Developer tools until evaluated. Do not silently mark a crossing started from a green-looking light and movement. |
| Multi-step left/front/right Gemini scan | Replace later with optional **Describe ahead**, a single purposeful capture while stationary, using route context. |
| Frequent aiming chatter, processing messages and technical captions | Prefer one actionable message on a meaningful change, with Repeat on demand. Retain significant uncertainty/covered-camera warnings. |
| Vehicle detector, temporal tracking, signal observation, uncertainty, explicit crossing finish | Preserve. These carry the core function and should not be rewritten as part of a layout change. |
| Import models, confidence controls, performance/logging tools | Keep in Developer tools for the capstone; they are not daily pedestrian controls. |
| Guide and Practice | Keep as optional Help content, remove direct main-screen destinations. |

No new YOLO model/dataset replacement is justified by this UI request. A compact screen should not change inference
resolution, orientation, vehicle tracking or pedestrian-signal class semantics.

## 4. Implementation order and acceptance gates

Implement one increment at a time. A later increment starts only after the previous one works on the phone.

### Increment 1 — configuration and hardware-control cleanup

- Add dynamic Expo configuration (`app.config.ts`) and a typed service configuration layer, reading the user's existing
  `GOOGLE_MAP_API_KEY` and `GEMINI_API_KEY` names. They currently are not referenced by runtime or app configuration.
  Non-`EXPO_PUBLIC_` names do not automatically become JavaScript variables; map them explicitly without requiring the
  user to rename or retype credentials on the phone.
- Separate service configuration from user preferences. Remove KeyRow usage and key-entry messaging; migrate persisted
  settings so old blank keys cannot override build configuration. Stop exporting keys to `crosswise.conf.json`; rewrite
  that file without old key properties while preserving ordinary preferences. Keep `.env` ignored and use placeholder
  values only in any `.env.example`.
- Feed the native Google Maps plugin from build configuration. Verify Maps SDK for iOS, Places API (New), Routes API,
  billing and applicable key restrictions when implementation begins. Presence in `.env` does not prove service access.
- Keep SDK and REST credentials logically separate; allow separate `.env` overrides if restrictions require different keys.
  Follow Google guidance for direct mobile REST calls, including app identifiers and testing restrictions; use a proxy if
  the required restrictions are not supported. Do not make an existing key unrestricted as a shortcut.
- For the local prototype, build-supplied client credentials remain extractable; `.env` is configuration, not secret
  protection. A shared/public Gemini build should use a server-side broker or supported managed client protection rather
  than shipping an unrestricted Gemini key. This does not reintroduce a phone key-entry screen.
- Remove volume interception end to end, not merely its switch. Clear obsolete `volumeKeys`/`navigationEnabled` settings
  through migration and update Help/tests/dependencies. Do not alter the user's actual volume as part of migration.

Acceptance: clean build uses the computer's configuration; no key value appears in logs, settings UI or exported config;
missing/invalid credentials yield an actionable service state. On the iPhone, both volume buttons change volume and
cannot start/end a crossing. Existing preferences and vision behaviour survive the update.

### Increment 2 — real Google map and split-screen shell

- Add the Expo-57-compatible `react-native-maps` package with `PROVIDER_GOOGLE` on iOS. Use its config plugin and a native
  rebuild. This is a native Google map, not an embedded website or screenshot. The map renders the route; the existing
  Places/Routes provider and journey logic still supply routing.
- Refactor presentation into a Journey screen, Map panel, Micro panel and shared controls. Subscribe the map to location/
  route updates, not every inference frame. Keep a single camera session when opening Settings or changing interface mode.
- Draw current location/accuracy, route line and destination; support route overview and recenter. Preserve Google
  attribution and walking-route warnings. Map/network errors must not disable local vehicle observations.
- Size and clip camera overlays to the lower panel. Prefer fitting the full upright frame initially; calculate the same
  fit rectangle for preview and boxes. Do not reuse whole-screen coordinates or stretch the input. Add tests for the new
  viewport and check actual cars/boxes in Developer mode to protect the orientation fix.

Acceptance: map loads on the physical iPhone, a real route appears above a live camera, boxes remain aligned, map gestures
work, and no camera restart occurs on mode/settings changes. Compare inference latency/FPS with the prior build and check
heat/battery over a practical walking-session duration. Verify large text and VoiceOver navigation order.

### Increment 3A — unified journey, speech and recovery

- Reuse the existing tested Journey service; make it the owner of one user-visible state. Keep the crossing engine as an
  independent perception consumer, coordinated through explicit events rather than a second set of screen controls.
- Use one speech coordinator: urgent local hazards first, then crossing status, then route prompts, then optional scene
  descriptions. Voice recognition and cloud requests must not suspend detector processing. Clear stale routine speech
  after route changes; announce pauses and service failures without continuous chatter.
- Coordinate application speech with VoiceOver so a status is not read twice and routine route speech does not continually
  interrupt control exploration. Test actual speech interruption behaviour on the phone, including Repeat during an alert.
- Merge start, pause/resume, end, repeat and the contextual crossing action into one control set. Preserve the existing
  background rule and unfinished-crossing state. Confirmation on a refuge must not be treated as final far-footpath arrival.
- Add one consistent recovery presentation for location, camera and route-service failures: explain what is unavailable,
  preserve the destination and completed progress, and show the relevant retry/resume action. Do not restart the whole
  journey, fabricate fresh distances or route the user directly across a road. Keep any unaffected guidance available and
  accurately labelled. Persistent capability state must remain discoverable after an urgent transient alert.

Acceptance: one Start launches the journey; multiple crossing handoffs do not restart it. Test VoiceOver, Bluetooth/TTS,
route cancellation, location/camera loss, backgrounding and repeated button taps. Pausing accurately reports what stops;
resuming never declares an unfinished crossing complete. Local alerts continue during map/network work when the camera
and detector are available. No stale instruction survives a route change.

### Increment 3B — tap-to-speak destination, after the basic journey works

- Add tap-to-speak destination recognition. Evaluate `expo-speech-recognition` against Expo 57/RN 0.86 first; if unavailable,
  retain text/system dictation while assessing a small native bridge separately. Do not let this block the map/camera build.
- Request audio/speech permission on use, show listening/cancel/retry states and confirm the understood destination plus
  address. Share candidate selection and route preview with typed input. “Find a cafe” must not silently choose a branch.
- No always-listening service or command vocabulary to memorise. Keep recognition independent of detector processing.

Acceptance: correct and confirm a misheard destination; recover from denied permission, traffic noise, cancellation and
Bluetooth/audio-session changes without losing the journey or suppressing available local alerts.

### Increment 4 — reduce route-confirmation burden

- Add reliable progress estimates with ordered step matching, consecutive good fixes, continuity/hysteresis and explicit
  handling of route loops, parallel roads and revisited geometry. A nearest vertex or phone compass alone is insufficient.
- Automate ordinary progress only where the route boundary can be established without silently passing a crossing.
  Google WALK steps are not an exhaustive list of road crossings. Obtain verified crossing/footpath topology for the test
  corridor (surveyed data or route-associated map data); do not treat an instruction without the word “cross” as proof.
- Keep a short confirmation at uncertain boundaries. Replan from a confirmed footpath position; never steer straight
  toward an arbitrary nearest route point. Preserve explicit final destination/entrance and far-footpath confirmation.
- Automatic preparation of the lower panel can be added for verified approaching crossings. It must not automatically
  authorise movement, infer a walk signal from map lights, or decide crossing completion from GPS/stillness.

Acceptance: recorded/synthetic walking traces cannot skip a crossing under GPS drift, jumps, low accuracy, short segments,
loops, refuge pauses or scanning turns. A known public route must then be checked on foot before enabling this automation.
Until that gate passes, show the transitional confirmation explicitly rather than claiming hands-free automatic navigation.

### Increment 5 — useful scene context, then optional depth research

- Replace the long scan with optional Describe ahead using one fresh frame, the current route instruction and recent local
  observations. Describe visible landmarks/obstacles; do not generate “path clear”, “go”, or crossing permission.
- Cancel or discard results after a route/state change or excessive delay. Failure says unavailable. Detection and urgent
  speech must continue while the request is pending. Correct the existing camera permission text claiming images are
  “never uploaded” before enabling an image-upload feature; explain the actual on-demand behaviour.
- Evaluate ARKit/LiDAR only as a separate feature on suitable iPhones. Confirm camera-session compatibility, depth alignment,
  confidence, outdoors performance and value over existing observations before adding metres-to-obstacle claims. Android
  ARCore code is not an iOS implementation and its two-metre trigger is not a moving-vehicle detector.

Acceptance: no stale description after cancel/finish, no competing speech during crossing, and no detector pause during a
slow/failed cloud request. Depth remains off unless its own evaluation passes.

## 5. Architecture and concrete code work

- `mobile/app.config.ts` / service configuration: environment loading, native map setup, startup validation.
- `mobile/src/ui/CrossWiseApp.tsx`: replace separate Assist/Go tabs; preserve mode and Settings/Help navigation.
- New Journey/Map/Micro panels and control bar: compose existing route and camera components, reduce duplicated UI.
- `mobile/src/nav/navigation.ts`, `journey.ts`, `location.ts`: retain provider/geometry/cancellation/fix checks; later add
  verified progress and route-associated crossing evidence rather than placing these in the map component.
- `mobile/src/state/controller.ts` / feedback policy: shared journey events and speech priority; remove volume handlers;
  keep on-device perception independent of map/voice/AI activity.
- `mobile/src/settings/settings.ts`, Settings/Guide/Practice screens, strings: remove key and shortcut preferences, migrate
  existing installs, simplify daily choices. Delete `ui/volumeKeys.ts` and its dependency when removing shortcuts.
- Camera/preview geometry and overlay components: match bottom-panel fit/crop while preserving upright model input.
- Voice input adapter: recognition lifecycle, permissions and audio-session coordination; no background always-listening.

Retain regression coverage already in place; add focused tests for each increment and run typecheck/lint. Native map,
actual volume buttons, VoiceOver, audio and real location need physical iPhone checks. API credentials are read locally;
no key values belong in test fixtures or diagnostics. Source reuse should retain any applicable upstream attribution;
prefer reimplementing the useful behaviour in CrossWise's existing architecture over copying Android AR sample code.

## 6. Technical references checked

- [Expo 57 react-native-maps](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/): native Google provider on iOS,
  compatible package installation and `iosGoogleMapsApiKey` config-plugin setup. The documented Expo Maps alternative
  uses Apple Maps on iOS, so it does not satisfy this specific Google Maps requirement.
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/): `.env` loading, explicit runtime
  mapping and the fact that values embedded in the client are readable from the client.
- [Google Maps API security guidance](https://developers.google.com/maps/api-security-best-practices): distinguish SDK
  and web-service keys, restrictions, direct mobile REST requirements and proxy fallback.
- [expo-speech-recognition primary repository](https://github.com/jamsch/expo-speech-recognition): native speech recognition,
  permission and audio lifecycle support. Exact compatibility with this app still needs a build check.
- [Apple Dynamic Type guidance](https://developer.apple.com/videos/play/wwdc2024/10074/): scale essential text and adapt
  layout rather than clipping text inside fixed-height containers.
- [Google Routes options](https://developers.google.com/maps/documentation/routes/route-opt): walking routes may omit
  sidewalks/pedestrian paths; Google requires the corresponding warning to be displayed.
- [Google road-level map details](https://developers.google.com/maps/comms/msa-road-level-details): describes visual
  crosswalk/sidewalk detail. This page does not establish a routable crossing topology or a live pedestrian-signal feed.

## 7. Reassessment: difficulty, clutter and evidence still needed

The split-screen implementation is feasible. Its usability for blind pedestrians is still a hypothesis: a simpler visual
screen does not establish a usable audio/touch journey. The first milestone is a configured map-over-camera journey with
clear state and recovery, preserving the working detector. Automatic crossing progress, depth and generated scene advice
are separate, unproven increments. Do not make them dependencies of that milestone.

| Uncertainty | Consequence and approach |
|---|---|
| Crossing location, road side and completion | Current routing/GPS do not prove curb position, which crossing a signal serves, or far-footpath arrival. Google also documents missing pedestrian paths. Keep explicit crossing start/finish reports; automate preparation only after verifying route-associated crossing data. Do not add initial left/right-road buttons as a substitute for that evidence. |
| Vehicle motion versus camera motion | Successful boxes establish detection, not reliable motion/direction estimates. Compare parked cars, passing/approaching vehicles and phone pans on labelled clips before strengthening spoken claims. An absence of detections must never become a clear-road message. |
| Simultaneous map, camera and audio | Native rendering, inference and audio-session interaction may cause delay, heat or dropped observations. Preserve independent processing, measure the current build as a baseline, then repeat with map updates and speech active. A successful build alone does not resolve this. |
| Phone position and one-handed use | Scanning traffic changes phone heading; pedestrians may also be using a cane or guide dog. Test reachability and camera coverage in the intended holding position. Do not infer walking direction from phone orientation alone or require repeated screen hunting. |
| Competing announcements | Route speech, vehicle observations, VoiceOver and optional descriptions can obscure each other. Use priority, expiry and deduplication; keep routine speech brief and Repeat available. Do not read every detected object or process transition. |
| Provider and speech availability | Existing `.env` values do not prove API enablement/restrictions, network availability or speech-library compatibility. Verify independently; retain typed/system-dictation entry and local observations when their dependencies remain available. |

### What deserves the space freed by removing controls

Prioritise **recovery without losing the journey**, rather than adding a new permanent button. For example, a persistent
“Location uncertain — route updates paused” state should explain the limitation and offer the relevant recovery action.
Camera unavailability must be stated, not presented as no nearby vehicles. Recovery must not clear unfinished crossing
state or quietly resume a stale movement instruction.

Later, a small recent/favourite destinations list on the start screen could reduce repeated typing. It is optional and
must be user-controlled; no need to add it to the walking screen. Defer Describe ahead, LiDAR/BEV, new object categories,
always-listening voice commands and extra map layers until the core journey passes evaluation. Do not port an entire
BlindHelperApp feature merely because it appears useful in a demonstration.

### Usability and failure tasks before declaring the design intuitive

1. Indoors, complete destination entry, correction, confirmation, Start, Repeat, Pause, Resume and End using VoiceOver
   without viewing the map or camera. Check large text, stable focus, labelled controls and no hidden-gesture requirement.
2. Simulate two successive crossings, a refuge pause and rapid repeated activation. The participant should understand
   whether the app is observing, waiting for a user report, crossing, paused or unable to assess. No crossing should be
   silently skipped or finished, and no observation should sound like permission to cross.
3. Interrupt GPS, network, camera and microphone access independently; background/lock and return. Verify truthful status,
   preserved destination/progress, no stale reassurance and no instruction to walk toward an arbitrary recovery point.
4. On a known route, perform a sighted observation session measuring route matching, camera coverage, false alerts,
   speech overlap, latency and heat. Include parked cars, moving traffic and phone panning. Do not use an eyes-closed
   street walk as the usability test.
5. Seek feedback from blind/low-vision users and an orientation-and-mobility practitioner before claiming independent
   pedestrian usability. Record help needed, missed information and misunderstood prompts; simplify based on those
   findings. These tests and participant feedback have not yet been completed for the proposed redesign.

## 8. Implementation record — configuration and volume cleanup, 4 October 2026

Implemented Increment 1 after the user's instruction to implement the plan:

- Dynamic `mobile/app.config.ts` maps the existing `.env` names into typed runtime service configuration; supports optional
  separate native Maps/REST credentials. Installed the SDK-57-compatible native map package and generated its iOS setup.
  The map panel itself remains Increment 2; neither the camera layout nor model pipeline changed in this increment.
- Removed both API-key editors and the unused key-entry component/help strings. Developer Settings displays configuration
  presence only. Missing/denied routes explain service unavailability without asking the pedestrian to enter credentials.
- Removed the volume hook, controller shortcut handler, setting, help instructions and native dependency. Added one
  controller `repeatGuidance` action for future shared controls. Phone buttons are no longer observed or reset by the app.
- Startup rewrites both AsyncStorage and the exported preferences file without legacy credential/shortcut/navigation
  properties, preserving ordinary preferences and the accepted notice. Parse-error logs cannot quote a malformed secret.
- Corrected camera permission text: on-device detection remains local, but optional Gemini descriptions upload requested
  images. No actual key values were printed or copied to source/tests/docs.

Validation: all 126 tests pass, including settings migration, environment mapping, service headers and absence of key
editors/values in Developer Settings; typecheck and lint pass. Signed Release build succeeded and installed on the
connected iPhone 15 Pro. Inspected its embedded runtime configuration using boolean comparisons only: Maps/Gemini values
match the local environment, the native Maps configuration is present, and the bundle identifier is correct. The removed
volume package is absent from the package lock and native Pod lock.

Live Google preflight: Places and Routes returned HTTP 200 for a public Sydney test query/route. Both also returned 200
with a deliberately wrong iOS bundle identifier: application restrictions are not established for this key. Cloud
restrictions/billing settings were not modified. Before public distribution, verify supported restrictions or introduce
the proxy described in Increment 1. Native map-tile access still needs the Increment 2 rendered-map check.

**Follow-up:** the app subsequently launched successfully on the connected iPhone. The user confirmed both volume
buttons work normally. The earlier locked-device blocker is resolved. This confirmation covers volume controls, not
VoiceOver, field navigation or the new split-screen preview alignment.

Increment 2 continues in section 9 below. Developer-entry relocation, unified controls,
recovery changes, voice search, crossing automation and optional descriptions have not been implemented in this increment.


## 9. Increment 2 — split screen and required shared controls (4 October 2026)

The user confirmed “Volume buttons work normally”, completing that increment-1 physical check.

Implemented one Journey screen with native Google map above the camera, route line/destination/accuracy circle,
pan/overview/recenter, and independent map/camera recovery. GPS expires from the map after its existing freshness limit;
recenter keeps the current instruction and watcher. Map rendering subscribes to location/route, not inference frames.
The lower preview and overlays both fit the full upright frame. Detector input, model and tracking were not replaced.

Settings and destination search open over the same mounted camera. Removed Assist/Go tabs, permanent mode tabs,
cosmetic font/large-status choices, duplicate start/end/repeat controls during a route, and the unused AI enable toggle.
Developer controls remain in Settings → Interface. User settings retain feedback and Help. The existing multi-view AI
implementation has no everyday entry point; the planned purposeful Describe ahead remains a later increment.

The shell necessarily includes the shared controls from increment 3A: Start journey starts assistance, one Repeat,
Pause → Resume/End, and Crossing help → I’m crossing → I’m on the footpath. Expected-state guards reject duplicate
crossing taps. Backgrounded unfinished crossings still require explicit far-footpath confirmation. Existing manual
instruction completion remains visible until robust route progress is separately validated. No automatic GPS crossing
start/finish or road-side inference was introduced. The existing automatic-start experiment is Developer-only,
standalone assistance only, without altering the stored preference. Repeat rejects unavailable/stale camera observations.

Denied camera permission leaves route entry usable. Map timeout offers map-only Retry; camera interruption offers
camera-only Retry. An accurate current marker is not fabricated from an old fix. Leaving destination search cancels
pending work while preserving an available route preview. Help text uses the new controls.

Automated validation: **142 tests in 13 suites pass**, along with TypeScript and Expo lint. Tests cover map expiry,
recenter without watcher replacement, cancelled location requests, map timeout, contained asymmetric box coordinates,
camera denial/interruption/retry, fresh-frame recovery, one mounted camera, crossing duplicate-tap guards, and paused
crossing completion. Finishing a foreground paused crossing now stops local guidance and keeps the route paused.
No core/model/tracking algorithm was changed relative to the backup made before this increment.

Native simulator validation used iPhone 17 Pro / iOS 26.2 with a simulated public Sydney location. Google tiles loaded;
Places found Sydney Town Hall with its street address; Routes returned a 96 m, two-instruction walking route. Started
the route, saw its map markers/route and current instruction, entered crossing help, explicitly started crossing,
paused, confirmed completion and observed Resume become available. This is UI/network evidence, not real-world navigation.

The device check found and fixed a layout issue: route details previously pushed micro status off-screen. Map/route and
camera now occupy separate regions at ordinary text sizes. Micro status precedes the fitted preview. Larger text stacks
controls; the largest accessibility sizes use a scrollable page. A reproduced iOS/Fabric live Dynamic Type measurement
issue is handled by recreating text nodes on font-scale changes, preserving the map, camera and journey. Branding alone
has a scaling limit; guidance and action labels retain system scaling. Font-size layout transitions reset scroll offsets.

Physical installation and final layout results are recorded below. This does not mark all of increment 3A complete:
VoiceOver/audio interaction, live box alignment, thermal/FPS comparison and an outdoor route remain acceptance checks.


Final layout checks: normal text and accessibility text sizes 7 and 11 were exercised in the native simulator. At the
largest size, the location label wraps at full width and the page scrolls to Retry camera and Start camera assistance.
Returning to the original text size restores both panels and controls. Developer Settings exposes diagnostic controls
and service readiness without key editors; switching back preserves the journey screen. The simulator was restored to
User mode, its original text size (3), and keyboard capture off; the injected simulator location was cleared. No claim of physical VoiceOver speech validation is made.

Final Release builds for the iOS simulator and the connected iPhone both completed successfully. Compiler warnings from
existing native dependencies remain; no native package source was patched. Installation/launch results follow.

The final Release app was installed on the connected iPhone 15 Pro and `devicectl` reported a successful launch of
`com.tq98g3wfgs.crosswise`. A subsequent process check also found CrossWise running. The user's existing settings were retained. Device Hub cannot screen-share this physical
iOS 26.6.1 device (it requires iOS 27), so the user has been asked to confirm the visible map, live camera and box
alignment. Do not mark that physical acceptance passed until the reply arrives. No OS upgrade was performed.

Next increment starts after that acceptance: validate shared speech/VoiceOver and recovery during an actual journey
(remaining 3A), then add dedicated destination speech entry (3B). Keep automatic crossing progress, AI guidance and
new depth/model work deferred.


## 10. Full-size micro view, map drawer and concise speech (4 October 2026)

The user's next request supersedes the fixed split screen in section 9. The default journey view now fills its viewport
with the micro camera. A small, labelled bottom up arrow slides the macro map into view; the down arrow hides it. Tapping
the map preview expands the same native map full screen. A bottom-right inward-arrows button returns to the drawer.
Map transitions do not start/end assistance, change crossing state, replace the camera/map, or resize the camera viewport.
Full-screen mode enables map gestures. Hidden views are excluded from accessibility navigation; Back/accessibility escape
collapse the map, and Reduce Motion disables the drawer animation. Large-text cards scroll independently of the map handle.

The camera and all detection overlays use the same centred `cover` crop. This replaces the previous `contain` preview,
without changing inference input, orientation handling, selected model, thresholds, tracking or motion estimation. The
persistent full-size viewport avoids moving boxes when the map is opened or closed. Physical live alignment still needs
confirmation on the phone; a simulator has no real camera.

Speech changes:

- Successful model loading is silent. Model identity/backend/FPS remain available in Developer Settings.
- Removed “I will tell you…” startup narration and automatic baseline-model metadata announcements. Startup now says
  “Assistance on”; crossing actions say “Crossing mode on/off”. Necessary model failures still report unavailable detection.
- User mode does not repeat the periodic signal-search tutorial. Help and Repeat retain on-demand information. Map
  display changes are silent. Visual diagnostic notices no longer also trigger a separate VoiceOver announcement.
- Short status/action prompts include “Journey paused”, “Signal lost”, “Location uncertain. Distance paused”, and
  “Near this step’s end. Confirm when complete”. Vehicle warnings keep their direction and urgency.
- Unknown signal onset, unverified signal colours, unavailable camera observations and explicit far-footpath confirmation
  remain stated. “No approaching vehicles detected” is an observation, never a clear-road or safe-to-cross claim.
- Common prompts live in `mobile/src/strings.ts`; shared detector/crossing phrases are mirrored in Android strings.
  Route instructions retain provider street names and wording rather than being truncated to satisfy a word limit.

Validation so far: TypeScript, Expo lint and **150 tests in 14 suites pass**. Coverage includes repeated map expansion/
collapse without remounting the camera or resetting crossing state, full-screen gesture gating, preview/box crop geometry,
silent successful model loading, quiet User-mode search with urgent vehicle cues preserved, and concise prompts that
retain uncertainty. Android's edited string XML parses successfully. Detector and tracking source match the pre-change
backup. Native build, final simulator attribution check and physical installation results are recorded below.

Final native validation: Release simulator and signed iPhone builds both returned success. The native simulator verified
camera-default → drawer → full map → drawer → hidden, full-map panning, normal and maximum accessibility text size,
scrolling to camera recovery, and persistent show/hide/collapse controls. A route from a simulated public Sydney location
to Sydney Town Hall also rendered its polyline/markers, instruction, distance and manual step action in both map sizes.
Collapsing/hiding the map preserved the walking journey and its Crossing help/Repeat/Pause controls. The route card's
attribution overlap was found and corrected; the final full-map check shows Google's logo clear at the bottom left.
The simulator test journey was ended, injected location cleared, and original text size restored.

The final build was installed and launched on the connected iPhone 15 Pro. A subsequent `devicectl` process query found
CrossWise running (PID 26805). Existing native dependency compiler diagnostics remain; no native dependency was patched.
The computer cannot mirror this phone's iOS version, so physical camera/box alignment, actual speech/VoiceOver interaction
and outdoor performance are not marked validated. This request changes presentation and spoken wording; it does not
establish new detection accuracy or automatic crossing reliability.


## 11. Comprehensive plan: full map, bottom destination sheet, saved places and voice commands

**Status: approved plan; incremental implementation began 4 October 2026. See section 12 for completed work and remaining acceptance gates.**
This section supersedes the intermediate map drawer in section 10 for the next implementation. The 150 passing tests
recorded there are the existing baseline, not verification of the features proposed here.

### 11.1 Decisions and exact scope

Recommended interpretation: retain the full-screen micro camera as the default, but the bottom map arrow opens a fully
interactive full-screen map directly. Remove the extra preview/drawer step. There are two presentation states: Camera
and Map. The bottom-right inward-arrows control returns to Camera. Opening, closing or manipulating the map preserves
one camera, one map and the current journey; it is never a crossing or guidance start/stop command.

Move destination entry, saved suggestions, search results and route review into one bottom sheet on the map. Remove the
separate destination page and duplicate destination buttons. The sheet changes content as the task progresses, rather
than accumulating panels. Keep one microphone entry point available from both main views so voice use does not require
finding a map first. Settings remains separate.

The three suggestions are the most recently SAVED places, not recent searches or most recently visited places. Save
only after an explicit star/voice command. Three is the shortcut count, not a storage limit. Full saved-place management
is available through an All saved action inside the sheet, only when needed.

Provisional voice activation: one microphone tap starts a bounded foreground conversation; its subsequent search,
selection, saving and confirmation steps can continue by voice. The user has been asked whether they prefer this or a
hands-free wake phrase. This recommendation does not claim that commands work while the microphone is off. A wake phrase
would need a separate activation implementation and physical false-trigger/battery evaluation; it is not provided merely
by enabling ordinary speech recognition. System permission dialogs may still require an initial system interaction.

Saving here means bookmarking the identified Google place. A bare Save must never silently save the phone's current GPS
position or map centre. Arbitrary coordinate bookmarks, account sync and background/wake-word operation are separate
scope, unless the user selects the wake-phrase option.

### 11.2 Map and bottom-sheet behaviour

- Full map: enable pan, pinch/double-tap zoom, result/destination marker selection, Recenter and Route overview. Allow
  manual rotation with an accessible North up reset if supported by the installed native build; do not infer pedestrian
  heading from map rotation or phone aiming. 3D tilt is unnecessary for this walking interface.
- Native POI taps should open a place preview using its place ID and current details. They do not start routing by
  themselves. Test on Google Maps iOS specifically; a missing usable POI ID gets an unavailable response, not an invented
  destination. Touching empty map space only dismisses the keyboard/reduces the sheet; it never selects a route origin.
- The collapsed sheet contains Destination, microphone and the applicable main action. Focus expands it upward with
  saved suggestions or results. A labelled Expand/Collapse action supplements dragging. On small screens or maximum text
  size the sheet can occupy the available height and scroll, with Back/Close still reachable.
- The keyboard raises the sheet; the entry field, relevant result and confirmation cannot be covered by the keyboard.
  The first Back/dismiss action closes the keyboard or expanded sheet; the explicit map-close button always returns to
  Camera. Reopening restores the draft and selection, without submitting a new request.
- Keep a visible map region wherever space permits. Panning that region collapses editing and disables follow mode;
  new GPS fixes must not pull the map away until Recenter. Native gestures must not be intercepted by a full-map overlay.
- Measure the sheet, safe-area and controls for camera fitting and attribution insets. Do not hard-code the previous
  72-pixel inset. Keep the destination/route bounds and Google's attribution out from under the sheet and collapse button.
- Search result numbers correspond to stable list rows and matching pins. Search-area panning does not silently rerun a
  search or change the result numbering. Recenter, overview and map rotation never modify route progress.
- During guidance the same sheet becomes destination + current instruction + Repeat/Pause and crossing actions. The
  manual step-completion action remains available there. Map mode cannot hide the only means of pausing or asking for
  crossing help. Avoid a second overlapping route card and duplicate footer controls.
- Starting a reviewed route returns to Camera by default, gives the first instruction and stops the planning voice
  session. Map remains one action away. Closing Map without starting does not start the camera assistance engine.

### 11.3 Saved places: exact interaction and persistence

Focusing the destination textbox shows zero to three recently saved entries, newest saved first. With no saved entries,
render no empty rows, fake Home/Work items or unnecessary empty-state announcement. Submitting Search replaces these
suggestions with results; clearing/reopening the field restores saved suggestions. Typed text is preserved while browsing.

Each result has a numbered name/address selection target and a separate trailing star target. Outline means not saved;
filled means saved, with accessible labels such as Save Sydney Town Hall and Remove Sydney Town Hall from saved places.
Use at least 44-point hit areas. The star is a sibling control, not a nested button: tapping it cannot also select the
place, fetch a route, dismiss results or move the map. State is shared with the selected-place preview and saved list.

Saving is idempotent by place ID. Save twice yields one bookmark and does not reorder it. Removing then deliberately
saving again creates a new save time. Selecting/using/renaming a place does not change its saved order. Saving a fourth
place moves the oldest out of the three shortcuts but keeps it in All saved. Removing one fills the shortcut from the
next oldest. Stable tie-breaking prevents rows jumping when timestamps match.

A touch unstar or unambiguous Remove saved command removes only that bookmark and offers Undo. It cannot cancel a route
to the same place. Save by voice never toggles to unsaved if recognition delivers it twice. Do not claim Saved until the
persistent write succeeds. Serialize writes and test concurrent touch/voice saves, failures and undo alongside new saves.

Allow an optional user-written/spoken alias, such as Save as Home. Ordinary starring must not require a naming dialog.
Duplicate aliases require choosing a different label or explicitly replacing the existing alias assignment; never silently
redirect Home. Voice selection of ambiguous names asks which numbered entry. Different branches with the same name keep
separate IDs and addresses.

Persist a versioned bookmark record with local ID, Google place ID, saved timestamp, optional USER-authored alias/query
label and schema metadata. Keep this separate from exported detector settings/CSV logs. Keep full API responses and
route geometry ephemeral. Load names/addresses/details for the three visible bookmarks on demand; do not request an
entire large saved collection every time the screen mounts. Use bounded, cancelled requests and in-flight deduplication.

Google exempts place IDs from its general Places caching restrictions. Do not assume that names, addresses, coordinates
or photos can all be stored permanently. The implementation must validate its exact fields/retention against the applicable
terms before adding a durable details cache. Source: [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

This has a real UX consequence: before refreshed details arrive, show a user-authored label when available; otherwise a
neutral numbered saved-place placeholder. When offline, keep labels and bookmark management available, mark details
unavailable and do not fabricate addresses or a route. Optional aliases improve offline recognition. First-use loading
must not be mistaken for an empty saved list. Do not overwrite unread/corrupt/unsupported-version storage with an empty
array; preserve it and offer recovery. Updates/restarts should preserve bookmarks; uninstall and OS backup behaviour are
not a cross-device sync feature.

Revalidate a chosen bookmark before routing. A moved/closed/invalid place needs a clear review; do not automatically route
to a replacement business. Network failure does not delete the bookmark. Refresh ageing IDs as appropriate: Google's guide
recommends refreshing IDs older than 12 months. Source: [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id).

### 11.4 Destination and route flow

Touch flow: Show map → Destination → saved suggestion or Search → numbered result → place/address preview → Confirm place
→ route review → Start journey. Voice and touch use the same selected place, validation and actions. A star only saves.
Saving is never a prerequisite for routing, and selecting a saved place is never an automatic journey start.

Place search should work with an explicit place/suburb even when a precise GPS fix is unavailable. The current code blocks
all search behind a fresh accurate fix; refactor it so a usable location is an optional search bias. Route creation/start
still requires a valid origin, and the map centre is never used as a surrogate current location. A place can be saved even
if routing cannot yet obtain an origin.

Add Place Details (New) for saved/POI resolution with a minimal field mask and app headers. Names/addresses, location and
relevant moved/closed information are requested only as needed. Verify actual API access; the prior Text Search/Routes
preflight does not establish this new endpoint works. Field selection affects billing; do not request photos/reviews or
wildcard fields. Source: [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details).

Route preview gives destination, distinguishing address, approximate length/time, relevant provider warnings and Start
journey. Confirm by itself confirms the currently reviewed PLACE; it does not additionally start walking guidance.
The explicit Start journey command starts the reviewed route, once, after the existing location recheck.

Changing destination during an active journey is explicit: pause guidance, retain the old route/progress, prepare a new
plan and replace the journey only after the new route is reviewed and started. Cancelling replacement restores access
to Resume for the original route. During an unfinished crossing, defer replacement until the far-footpath report; retain
Repeat and existing crossing controls. Closing a sheet or cancelling a search must not call Journey.end().

### 11.5 Voice command contract

| Utterance | Result and context |
|---|---|
| Search | Submit a nonempty draft only in the query-entry step; elsewhere ask Destination? and enter dictation. Never silently rerun an old result query. |
| Search for Sydney Town Hall | Search this explicit query and read the first result with its number and distinguishing address. |
| Saved places / All saved | Read the saved shortcuts / open the full saved list. With none, say No saved places once. |
| Next / Previous / Read results | Browse the current results; this never advances the walking route. |
| Choose two / Select Home | Preview the identified result/bookmark; disambiguate duplicate names. |
| Save / Save two / Save as Home | Save the identified result/preview, or the current destination during guidance. Ask Which place? if no unique current target exists. Never use a hidden old candidate. |
| Remove saved Home / Undo | Remove a uniquely identified bookmark / undo the last reversible bookmark action. |
| Confirm | Confirm the explicitly pending place/action. With nothing pending, say Choose a place first or the applicable short instruction. |
| Start journey | Start only a completed, reviewed route; partial transcripts cannot trigger this. |
| Change destination / Cancel | Begin the explicit replacement flow / cancel the current planning operation, preserving the active journey. |
| Show map / Show camera | Switch presentation, preserving camera and journey state. |
| Zoom in / Zoom out / Recenter / Route overview / North up | Operate the map, never issue a walking instruction. |
| Repeat / Pause journey / Resume journey | Existing guarded journey actions; Repeat uses the current context. |
| End journey | Read the destination and ask for confirmation; never treat bare Stop as ending a journey. Ending guidance is not a report of arrival or crossing completion. |
| I completed this instruction / I am at my destination | Existing explicit step/arrival reports with expected-step guards; unavailable during an unfinished crossing. |
| Crossing help / I'm crossing / I'm on the footpath | Existing explicit user reports, accepted only in valid current states. Generic Confirm does not finish a crossing. |
| Stop listening | End the voice session; leave navigation unchanged. |
| Help | Briefly list commands valid in the present step; longer tutorials remain in Help. |

Inside a voice session, read one result at a time, keeping its number stable. Read a distinguishing address before place
confirmation; do not force listening to five complete addresses at once. Say the shortest useful acknowledgement: Saved;
Already saved; Which place?; No matches; Say the destination again; Route ready. Say Start journey. No narration of model
loading, request internals or every partial transcript.

Use a deterministic, state-dependent command parser, not an LLM controlling journey state. Treat destination dictation as
text: Save On Foods is a query, not a Save command. Recognize whole commands/explicit prefixes, preserve original Unicode
names and reject conflicting commands or negation such as Don't confirm. Unknown input gets one short clarification and
no action; do not use fuzzy matching to guess a destructive or movement-related command.

Only final transcripts dispatch actions. Bind each recognition turn to a session token, result-list revision, target
place ID and pending-action ID. Freeze a numbered result snapshot while it is being read. New searches, navigation away,
backgrounding, cancellation, alerts and changed targets invalidate obsolete turns. A repeated final/Confirm cannot execute
twice or spill into the next confirmation. A timeout means no action. During network work accept only applicable controls
such as Cancel; restarting the recognizer for that turn must not replay the old search utterance.

### 11.6 Recognition and audio implementation risks

There is currently speech OUTPUT through expo-speech, but no installed recognition/command layer. Candidate input adapter:
expo-speech-recognition, whose release notes explicitly list SDK 57/RN 0.86 support. This is a compatibility lead, not proof
it works with CrossWise's audio stack. First perform an isolated physical-device build/audio spike using the matching
version. Keep a small native adapter as a fallback only if the integration fails. Source: [release notes](https://github.com/jamsch/expo-speech-recognition/releases).

Request microphone and speech permissions on first voice use, with a short explanation. Prefer on-device recognition
when the selected locale supports it. Do not promise universal offline recognition or silently fall back to remote audio:
make any network recognition option clear. Apple exposes per-recognizer availability; unsupported local recognition needs
an explicit fallback. Source: [Apple on-device recognition](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition).

Default speech locale should follow an explicitly supported app/user choice (initial English/Australian English for the
existing interface), not a guessed language from GPS. Test the user's accent, street names, short commands and ordinals.
Use contextual vocabulary as a recognition aid, never as proof a command was understood correctly.

Create one audio coordinator for recognition, app TTS, earcons and interruptions. The current feedback engine configures
playback audio; recognition can change the session to playAndRecord, affecting output routing/volume. The package exposes
session configuration and documents this behaviour. Source: [recognition audio configuration](https://github.com/jamsch/expo-speech-recognition#readme).

The coordinator must suspend command capture while the app speaks, await real completion rather than an arbitrary timer,
then open the next listening turn with a short cue. Never parse the app's own Save/Confirm prompt. Handle TTS errors and
speech-off preferences without hanging a turn. VoiceOver focus speech needs separate physical testing: app TTS callbacks
do not establish that the screen reader has stopped speaking. If speaker-based multi-turn recognition cannot reliably
avoid VoiceOver feedback, use explicit per-turn activation in that configuration and disclose the limitation.

Urgent vehicle alerts pre-empt routine dialogue. Abort/invalidate partial recognition without waiting on a network call,
play the alert and retain haptics. Detection keeps running. Resume conversation only while its foreground session is still
armed, with a fresh turn and pending intent rechecked; never silently execute an interrupted Confirm. Do not repeatedly
restart microphone listening after silence, cancellation, screen lock or a phone/Siri interruption. Preserve the draft and
show a clear Voice off/Retry state. Restore the prior audio route/category after recognition exits.

Use visible listening state plus a short haptic/tone (respecting preferences). Bound silence and total session time, with
values tuned on the phone; a quiet timeout does not accept a place. Do not retain raw audio or transcripts by default.
Bookmarks remain local, and no key-entry UI returns. Search queries go to Google; any remote recognition is separately
explained. First-release voice support remains foreground only.

### 11.7 Architecture and affected code

- JourneyScreen/MapPanel: reduce display state to camera/map; remove tap interception and intermediate preview; integrate
  one destination sheet, measured insets, map actions and accessible focus transitions.
- NavigateScreen: extract its search/review content into DestinationSheet and PlaceRow rather than keeping a second screen.
  Preserve useful route review and provider attribution. Avoid its current auto-close-on-active effect in replacement flow.
- Destination planner: own draft text, numbered results, focused place, route preview, pending action and cancellation
  separately from the active Journey. Each async operation has a generation token; closing UI does not destroy the route.
- SavedPlacesRepository: independent versioned local persistence, explicit user metadata, serialized mutations and undo.
  In-memory PlaceDetails resolver: cancellable, bounded and aware of stale/moved IDs.
- Voice adapter + DialogueController: recognition lifecycle and deterministic intents. Touch and voice dispatch the same
  domain actions through one controller; neither calls component onPress handlers or has a separate navigation engine.
- AudioCoordinator + feedback changes: sole audio-session ownership, speech completion, interruption and priority handling.
  Preserve detector/camera frame processing and the working model/tracker pipeline.
- Configuration: native microphone/speech permission strings through Expo config/plugin; native rebuild required. Follow
  the repository's matching Expo documentation rule at implementation time, rather than patching generated native files.
- Tests: add planner, bookmarks, command grammar/dialogue and audio arbitration suites; extend layout/map/journey regressions.
  Existing Kotlin-mirrored crossing algorithms are not part of this feature change.

### 11.8 Delivery order and acceptance gates

1. **Full map and destination sheet.** Touch-only, existing service calls. Verify full map gestures, accessible collapse,
   keyboard/large-text behaviour, attribution, active-route actions and 30 repeated view transitions without camera remount,
   box-coordinate change or route reset. Install this increment before building further features.
2. **Saved places and lookup.** Implement stars, exactly three shortcuts, All saved, aliases, persistence and details refresh.
   Test 0/1/2/3/4+ saves, duplicate names/IDs, delete/undo, restart, storage failure, offline details and moved IDs. Verify the
   new Google endpoint against a public test place. No successful-save announcement before a durable write.
3. **Recognition/audio spike.** First test microphone → transcript → stop on the actual iPhone with the existing camera,
   speech, tones, haptics and Bluetooth/VoiceOver conditions. Do not build a large command workflow atop unverified audio.
   Release gate: alerts still work and the original playback route returns after errors/cancel/interruptions.
4. **Complete voice destination flow.** Add Search, result browsing, Select, Save/alias, Confirm place, Start journey,
   Cancel and Stop listening using the shared actions. Complete this sequence after one activation without additional
   touch, apart from initial system permissions, in the supported tested configuration.
5. **Voice journey/map actions and hardening.** Add the remaining map and existing journey commands, active-route
   replacement, interruption recovery and accessible saved-place management. End journey requires its own confirmation;
   crossing completion remains an explicit report. Finish physical tests before treating the whole feature as working.

Each increment runs appropriate unit/component tests, TypeScript and Expo lint; native changes get signed Release builds.
Do not report future gates passed because the existing 150-test baseline is green.

### 11.9 Adversarial recheck and physical test checklist

| Scenario | Required result |
|---|---|
| Star pressed beside a result | Saves exactly that ID; no route request, selection or list renumbering. |
| Save twice, rapidly or via duplicated speech final | One bookmark; never unsaves it. |
| Search A returns after B; details arrive after Cancel | Obsolete data and speech discarded; active route preserved. |
| Result list changes while user says Choose two | Reject obsolete turn/re-read current results; never act on the new second row. |
| Confirm repeated across place and route screens | One place confirmation; no accidental Start journey. |
| Save/Confirm heard from app or VoiceOver speaker | No action; verify physically, not only with transcript mocks. |
| No saved places / storage still loading | Empty suggestions only for a verified empty store; loading/failure is not emptiness. |
| Duplicate Home aliases or same-name branches | Read distinguishing address/number; require an explicit choice. |
| Poor GPS but explicit town/suburb search | Search and save remain possible; route start still waits for a usable origin. |
| Saved place moved/closed or Google denies details | Explain/review; no substitute route and no automatic bookmark deletion. |
| Keyboard, maximum text, VoiceOver, Reduce Motion | All actions reachable, focus restored, no obstructed attribution; no gesture-only requirement. |
| Map panned/rotated during walking | Camera aims/detection and journey instruction unchanged; Recenter is deliberate. |
| Voice cancelled, silence, call, Siri, lock/background | Microphone ends, pending turn invalidated, draft retained; existing journey background policy preserved. |
| Vehicle warning during recognition or result narration | Warning pre-empts dialogue; no stale command after it and no detector pause. |
| Cancel destination replacement during active route | Original route/progress retained and available to Resume. |
| Unfinished crossing plus generic Confirm/Next | Does not report crossing completion or advance a step. Confirm may end guidance only for a separately requested, explicit pending End journey action. |
| Bookmark removed while used by a journey | Journey unaffected; bookmark Undo still works. |
| Offline recognition unsupported / permissions denied | Clear retry/settings/text alternative; no silent remote audio or endless permission loop. |

On the iPhone, test speaker, wired/Bluetooth where available, VoiceOver on/off, silent switch and ordinary volume buttons.
Use spoken destination names, similar numbers, negative commands, false starts and background conversation, not only typed
transcripts. Include benign place names containing command words. Record recognition success, accidental actions and
recovery; all scripted unintended-start/end/save tests must produce zero actions. This does not establish zero field risk.

Compare detector FPS, warning onset latency, audio volume/routing, battery and heat against the current build under matched
conditions with map, GPS and voice active. Set performance regression thresholds from the measured baseline before release;
report median/p95 and missed alerts, not just averages. The coordinator must never wait for speech recognition/network
completion before delivering a vehicle warning. Test outside from a stationary footpath position before any supervised
walking evaluation. Simulator checks cannot validate microphone quality, camera alignment or street-noise reliability.

### 11.10 Remaining decisions and uncertainty

The only requested user preference at this planning stage is initial voice activation (microphone tap versus foreground
wake phrase). The plan currently recommends tap once plus multi-turn dialogue. Exact speech locale, timeout tuning,
VoiceOver/speaker coexistence, Google details access and any durable provider-data cache need implementation-time evidence.
No plan can guarantee street recognition accuracy before the physical noise/interruptions tests. Full-map interaction and
bookmarks are straightforward; reliable voice/audio coordination is the highest-risk part and gets its own early gate.


## 12. Full-map and saved-place implementation, 4 October 2026

### Delivered touch flow

- The camera remains full size. The bottom arrow opens the interactive Google map directly; inward arrows return to Camera.
  One camera and map stay mounted. Pan/zoom/rotation, Recenter, route overview and North up preserve route progress.
- Destination entry, results, saved places, place confirmation and route review now live in the map’s bottom sheet.
  The keyboard raises the sheet. Its handle supports drag up/down and accessible Expand/Collapse actions.
  Active journeys use this same sheet for instructions, Repeat, Pause/Resume and crossing actions.
- Each result has an independent 52-point star. Saving does not select the result, fetch a route or start guidance.
  The field presents up to three newest saves; All saved retains older entries. Optional aliases, remove and Undo are supported.
- Bookmarks persist IDs, save times and user-authored labels in a versioned local store. Writes are serialized and acknowledged
  only after storage succeeds. Duplicate IDs are idempotent; duplicate aliases fail explicitly. Unreadable storage is preserved.
  Provider names/addresses/coordinates are session data. Three visible shortcuts are resolved on demand; selecting a bookmark
  fetches fresh Place Details. Moved/closed details block routing instead of choosing a replacement.
- Planning is separate from the live journey. Search permits a missing GPS bias; routing/start still require a usable origin.
  Select → Confirm place → review → Start journey are distinct. Replacing a destination pauses and preserves the old journey
  until the new start succeeds. Cancelled/late requests cannot replace a newer draft or restart navigation.

### Verified evidence

- Unit/component suite: 184 tests across 21 suites, including saved-store failure/restart/Undo, stale planner requests,
  replacement preservation, independent stars, exactly three shortcuts, Place Details requests, microphone cancellation,
  duplicate final transcripts and actual TTS completion/urgent interruption. TypeScript and Expo lint pass.
- Live public-place probes: Text Search and Place Details returned HTTP 200 for Sydney Town Hall using the configured services.
  Credentials were not printed. Details use GET and a minimal field mask with the app identifier header.
- Native simulator: searched Sydney Town Hall with no GPS fix; starred it while remaining on results; selected the saved
  place; assigned the test alias; relaunched and verified the alias persisted and current details refreshed. A simulated
  public Sydney origin produced a 96-metre route preview. Guidance remained idle until Start journey, then returned to Camera.
- A signed Release build containing saved places and the microphone integration check was installed and launched on the
  connected iPhone 15 Pro. A previous full-map increment was also installed before saved-place work.
- Detector, tracker, model input/box geometry and Kotlin-mirrored crossing algorithms were not changed by this increment.

### Physical voice integration gate — still pending

The approved plan requires actual iPhone microphone/alert testing before completing the command workflow. The installed
**Settings → Practice the cues → Voice check** is an isolated integration check. It records one bounded foreground turn,
accepts only a final transcript after native capture ends, restores the previous audio category, then repeats the phrase.
It executes **no navigation commands** and saves no audio/transcripts. App inactivity, cancellation and urgent cues invalidate
it. Missing native shutdown refuses further turns until app restart instead of risking old events entering a new command.

The matching `expo-speech-recognition` 57.1.0 native module and permission strings are integrated through Expo configuration.
Inspection found that its iOS `installedLocales` list is all supported locales, not proof of offline capability. CrossWise’s
native bridge therefore checks `SFSpeechRecognizer(locale: en-AU)` availability and on-device support before starting.
There is no silent remote-recognition fallback. Initial permission dialogs can interrupt the first check; tap again afterward.

Requested phone check: say Sydney Town Hall; confirm the repeated phrase and normal vehicle practice alerts afterward.
Also still required: cancellation, silent switch, Bluetooth/headphones, VoiceOver interaction, interruptions/lock and outdoor
noise. Simulator/build/unit success does not establish these physical behaviours. The Mac cannot mirror this phone’s iOS
version; no OS update was attempted.

### Next increment after the audio gate

Implement the deterministic, context-bound command dialogue in sections 11.5–11.6 using the existing planner and bookmark
repository: Search, results/selection, Save/alias, Confirm place, explicit Start journey, Cancel/Stop listening, then guarded
journey and map commands. Add a shared microphone entry on Camera and Map only once the integration is validated. Preserve
final-only dispatch, short prompts, stale-context invalidation, foreground timeout, separate End journey confirmation and
explicit far-footpath reporting. Multi-turn VoiceOver behaviour needs its own physical evidence.

Full voice commands, wake phrases, background listening, automatic crossing inference and outdoor reliability are **not**
claimed complete by this delivery. The complete voice flow remains outstanding; this record is an incremental delivery.

Final native UI check: upward/downward handle drags and its labelled Expand action passed after consolidating the handle into one responder target. Map panning was verified separately. Final simulator Release build and launch succeeded.

Final signed iPhone Release build succeeded and was installed/launched (bundle installation 7580DD85-B4C5-4075-BB7C-17DBA07EC647). Permission strings were verified in the built Info.plist. Physical microphone/audio confirmation is still pending.


## 13. Revised plan: automatic startup, location recovery and crossing preparation — 5 October 2026

**Planning only.** This supersedes the tap-to-start voice preference in section 11 and the older crossing roadmap’s
optimistic distance/step/ARKit claims. The user now wants normal daily operation without touching app controls after opening.
The microphone/alert integration check in section 12 remains unverified. No app code/build changed for this planning request.

### 13.1 Confirmed cause of the location problem

`Journey.pause()` currently removes the location subscription, clears the current position and changes location status to
waiting. Backgrounding calls this same method. `CrossWiseController.onForeground()` restarts motion sensors and reloads
settings/models but does not reacquire location. Location requests otherwise happen on route planning/start or Recenter.
`usableFix` currently rejects fixes older than 15 seconds or with reported accuracy worse than 25 metres. The map therefore
cannot keep displaying its old point as current. This code explains disappearing/uncertain location around pause/reopen;
without a recording, it does not establish which exact spoken/UI message the user encountered.

Fix the lifecycle, not the accuracy threshold. A paused journey is not a failed GPS receiver.

- Introduce one shared LocationCoordinator, independent of Journey, with permission/acquiring/cached/live/poor/unavailable
  states, timestamps and reported uncertainty. Map, planner, guidance and crossing context consume the same source.
- On foreground launch, check existing permission and automatically acquire location. First use explains and requests the
  iOS permission once; denial gets one useful recovery prompt and destination search still works. Use a recent cached fix
  only for approximate map display/search bias, visibly marked; wait for a live usable origin before movement instructions.
- Keep foreground location during explicit Pause, at a lower duty cycle if appropriate. Pause guidance and progress, not
  geographic awareness. Do not clear a known point simply because the traveler paused.
- Reopening automatically reacquires GPS and fresh camera frames. Preserve the destination and route context across a
  temporary background interruption. Repeated foreground events must not start duplicate watches or repeat the welcome.
- Separate explicit user Pause from OS suspension: never automatically override an explicit pause. After OS suspension,
  resume ordinary guidance only once location/progress are revalidated. Displacement or an unfinished crossing requires a
  short spoken context check. A process restart must not pretend it still has a validated journey in memory.
- Prompts distinguish “Journey paused”, “Finding your location”, “Location is approximate”, “Location permission is off”
  and a sustained loss of usable location. Debounce quality changes; no repeated uncertain announcement every few seconds.
- Background/locked-screen routing is a separate later capability with its own iOS configuration and testing. Ordinary
  iPhone camera capture cannot be assumed available in the background. Never claim ongoing vehicle observation while locked.

### 13.2 Hands-free startup and conversation

After one-time accessible onboarding/OS permissions, opening the foreground app starts the interaction automatically.
Use the existing product name CrossWise unless the user explicitly requests a rename.

1. New session: “Welcome to CrossWise. Where would you like to go?” Acquire location in parallel; do not wait silently for GPS.
2. Listen after real speech completion and a brief haptic cue. Accept a spoken name/address or saved alias.
3. Read one matching place and distinguishing address: “Town Hall, George Street. Is that right?” Next/Previous explore
   alternatives; Save or Save as Home stores the current identified place. No need to say a rigid Search prefix here.
4. An affirmative answer confirms only that pending place. Prepare the route. “About ten minutes. Start this journey?”
   An affirmative answer now starts only that reviewed journey. Bind each answer to a unique pending action and revision.
5. Start ordinary guidance and camera readiness automatically. Do not require separate assistance or map buttons.
6. At later decision points, open the next response window automatically. Repeat, Cancel, Help, Change destination and
   Stop listening remain available. A user’s deliberate voice-off preference is respected until re-enabled.

Use one DialogueController for startup, search, planning, walking, crossing and recovery. The map and camera are optional
visual views of the same state, never prerequisites for a voice action. Keep accessible touch controls as an alternative.
First-run iOS permission dialogs cannot be bypassed by our conversation; support VoiceOver/system accessibility through them.

Outside active response windows, investigate a local foreground wake phrase (“CrossWise”) so Repeat/Pause remain available
hands-free during a long walk. This requires an actual keyword implementation and device false-trigger/battery testing;
ordinary recognition restarted indefinitely is not a wake-word implementation. Short bounded answer windows, one retry
for silence, and quiet standby prevent endless talking/listening. Never silently fall back to remote audio recognition.

TTS, VoiceOver, recognition, tones and interruptions share audio arbitration. Do not capture app prompts as commands.
Vehicle/signal alerts preempt dialogue and invalidate unfinished answers. A replayed or duplicated “yes” cannot confirm
both a place and a route, or become a crossing-completion report. Do not lower these safeguards to meet a no-buttons demo.

### 13.3 Walking progress without repeated button presses

The current manual “I completed this instruction” is unsuitable as the everyday default. Add automatic ordinary-step
progress using several consistent fixes, route projection, expected turn/heading and continuity. GPS proximity alone must
not skip a crossing, a parallel street, a refuge or arrival. Turn the manual control into a voice/touch recovery option.
If position is ambiguous, ask one short context question instead of advancing. Announce likely arrival; accept a spoken
arrival confirmation until entrance/arrival detection has separate evidence. Route replanning must not silently add a new
road crossing while the user is approaching or traversing one.

### 13.4 Crossing data and which side of the road

Keep Google for destination search, map rendering and the macro route. Evaluate OSM/OpenSidewalks-style pedestrian topology
for crossing candidates: separately mapped sidewalks, crossing ways/nodes, kerbs, signal controls, tactile paving and refuge
islands where present. A road intersection or a nearby signal pole is not automatically a route crossing. Match topology,
route continuity and pedestrian access, distinguishing overpasses/underpasses with levels/bridge/tunnel information.

Google map rendering can show sidewalks/crosswalks, but that is not proof that the Routes API exposes a complete navigable
sidewalk graph or live pedestrian signal phase. Audit returned route fields and a small representative local route set.
OSM coverage is uneven: missing data means unknown, not no crossing. Street lamps are illumination, not pedestrian signals.
Show OSM attribution when its data is used and assess service reliability/licensing before deployment. Avoid a runtime
scraping dependency on an uncontrolled public Overpass endpoint; prototype with a bounded local test extract or suitable service.

Do not add mandatory Left/Right buttons at startup. The useful spoken question is:
**“As you walk in this direction, is the road on your left or right?”** Accept “not sure”. Ask only if side ambiguity changes
which crossing is needed. Prefer a mapped landmark/address-side confirmation when it is easier to identify.

Store the answer as a fallible observation tied to a particular street segment and travel direction, with time/confidence.
OSM left/right tags refer to the mapped way’s direction, so explicitly transform between map direction and traveler direction.
Do not treat the phone’s camera bearing as the traveler’s walking heading during a scan. Reassess after turns, crossing,
reversal, relocation or a conflicting observation. Street side + heading + a connected sidewalk/crossing graph can help choose
where to cross. Street side alone cannot determine crossing location, timing, signal state or whether traffic will yield.
When the needed topology is missing, retain uncertainty and offer a spoken crossing-help request; do not fabricate connectivity.

### 13.5 Automatic crossing preparation, with truthful observations

Create a separate CrossingContext/state machine:
walking → possible crossing ahead → approaching → waiting at edge → scanning/observing → user crossing → refuge or far side
→ ordinary guidance. Unknown/recovery is explicit. Automatic preparation does not mean automatically deciding to enter the road.

| Stage | Automatic behaviour | Short prompt / condition |
|---|---|---|
| Route preparation | Identify likely crossings on the route and their provenance/confidence. | Pre-brief only mapped/verified attributes; do not invent lane count or an audio button. |
| Approach | With stable route progress, approaching direction and appropriate location quality, prewarm the camera/models and give one cue. | “Crossing ahead. Raise your phone when you stop.” Distance only when supportable. |
| At edge | Seek corroborating visual/map evidence or ask for a spoken edge report; proximity is insufficient. | “Are you at the kerb?” Never command an abrupt stop based on GPS if the user might already be crossing. |
| Scan | While stationary at the edge, guide controlled phone rotation and short held views; check aim and blur using motion/image evidence. | “Point the camera right. Hold.” Then the other direction, and ahead as needed. This is a camera task, not an instruction to rotate the body. |
| Observe | Run vehicle detection/tracking and relevant pedestrian-signal observations, while routine macro speech stays quiet. | “Vehicle on your right.” Say “approaching” or “from the right” only when motion and the reference frame support it. |
| Decide | Report current evidence, its loss, and relevant pedestrian signal observations. | “Pedestrian walk signal detected” only after relevant-signal validation; never “safe”, “clear” or “walk now” from no detections. |
| Traverse | A spoken “I’m crossing” establishes entry initially. Later automatic entry needs independent validation. | Brief hazard/alignment information only; do not repeat scan instructions while moving through traffic. |
| Refuge | Treat a mapped/confirmed island as an intermediate stage, not the destination footpath. | Ask/accept an island report; prepare the next leg separately. |
| Far side | Initially ask “Are you on the far footpath?” Accept an explicit spoken report. | Resume the retained route automatically afterward. A generic Yes outside this pending question cannot complete a crossing. |

A full scan is not simultaneous coverage: the right-hand scene becomes stale while the camera faces left. Expire observations
by capture time, turn angle and confidence, and keep an unseen direction unknown. Never combine old clear-looking snapshots
into a clearance decision. Include parked-car occlusion, turning vehicles, bicycles, buses/trucks and motorcycles in testing.
Parked vehicles are still potential occluders; suppressing their repeated moving-traffic alerts does not mean deleting them
from scene context. Change lenses/orientation only after recalibrating field of view, input rotation and box geometry.

### 13.6 Distance, steps and missing capabilities

The working vehicle detector is not a complete road-crossing system. Needed capabilities include confidence in the relevant
crossing/kerb, signal association and phase, motion despite camera rotation, route-relative vehicle direction, and localized
crossing progress. Build them as independently tested components; adding another YOLO model does not solve topology or depth.

Do not ship “walk now”, precise vehicle distance/time-to-arrival, “kerb in three steps”, or a guaranteed crossing step count
from current boxes/GPS. GPS and a monocular detector do not establish far-kerb distance. Investigate surveyed map geometry,
ARKit visual-inertial tracking, short-range depth on the iPhone Pro and a validated kerb/crosswalk model. LiDAR near the phone
is not proof of a far kerb across the road. ARKit drift/relocalization and scene failures need measurement; no fixed accuracy
claim is accepted from the older plan. Any later step estimate needs a user-specific stride estimate, interval/uncertainty,
and no use as a stop/step-up command. Prefer approximate crossing length once defensible; omit it when unknown.

### 13.7 Implementation order and acceptance gates

1. **Location lifecycle and precise messages.** Shared coordinator, automatic launch/foreground acquisition, explicit-pause
   separation and reacquisition. Test cold/warm starts, Pause/Resume, lock/unlock, permission denial/approximate-only access,
   indoor-to-outdoor transitions, stale GPS, missed updates and rapid foreground toggles. Exactly one watcher; no stale marker
   masquerading as current, no pause-triggered false location-loss prompt, no resume after an explicit user pause.
2. **Automatic voice destination journey.** Finish physical microphone/alert gate, then startup dialogue, contextual Yes/No,
   saved aliases, selection, confirmation and starting. Test a complete post-onboarding session without touch, plus VoiceOver,
   accents/street noise, similar place names, negation, silence, interruptions and app-TTS feedback. Prototype wake activation
   as a separate evaluated component. A visible error must also have a usable spoken recovery path.
3. **Automatic ordinary route progress.** Controlled-route trace replays first; prevent skipped steps, wrong parallel paths,
   crossing advancement and premature arrival. Resume from actual position rather than repeating a stale instruction.
4. **Crossing context and optional street-side question.** Audit representative local routes including a side street,
   signalised crossing, zebra, refuge, parallel paths and missing map data. Add stable IDs, confidence, approach hysteresis,
   reroute/reset semantics and one preparation prompt per encounter. Test false triggers beside, beyond and below a crossing.
5. **Guided camera observations.** Start with stationary-footpath recordings and measured left/right/motorcycle/occlusion
   scenarios. Validate motion under scanning, prompt timing, alert priority and stale-view handling before walking trials.
   Do not make replacing the currently working detector a prerequisite without measured evidence.
6. **Measured crossing progress and optional background macro routing.** Separate research/acceptance work. Evaluate with an
   orientation-and-mobility specialist and sighted supervision; no unsupervised or blindfolded road-crossing validation.

Each increment gets tests/typecheck/lint, an installed native build where appropriate and a small concrete physical test.
Record crossing-event precision/recall, preparation latency, wrong-side reports, missed vehicles, false motion from scans,
voice unintended actions, location recovery latency and power/thermal impact. Choose thresholds before trials from measured
baseline data; automated test counts alone do not establish street safety. No road-entry authorization is part of this release.

### 13.8 Sources checked for this revision

- Google walking-route limitations: https://developers.google.com/maps/documentation/routes/route-opt
- Google route response fields: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
- Rendered road details: https://developers.google.com/maps/comms/msa-road-level-details
- OSM crossings, sidewalks and mapped-way direction: https://wiki.openstreetmap.org/wiki/Tag:highway%3Dcrossing and https://wiki.openstreetmap.org/wiki/Key:sidewalk
- Street lamps are lighting: https://wiki.openstreetmap.org/wiki/Tag:highway%3Dstreet_lamp
- iOS background camera interruption: https://developer.apple.com/documentation/avfoundation/avcapturesession/interruptionreason/videodevicenotavailableinbackground
- Accessible travel and O&M support: https://www.visionaustralia.org/information/living-independently/getting-around-safely

## 14. Follow-up: road/path perception and street-side localization — 5 October 2026

**Saved discussion and proposed work, not implemented.** Section 13 remains the current overall plan. The user wants to
continue asking questions before the next implementation. No app build or model was changed by this follow-up.

### 14.1 What YOLO can and cannot supply

The current bundled COCO vehicle detector does not have road, sidewalk, kerb or lane-marking classes. Our custom label
mapping includes a crosswalk class, but a crosswalk box does not delineate a walkable surface or establish a legal/safe
crossing. A YOLO segmentation model can be trained for suitable classes; a stock segmentation checkpoint does not acquire
new classes just because its output is masks rather than boxes. The training labels and pedestrian-view coverage matter.

Recommended division of work:
- Keep the working vehicle detector/tracker for cars, motorcycles, bicycles, buses and trucks.
- Evaluate a separate compact surface-segmentation model for road, sidewalk, kerb/kerb ramp, crosswalk and island, with
  relevant obstruction evidence. Semantic segmentation is a natural fit for continuous surfaces; custom YOLO segmentation
  is also a candidate. Compare measured device performance rather than select an architecture by name alone.
- Preserve separately validated pedestrian-signal detection/phase and associate the signal with the intended crossing.
- Extract boundaries, crossing orientation and local geometry from masks plus camera calibration/motion/depth as available.
  Lane paint alone does not prove lane count, direction, walkability, or crossing connectivity. Unmarked lanes and crossings
  remain possible. A walking path is a connected route with constraints, not simply every pixel labelled sidewalk.

The repository's earlier six-photo evaluation reports serious road-as-footpath errors for the AN-S3 segmenter. This is
limited prior evidence, not a new benchmark; do not use that model to place kerbs. Code inspection also found that
`segCategoryOf` maps generic `Markings` to `CROSSWALK`. Remove that semantic shortcut before segmentation can influence
crossing decisions. Generic paint must remain unknown marking unless a specific validated crosswalk class supports it.

Evaluate road-scene segmentation weights/datasets such as Mapillary Vistas, whose published taxonomy includes road,
sidewalk, kerb and marking classes. Check current dataset/weight licenses and exact checkpoint labels. Fine-tune/evaluate
on held-out Australian handheld pedestrian views: chest-height portrait, sideways scans, unmarked side streets, kerb ramps,
parked-car occlusion, shadows, rain and dusk. Driving-view lane models need separate evidence before pedestrian use.
Measure road incorrectly classified as footpath, boundary errors, unknown/abstention behaviour, temporal stability and
phone alert latency/thermal load; a high aggregate segmentation score is insufficient.

### 14.2 Street side when GPS spans both footpaths

Do not snap an uncertain GPS point to whichever sidewalk happens to be nearest. Keep competing hypotheses:
{street segment, sidewalk/side, travel direction, confidence, supporting observations, age}. Location uncertainty may
support both sides. New GPS samples are correlated and can stay biased; averaging does not guarantee a correct side.

Proposed implementation:
1. Retrieve mapped sidewalk/crossing connectivity for the route corridor with provenance. Preserve missing/inferred geometry
   as such; do not invent two known walkable sidewalks from every road centreline.
2. Combine coarse GPS with reliable travel direction, camera-to-world orientation and short-term visual/inertial motion.
   Phone pointing direction is not automatically walking direction. Ordinary local AR tracking preserves relative motion;
   it cannot independently establish which globally mapped sidewalk the user started on.
3. Use scene segmentation to estimate where road/kerb/footpath lie relative to the calibrated camera. With a reliable
   heading and street identity this can support one side hypothesis. With road in front of the user, symmetric scenery,
   poor orientation or occlusion, it may not resolve the ambiguity.
4. Strengthen the initial global association using an identifiable mapped entrance/landmark or, where available, visual
   positioning. Treat OCR/landmark matches as fallible evidence, not an unquestioned address fix.
5. If unresolved and relevant to the route, ask a brief spoken question: “As you walk in this direction, is the road on
   your left or right?” Accept “not sure”; prefer a recognizable landmark question where appropriate. Do not direct a user
   to move toward or into a road just to obtain localization evidence.
6. Maintain the established hypothesis through time, downgrade on tracking loss/turns/reversal, and update on a confirmed
   crossing/far-footpath event. GPS jumping across a centreline must not itself declare a crossing completed.
7. Trigger crossing preparation only for a crossing connected to the current route/side with sufficient evidence. If two
   plausible sides require different instructions, ask or abstain; do not choose a potentially wrong crossing instruction.

Illustrative geometry: on a straight north–south road, a traveler known to be walking north with the road on their right
is on the west side. The conclusion depends on both direction and street association; left/right alone is insufficient.

### 14.3 Optional visual positioning

Apple ARKit geotracking and Google's ARCore Geospatial iOS API are concrete candidates for globally locating the camera
against geographic imagery. Check actual availability at test locations and pose uncertainty at runtime. VPS coverage is
not a guarantee of sidewalk-level accuracy on a particular frame. Lighting, view, imagery changes, network and capture
conditions require trials; do not assume every neighbourhood is covered. Ordinary Google Maps routing does not enable VPS.

Prototype one provider in isolation first. Inspect SDK/API access, privacy/data transmission, camera ownership and
integration with the existing VisionCamera inference stream. Do not run competing camera capture sessions or degrade
vehicle warnings. LiDAR supplies local geometry; it is not a GPS replacement or a global street-side identifier.

### 14.4 Recommended deliverable and acceptance

Start with a small surveyed test-route set and a street-side estimator that can explicitly say unknown, using maps,
existing location/motion and a spoken side/landmark confirmation. Add segmentation to improve local road/footpath evidence;
add VPS only if the separate on-phone evaluation demonstrates a useful accuracy improvement. Avoid making universal
street-side localization a prerequisite for the first usable voice journey.

Test narrow/wide roads, both travel directions, turns, stationary startup, camera rotation, GPS biased onto the opposite
footpath, missing sidewalk data, islands and tracking reset. Report confident wrong-side decisions separately from unknown
results and recovery time. Never infer “safe to cross now” from street-side localization: it informs where a crossing is
needed, while live traffic/signal observations remain a separate capability with the limits in section 13.

Sources checked:
- YOLO segmentation and custom training: https://docs.ultralytics.com/tasks/segment/
- COCO object labels: https://docs.ultralytics.com/datasets/detect/coco/
- Original Mapillary Vistas paper: https://openaccess.thecvf.com/content_ICCV_2017/papers/Neuhold_The_Mapillary_Vistas_ICCV_2017_paper.pdf
- Apple AR geotracking: https://developer.apple.com/documentation/arkit/argeotrackingconfiguration
- Google iOS VPS availability: https://developers.google.com/ar/develop/ios/geospatial/check-vps-availability

### 14.5 GitHub shortlist — checked 5 October 2026

Start by evaluating published pretrained checkpoints; do not train from scratch as the default. Repository documentation
was reviewed, but weights have not been downloaded/run or converted for this phone in this research turn.

| Project | Available component | Proposed use / limitation |
|---|---|---|
| [PIDNet](https://github.com/XuJiacong/PIDNet) | Official real-time segmentation code, published Cityscapes/CamVid trained weights; MIT repository license. | PIDNet-S is a first compact road/sidewalk baseline. Cityscapes output does not provide dedicated kerb/crosswalk classes. README points to a replacement weights folder because older links broke. Published GPU FPS is not iPhone evidence. |
| [OneFormer](https://github.com/SHI-Labs/OneFormer) | Official code and Mapillary Vistas checkpoints. | Offline reference for richer road/sidewalk/kerb/marking classes. Published Mapillary models have roughly 219–223M parameters, so treat them as reference/possible annotation assistance before considering device use. Validate their outputs; they are not ground truth. |
| [YOLOP](https://github.com/hustvl/YOLOP) | Pretrained traffic detection, drivable-area segmentation and lane detection. | Useful driving-perception reference; its drivable area is vehicle space, not a pedestrian path. Not the preferred footpath model. |
| [ARCore iOS SDK](https://github.com/google-ar/arcore-ios-sdk) | Official GeospatialExample, documented in the [iOS quickstart](https://developers.google.com/ar/develop/ios/geospatial/quickstart). | Prototype visual geographic localization with no custom ML training. Requires API setup, actual VPS/pose-quality checks and native camera integration. Does not itself select a sidewalk or solve route crossing decisions. |

Secondary candidate: [SegFormer](https://github.com/NVlabs/SegFormer) provides pretrained semantic segmentation models and
small B0 variants; the original repository states non-commercial research/evaluation use. Check the exact checkpoint
labels and license before selecting it. [RampNet](https://github.com/ProjectSidewalk/RampNet) is a relevant kerb-ramp project
based on street-view panoramas; handheld iPhone suitability is unverified. Neither is selected for integration now.

Proposed experiment: compare a compact road/sidewalk checkpoint against a Mapillary-trained reference on the same annotated
pedestrian-view test set. Keep a held-out set split by location/sequence, not adjacent video frames. Measure road-as-footpath
errors, missed kerbs, temporal stability and unknown output. Convert only the promising compact candidate and measure it
alongside YOLO on the iPhone. Fine-tune if the target viewpoint fails; new missing classes require appropriate labelled
training data/model heads or a checkpoint that already supports them. Check code, checkpoint and dataset terms separately.
For street-side localization, evaluate Google's sample separately and fuse its quality-qualified pose with the pedestrian
map and context estimator; no reviewed project is established as a drop-in complete safe-crossing solution.
