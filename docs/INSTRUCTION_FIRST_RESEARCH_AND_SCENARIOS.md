# Instruction-first CrossWise: repository study and scenario assessment

6 October 2026. User requirement: the app evaluates the surroundings and gives instructions; the traveler must not answer environmental questions. This supplements and revises the [implementation plan](HANDS_FREE_NAVIGATION_IMPLEMENTATION_PLAN.md).

**Subsequent implementation update:** foreground location, automatic voice entry/destination commands and precautions in Settings are now implemented for iPhone testing. See [the implementation record](HANDS_FREE_NAVIGATION_IMPLEMENTATION_PLAN.md#11-6-october-implementation-location-and-voice-entry). The earlier model/scenario evidence below remains a historical record; it does not establish automatic roadside or crossing capability.

## 1. Product decision

Remove the proposed roadside/landmark/completion question loop from the design. There should be no routine “Which side?”, “Are you across?”, or “Can you see the signal?” questions. The user supplies their goal and intentional commands; the app owns observation, state estimation and recovery. Destination input is still necessary unless the user has already chosen a destination.

This increases the capability required for release: automatic crossing completion and side localization cannot be replaced by a spoken confirmation fallback. If the app cannot establish a needed state, it must announce that the dependent guidance is unavailable, attempt bounded recovery, and retain the unresolved state. An autonomous route that needs outside help is a failed autonomous task, even if the app correctly abstains. We must measure both wrong instructions and incomplete journeys.

No reviewed repository establishes reliable phone-only autonomous street crossing. Reuse can reduce implementation effort, but it cannot supply missing observations of occluded traffic, correct a missing map, or validate the deployment conditions for us.

## 2. Additional repositories actually cloned and read

Exact commits are recorded in `../../research/2026-10-05-crosswise/sources.json`. These repositories are separate from app dependencies. Upstream install scripts were not executed.

| Repository | Source inspected | Reuse decision and limits |
|---|---|---|
| [Soundscape Community](https://github.com/soundscape-community/soundscape) | `IntersectionGenerator.swift`, `CalloutGroup.swift`, `CalloutStateMachine.swift`, `LocationUpdateFilter.swift`, GPX simulator inventory | Primary design reference: event-driven intersection arrival/departure, repeat suppression, update filtering, interrupt-and-clear announcements, rechecking callout validity at playback, and route replay. MIT license permits attributed reuse. Its intersection arrival threshold is 35 m and departure threshold 20 m; these announce nearby surroundings, not exact kerbs. Do not copy those values as crossing boundaries. |
| [NavCogIOSv3](https://github.com/hulop/NavCogIOSv3) | `NavNavigator.m`, `NavCommander.m`, `NavPreviewer.m` interface/inventory | Reuse the separation of route state from spoken instructions, approach/action timing, speed/segment-length-aware thresholds and preview/replay structure. MIT source. Its localizer requires a supplied localization model and mapped environment; it is not a drop-in outdoor GPS fix. Port bounded algorithms/tests as needed rather than importing the whole Objective-C app/server stack. |
| [Clew](https://github.com/occamLab/Clew) | `AnnouncementManager.swift`, `Navigation.swift`, tracking-error handling in `ViewController.swift` | Study VoiceOver-aware announcements, explicit tracking loss and local waypoint geometry. It is designed for recorded path retracing, particularly short indoor routes. No repository-wide reuse license was found in this checkout; inspected files include all-rights-reserved notices. Do not copy implementation/assets without resolving permission. Use the published architectural ideas only. |

Soundscape's relevance check is especially useful: an instruction can be correct when generated and wrong when speech finally plays. Our prompt design must include a route revision, observation time, reference frame and validity test; a queued “left” must expire after a turn or reroute. Do not let urgent speech build an unbounded queue either.

Clew illustrates a separate failure: phone direction and travel direction are not automatically the same. Its navigation code exposes a heading offset; we need an independently evaluated body/travel alignment, especially while the user scans left/right. Merely substituting phone yaw for walking direction would be wrong.

The existing five model/map projects remain relevant: PIDNet-S for a compact road/sidewalk trial; ARCore for optional native semantic/visual geographic observations; OneFormer for a richer offline reference; ppr for pedestrian graph concepts; YOLOP for understanding why driving-lane detection does not solve walkability.

### What to reuse rather than rebuild

1. Keep existing Expo location, speech and recognition integrations; no second custom wrapper around the same OS service without a concrete gap.
2. Reuse the app's existing planner, saved-place services, tracker, model decoder and geometry tests for both touch and voice.
3. Adapt Soundscape's callout validity, lifecycle and replay patterns into the existing feedback/navigation services. If source is ported/copied, keep its MIT notice and record source commit/file; no copied Soundscape code has been shipped by this increment.
4. Adapt NavCog's approach/action state separation after verifying our map accuracy. Its metre thresholds are not transferable evidence.
5. Prefer an official SDK/module for VPS and semantics, with one camera owner, over inventing visual localization or segmentation training.
6. Keep a reuse register stating exact source, license, copied/adapted material, integration boundary and regression tests. No whole application transplant and no copied assets with unclear terms.

## 3. First-time-user acceptance model

A tester is given only the goal, such as “Navigate to the library.” They receive no explanation of Developer mode, confidence, crossing states or buttons. Evaluate the audio/action trace, not a debug overlay that the intended user cannot see.

For every state record: what the app knows; what it says; what action a novice would take; what observation indicates completion; what happens after silence, lost tracking or failed recovery. A prompt is insufficient if its next action depends on hidden UI knowledge or asks the user to perform visual inference.

Proposed ordinary flow:

- Launch: “Welcome to CrossWise. Say your destination after the tone.” Existing route interrupted by the OS: reacquire and resume only after state validation. Explicit user pause: “Navigation paused. Say resume to continue.”
- Unambiguous navigation command: announce resolved destination and begin. A search alone remains a search. For ambiguity: “Two matches. Say the place name and suburb.” Do not silently choose one.
- Before a turn: give one named direction at the correct approach/action event. Avoid routine “Step 2” numbering and repeated remaining-distance narration unless requested.
- At a qualified crossing approach: “Crossing ahead.” Ask for no classification. When the user is established off the carriageway and image quality requires it: “Hold the phone upright,” followed separately by “Scan slowly left, then right.”
- Traffic observations: retain the difference between “car on your left” and “approaching from the left.” The latter requires motion evidence corrected for phone movement. Observations never imply a clear road.
- Far-side recovery: resume only after temporally consistent evidence of the connected far sidewalk. A refuge island is an intermediate stage. No question fallback and no completion from elapsed time, GPS proximity or stillness alone.
- Unresolved state: announce the missing capability and the supported recovery action. For a blocked view, adjust the phone only where stationary scanning is appropriate. After a bounded unsuccessful attempt, explicitly report guidance unavailable instead of repeating scan forever. Never issue “stop here,” “stay on the footpath,” or “turn back” when current position is unknown and may be in the road.

A statement of unavailable guidance is necessary to avoid a false instruction, but does not satisfy end-to-end independent navigation. Record the route task as incomplete and use that failure to decide the next engineering work.

OS permission screens remain platform-controlled. No implementation can silently grant microphone/camera/location consent. Accessible first-use onboarding needs its own acceptance test.

## 4. Real-image scenario review and executed inference

Input: `mobile/read.JPG` (5712×4284 stored image; EXIF orientation applied by the diagnostic). Reviewed visually on 6 October. This is a real residential street photo already supplied by the user. It shows a foreground grass verge, a driveway/path connection, a near white vehicle, two farther vehicles and a painted road marking. No marked pedestrian crossing or pedestrian signal is established in the visible scene. Vehicle motion, unseen traffic, precise observer position and route direction cannot be established from this single image.

Executed the existing local diagnostic on both bundled TFLite models with a score threshold of 0.35, using their actual weights, RGB normalization and letterboxing. No cloud vision service was used.

| Model | Output on this image | What this establishes |
|---|---|---|
| `crosswise.tflite` | Three `car` detections, scores approximately 0.944, 0.844, 0.607 | Cars are detected on this input. The near vehicle and two farther vehicles have corresponding boxes in the inspected overlay. |
| `yolo26n.tflite` | Two `car` detections, scores approximately 0.833, 0.692 | Different recall on this example; not a dataset-level accuracy comparison. |

Raw results include exact model hashes, preprocessing dimensions and boxes. See [results](../../research/2026-10-05-crosswise/scenarios/2026-10-06/read-photo/results.json) and [annotated model input](../../research/2026-10-05-crosswise/scenarios/2026-10-06/read-photo/crosswise/detections.png). No road/sidewalk/kerb model was run in this increment.

The two existing phone screenshots were used only for historical UI/context inspection, not as fresh camera or current-build evidence. `IMG_8573.PNG` visibly contains a driveway and an older Assist-off interface; it is not evidence of current detector failure. Only `read.JPG` was used for the new raw-image inference run.

### Scenario outcomes from the novice perspective

| Scenario | Naive failure to avoid | Required behaviour | Evidence level/result |
|---|---|---|---|
| Supplied residential photo | Interpret road paint as a crosswalk and follow aiming guidance into the road | Generic markings must not create a crosswalk target | Real scene inspected; code defect found and corrected; synthetic engine replay passes. No claim that this photo ran through a segmentation model. |
| Near car with obscured area beyond it | Treat absent additional detections as a crossing gap | No clearance statement; keep unobserved traffic unknown | Image establishes limited view; live motion/occlusion handling still needs video/device tests. Autonomous crossing not demonstrated. |
| Driveway across the walking line | Treat every paved region as footpath or every surface change as a road crossing | Combine traversable connection, map topology and temporally observed boundaries | Current object detector lacks this capability. Fail for autonomous route guidance in this case. |
| Opposite sidewalks inside GPS uncertainty | Tell the user to cross or turn based on nearest-map snapping | Retain competing hypotheses; recover automatically or mark dependent guidance unavailable | Analytical/replay requirement, not image-derived global localization. Remains unimplemented. |
| User pans phone to scan traffic | Interpret phone rotation as moving traffic or a new walking direction | Separate camera pose, travel heading and tracked object motion | Must be evaluated on synchronized video/pose; a still photograph cannot validate it. |
| Refuge island | Declare completion after a pause | Track connected crossing stages and far-side evidence | Existing crossing tests preserve crossing through stillness; automatic completion remains unsolved. |
| Audio says “Confirm when complete” | User does not know what to say or operate | Automatic progress with explicit unavailable recovery | Current behaviour fails the desired no-routine-control journey. Do not merely remove the prompt before replacing the transition. |
| Cold opening without prior app knowledge | Camera runs but user receives no destination guidance | Startup instruction, listening tone, shared location acquisition | Existing voice stack is a microphone test; full flow remains to implement and validate. |

These are a cognitive walkthrough and controlled software/model checks. They are not a blind participant study or a claim that I physically navigated a street. The “rely only on app output” perspective is an acceptance lens used in replay/controlled testing; public-road trials need a sighted observer and must not expose a user to unvalidated directions.

## 5. Implemented increment: preserve the meaning of model labels

Changed both iOS/TypeScript and Android/Kotlin segmentation category handling:

- Generic `Markings` is no longer a crosswalk; `Paved`, road and broad People/Animals remain unknown to more specific guidance logic.
- Use actual model metadata labels instead of assuming class index 2 means markings or the legacy AN-S3 order applies to every model.
- Missing segmentation labels become `class_N`/unknown; matching class count is not evidence of matching taxonomy.
- Reject inconsistent metadata instead of silently applying unrelated labels.
- Preserve explicit supported labels such as `crosswalk`, cars and unverified signal presence. No change to the bundled detection model weights or detection decoder.

Eight new mobile tests exercise these contracts and replay repeated centered observations through the actual crossing engine, including an explicit-crosswalk positive control. Four Android tests mirror the category/metadata contracts. This is a prerequisite fix, not implementation of the complete voice/navigation plan.

Validation completed:
- Mobile: **192 tests passed across 22 suites** (including eight new semantic/replay cases).
- TypeScript typecheck and Expo lint passed.
- Android: **53 tests passed across 9 suites**, including four new semantic-contract tests; Kotlin compilation passed.
- Real-image inference completed for both bundled models; exact hashes/output saved with the report.
- Physical iPhone validation and a new device build/install were not performed. These checks do not establish real-world autonomous navigation.

Android tests used the installed Android Studio Java runtime after the default Java 25 runtime failed Gradle initialization. No JDK installation or project build-system change was required.

## 6. Next implementation and release criteria

Continue with shared foreground location acquisition/recovery, then a functioning startup destination command. Implement the bounded audio turn and its next action together so the app never advertises an unavailable voice command. Keep the existing full-screen camera/map controls as accessible alternatives during development.

Before implementing autonomous crossing transitions, collect synchronized walking/scan video, pose, location and a surveyed pilot route; test an independently pretrained surface model and evaluate exact-side localization. No amount of interface copying makes the current object boxes a road geometry system.

The revised success criterion is: a new user completes the supported route using app instructions without environmental questions, unexplained controls, investigator hints or wrong movement instructions. Track completion rate, intervention rate, wrong-instruction rate, unnecessary speech, response delay and blocked-state duration. Any outside assistance counts as intervention. Report low coverage honestly even when the system abstains correctly.

For each failed scenario, classify the cause before adding features: missing model class, camera coverage, localization/map error, temporal tracking, prompt timing or command interaction. Fix the responsible layer, rerun the same scenario, then run held-out routes. Train only if a verified pretrained baseline lacks the needed labels or demonstrably fails the pedestrian viewpoint after preprocessing is correct.
