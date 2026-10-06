# Crossing guidance plan: from "reads a signal" to "gets a traveler across"

**Latest revision — 6 October 2026:** [Instruction-first research and scenario assessment](INSTRUCTION_FIRST_RESEARCH_AND_SCENARIOS.md). The user rejects routine environmental questions: automatic state estimation and explicit recovery replace roadside/landmark/completion question fallbacks in older plans. Three more repositories inspected; real-photo detector inference executed; conservative segmentation-label correction implemented. The full hands-free journey is not yet implemented.

**Current comprehensive plan — 5 October 2026:** [Hands-free navigation and crossing perception](HANDS_FREE_NAVIGATION_IMPLEMENTATION_PLAN.md). Based on five pinned GitHub source checkouts; supersedes conflicting earlier proposals. Includes native Scene Semantics evaluation, roadside uncertainty, capture/model integration gates and one-feature-at-a-time acceptance. Planning only; no app functionality changed by this assessment.

**Latest plan, 5 October 2026:** automatic foreground location acquisition/recovery, hands-free startup dialogue, automatic ordinary route progress and crossing preparation, plus optional contextual road-side confirmation. See [redesign plan section 13](BLINDHELPER_REVIEW_AND_REDESIGN.md#13-revised-plan-automatic-startup-location-recovery-and-crossing-preparation--5-october-2026). This supersedes earlier UI priorities and optimistic crossing-distance/step claims. Planning only; physical voice validation remains pending.

**Latest implementation, 4 October 2026:** redesign Increment 1 supplies credentials from `.env`, removes phone key entry
and volume shortcuts, and migrates legacy preferences. Signed build installed; physical checks await unlocking the iPhone
and Mac. Split-screen work remains next. See [the redesign implementation record](BLINDHELPER_REVIEW_AND_REDESIGN.md#8-implementation-record--configuration-and-volume-cleanup-4-october-2026).

Written 30 Sep 2026, after testing the current models on Australian street photos. Code freeze is 13 Oct, so the plan
is split into what fits in two weeks and what belongs in the thesis as future work.

**Planning update, 4 October 2026:** Section 8 records the agreed User/Developer interface overhaul and the
proposed neighbourhood crossing journey. Its implementation priorities and capability limits supersede the earlier
schedule and illustrative instructions where they conflict. None of the new checklist items is implemented by this update.

**Previous priority, 4 October 2026 (after interface increment 1):** pause other feature development. Establish reliable
vehicle detection on the iPhone, then moving-vehicle observations. Section 9 supersedes the implementation order above
and in section 8. The interface work already installed remains in place.

**Latest priority, 4 October 2026:** the user has deferred physical micro-navigation testing and requested simpler daily
controls and research into automatic macro/micro handoff. Section 10 records the code audit, map-provider research and
next implementation order. The phone validation in section 9 remains pending; this change does not establish road readiness.
The reassessment in section 10.7 narrows the first deliverable and supersedes the original provider preference.
Section 10.8 records the subsequent explicit-completion fix and installation on the reconnected iPhone.

**Newest direction, 4 October 2026:** the user requests a single split screen (Google Maps above, micro guidance below),
computer-side `.env` configuration instead of phone API-key entry, removal of volume-button shortcuts (tilt-prompt scope
awaits clarification), and selective reuse of BlindHelperApp features. See section 11 and the linked code-review notes.
This is a plan-only update and supersedes the separate Assist/Go presentation in section 10.9.
The linked redesign plan now includes a usability reassessment: Developer access inside Settings is recommended instead
of permanent top tabs, with fewer walking controls, explicit recovery states and validation before crossing automation.

## 1. What the tests showed

### 1.1 The detector does see cars, but the app is built to stay quiet about most of them

The trained model (`crosswise_v1_best.tflite`) and the COCO baseline (`yolo26n.tflite`) were run on 22 CC-licensed
Australian street photos from Wikimedia Commons: Sydney CBD, Wollongong, Brisbane, Melbourne, Canberra, Albury, Adelaide,
zebra and signalised crossings, a roundabout, rain and dusk. Threshold 0.35, the app's default.

| | Trained model | COCO baseline |
|---|---|---|
| Vehicles detected, 22 photos | **54** | 58 |
| Dense George St traffic jam (historic black-and-white photo) | 1 | 13 |
| Bus beside Central station, rain | missed | found |
| **Vehicle traffic lights called pedestrian signals** | **3 photos (2 × `ped_red`, 1 × `ped_green`)** | 0 (called "traffic light") |

Three conclusions:

1. **Cars are detected** in ordinary scenes. The weak spots are dense, small or distant vehicles and some buses.
2. **The app only speaks about a car when it is looming**: time-to-contact ≤ 3 s from image growth, box at least 5 % of
   the frame, 4 frames of history, a clean fit (`HazardMonitor`). Standing at a kerb and facing across the road, traffic
   moves *sideways* through the view and does not grow, so it is silent by design. The unit test
   `passingVehicleIsNotAHazard` locks that in. This is the main reason the app "does not detect cars" in practice, and
   it is the wrong behaviour for crossing: the cars that matter at a kerb are exactly the ones travelling across the view.
3. **A green round vehicle light was read as a pedestrian WALK.** The training data has pedestrian lights and a few
   vehicle lights from a car's viewpoint (DTLD), but almost no vehicle lights seen from the footpath. This is a safety
   defect and has to be fixed before any curb test.

Still open: whether the on-phone pipeline (GPU resize → letterbox → model) delivers the same input as the desktop test.
The iOS app now has a debug capture for this (section 7, step 1).

### 1.2 The sidewalk segmenter cannot find the kerb

The AN-S3 16-class segmentation model was run on six Australian crossing photos. It painted the whole road as footpath
(`Paved`) at Adelaide St, labelled roads patchily elsewhere, and produced a usable road/footpath boundary in one photo
of six. Road-called-footpath is the "false-safe" error the 2026 SENSATION study measures as its primary safety metric
([arXiv 2607.21137](https://arxiv.org/abs/2607.21137)). This model must not be used to place a kerb.

## 2. What YOLO does, and why the signal classes still matter in Australia

**YOLO** is one neural network that looks at one picture (640 × 640 px here) and returns a list of boxes. Each box has a
class ("car", "person", "ped_red") and a confidence. It does not know distance, speed or which way anything is moving;
it sees one frozen moment. Everything else in CrossWise is built on top of those boxes: tracking over frames, phase
timing, looming, veer.

**Does it need pedestrian-signal training if Australia has one design?** Yes. One design makes the job easier, but the
model can only recognise what it has seen, in the conditions it will meet:

* **Telling pedestrian lights from vehicle lights is the hard part.** The standing and walking figures are distinctive,
  but at 20 m a lit figure is a few pixels, and round vehicle lights sit on the same poles. The test above shows the
  model confusing them, in both directions.
* Australian specifics the current data barely covers: the black two-aspect head, LED figures, flashing red clearance,
  no countdown numbers, poles at the kerb seen from the footpath, harsh sun, night.
* Measured domain gap: red called green was 0.33 % on familiar data and 5.75 % on an unseen city (ImVisible).

So the right move is not "drop the signal classes" but "specialise": add Australian examples and **vehicle lights as
an explicit negative class**, so the model is forced to learn the difference.

**Context from Australian practice.** Australian signalised crossings are fitted with audio-tactile push buttons as
standard (PB/5 and successors). Each gives a slow locator tick, a rapid tick on the green man, and a vibrating arrow that points across the
road ([OSM Australia](https://wiki.openstreetmap.org/wiki/Key:traffic_signals:sound),
[Vision Australia](https://www.visionaustralia.org/community/news/2023-02-02/history-pb5-crosswalk-button)). Blind
travellers already hear the phase at signals. The camera's value at signals is therefore:

* finding the button pole;
* confirming the phase when traffic noise drowns the ticks;
* telling a *fresh* green from one about to end;
* alignment;
* warning about **turning vehicles**, the main conflict during a green man.

The unmet need is at **unsignalised crossings**: zebra crossings, refuge islands, roundabouts, side streets. There,
blind pedestrians wait about three times longer than sighted ones and needed intervention in about 6 % of attempts in
a roundabout study ([Guth/Ashmead](https://www.researchgate.net/publication/228666397)). Quiet vehicles make this worse:
Australia mandates acoustic alerting on new EVs and hybrids only below 20 km/h (ADR 113, all such vehicles sold from
1 Nov 2026) ([Minister](https://minister.infrastructure.gov.au/c-king/media-release/new-ev-and-hybrid-rules-improve-pedestrian-safety)).

## 3. Your concept, evaluated

| Idea | Verdict | Why / change |
|---|---|---|
| Macro navigation with Google Maps, micro navigation only at crossings | **Keep** | The right split: the camera and battery are only needed for the last ~20 m and the crossing itself. |
| Google Maps knows where you cross | **Change** | Google walking routes do not say what kind of crossing a step uses. Add **OpenStreetMap** crossing nodes along the route: `crossing=traffic_signals / zebra / uncontrolled`, `crossing:island`, `tactile_paving`, `kerb`, `lanes`, `width`. They pre-brief "signalised crossing with audio button, 2 lanes, island" before arrival. GPS is only good to 5–15 m in a CBD, so vision takes over near the kerb. |
| "Stop" at the kerb | **Keep, as a backup** | The cane and dog already find the kerb and the tactile warning dots (TGSIs). The app confirms it: TGSI detection and, on iPhone Pro, the LiDAR step-down (range ~5 m). It must never replace the cane. |
| "Turn left or right to face the crossing" | **Keep, two stages** | Coarse: crossing direction from the OSM geometry plus the compass (±15°, disturbed by cars). Fine: zebra-stripe direction, far-kerb line, the button's tactile arrow, then lock heading with visual-inertial tracking (ARKit). |
| Point the phone down, find both kerb lines, measure distance, say how many steps | **Keep, but honest about accuracy** | Near kerb: easy with LiDAR, TGSIs and segmentation. Far kerb (7–20 m away): needs a road/footpath/**curb** segmenter (section 4) plus ground-plane geometry. From 1.3 m chest height at 15 m, a 0.5° tilt error is ~1.5 m. Step length varies 0.6–0.8 m. Say it as "about 14 metres, about 19 steps, 2 lanes". Better still, give **progress while crossing**: "halfway", "kerb in 3 metres". ARKit tracks distance walked to within a few percent (tens of centimetres over a crossing). |
| Press start, raise the phone, scan left to right | **Change** | The portrait main camera sees ~40°; covering both directions means turning ~180° while cars keep moving. Hold the phone in **landscape** and use the **ultra-wide camera** (iPhone 15 Pro: 120° diagonal, ~108° horizontal). Replace free scanning with a guided glance: "Look right… now left", 2 s each, with the gyroscope confirming each glance happened. |
| "Danger! cars coming from the left in … metres" | **Keep, as a warning only** | Distance comes from box height × known vehicle height (car ~1.5 m, bus ~3.2 m) with the camera focal length (±15–25 %), cross-checked by ground-plane geometry from the box's bottom edge. Speed and time-to-arrival come from the track. Say side, distance **and** seconds: "Car from the right, about 30 metres, 3 seconds". |
| Deciding when it is safe to cross | **Remove** | Physics rules it out. At 50 km/h a car covers 14 m/s. Crossing two lanes at 1.1 m/s takes ~7 s, so a gap needs no car within ~100 m. The main camera shows a car at 100 m ~7 px tall at the 640-px model input, below what YOLO26n finds reliably (~40–60 m). "No car detected" cannot mean "clear". The app warns; the traveller, with cane, dog and ears, decides. |

## 4. Which model, in which situation

| Stage | Phone | Models and sensors | What the user hears |
|---|---|---|---|
| **A. Walking the route** | Pocket or lanyard, screen off | GPS, Google route, OSM crossings, compass. **No camera.** | "In 40 metres, crossing ahead: traffic lights with audio button, 2 lanes." |
| **B. Approach** (last ~20 m) | Raise to chest, portrait | Detector (TGSI, crosswalk, signal pole), LiDAR step-down, GPS | "Kerb ahead, 2 metres." / "Tactile dots under your feet." |
| **C. Align** | Chest, pointing across | Crosswalk stripe direction, far-kerb segmentation, signal position, compass, then ARKit heading lock | Sonar tick that speeds up when facing the crossing; "Facing the crossing." |
| **D. Measure** (optional, ~3 s) | Tilt down, then level | Road/footpath/curb segmenter, ARKit ground plane, LiDAR near kerb, lane markings, OSM `lanes`/`width` | "About 14 metres, 2 lanes, island halfway." |
| **E1. Wait: signalised** | Chest, pointing at far signal | Detector (`ped_red`, `ped_green`, flashing), phase tracker, the button's own ticks | "Red man." … "Green man just came on." / "Green man on, may end soon." |
| **E2. Wait: unsignalised** | **Landscape, ultra-wide** | Detector (vehicles), tracker, distance and speed, time to reach the crossing line | "Car from the right, 30 metres, 3 seconds." / "Vehicles still approaching." Never "clear" or "safe". |
| **F. Crossing** | Chest, pointing ahead | ARKit (distance walked, lateral drift in metres), gyroscope fallback, detector for turning vehicles, signal phase | "Bear left." / "Halfway." / "Kerb in 3 metres." / "Flashing red: keep going." / "Car turning, left!" |
| **G. Arrive** | Chest | LiDAR step-up, TGSI, distance walked ≈ measured width | "Kerb. Step up." → back to stage A |

**Models to have by the end:**

1. **Detector, retrained YOLO26n (640).** Classes: `ped_red`, `ped_green`, **`vehicle_light`** (new negative), `crosswalk`,
   **`tgsi`** (new), `person`, `bicycle`, `car`, `motorcycle`, `bus`, `truck`. Data:
   * existing sets;
   * vehicle lights from DTLD (already downloaded) and Mapillary Vistas;
   * Australian footage from your own recordings (auto-label, then review with A/F/R);
   * the 22 test photos, held out as a test set.

   Report red-as-green and **vehicle-light-as-pedestrian** rates.
2. **Road/footpath/curb segmenter** (new; replaces AN-S3 for kerb finding). DeepLabV3+ MobileNetV3 had the lowest
   road-as-footpath error in the 2026 SENSATION study (0.079, 7.4 FPS on Android at 512 × 384). Train on Mapillary
   Vistas classes `road`, `sidewalk`, `curb`, `curb cut`, `crosswalk-zebra`, `lane marking`. Validate on
   [SydneyScapes](https://hdl.handle.net/2123/33051) (756 Sydney images) and your own frames. It only runs in stages
   B–D, a few frames per second.
3. **Geometry, not networks, for distance.** LiDAR depth up to ~5 m (iPhone Pro); ARKit ground plane and raycasts
   further out; known object heights. Depth Anything V2 small ([Apple Core ML](https://huggingface.co/apple/coreml-depth-anything-v2-small))
   is only a fallback for phones without LiDAR: relative depth, metric only after fine-tuning, and it adds latency.
4. **Optional:** Apple's built-in SoundAnalysis classifier for sirens and horns. It cannot give direction from one
   microphone.

## 5. Instructions to users (the vocabulary)

Rules that hold at every stage: short sentences, side first, numbers rounded, never "safe" or "clear", and silence
while the traveller is listening to traffic unless something changed.

| Moment | Say | Don't say |
|---|---|---|
| Crossing ahead | "Crossing in 30 metres. Traffic lights, audio button, 2 lanes." | Street-name lists, turn-by-turn during a crossing |
| At kerb | "Kerb. Stop." | "You can cross now." |
| Aligning | tick tempo + "Facing the crossing." | Degrees |
| Measuring | "About 14 metres. About 19 steps. Island halfway." | Decimals, "exactly" |
| Signal | "Red man." / "Green man just came on." / "Green man, may end soon." / "Flashing red." | "Go." |
| Unsignalised | "Car from the right, 30 metres, 3 seconds." / "Two cars from the left." | "No cars" (say "No vehicle detected. Listen before crossing.") |
| Crossing | "Bear left." / "Halfway." / "Kerb in 3 metres." / "Car turning, left!" | Anything longer than 4 words |
| Uncertain | "Signal lost." / "Too dark to see traffic." / "Camera blocked." | Guesses |

## 6. Precautions

* **The app never authorises a crossing.** Its output is information and warnings. The test in section 3 shows why.
* **A missed car is worse than an extra warning**, but warnings that cry wolf get ignored. Measure both: vehicles
  missed and false alarms per minute.
* **Wrong-type signals.** Never announce a green man from a light the model cannot tell apart from a vehicle light; say
  "Light looks green, not verified" (already built).
* **Known blind spots**, stated in the app and in the thesis:
  * night, heavy rain and glare;
  * cars hidden by parked vans;
  * vehicles beyond ~50 m;
  * the camera's field of view;
  * turning vehicles appearing late;
  * quiet vehicles above 20 km/h.
* **Road rules**: cross at a crossing if one is within 20 m (Australian Road Rule 234). On flashing red you may finish
  but not start (rule 231).
* **Human factors**:
  * speech competes with hearing traffic, so use bone-conduction headphones and keep speech minimal;
  * a chest mount frees both hands;
  * the cane or dog stays the primary tool.
* **Battery and heat**: the camera and models run only in stages B–G.
* **Testing**: no blindfolded or unsupervised crossings. Kerb-side recording with a sighted spotter; veer tests in a
  closed car park; involve an O&M specialist (Guide Dogs NSW/ACT or Vision Australia) before any street use by BLV
  participants; ethics approval for user studies.

## 7. What to do before code freeze (13 Oct) and what to leave

**Now to 6 Oct: make the car answer real**

1. **Verify the on-phone pipeline (½ day).** With the app open, drop an empty file named `capture.request` into
   *Files → CrossWise* (or ask me to push it over USB). The next frame's exact model input, raw output and boxes land in
   `Documents/debug/`; compare them with the desktop run.
2. **Replace looming-only alerts with crossing-relevant alerts (2–3 days).**
   * Per-track distance from box height and class height, cross-checked with the ground plane.
   * Lateral speed toward the crossing line, and time to arrival.
   * Announce any vehicle arriving within ~8 s, from its side.
   * Keep looming for vehicles heading straight at the user.
   * Unit-test with synthetic tracks, as the existing tests do.
3. **Landscape + ultra-wide "traffic check" mode (1 day).** Choose the ultra-wide lens, rotate the geometry, and add a
   guided "look right, look left" glance.
4. **Retrain with `vehicle_light` negatives (1 day of work, overnight on Kaggle).** Evaluate on the 22 Australian photos
   and your footage.

**7 to 13 Oct: connect the journey and measure**

5. **Macro to micro hand-off (1–2 days)**: Google route plus OSM crossings along it, pre-brief and automatic crossing mode.
6. **Evaluation at the kerb**: detection range per vehicle type, distance error against a measured tape, alert latency,
   missed vehicles, false alarms per minute.

**Future work (in the thesis, not in the demo)**

* ARKit crossing measurement and in-crossing progress ("halfway", "kerb in 3 m").
* The road/footpath/curb segmenter.
* TGSI detection.
* Button-pole finding.
* Siren detection.
* A user study with O&M supervision.

## 8. Interface overhaul and pedestrian journey

Updated 4 October 2026 following the user's request for separate User and Developer modes and more usable crossing
instructions. The two modes share perception, uncertainty, session state and feedback rules. Developer mode exposes
evidence; it does not make the system more certain or automatically enable experimental guidance.

### 8.1 Agreed interface backlog

**Increment 1 — implemented in the iOS port, 4 October 2026:** persistent User/Developer tabs, a scrollable User
Assist screen with large text controls and essential warnings, and simplified User settings. Switching presentation
preserves the camera, active assistance and current tab. Developer controls remain available. This is the first slice
of the interface redesign; the journey controller, replay and signal-trust work below remain outstanding.

Validation: 65 tests across seven suites, TypeScript and ESLint pass; Release builds succeed for simulator and iPhone.
Simulator checks cover switching during assistance, Settings continuity, persistence after relaunch and maximum
accessibility text size (including a status-layout fix). The connected iPhone runs the build and its User layout was
inspected by screenshot. Physical VoiceOver focus, spoken output and tactile feedback still need hands-on confirmation;
the selector item remains open until those checks are complete. No road-crossing performance claim follows from these UI tests.

- [ ] Add an accessible top-level **User | Developer** selector. Default to User, remember the choice, preserve the
  active session, and avoid accidental switching or focus resets while crossing.
- [ ] Build a task-focused User home with **Navigate** and **Crossing assistance**, with **Practice** under Settings
  (updated by section 10). Keep a low-vision
  camera option and large text; do not assume every user has the same residual vision or screen-reader preferences.
- [ ] Provide consistently located **Repeat status**, **More detail**, and **Stop assistance** actions, with spoken and
  tactile confirmation. Say "Assistance stopped" rather than an ambiguous "Stop" that sounds like a movement command.
- [ ] Make all tasks achievable through VoiceOver without relying on colour, icons, animation, or an undisclosed gesture.
  Keep focus stable as detections update. Support large text and Reduce Motion. Verify volume-key behaviour with
  VoiceOver and allow those shortcuts to be disabled so users can retain normal volume control.
- [ ] Separate observations ("Vehicle on your right") from instructions ("Raise your phone") and distinguish camera
  instructions from body-direction instructions. Never treat a detection as permission to cross.
- [ ] Add short setup and practice: speech detail, haptic demonstration, handheld versus mounted phone, and optional
  audio-route check. Voice control is a later optional shortcut, not a prerequisite.
- [ ] Provide actionable uncertainty: camera blocked, view too dark, signal lost, heading unavailable, and crossing
  direction unknown. Do not narrate every low-confidence frame or silently retain expired information.
- [ ] Build Developer panels for camera input, detections, tracks, phase evidence, alert reasons, route/location quality,
  model selection, capture and logs. Explain "Why no warning?" as well as why an alert fired.
- [ ] Add clearly labelled recorded-scenario replay with pause, scrub, an event timeline, and algorithm comparison on
  identical inputs. Isolate replay from live navigation and reset temporal state when changing source or seeking.
- [ ] Give each experimental capability a separate enable switch and validation status. Keep measurements unavailable
  in User mode until its acceptance criteria are met.
- [ ] Keep crossing completion explicit initially. User confirmation is recorded as confirmation, not sensor detection.

### 8.2 Journey design

This is a proposed product task analysis, not a mobility-training protocol. Review the interaction and wording with
blind and low-vision travellers and an orientation and mobility specialist. Existing travel skills and cane/guide-dog
use remain part of the journey. The app must accommodate different techniques rather than impose a sighted scanning routine.

Examples below are conditional: speak a fact only when the relevant capability can establish it. Mapped information,
current camera observations and user confirmation must retain their different sources and timestamps.

| Stage | Details a sighted pedestrian might check | Proposed assistance and interaction | Required limit or recovery |
|---|---|---|---|
| Prepare | Destination, correct entrance, preferred route, phone and belongings | Confirm the selected address; offer familiar routes; preview known crossings; check permissions and output before departure | A route preference for fewer crossings or signals depends on available map data; never label an unassessed route "safest" |
| Walk along the footpath | Side streets, driveways, reversing cars, bikes, obstacles, gaps in the footpath | Sparse route instructions and an on-demand "Where am I?" summary; offer crossing assistance before a mapped crossing | Camera-off navigation cannot monitor obstacles or driveways. Say when visual assistance is unavailable |
| Identify the intended crossing | Is the route crossing a side street or the main road? Is this a driveway? Which branch of the junction? | "Your route crosses the side street ahead" when supported; retain the crossing identity throughout the session | A nearby node or detected signal is insufficient to identify the correct crossing; offer manual entry and uncertainty |
| Choose a crossing location | Markings, signals, refuge, parked-car occlusion, bends, the opposite footpath and accessible exit | Offer known mapped crossing alternatives and an optional brief description while stationary | Do not direct the user around a parked vehicle into the road to obtain a better camera view |
| Approach the edge | Kerb, dropped kerb, ramp slope, tactile paving, raised continuous surface, gutter | "Crossing nearby" from map context; user confirms they have reached the crossing before camera setup | GPS cannot locate the exact edge. Kerb distance, step-down and tactile-surface statements require validated local perception |
| Establish the crossing direction | Opposite landing point, crossing axis, skewed zebra, corner ramps pointing diagonally | Store a crossing direction separately from current phone direction; offer alignment cues only with sufficient evidence | "Signal centred" must not become "Facing the crossing". A crosswalk box alone supplies no crossing axis |
| Understand the layout | Near and far lanes, slip lane, refuge, separate signal stages, bike lane | On-demand short pre-brief: "Mapped crossing has an island" where supported | Missing tags mean unknown. An island is an intermediate destination; each further carriageway needs a new assessment |
| Set up the camera | Lens clear, phone correctly held, intended view visible | One instruction at a time: "Raise your phone", then "Hold it steady"; give a brief completion cue | No repeated tilt loop. Allow retry, help, or leaving camera assistance; validate the wording at realistic phone positions |
| Observe traffic | Both directions, turning paths, vehicles behind the shoulder, overtaking, occlusion, cyclists | Guided phone movements when appropriate; time-stamped vehicle observations; distinguish position from established travel direction | Phone rotation is not vehicle motion. A scan is a sequence of partial views, never a simultaneous all-clear |
| Wait and reassess | Has traffic changed? Is a vehicle actually stopped? Is the relevant signal changing? | Signal changes and meaningful vehicle updates; keep quiet otherwise; provide an on-demand current status | Do not infer driver awareness or yielding from apparent slowing, eye contact, a wave, or other pedestrians crossing |
| Begin crossing | Person decides to start and retains intended direction | Use **I'm crossing** for a user report; confirm "Crossing assistance active"; offer a practised hardware shortcut | The app does not say "Go". Starting must invalidate old scan assumptions without discarding current hazard observations |
| Continue | Turning traffic, path deviation, footing, intermediate islands | Short fresh hazard observations; heading cues only when phone/body relationship supports them; suppress routine route narration | Do not prescribe stopping, reversing, or rushing in the carriageway from an uncertain estimate. Heading retention is not proof of remaining inside a crosswalk |
| Reach the far side | Actual footpath or ramp reached, gutter cleared, room to continue | **I've reached the footpath** confirms completion; later add validated arrival suggestions | A pause, elapsed time, inferred steps, or walked distance alone cannot confirm arrival. No automatic "Step up" at an unseen kerb |
| Resume the route | Reorient along the correct footpath, avoid an immediate wrong turn | Restore the next route instruction after completion and adequate location/orientation evidence | Do not reset to a wrong route segment because GPS jumped across the road |

### 8.3 Additional usability work

- [ ] Give the User screen one main action for the current stage, with Repeat and More detail in stable locations.
  Use explicit labels such as **Check traffic**, **I'm crossing**, and **I've reached the footpath** instead of a
  changing generic **Start** button. Urgent observations must not require acknowledging a dialog.
- [ ] Define left/right relative to the traveller's established crossing orientation. Keep camera-relative cues
  explicitly worded as phone movements. When that reference is lost, withdraw directional guidance rather than guess.
- [ ] Keep instruction speech short and sequential. Explain the rationale on demand. Beginner detail can be greater
  during setup; urgent hazard information must not be hidden by a verbosity preference.
- [ ] Retire stale speech before playback. Prioritise urgent observations over route instructions, avoid overlapping
  VoiceOver and app speech, and test with the actual audio outputs used by participants.
- [ ] Provide an optional unobtrusive feedback cue to distinguish assistance running from assistance unavailable;
  test whether it interferes with hearing traffic before enabling it by default. Silence never means the road is clear.
- [ ] Preserve progress through phone calls, audio disconnection, camera interruption, and app backgrounding. Announce
  the loss once and require fresh observations before resuming live guidance; never replay old WALK or vehicle cues.
- [ ] Add **Crossing not found**, **Check again**, and **Choose another route** recovery actions. Avoid imposing a time
  limit on preparation or interpreting a long wait as an instruction to move. Help must not automatically contact others.
- [ ] Treat signalised, zebra, unmarked side-street, refuge and slip-lane crossings as separate scenarios. Support an
  unknown crossing type; do not force a guessed classification. Roundabouts and complex junctions need dedicated validation.
- [ ] Let a user preview and practise a familiar journey. Save preferred settings and route choices without treating
  a previously successful crossing as evidence that today's traffic or infrastructure is unchanged.

### 8.4 Capability and implementation order

**First deliverable:** verify phone input against desktop inference; fix signal trust handling; add deterministic replay
and richer logs. A class named `ped_green` currently becomes trusted evidence, so the generic-light colour fallback does
not mitigate a vehicle light misclassified as a pedestrian head. An explicit `vehicle_light` class needs corresponding
app logic and held-out evaluation, not just new weights.

**Interface deliverable:** shared session/journey controller and two presentation shells; accessible User controls;
Developer inspection and replay; practice, wording and interruption handling. Preserve existing core functions while
validating the redesigned flow. Store evidence source, freshness and availability alongside each presented observation.

**Traffic deliverable:** useful presence and motion observations alongside existing looming. Compensate camera motion
before interpreting track velocity. Validate view coverage and performance before choosing landscape or ultra-wide as
the default. Do not infer a vehicle's crossing-conflict time merely from time to reach the image centre.

**Journey deliverable:** map context, crossing identity and route hand-off with manual fallback. Reserve evaluation time
before the documented 13 October freeze. The full backlog is not a promise to finish all capabilities by that date.

**Later research:** near-kerb perception, road/footpath/curb segmentation, far-side landing identification, width and
progress estimation, pedestrian-button location, and metric vehicle distance/arrival time. Establish acceptable error and
failure behaviour before exposing each feature as user guidance. Step counts additionally need personal calibration and
must never be used alone to decide that a road has been crossed. Background navigation is a separate platform task;
camera-off operation is not automatically implemented by the new mode selector.

### 8.5 Acceptance scenarios

- [ ] Complete a simulated journey with VoiceOver, without seeing the screen, including repeat, cancellation and recovery.
- [ ] Replay a green vehicle light, multiple pedestrian signals, and a persistent incorrect class; check that unsupported
  pedestrian WALK claims are not produced by model-name or class-name trust alone.
- [ ] Replay lateral traffic, a stopped car, a car hidden by a van, a turning car, a bicycle, and camera rotation. Measure
  missed vehicles and false warnings, and check that old observations expire.
- [ ] Simulate GPS drift to the wrong side of a junction, a missing map crossing, an island, and a raised crossing without
  an obvious kerb. Unknown geometry must remain unknown.
- [ ] Rotate a handheld phone during a scan; verify that it does not issue unsupported body-steering cues.
- [ ] Pause midway through a simulated crossing; verify that it does not announce arrival or restart ordinary route speech.
- [ ] Interrupt camera/audio, background the app, and resume; verify availability announcements and fresh-state recovery.
- [ ] Switch interface mode and replay/live source; ensure controls, evidence and speech remain consistent and live/replay
  data never mix. Repeat with large text, Reduce Motion and normal hardware-volume behaviour.
- [ ] Review phrasing and task completion with BLV advisors and an O&M specialist, initially using table demonstrations
  and controlled settings. Record comprehension, unnecessary prompts, recovery success, and workload as well as detector metrics.

### 8.6 Sources for the journey review

The workflow and backlog above are design proposals. These sources inform the environmental considerations; they do not
validate the proposed app or provide evidence of its accuracy.

- [Vision Australia getting around safely](https://www.visionaustralia.org/information/living-independently/getting-around-safely):
  crossing-location selection, parked cars/bends, familiar routes and individual orientation and mobility support.
- [NSW sharing the road with pedestrians](https://www.nsw.gov.au/driving-boating-and-transport/driving-nsw/roads-safety-and-rules/sharing-road-overtaking-and-merging/sharing-roads-pedestrians):
  turning and driveway interactions that crossing scenarios should include.
- [Guide Dogs for the Blind street crossings](https://www.guidedogs.com/resources/client-resources/guide-dog-class-lecture-materials/street-crossings):
  crossing layouts, islands and guide-dog travel context. This is a US organisation; its local traffic rules are not
  treated as Australian instructions.

## 9. Vehicle detection investigation and next increments — 4 October 2026

### Evidence from the user's neighbourhood photo

The supplied file is `mobile/read.JPG` (the requested `real.jpg` path was absent). EXIF-corrected size is 4284 × 5712.
Test input: RGB float32 in [0, 1], NCHW, 640 × 640, aspect-preserving resize with gray 114 padding. Desktop inference
used LiteRT 2.2.0 with CPU/XNNPACK. This reproduces the model's intended input, not the phone's live YUV camera pipeline.

The bundled `crosswise.tflite` has SHA-256
`466536d041a6d72c57c6755206f51bee46f80afdeb0b3241117e651751b9555a`, identical to the saved v1 export.
Input shape is [1,3,640,640]; output is [1,300,6]. At the app's 0.35 threshold:

| Visible vehicle | Bundled trained model | Bundled COCO YOLO26n |
|---|---|---|
| Foreground white hatchback | car, 0.9440 | car, 0.8335 |
| Utility vehicle at left | car, 0.8444 | best car score 0.2753; filtered out |
| Farther white car up the street | car, 0.6072 | car, 0.6917 |

These are model scores, not calibrated probabilities or measured detection accuracy. Three obvious vehicles were found
by the trained model in this single photo; this is not a general recall benchmark. The original PyTorch weights also
find the three vehicles. The app's actual TypeScript decoder and label mapper were run on the LiteRT output and retain
all three as CAR. The model is therefore capable of detecting these vehicles; retraining is not yet justified by this case.

The connected phone's configuration currently selects `asset:crosswise.tflite`, threshold 0.35, acceleration enabled,
Developer mode, overlays/status icons enabled, and vehicle alerts/speech enabled. Those settings are not evidence of
which backend actually ran during the outdoor test. No saved outdoor input/output capture was supplied in this turn.

Confirmed app behaviour: `HazardMonitor` only flags sufficiently large, consistently expanding vehicle tracks with
short estimated time-to-contact. Lateral traffic is explicitly excluded, including in the existing test named
"passing vehicle is not a hazard". Repeat status counts those hazards rather than all vehicle detections. Thus a
stationary or passing car can be detected without any vehicle announcement. User mode also hides detection overlays.
Neither fact alone explains absent Developer boxes; that requires the next phone test.

### Work order and acceptance gates

**Screenshot follow-up, 4 October:** `mobile/IMG_8572.PNG` shows YOLO26n/Core ML, four vehicle tracks and boxes that
appear rotated approximately 180 degrees relative to the preview (the largest vehicle's box is on the opposite side;
the smaller boxes also reverse position). `IMG_8573.PNG` shows the same model/backend but zero vehicles. Both show
Assist off, which suppresses spoken guidance but does not disable inference, tracking or Developer boxes. This is
evidence of a live geometry/preprocessing problem to investigate, not merely the lateral-warning limitation.
Check the resizer's left/right rotation against VisionCamera's frame-orientation convention before applying any
overlay correction. If model input is upside down, flipping only the drawn boxes leaves recognition and guidance wrong.
A USB debug capture at 13:59 reports a portrait 720 × 1280 frame, orientation `left`, NCHW 640 input and CrossWise/Core ML;
the camera then saw a blurred indoor scene, so that capture cannot establish correspondence with the outdoor screenshots.

1. **Next implementation: deterministic vehicle-detection diagnosis on the iPhone.** Feed this same saved image/input
   through CPU and Core ML; retain model identity, input pixels, raw outputs, decoded boxes, timing and failures. Then
   capture a live camera tensor using the existing `capture.request` path and replay that exact tensor on desktop.
   Inspect orientation, RGB/YUV conversion, range, layout, letterbox and overlay coordinates. Fix only the stage that
   fails. Passing means all three photo vehicles survive the phone inference/decoder at 0.35 with sensible boxes;
   backend comparison must check detections, not merely whether outputs contain NaNs. Verify live stationary vehicles
   too. This establishes object detection before motion classification.
2. **Moving-vehicle observations.** Keep detecting parked and moving vehicles; add temporal classification of moving,
   stationary and unknown. Track identity across frames and compensate camera rotation; when translation/parallax or
   insufficient observations make motion ambiguous, retain unknown. Image position is not travel direction. Test a
   fixed camera with passing cars in both directions, approach/recession, stop/start, partial occlusion and camera panning
   across parked cars. Only then add concise, fresh motion observations with repetition limits. Do not equate lateral
   image motion or looming with predicted intersection of the user's path, metric speed, or a safe crossing gap.
3. **Evaluate model alternatives only after phone parity is established.** Compare the trained model, the already
   bundled COCO YOLO26n and a COCO YOLO26s candidate on the same held-out local clips. Measure vehicle recall by apparent
   size/view/lighting, false positives, detection gaps, motion errors, end-to-end latency and sustained phone performance.
   Choose using those results rather than a desktop mAP table or one successful photo. Do not download/train a large new
   model or replace the installed model until that comparison provides a reason.
4. **Targeted data work if measured misses remain.** Prioritise manually checked Australian footpath-level recordings,
   including parked cars, passing traffic, turning traffic and negative scenes. Split by recording/location, not adjacent
   frames, to avoid leakage. Audit missing vehicle annotations and teacher pseudo-labels in existing training data.
   BDD100K is a possible road-vehicle/tracking supplement, but its driving viewpoint does not replace pedestrian-view
   validation. A single image cannot label moving versus stationary; record short video sequences with motion truth.

Official candidate references: [Ultralytics YOLO26 models](https://docs.ultralytics.com/models/yolo26/),
[BDD100K dataset/toolkit](https://github.com/bdd100k/bdd100k),
[ByteTrack tracker](https://github.com/FoundationVision/ByteTrack). ByteTrack is an association/tracking candidate,
not a solution for world-motion classification or collision prediction by itself.

No detection, threshold, motion or warning code was changed during the initial investigation. Other development stays paused.

### Implementation increment: input orientation and reproducible diagnosis

Implemented `enablePhysicalBufferRotation: true` on the analysis stream, so the camera delivers upright YUV buffers
and the resizer does not apply its portrait left/right rotation. Both prediction and display now use that intended
upright input; the overlay is not artificially reflected. This uses VisionCamera's supported API rather than a local
patch to node_modules. Physical buffer rotation introduces overhead; sustained device throughput remains to be checked.

Added a local photo diagnostic (`ml/scripts/diagnose_mobile_detector.py`) and an isolated, file-triggered phone probe
that compares CPU with accelerator-preferred inference. The probe runs only when explicitly requested in Developer mode
with assistance off, uses independent interpreters, validates tensor size/range, and never injects test results into
live tracking/guidance. Debug camera capture now saves one frame per request instead of several in-flight copies.
Coordinate tests cover portrait, landscape and square frames with an asymmetric box; probe tests cover unaligned file
buffers, malformed inputs, nonfinite output, decoding and interpreter cleanup.

Controlled orientation experiment on `read.JPG`, same files and 0.35 threshold:

| Input orientation | CrossWise | COCO YOLO26n |
|---|---|---|
| Upright | 3 car detections (0.944, 0.844, 0.607) | 2 car detections (0.833, 0.692) |
| Intentionally rotated 180° | No detections | 1 car and 1 truck detection |

This supports correcting orientation before retraining. It does not measure general accuracy or establish that every
outdoor failure was caused by rotation. Data/results are local under `ml/data/diagnostics/orientation/` (ignored by Git).
The iPhone became unavailable during implementation and the user deferred the physical scene test. Do not mark live
alignment, device CPU/Core ML parity, or improved outdoor recall as passed until the phone checks are actually completed.

Local validation: 74 tests across eight suites pass; TypeScript and ESLint pass. Release builds for iOS and simulator
succeed. The file-triggered diagnostic ran end-to-end in the simulator for both bundled models on CPU and Core ML.
Above-threshold detections match desktop LiteRT: 3 CrossWise vehicles and 2 baseline vehicles, maximum coordinate
difference below 0.001 input pixels and score difference below 0.00001. This is simulator backend parity on a saved
tensor, not physical iPhone Neural Engine validation, live camera validation, or a throughput benchmark. The signed
orientation-fix build is prepared; installation awaits the iPhone reconnecting.

**Later physical-device check, 4 October 2026:** the reconnected iPhone 15 Pro now has the Release build containing
the orientation fix, simplified tabs and explicit crossing completion (10.8). The selected CrossWise detector ran the
same saved street-image tensor on device: CPU and Core ML each detected the same three cars at threshold 0.35. CPU
matched the simulator within approximately 0.000001 in score; Core ML differed by at most 0.00477 in score and less than
0.15 model-input pixels in box edges versus CPU. Small accelerator differences were observed, not assumed absent.
Results are in `ml/data/diagnostics/orientation/upright/crosswise/iphone-result.json` (local, ignored by Git).
This checks saved-input inference on the physical phone, not live camera orientation, outdoor recall, a Neural Engine
execution trace or sustained frame rate. The live-scene check and physical YOLO26n comparison remain outstanding.

### Accuracy experiments inspired by r/computervision

Read the discussions on [CCTV fine-tuning and small objects](https://www.reddit.com/r/computervision/comments/1sewiu8/new_to_computer_vision_struggling_to_finetune_for/),
[class retention during fine-tuning](https://www.reddit.com/r/computervision/comments/1mfw6x8/yolo_finetuning_catastrophic_forgetting_am_i/),
and [reviewing auto-labels](https://www.reddit.com/r/computervision/comments/1vlnphd/looking_for_a_faster_and_more_accurate/).
These are practical leads from commenters, not validated prescriptions for this app. The resulting experiment order is:

1. Finish phone input/box alignment and CPU/Core ML parity. Preserve the present threshold/model as the baseline.
2. Build a manually reviewed local evaluation set, split by recording and location. Include all visible vehicle labels,
   difficult negatives, occlusion and small/far vehicles; do not use teacher predictions as test truth. Retain a separate
   untouched test set while using a development set to select changes.
3. Measure vehicle size in the actual input tensor. Compare 640 input with a separately exported higher-resolution
   model, then a full-frame plus tiled-inference candidate if small-object misses justify it. Tiling needs duplicate
   merging and full-scene coverage; measure total latency, thermal load and temporal consistency on the phone. Do not
   change input buffer dimensions for a fixed-shape 640 model. The [official Ultralytics SAHI guide](https://docs.ultralytics.com/guides/sahi-tiled-inference/)
   documents the approach; phone feasibility is an experiment, not an assumption.
4. Compare YOLO26n and YOLO26s at matched input sizes. Sweep thresholds on development data to measure recall versus
   false positives; do not lower thresholds globally just to make more boxes appear.
5. If retraining is warranted, review failed cases and pseudo-labels, retain vehicle examples alongside signal examples,
   and check all retained classes for regressions. Follow [evaluation-driven fine-tuning](https://docs.ultralytics.com/guides/model-evaluation-insights/).
6. Validate moving/stationary/unknown classification separately after reliable detection. No image model or confidence
   threshold turns a single photo into proof of vehicle motion or crossing clearance.

## 10. One journey, simpler controls and map-assisted crossing preparation

Updated 4 October 2026. Research and architecture decisions below are proposals unless explicitly marked implemented.
The user will test micro-navigation later. Avoid another model or routing dependency until its evidence justifies it.

### 10.1 What exists now

This audit describes the state before the incremental fix in 10.8. Automatic completion has since been removed;
the other navigation and automatic-start issues remain.

- `mobile/src/nav/navigation.ts` calls Google Places Text Search and Google Routes with `travelMode: WALK`.
  This is partial Google integration, not an embedded Google map or a complete pedestrian navigation SDK.
  Navigation defaults off and requires a configured Maps API key with access to those services.
- Destination search takes the first match, discards the returned address, and immediately routes to it. Add accessible
  candidate selection before trusting ambiguous queries. Route steps currently retain only instruction text and distance;
  no step geometry, crossing identity, pavement side or map-quality information reaches the controller.
- `GuidanceManager` follows overall polyline vertices rather than the route's instruction steps. It ignores location
  accuracy, uses phone heading as travel heading, and can give a straight-line off-route instruction. These are prototype
  behaviours to replace before using it to guide someone towards a road. A scanned phone direction is not body direction.
- `controller.navigateTo()` and `CrossingEngine` operate independently. Starting a route does not start assistance or
  create crossing handoffs. Navigation speech can still arrive during a crossing.
- Assistance already persists across roads: `END_CROSSING` returns to `SEARCHING`; it does not stop assistance.
  Users therefore do not have to stop and restart the whole assistant at every road. Per-crossing state is separate.
- There are experimental auto-start/auto-end heuristics. Auto-start uses walking plus a WALK-like phase and approximate
  aim; a missing aim currently defaults to zero degrees. Auto-end uses at least six seconds elapsed plus five seconds
  still, or a two-minute timeout. Neither establishes the intended crossing or arrival at the far footpath. Remove these
  shortcuts from the default journey before integrating automatic handoff; a refuge or pause in traffic is not arrival.

### 10.2 Scope reduction

| Function | Decision |
|---|---|
| Navigate to a destination; standalone crossing assistance | Keep as the two daily tasks; eventually share one journey session. |
| Repeat status; stop assistance; manual crossing-state correction | Keep always accessible. Low frequency does not make recovery controls expendable. |
| Guide and cue practice | Implemented: remove from User tab bar; accessible through Settings → Help and practice, with Back to Settings. Developer tabs remain. |
| Model import/selection, confidence sliders, overlays, performance, logs | Keep in Developer tools, not the daily workflow. Existing presentation split already does most of this. |
| Gemini scene descriptions; experimental segmentation/distance claims | Keep out of the User crossing flow; defer expansion. They do not solve route/crossing association. |
| Mandatory initial left/right-road selection | Do not add. Use a targeted clarification only when sidewalk identity is genuinely unresolved. |
| Automatic completion from a timer/stillness | Removed in 10.8; explicit completion now required. |
| Straight-line recovery across unknown geometry | Still present; replace before automatic journey handoff. |

Current User tabs are **Assist**, **Go** (when enabled) and **Settings**. Help remains reachable after changing modes;
switching tabs/modes does not remount the camera or reset the crossing. This is a UI-only increment, not the new coordinator.

### 10.3 What the available map tools provide

| Source | Useful information | Limit / integration decision |
|---|---|---|
| [Google Routes](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes) | Walking path and navigation steps. | Retain behind a route-provider interface. The reviewed schema is not a complete pedestrian-crossing inventory with kerb endpoints and accessibility attributes. Do not infer crossings by matching English instruction strings. |
| [Google waypoint sideOfRoad](https://developers.google.com/maps/documentation/routes/reference/rest/v2/Waypoint) | A vehicle stopping-side preference. | Only DRIVE/TWO_WHEELER; it neither identifies a pedestrian's pavement nor supplies WALK-side routing. |
| [OSM crossings](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dcrossing), [crossing ways](https://wiki.openstreetmap.org/wiki/Tag:footway%3Dcrossing) | Crossing locations, connecting footways, markings, islands and other mapped attributes. | Coverage varies. A road-centre node alone does not identify both kerbs; preserve network connectivity and crossing stages. |
| [OSM crossing signals](https://wiki.openstreetmap.org/wiki/Key:crossing:signals) | Whether a crossing is signal-controlled; sometimes button, sound or vibration tags. | Static infrastructure only, not the current red/green phase. Normalize legacy `crossing=traffic_signals` and current `crossing:signals`; missing is unknown. Check dedicated pedestrian-head evidence separately. |
| [OSM street lamps](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dstreet_lamp) | Lighting infrastructure. | Not a crossing signal or evidence that a crossing exists. |
| [OSM sidewalks](https://wiki.openstreetmap.org/wiki/Sidewalks) | Separate sidewalk ways or tags on road ways. | Left/right tags follow the stored way's direction, not the user's travel direction. GPS must not be snapped confidently to one side when its uncertainty spans both. |
| [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) | Fetch OSM crossing/sidewalk features for a bounded route corridor. | Not a router. Fetch once per route/revision with timeouts and OSM caching; do not query a public endpoint on every GPS update. |
| [MOTIS PPR](https://github.com/motis-project/ppr) | Existing OSM-based pedestrian router. Its [route edges](https://github.com/motis-project/ppr/blob/master/include/ppr/routing/route.h) carry geometry, OSM IDs, side and crossing type; [steps](https://github.com/motis-project/ppr/blob/master/include/ppr/routing/route_steps.h) distinguish crossings. | Research candidate only. Source review in 10.7 found assumed/generated pavements; do not treat all returned geometry as surveyed or explicitly mapped. Deployment and local coverage remain unverified. |

PPR's [sample accessibility profile](https://github.com/motis-project/ppr/blob/master/profiles/accessibility1.json)
already applies costs/preferences to different crossing types. It is a starting point, not a validated blind-pedestrian
profile: for example, unmarked residential crossings remain allowed. Evaluate routes and tune policy explicitly.
Google's [walking-route limitations](https://developers.google.com/maps/documentation/routes/route-opt) also caution
about missing pedestrian facilities. Review provider [attribution and storage rules](https://developers.google.com/maps/documentation/routes/policies)
when implementing adapters; OSM caching permission does not automatically apply to Google route content.

**Revised recommendation:** first audit a small, surveyed test route and its crossing records. Do not deploy PPR yet.
A later comparison must distinguish explicitly mapped from assumed/generated graph edges. Google plus OSM annotations can be an interim context
layer, but matching the nearest light to a coarse route line is insufficient to select a crossing. Mark unresolved
segments unknown; never silently bridge missing sidewalk connectivity through the carriageway. No local coverage
or live provider calls have been validated yet; the requested public test intersection is still to be supplied.

### 10.4 Intended experience

1. Select a destination and confirm the intended place/address. Start the journey once. Alternatively start standalone
   crossing assistance without a destination or network connection.
2. Get quiet, timely footpath directions. Keep **Repeat**, **Pause/end journey** and **Crossing assistance** available.
3. Approaching a crossing that belongs to this route, automatically prepare crossing assistance and announce the mapped
   road/crossing type once. Do not interrupt VoiceOver focus or repeatedly trigger from GPS jitter. “Mapped crossing
   ahead” is not “You are at the kerb.”
4. At the kerb, verify context through the user's normal mobility methods and the app's available observations. If side
   is unresolved, ask about a named corner/landmark where possible. A fallback can say “Facing along your route, is the
   road on your left or right?” with **Not sure**. This is temporary user-reported evidence, not permanent localisation.
5. The user decides when to enter the road. Initially retain **I'm crossing** / volume shortcut. Auto preparation does
   not mean auto permission to cross, a green phase or a gap in traffic. Sideways moving-vehicle assessment remains
   a separate unfinished feature, as documented in section 9.
6. While crossing, suppress routine route narration; retain relevant hazards, crossing feedback and manual controls.
   Track a refuge as a separate stage rather than the far pavement. Do not reroute someone mid-carriageway.
7. Initially require **I'm on the footpath** confirmation to complete the crossing, then automatically resume footpath
   navigation. Later sensor-assisted completion needs independent validation. A timer or GPS jump alone cannot complete it.
8. Repeat automatically at the next relevant crossing. End the journey once at the destination, with arrival uncertainty
   represented; foreground camera/background limitations must be stated accurately.

### 10.5 Proposed implementation boundary

```text
Destination selection → RouteProvider → ordered footpath and crossing segments
                                       ↓
Location + accuracy + age + motion → JourneyCoordinator ← CrossingContextProvider
                                       ↕                         (mapped facts)
                                CrossingEngine
                                (live observations)
                                       ↓
                              one feedback scheduler
```

- `RouteProvider`: separate place search from routing. Keep provider/source, route revision, step geometry and ordered
  segment IDs. Return crossing segments only where evidenced, with entrance/exit/refuge connectivity when known.
- `CrossingContextProvider`: normalize OSM crossing types and tri-state attributes, preserve element IDs, retrieval
  time and geometry. Keep map assertions separate from observed signal phases and vehicles. A signal on another arm of
  the intersection must not become the target just because it is closer.
- `JourneyCoordinator`: own route progress, pending crossing ID, phase and feedback ownership. Proposed phases:
  `IDLE → WALKING → APPROACHING_CROSSING → AT_KERB → CROSSING → CONFIRM_FOOTPATH → WALKING`, plus paused/uncertain
  states and multiple crossing stages. A map event may enter APPROACHING only; it cannot enter CROSSING or confirm arrival.
- Localisation: retain timestamps and horizontal accuracy; reject stale/invalid fixes, reason over multiple observations,
  use hysteresis, and keep ambiguous sides unknown. Distinguish phone/camera orientation from pedestrian travel heading.
- Lifecycle: one start/stop owner, cancellable route requests, invalidation on reroute, no duplicate subscriptions,
  no stale event moving a newer journey. Losing network/map/location retains available manual crossing assistance.

### 10.6 Next increments and acceptance criteria

1. **Implemented: simplify daily tabs.** Run existing regressions plus help/back/mode-switch tests with an active crossing
   and a single mounted camera. TypeScript, lint and all 77 tests pass. The simulator Release build succeeds and was
   installed/launched. Visual UI inspection was blocked because the Mac was locked; physical VoiceOver, layout and
   micro-navigation checks remain unverified. This increment has not been installed on the physical iPhone.
2. **Correct known transition/recovery assumptions and prove the inputs.** Timer/stillness completion is removed in 10.8.
   Next replace missing-aim auto-start and straight-line off-route recovery in separate tested changes, maintaining Android core parity.
   Audit one short public test route before broad coordinator work. Record crossing identities, approach sides and data
   gaps; retain explicit user confirmation. Unknown map coverage must not be filled by a router's default assumptions.
3. **Build a minimal journey coordinator against verified fixtures.** Test one session across two crossings, refuge pause,
   GPS teleport, stale location, repeated approach events, cancellation, reroute and no routine route narration during
   crossing. Separate the route's expected crossing from the pedestrian's observed position and confirmed progress.
4. **Trial advisory approach announcements on that route.** Keep external providers behind the existing small boundary;
   do not build several provider adapters in advance. Test API failures, cancelled/out-of-order results,
   ambiguous destination, poor GPS and unavailable network. Repeated visits/reverse travel should select the appropriate
   segment without duplicate announcements. Measure missed and wrong-crossing triggers separately.
5. **Resume physical micro-navigation checks when the user is ready.** Install and verify the orientation fix, then live
   box alignment and moving-vehicle evidence. Automatic physical crossing start/end remains deferred until it is supported
   by the relevant field evidence. Unit tests and map records alone do not establish that capability.

### 10.7 Reassessment: feasible scope and evidence gaps

The earlier design was an architectural direction, not evidence that automatic navigation would work. It gave too much
weight to provider schemas and put coordinator construction ahead of checking real route inputs. Revised assessment:
one session and advisory crossing-approach prompts are feasible engineering targets; automatic pavement localisation,
signal-to-crossing association and far-footpath detection remain unproven research problems in this app.

**New evidence collected in the reassessment:**

1. Executed the actual `GuidanceManager` with a synthetic 12 m crossing. A stationary person was 8 m before its entrance.
   Two identical erroneous fixes about 15.3 m from the true position advanced the route past the crossing. Restoring the
   correct fix did not restore the missed segment. This demonstrates a current algorithm failure, not a measured iPhone
   failure rate. Run `node scripts/diagnose-navigation.cjs` from `mobile/` to reproduce. Output:

   | Input | Spoken instruction |
   |---|---|
   | Correct fix before near kerb | In 8 metres, go 12 o'clock. |
   | First displaced fix | In 1 metres, go 9 o'clock. |
   | Same displaced fix again | Continue 12 o'clock for 40 metres. |
   | Correct fix restored, person still before crossing | Continue 12 o'clock for 49 metres. |

   The same script shows a direct off-route bearing without checking walkable connectivity. Rotating only the phone
   changes “12 o'clock” to “9 o'clock” with no change in body direction. These outputs cannot be used as body-relative
   crossing instructions. Fixes must retain accuracy/age; repeated biased fixes are not independent proof of progress.
2. PPR's [way parser](https://github.com/motis-project/ppr/blob/master/src/preprocessing/osm/way_info.cc) defaults to
   generating left and right sidewalks for several road types when the relevant tags are absent. Its
   [sidewalk geometry](https://github.com/motis-project/ppr/blob/master/src/preprocessing/int_graph/sidewalks.cc) offsets
   road centrelines. Thus a returned sidewalk/crossing graph may include inferred geometry; it does not prove the physical
   pavement, kerb or crossing width. Remove the preferred-provider recommendation until a local provenance audit passes.
3. `SignalPhaseTracker.selectPrimary` selects by confidence, image centring, size and track maturity. It has no route-leg
   identity. At a multi-arm intersection, a well-detected green pedestrian signal could govern a different crossing.
   Map proximity plus model confidence cannot resolve this automatically. Until association is independently validated,
   label it an observed signal rather than asserting it controls the intended crossing.
4. Existing tests encode “standing still on the far side” without supplying evidence of which side the user is on.
   Passing that test establishes the programmed timer behaviour, not actual crossing completion. The 77 passing tests
   reported above are not navigation efficacy evidence.

The [GPS.gov accuracy guidance](https://www.gps.gov/gps-accuracy) explains that phone location accuracy varies and worsens
near buildings/trees. Its general typical figure is not a measurement or bound for this iPhone. A small reported accuracy
radius, filtering, or a map snap must not be treated as a guarantee of pavement identity. Google also explicitly notes
[missing pedestrian facilities in walking routes](https://developers.google.com/maps/documentation/routes/route-opt).

**First deliverable:** a foreground, supervised prototype on one short, independently checked route with one or two
simple crossings. Start once, announce a verified upcoming crossing once, retain manual crossing/footpath confirmation,
and resume route guidance only after that confirmation. An unmapped crossing remains available through manual assistance.
This still requires two short state confirmations per crossing; it reduces mode switching and repeated session setup,
but does not yet satisfy a completely hands-free requirement. Measure that interaction burden against manual assistance.
No mandatory initial left/right choice; optional user-reported side can help resolve ambiguity but does not persist as
truth after turns, reroutes or a lost fix. If approach side is unknown, do not select a specific crossing arm automatically.

Keep automatic *preparation* separate from starting the present signal-search loop: otherwise a route-long session could
continuously ask the user to aim at signals while simply walking along a pavement. The coordinator should activate only
the relevant feedback for the current phase. Explicit user entry into crossing mode must silence routine route prompts
even when a map trigger was missed. Do not infer which way the user should walk from the phone's scanning orientation.

**Go/no-go evidence before expanding beyond the checked route:**

- Surveyed crossing inventory and expected order, including entrances/exits and whether source geometry is explicit,
  generated or unknown. Route omissions and extra/incorrect crossings are failures, not merely missing annotations.
- Replay noise, sustained GPS bias, stale fixes, pass-by on the same pavement, opposite direction, a nearby unrelated
  signal, a refuge stop, and loss of network. None may auto-confirm entry/completion or skip an unconfirmed crossing.
- On held-out supervised approaches, record correct/missed/wrong crossing prompts, lead distance/time, duplicate prompts,
  manual corrections and task burden. Predeclare a useful lead window for that route, then measure it; do not invent a
  universal geofence or claim that a small test set with zero failures establishes general safety.
- Compare with manual-only assistance: if prompts repeatedly require clarification or arrive too late, retain manual
  activation and stop expanding automation. Test physical VoiceOver/volume shortcuts without requiring walking into a
  road just to validate UI or triggering.
- No claim about autonomous kerb detection, correct signal association, traffic clearance or far-footpath arrival until
  each has a separate evaluation. Deferring micro-navigation field testing also defers those end-to-end claims.

For the capstone deadline, prioritise this measured, bounded result and the outstanding vehicle pipeline validation over
a new hosted routing stack, general city-wide navigation, or additional vision models. No routing behaviour was changed
by this reassessment; the newly demonstrated defects remain implementation work.

### 10.8 Increment: explicit crossing completion — implemented 4 October 2026

Scope: remove the unsupported arrival inference, maintain iOS/Android engine parity, and make completion understandable.

- Crossing mode remains active during stillness, a refuge pause, prolonged walking and gaps in sensor updates. Neither
  the former five-second stillness rule nor the two-minute timeout ends it.
- **I’m on the footpath** explicitly ends crossing mode and returns to searching; feedback confirms that assistance is
  still on. The User screen and Guide explain that a refuge pause is not the far footpath. The existing optional volume-up
  shortcut still toggles crossing mode; it is a user action, not a detected arrival.
- On-screen controls send `START_CROSSING` or `END_CROSSING` explicitly. Repeated end commands before the screen updates
  are idempotent, instead of toggling straight back into crossing mode. Stopping assistance remains a separate cancellation
  and does not announce crossing completion.
- Existing automatic crossing-start heuristics are unchanged in this increment. Map handoff, GPS progress, body-versus-phone
  heading, signal association and moving-vehicle assessment are still pending. This is not an automatic-navigation release.

Validation: 82 iOS tests across eight suites, TypeScript and ESLint pass. Android's 49 JVM tests across eight suites and
`lintDebug` pass. Regressions cover refuge pauses, walking/stillness beyond two minutes, missing heading with a three-minute
sensor gap, hazards after a long pause, explicit volume-toggle completion, repeated completion, starting another crossing
without restarting assistance, and stopping assistance without claiming arrival. iPhone and simulator Release builds succeed.

The signed Release app is installed and launched on the connected iPhone 15 Pro. Its selected CrossWise model also passed
the saved-input check documented in section 9. Xcode screen sharing requires iOS 27 while this phone runs 26.6.1, so physical
UI interaction and spoken/tactile behaviour have not been verified remotely. Live-scene readiness was requested separately.
In the running simulator, crossing mode remained active for more than two minutes, footpath confirmation returned to
searching while assistance stayed on, another crossing could start immediately, and Stop assist returned to idle. The
normal-size button and refuge hint were visually inspected. At maximum text size the accessibility tree retained the
controls, but the computer-use tool could not scroll the window (`noWindowsAvailable`), so visual reachability at that
size is unverified. The simulator's original text size was restored and its assistance session stopped.


### 10.9 Increment: macro-navigation journey — implemented 4 October 2026

The user now reports that cars and other objects are detected and asked to proceed with macro navigation. That is
user-confirmed functionality, not a measured outdoor detection recall result. This increment targets the iPhone app;
Android's earlier core crossing-completion change is preserved, with no additional Kotlin engine changes.

Implemented flow: **search → choose place/address → review route → start journey → instruction confirmation → explicit
crossing handoff → resume route → confirm destination/end**. Go is present in both interface modes. The previous hidden
navigation toggle no longer controls availability. A missing Google key leads to Developer settings with setup guidance.
Places Text Search returns up to five named/addressed candidates; a selected place ID is sent to Routes with WALK mode.
Step polylines and named instructions replace the old phone-heading clock directions and global nearest-vertex advancement.
Provider warnings and Google Maps attribution appear alongside route content. All Google payload coordinates contain
only latitude/longitude; native accuracy and timestamp fields are kept out of provider request objects.

One journey starts assistance and keeps it available between crossings. Along the route, vehicle alerts remain enabled
according to the existing user setting, while signal-search/sonar/aiming narration is filtered. Assist or Crossing
assistance pauses route speech and restores micro guidance. Explicit far-footpath confirmation resumes the same route
instruction and returns to Go. The full instruction may extend beyond the crossing, so the app does not automatically
advance it. Heuristic crossing start is disabled while a journey exists (including a paused journey), without changing
the persisted setting. Volume down repeats the route instruction during ordinary walking.

The important limits are deliberate:

- GPS estimates distance within the current instruction only. It does not advance instructions, choose the pedestrian's
  side of the road, confirm a kerb/refuge/entrance, declare arrival or authorise crossing. Instruction and destination
  confirmations are explicit. Repeated callbacks for the same rendered instruction cannot advance twice.
- Fixes need finite coordinates, known accuracy of at most 25 m and age of at most 15 seconds. Implausible jumps and
  out-of-order fixes suspend distance estimates. Missing updates expire estimates. Off-route status does not draw or
  announce a straight line across a road. Replanning is explicit: end the journey, then search from the current footpath.
- Foreground location only. Backgrounding stops assistance and pauses the journey. An unfinished crossing stays recorded,
  even if it began while route guidance was already paused. Route resume requires far-footpath confirmation in that case.
- Requests and native location waits have deadlines. Cancellation invalidates old results; late native subscriptions are
  removed. There is no restart persistence, downloaded map, OSM crossing association or automatic mapped crossing handoff.
- A Google walking instruction remains provider advice, not a surveyed accessible route. The WALK warning is displayed.
  Routine navigation transitions cannot interrupt urgent vehicle speech. Backgrounding ordinary route walking announces that the journey is paused.

Validation: **121 tests across 11 suites**, TypeScript and ESLint pass. Tests include candidate identity/address selection,
explicit route start, provider request/response geometry, rejected malformed polylines, no credential leakage in service
errors, GPS drift across the synthetic 12 m crossing, GPS jumps/staleness/silence, cancellation and response races,
subscription failures/late cleanup, crossing speech suppression, background crossing persistence, explicit destination
confirmation, volume-repeat routing and urgent speech protection. `node scripts/diagnose-navigation.cjs` now reruns the
old 15 m drift counterexample against the new journey: all four fixes retain instruction index 0. These are synthetic
regressions, not recorded field performance. No new vision models or dataset changes were made.

Native validation and remaining field check:

- Simulator and signed iPhone Release builds succeed. The updated app is installed on the connected iPhone 15 Pro. Launch was denied because the device is locked; opening it on the phone remains a user action. The simulator setup screen was visually
  inspected: Go remains reachable without a key, Search is disabled, and Open settings reaches Developer settings with
  the Google Maps key field. User mode was restored after the check.
- The connected iPhone configuration has **no Google Maps key**. Live Places/Routes success, spoken guidance outdoors,
  location accuracy on the intended route and physical VoiceOver use are **not yet verified**. No sample route is passed
  off as a real route. Xcode screen sharing remains unavailable for this iOS version.
- Next: configure Places API (New)/Routes API and billing, choose a known public start/destination, then verify destination
  identity, each instruction, poor-location behaviour and crossing handoffs on that route. Do not add automatic crossing
  triggers until actual crossing topology, approach direction and signal association are evaluated for the test area.

Implementation references: `mobile/src/nav/navigation.ts` (Google provider/geometry), `journey.ts` (session/progress),
`location.ts` (foreground adapter/deadlines), `feedbackPolicy.ts` (route cue filtering), `state/controller.ts` (micro handoff),
and `ui/NavigateScreen.tsx` (accessible route flow). Provider references checked for this implementation:
[Expo 57 Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/),
[Google Routes response fields](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes),
[Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search), and
[Routes attribution](https://developers.google.com/maps/documentation/routes/policies).

## 11. Split-screen redesign based on BlindHelperApp — plan, 4 October 2026

The full [BlindHelperApp review and redesign plan](BLINDHELPER_REVIEW_AND_REDESIGN.md) records active features,
partially wired experiments, code defects, the feature-removal decisions and acceptance gates.

The intended screen has native Google Maps and route context above the existing camera/micro guidance. One journey
owns the controls and speech. Keep the User/Developer presentation choice, working vehicle detection, explicit crossing
completion, location-quality checks and cancellation guarantees. Remove phone key editors and volume interception;
load the existing `.env` automatically during configuration/build. Bring over voice destination search and shared route
context, with destination/address confirmation. Do not copy nearest-vertex steering, depth-gated detection, AI-generated
movement permission or cloud requests that suspend local detection.

Implementation order: (1) `.env` configuration and hardware-control cleanup; (2) native map and split screen;
(3) unified controls and voice destination input; (4) validated progress to reduce routine confirmations;
(5) optional scene description, then separately evaluated depth. Test and install one increment at a time.

No application code was changed by this review. The `.env` variable names and nonempty presence were checked without
printing their values; credentials and live API access have not been validated in this planning pass.

## Sources

* Model tests: 22 photos from Wikimedia Commons (listed with licences in the appendix), run 30 Sep 2026 with
  `crosswise_v1_best.tflite`, `yolo26n.tflite`, `an-seg-new2.tflite`.
* [Safety-oriented sidewalk and road segmentation for smartphone-based assistive navigation (arXiv 2607.21137)](https://arxiv.org/abs/2607.21137)
* [SydneyScapes: image segmentation for Australian environments (arXiv 2504.07542)](https://arxiv.org/abs/2504.07542)
* [Mapillary Vistas dataset](https://www.mapillary.com/dataset/vistas)
* [OSM Key:traffic_signals:sound](https://wiki.openstreetmap.org/wiki/Key:traffic_signals:sound),
  [Australian tagging guidelines](https://wiki.openstreetmap.org/wiki/Australian_Tagging_Guidelines/Cycling_and_Foot_Paths)
* [Vision Australia: history of the PB/5 button](https://www.visionaustralia.org/community/news/2023-02-02/history-pb5-crosswalk-button),
  [Vision Australia: getting around safely](https://www.visionaustralia.org/information/living-independently/getting-around-safely)
* [NSW Guide Dogs: automated audio tactile signals](https://nsw.guidedogs.com.au/news/new-automated-audio-tactile-pedestrian-signals-in-nsw-to-reduce-risk-of-contracting-covid-19/)
* [ADR 113 acoustic vehicle alerting](https://minister.infrastructure.gov.au/c-king/media-release/new-ev-and-hybrid-rules-improve-pedestrian-safety),
  [MUARC](https://www.monash.edu/muarc/news-and-events/articles/new-safety-rule-requiring-sound-alerts-on-electric-vehicles-takes-effect,-informed-by-muarc-research)
* [Street crossing by sighted and blind pedestrians at a modern roundabout](https://www.researchgate.net/publication/228666397_Street_Crossing_by_Sighted_and_Blind_Pedestrians_at_a_Modern_Roundabout)
* [Australian Road Rules 231](https://classic.austlii.edu.au/au/legis/sa/consol_reg/arr210/s231.html),
  [234](https://classic.austlii.edu.au/au/legis/sa/consol_reg/arr210/s234.html)
* [Depth Anything V2 Core ML](https://huggingface.co/apple/coreml-depth-anything-v2-small)
* [iPhone 15 Pro tech specs (ultra-wide 120°)](https://support.apple.com/en-us/111829)
* [TfNSW pedestrian crossing delineation (3.6 m crossings)](https://standards.transport.nsw.gov.au/_entity/annotation/9981b225-9b39-ed11-9db1-000d3ae019e0)

## Appendix: Australian test photos (Wikimedia Commons)

Vehicles / people found at threshold 0.35. "Signal" lists pedestrian-signal classes the trained model reported.

| # | Photo | Licence | Trained: veh / ppl | COCO: veh / ppl | Signal (trained) |
|---|---|---|---|---|---|
| 00 | George Street looking north, Sydney (NSW) (9267484200).jpg | No restrictions | 1 / 0 | 13 / 3 | — |
| 01 | King Street Lonsdale Street intersection cars stopped 2010-11-22.jpg | CC BY-SA 4.0 | 5 / 2 | 3 / 2 | — |
| 02 | Crown Street, Wollongong 20220619110018.jpg | CC0 | 1 / 2 | 1 / 2 | — |
| 03 | Traffic at intersection-Brisbane City street with tram lines and traffic. 1066N.jpg | PDM-owner | 1 / 0 | 2 / 0 | — |
| 04 | Zebra crossing and traffic bollards in Brisbane Airport, Queensland.jpg | CC BY-SA 4.0 | 0 / 0 | 0 / 1 | crosswalk |
| 05 | Dean Street pedestrian crossing, Albury NSW.jpg | CC BY-SA 4.0 | 5 / 0 | 3 / 1 | crosswalk |
| 06 | Pedestrian Crossing Cover Sydney 2020.jpg | CC BY-SA 4.0 | 3 / 0 | 3 / 0 | — |
| 07 | Pedestrian crossing Adelaide St and Edward St Brisbane P1450430.jpg | CC BY-SA 4.0 | 5 / 8 | 5 / 11 | — |
| 08 | Pedestrian crossing Hamilton Rd and Corrie St Chermside P1440412.jpg | CC BY-SA 4.0 | 1 / 0 | 2 / 2 | — |
| 09 | Pedestrian crossing on Lonsdale Street Braddon September 2024.jpg | CC BY-SA 4.0 | 4 / 5 | 4 / 7 | — |
| 10 | Salisbury Interchange Pedestrian Crossing Towards Stockade Tavern 20240606.jpg | CC0 | 1 / 0 | 1 / 0 | crosswalk |
| 11 | AUS Sydney, Central Business District, Circular Quay West 006.jpg | CC BY 4.0 | 0 / 7 | 0 / 8 | crosswalk |
| 12 | Pedestrian and cyclist crossing at the intersection of President Avenue and Auburn Street.jpg | CC BY 4.0 | 4 / 0 | 3 / 0 | — |
| 13 | Kent St, Sydney after short rain - panoramio.jpg | CC BY-SA 3.0 | 0 / 1 | 1 / 1 | — |
| 14 | Rain in Sydney.jpg | CC BY 2.0 | 8 / 0 | 7 / 0 | — |
| 15 | Rain in Sydney (2).jpg | CC BY 2.0 | 8 / 0 | 7 / 0 | ped_red |
| 16 | Sydney Central in the Rain (11321727685).jpg | CC BY 2.0 | 1 / 8 | 3 / 7 | ped_green |
| 17 | Murray Street and Roberts Street roundabout, Bayswater, Western Australia, October 2021.jpg | CC BY-SA 4.0 | 2 / 0 | 0 / 0 | — |
| 18 | Canberra road lights.jpg | CC BY 2.0 | 0 / 0 | 0 / 0 | — |
| 19 | Part of a one way section of Doonkuna Street Braddon February 2021.jpg | CC BY-SA 4.0 | 0 / 0 | 0 / 0 | — |
| 20 | Centrepoint Car Park, Pulteney Street and Rundle Street, Adelaide, February 2023.jpg | CC BY-SA 4.0 | 3 / 4 | 0 / 6 | ped_red |
| 21 | George Street, Sydney (4079202892).jpg | CC BY 2.0 | 1 / 7 | 0 / 4 | — |
