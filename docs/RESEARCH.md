# CrossWise — research summary (September 2026)

Goal of this review: find what already exists for helping blind and low-vision (BLV) people cross roads,
what current technology makes possible on a phone, and where a one-month capstone can add something new instead of
repeating existing work.

## 1. Existing products

| Product | What it does for crossing | Gap we noticed |
|---|---|---|
| **OKO** (AYES, Belgium) | Real-time pedestrian-signal detection with audio, haptic and color feedback; works offline; tells users when they appear to veer; turn-by-turn maps (US, Canada, Japan, Spain, Belgium). Free since July 2025 (v4.7.5), App Store Editors' Choice. [App Store](https://apps.apple.com/us/app/oko-cross-streets-and-maps/id1583614988), [Forbes 2023](https://www.forbes.com/sites/gusalexiou/2023/08/10/oko-app-deploys-ai-to-make-crossing-the-street-safer-for-blind-pedestrians/) | **iPhone only** ("Only for iPhone", iOS 17+). Closed source. AppleVis users report there is no tilt-up alert, so feedback stops as the signal leaves the view while approaching the far side ([AppleVis](https://www.applevis.com/apps/ios/navigation/oko-cross-streets-maps)). |
| **Ampel-Pilot** (Germany) | Red/green pedestrian-light detection (YOLOv2) with speech and vibration, on iOS and Android. [Play](https://play.google.com/store/apps/details?id=org.tensorflow.ampelpilot) | Old model generation. Its dataset download links return HTTP 404 (checked 17 Sep 2026). |
| **Google Guided Vision** (Gemini Live) | Camera + Gemini describes the scene, announced September 2026. [Centre for Accessibility](https://www.accessibility.org.au/google-introduces-guided-vision-for-blind-and-low-vision-android-users) | Google states it "is not intended to be used as a mobility aid, for navigation or for detecting obstacles". General scene description is covered; safety-critical crossing guidance is explicitly not. |
| **Be My Eyes / Meta AI glasses** | Human volunteers or AI describe the camera view hands-free. [Meta](https://www.meta.com/ai-glasses/blind-visually-impaired/) | Not real-time signal tracking; depends on network and humans. |
| **Soundscape** (Microsoft → Scottish Tech Army) | 3D-audio beacons and map callouts; Android beta in 2026. [STA](https://www.scottishtecharmy.org/soundscape), [GitHub](https://github.com/Scottish-Tech-Army/Soundscape-Android) | Orientation by map only: no signal or vehicle detection. |
| **PedApp** (Polara), **Signalyst** | Push-button activation / signal timing from connected infrastructure. [Polara](https://polara.com/pedapp) | Only where the city installed compatible hardware. |
| Smart canes and robots (WeWALK 2, Glidance Glide) | Obstacle detection, navigation. [TechCrunch](https://techcrunch.com/2025/01/10/these-startups-are-making-smarter-canes-for-people-with-visual-impairments) | Expensive dedicated hardware; not signal-aware. |

## 2. Research systems

* **Ismail & Mousa, AAAI Summer Symposium 2025 (Heriot-Watt)** — the closest academic Android work: *two separate apps*,
  one with YOLOv11 + MiDaS depth for vehicles, one with YOLOv11n for red/green pedestrian lights (blind-assist1 dataset,
  ~1.2k signal instances), 305–315 ms per frame on a Snapdragon 765G, speech like "Safe to cross". Their own limitations:
  relative (not metric) depth, users must switch apps manually between signalized and unsignalized crossings, small
  sample, fair weather only. [paper](https://ojs.aaai.org/index.php/AAAI-SS/article/download/36057/38212)
* **VisionAid, CHI 2026 Extended Abstracts (Bangladesh)** — CameraX app with obstacle, signal and crossing detection,
  speech such as "Vehicles present, be careful" / "Safe to cross", intensity-coded haptics. [ACM](https://dl.acm.org/doi/10.1145/3772363.3798801)
* **Cross-Assist, 2024** — Flutter + YOLOv2-tiny: red 89.5 %, green 89.1 %, crosswalk 88.6 % accuracy. [DergiPark](https://dergipark.org.tr/en/pub/tjse/issue/88689/1447019)
* **LYTNet / ImVisible, 2019** — MobileNetV2 classifier for 5 signal classes plus a zebra-crossing midline, 21 FPS on
  iPhone 7; releases the 5,059-image PTL dataset (MIT license). Averages 5 frames and needs 0.8 probability before
  speaking. [GitHub](https://github.com/samuelyu2002/ImVisible), [arXiv](https://arxiv.org/abs/1907.09706)
* **Cross-Safe (NYU, 2020)** — pedestrian-signal recognition on a Jetson TX2 wearable. [NYU](https://nyuscholars.nyu.edu/en/publications/cross-safe-a-computer-vision-based-approach-to-make-all-intersect)
* **Crosswatch (Smith-Kettlewell)** — GPS + computer vision + GIS to find the intersection, align to the crosswalk and
  read walk lights. [SKI](https://www.ski.org/project/crosswatch/)
* **StreetNav (Columbia, UIST 2024)** — uses existing street cameras; continuous audio-haptic feedback reduced veering.
  [arXiv](https://arxiv.org/abs/2310.00491)
* **Hough-space crossing detection (Yoshikawa & Premachandra, 2023)** — 98.5 % day / 95 % night on Jetson Nano; fails
  when markings are worn. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10346231/)
* **VLM-based walking assistance** — WalkVLM (12k video–annotation pairs, ICCV 2025) and GuideDog (22k image–description
  pairs, 46 countries) show the trend toward multimodal LLMs, but also the latency and redundancy problems of streaming
  VLMs. [WalkVLM](https://arxiv.org/abs/2412.20903), [GuideDog](https://arxiv.org/abs/2503.12844)
* **GPT-4V street-crossing risk scores (Hwang et al., 2024)** — promising scene reasoning, no real-time evaluation.
  [arXiv](https://arxiv.org/abs/2402.06794). **"VLMs are blind" (2024)** — state-of-the-art VLMs fail simple low-level
  visual tasks. [arXiv](https://arxiv.org/abs/2407.06581)
* Open-source student projects exist (e.g. [YOLOv5 crosswalk/light, Korea](https://github.com/kairess/crosswalk-traffic-light-detection-yolov5),
  [Flutter crosswalk-deviation classifier](https://github.com/ssong2332/crossWalk)); they classify single frames.

## 3. What BLV travelers and O&M practice tell us

* **Timing matters, not just color.** The most common technique is to start crossing at the *surge of parallel traffic*,
  i.e. at the onset of the walk interval. Right-turn-on-red and leading pedestrian intervals break that cue; accessible
  pedestrian signals (APS) fix it but are missing at most intersections. [APS guide](http://www.apsguide.org/appendix_d_understanding.cfm),
  [ACB](https://www.acb.org/content/modern-signalized-intersections)
* **Countdown displays** were essentially unreadable for participants with severe visual impairment.
  [Scott et al. 2012](https://doi.org/10.3141/2299-07)
* **Veering** out of the crosswalk is common; vibrotactile and continuous audio-haptic feedback reduce it.
  [Guth et al. 2017](https://doi.org/10.3141/2661-05), [StreetNav](https://arxiv.org/abs/2310.00491)
* **Apps are rarely used for crossing.** A 2025 study reports AI camera apps being valued for identifying objects and GPS
  apps for planning routes, while participants often used no app at all for street crossings or obstacle detection.
  [Disabil. Rehabil. Assist. Technol. 2025](https://doi.org/10.1080/17483107.2025.2544942)
* **Research–need mismatch.** Only a weak correlation between what 24 BLV participants rated important and what 646 papers
  studied; participants preferred conversational interfaces and head-mounted devices. [Gamage et al. 2025](https://arxiv.org/abs/2505.19325)
* **Less talk, more signal.** Streaming AI assistants overload the serial auditory channel; recommended principles are
  continuity, conciseness and calibrated honesty. [Zhao et al. 2026, arXiv:2511.00945](https://arxiv.org/abs/2511.00945)
* Haptic design is still an open question (location, encoding). [Jiang, Kuang & Fan 2024](https://arxiv.org/abs/2412.19105)

## 4. Technology available now

* **YOLO26** (Ultralytics, Jan 2026): NMS-free end-to-end head, YOLO26n has 2.4 M params and 40.9 COCO mAP; exports to
  LiteRT with `format="litert"` (Linux/macOS exporter). [docs](https://docs.ultralytics.com/models/yolo26/). License AGPL-3.0
  (fine for an open academic project; commercial use needs an Enterprise license).
* **LiteRT 2.x** on Android: the CompiledModel API with GPU/NPU acceleration, the Interpreter API still available.
  [Google](https://developers.google.com/edge/litert/android)
* **Smart-glasses cameras for third-party apps**: Meta Wearables Device Access Toolkit (developer preview Dec 2025)
  streams the Ray-Ban Meta camera to Android apps. [GitHub](https://github.com/facebook/meta-wearables-dat-android)
* **OpenStreetMap crossing tags** (`crossing=traffic_signals|uncontrolled|unmarked`, `crossing:island`,
  `traffic_signals:sound`, `button_operated`, `tactile_paving`, `kerb`) can describe an intersection before arrival.
  [OSM wiki](https://wiki.openstreetmap.org/wiki/Key:crossing)
* **Audio event models** (YAMNet via MediaPipe) recognize sirens and horns on-device. [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/audio/audio_classifier)

### Datasets
| Dataset | Content | Access / license | Usable how |
|---|---|---|---|
| [VIDVIP](https://github.com/TetsuakiBaba/VIDVIP) (Japan, 2021) | 30–32k sidewalk eye-level images; YOLO boxes; `signal_red` 2,217 and `signal_blue` 1,577 pedestrian-signal boxes, `crosswalk` 17,586, people and vehicles; class ids 0–16 identical in every class list | [application form](https://tetsuakibaba.jp/project/vidvip/); CC BY-NC-ND 4.0 | Best match, no labeling: `prepare_vidvip.py` |
| [DTLD](https://www.uni-ulm.de/en/in/institute-of-measurement-control-and-microtechnology/research/data-sets/driveu-traffic-light-dataset/) (Germany, 2018) | 230k traffic-light boxes from a car camera at 15 Hz; `pictogram: pedestrian` + `state` red/green/off; `track_id`; 12-bit Bayer TIFFs ([parser](https://github.com/julimueller/dtld_parsing)) | registration; research and teaching | Pedestrian lights + vehicle lights as hard negatives: `convert_dtld.py` |
| [Mapillary Vistas v2.0](https://www.mapillary.com/dataset/vistas) (worldwide) | 25k images, 124 classes incl. "traffic light – pedestrians" outlines (no state) | Mapillary account or [Dataset Ninja](https://datasetninja.com/mapillary-vistas-dataset) (21 GB); CC BY-NC-SA 4.0 | Many countries' designs; state from lit pixels + detector vote: `convert_vistas.py` |
| ImVisible PTL | 5,059 Shanghai photos; image-level phase (red, green, countdown green, countdown blank, none) + zebra midline; MIT | direct | Weak-label mining to boxes; image-level benchmark comparable with LYTNet |
| Roboflow Universe sets | Many small box-labeled sets (hundreds to ~1.5k images) with ped lights / crosswalks | free account; licenses vary | Quick start (verify license and class names per set) |
| [Mendeley PTL](https://data.mendeley.com/datasets/9tm59d3nsn/1) | 809 web images, red/green per image | CC BY 4.0 | Small; classification only |
| Ampel-Pilot | 3,696 German ped-light images | download links dead (Sept 2026) | — |
| COCO | People and vehicles | CC BY 4.0 | Teacher model for pseudo-labels |
| **Your own recordings** | Local signal designs, traffic mix, night/rain | — | Auto-label + review: the only honest test set for your city |

**Auto-labeling tools checked:** [SAM 3](https://docs.ultralytics.com/models/sam-3) (text-prompted detection, segmentation and
video tracking; gated weights) and [YOLOE](https://docs.ultralytics.com/models/yoloe/) (open-vocabulary YOLO with text prompts).
General-purpose vision-language models often misread facility states ([arXiv 2601.10551](https://arxiv.org/abs/2601.10551)), so
CrossWise uses open-vocabulary models only as a second opinion for *missed boxes*, never to decide red vs green.

## 5. Positioning: what CrossWise adds

1. **Android, on-device, open**: the best-known crossing app (OKO) is iPhone-only and closed.
2. **Phase-aware, not frame-aware**: tracks one signal over time and tells *fresh* walk ("just came on") from walk of
   unknown age ("may end soon"), detects flashing clearance intervals from the on/off rhythm, and uses asymmetric
   confirmation (announcing WALK needs more evidence than DON'T WALK). None of the surveyed apps or papers do this beyond
   averaging a few frames.
3. **The whole crossing in one app with automatic mode changes** — aim → wait → walking detected → crossing → arrival —
   instead of separate tools the user must switch between (a limitation reported by Ismail & Mousa 2025).
4. **Looming-based vehicle alerts**: time-to-contact from how fast a vehicle's image grows. No depth network, fires for
   vehicles coming *toward* the user and stays silent for traffic passing across the view.
5. **Veer guard from the gyroscope** (no compass, so steel and cars do not disturb it), with left/right earcons.
6. **Honest wording**: never "safe to cross"; unverified results are labeled; a safety notice before first use.
7. **Hands-free**: volume keys, chest mount, stereo earcons, a distinct vibration per event.
8. **Data-centric training**: no hue augmentation (color is the label), COCO-teacher pseudo-labels for unlabeled
   traffic, weak-label mining from ImVisible, and a red→green confusion metric reported for every model.
