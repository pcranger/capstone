# CrossWise — 4-week plan, scope cuts, and test protocol

Start: Thu 17 Sep 2026 · Code freeze: Tue 13 Oct · Demo/report: Thu 15 Oct.

## What is already built (week 0)

| Area | Status |
|---|---|
| Android app skeleton: CameraX, LiteRT GPU/CPU detector, model import, settings, safety notice, CSV logging | ✅ builds, lint clean |
| Signal phase tracker (evidence, asymmetric dwell, flashing, fresh walk, lost) | ✅ unit-tested |
| Tracker with gyro compensation, looming time-to-contact, hazard alerts | ✅ unit-tested |
| Heading/pitch, walking detector, veer guard, aiming sonar, tilt hints | ✅ unit-tested |
| Crossing mode state machine with automatic crossing start/end | ✅ unit-tested (end-to-end scenario) |
| Feedback: prioritized TTS, stereo earcons, haptic vocabulary | ✅ compiles; needs on-phone tuning |
| ML pipeline: dataset merge, pseudo-labels, ImVisible mining, training, LiteRT export, ImVisible benchmark | ✅ end-to-end smoke run green on Kaggle (synthetic data) |
| No-hand-labeling tools: VIDVIP / DTLD / Vistas converters, video auto-labeler, keyboard review page | ✅ tested on synthetic data in each real format |
| Kaggle runner: uploads `ml/`, pushes the notebook, brings back models and reports | ✅ `scripts/kaggle_run.py run --mode smoke` |
| Trained CrossWise model | ⏳ week 1 (you run `--mode full` on real data) |
| Any test on a real phone or street | ⏳ week 1+ |

## Week 1 (17–23 Sep): first model on a real phone

* [ ] **Day 1: request VIDVIP access and register for DTLD** (approvals take days; links in `ml/configs/sources.example.yaml`).
* [ ] Install the app on 2 phones (one mid-range). Run `python scripts/kaggle_run.py run --mode smoke` for the COCO
      baseline and import `yolo26n.tflite` on the phone: check FPS, GPU vs CPU, preview overlay, speech/tones/vibration.
* [ ] Create the Roboflow account, choose 3–6 datasets in `configs/sources.yaml` (check licenses and class mapping).
* [ ] Start the Mapillary Vistas download (`fetch_datasets.py --only vistas_ninja`) while waiting for VIDVIP/DTLD.
* [ ] Record local video from the sidewalk (protocol below): ≥ 5 intersections, red→green transitions, flashing, night.
* [ ] Train v0 on whatever has arrived (`kaggle_run.py run --mode full --gpu`).

## Week 2 (24–30 Sep): the real model and threshold tuning

* [ ] Add VIDVIP / DTLD when approved; mine ImVisible and re-convert Vistas with the v0 vote; train v1 (steps 4–5).
* [ ] Auto-label your videos and review every frame of the test set with the A/F/R keys (roughly
      15 minutes per 300 frames instead of hours of drawing). Report the auto-label precision from `review_summary.json`.
* [ ] Evaluate v1 on your reviewed test set and on ImVisible (step 7).
* [ ] Curb-side field sessions with logging on: compare the CSV with the video to measure phase latency, false WALK,
      flashing detection, "fresh" correctness. Tune `SignalPhaseTracker.Config` and `HazardMonitor` thresholds.
* [ ] Veer guard test in a closed area: walk 15 m along a taped line with the phone chest-mounted, eyes closed, with a
      sighted spotter; measure lateral error with and without guidance.

## Week 3 (1–7 Oct): one stretch feature + user feedback

Pick at most one or two (in order of value/effort):

1. **OSM pre-brief** (~2 days): when a `crossing=traffic_signals` node is within 30 m, say "Signalized crossing ahead,
   with island, accessible signal" from `crossing:island`, `traffic_signals:sound`, `button_operated` (Overpass API, cached).
2. **Crosswalk stripe alignment** (~3 days, riskier): stripe orientation inside the `crosswalk` box + pitch → crossing
   direction on the ground plane → heading lock aimed along the crosswalk instead of the user's current heading.
3. **Siren / horn alerts** (~1 day): MediaPipe YAMNet on the microphone, "Siren nearby".
4. **Wear OS haptics** (~2 days): vibration on the wrist when the phone is in a chest mount.

In parallel: interview an O&M instructor and, if possible, 2–5 BLV users about wording, tones and vibration patterns
(interviews and demos at a table — no street trials without proper supervision).

## Week 4 (8–15 Oct): evaluation and delivery

* [ ] Final model; complete metrics table (below); battery and thermal test (20 min continuous).
* [ ] Demo video (sighted presenter at the curb; overlay + captions), report, slides.
* [ ] Code freeze 13 Oct; buffer 14 Oct.

## Cut or deferred (not feasible or not wise in one month)

| Idea | Why not now |
|---|---|
| VLM "describe this intersection" (Gemini/Claude) | Google Guided Vision now covers general scene description on Android; streaming VLM latency, cost and hallucinations are unsuitable for crossing decisions. Future: offline questions like "where is the push button?" |
| Unsignalized crossing "gap is safe" advice | Would require judging speed and distance of all lanes with a ~40° camera: unsafe to promise. We only announce approaching vehicles. |
| Monocular depth network (MiDaS etc.) | Looming time-to-contact gives what matters without a second model; depth doubled latency in prior work. |
| Countdown digit reading | Needs digit-level labels that no dataset has; OCR on LED digits is unreliable. Add `ped_countdown` + OCR after collecting data. |
| Smart-glasses camera (Meta Wearables DAT) | Developer preview; hardware and approval time. Strong future direction (hands-free, head-level view). |
| Background / screen-off operation | Needs a camera foreground service and battery work. For now the screen stays on and assist stops in background. |
| iOS version, crowdsourced intersection database | Out of scope for one person-month. |
| Street-crossing trials with BLV participants | Needs ethics approval and O&M supervision; plan it as future work. |

## Evaluation metrics

| Level | Metric | How |
|---|---|---|
| Detector | mAP50 / mAP50-95 per class; red boxes predicted green (%) | `train.py` report on local test set |
| Detector | Image-level phase accuracy on ImVisible test vs LYTNet | `eval_imvisible.py` |
| Data | Auto-label precision (frames accepted unchanged / reviewed) | `review_summary.json` |
| Temporal | WALK / DON'T WALK announcement latency (s) | log vs annotated video |
| Temporal | **False WALK announcements per hour (target 0)** | log vs video, all sessions |
| Temporal | Flashing detected (precision/recall); fresh-walk correctness | log vs video |
| Hazards | Alerts for approaching vs passing vehicles; false alarms / min | recorded curb sessions |
| Veer | Lateral error at 15 m with vs without guidance | taped line, closed area |
| System | FPS, inference ms, battery %/20 min, device temperature | 2 phones |
| UX | SUS, feedback on wording/tones from O&M instructor / BLV advisors | interviews |

## Safety protocol for all testing

* **Nobody crosses a real street blindfolded or "trusting the app".** Street sessions happen on the sidewalk; testers do
  not step into the road because of an app message.
* Veer tests only in closed areas (parking lot, sports field) with a sighted spotter.
* Recording in public: film traffic, not faces; blur faces before sharing; keep raw videos private.
* Every demo states that CrossWise is an aid, not a mobility tool replacement.
