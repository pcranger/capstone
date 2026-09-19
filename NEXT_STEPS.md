# What you need to do

Your checklist for the CrossWise capstone, in order. Code freeze **Tue 13 Oct 2026**, demo and report **Thu 15 Oct 2026**.
Background: [README.md](README.md) · [docs/ROADMAP.md](docs/ROADMAP.md) · [ml/README.md](ml/README.md).

Training runs on **Kaggle**, driven from your own machine: no browser, no Google Drive. One command uploads the `ml/`
folder, runs the notebook on Kaggle's hardware and downloads the results into `ml/kaggle_output/`.

## What your two downloads actually contain

I read both of them (structure, label vocabulary, box sizes) and converted them. The numbers below are measured, not
estimated.

| | VIDVIP | DTLD (Bochum, Bremen, Fulda) |
|---|---|---|
| What you downloaded | 30,471 images + YOLO labels, 13.5 GB | 1,774 frames (12-bit raw TIFF), ~6 GB |
| Images with a pedestrian signal | **3,520** (2,071 red, 1,510 green) | 356 |
| Crosswalk images | 8,133 | none labeled |
| After conversion | **9,753 images** (8,582 train / 1,171 val), 2.0 GB | **193 images**, 14 MB |
| Signal boxes it contributes | **3,794** — every one in the dataset (2,218 red, 1,576 green) | 187 (68 red, 119 green) |
| Camera | sidewalk, eye level — *exactly your app's view* | car windscreen, signals far away |

**VIDVIP is the project.** DTLD is a useful second opinion (another country, another camera, plus vehicle lights as
hard negatives) but it is a garnish: 193 images against 9,753.

### Why DTLD shrank so much, and what I got wrong

- 2,400 of its pedestrian-light boxes have state `unknown`. Those frames are **skipped on purpose**: labeling only the
  boxes we are sure about would teach the model that a lit signal is background, which is the one mistake this project
  must never make.
- Its signals are tiny (median 23 px in a 2048×1024 frame), so the converter now crops a 640 px window around them.
  They end up a median of 24 px tall at training size — the size a phone actually sees.
- **My earlier advice to grab the three smallest cities was wrong.** Now that the labels are on disk I could rank all
  11 cities by pedestrian frames per gigabyte:

  | Best value | GB | frames kept | per GB | | Worst value | GB | frames kept | per GB |
  |---|---|---|---|---|---|---|---|---|
  | **Bochum** ✅ you have it | 1.9 | 126 | 66 | | Kassel | 8 | 186 | 23 |
  | **Frankfurt** | 17 | 1,123 | 66 | | **Fulda** ❌ you have it | 2.1 | 27 | 13 |
  | Duesseldorf | 18 | 1,017 | 56 | | **Bremen** ❌ you have it | 2.0 | 25 | 12 |

  Bochum was a good pick; Bremen and Fulda are the two emptiest cities in the whole dataset. Nothing is lost — they
  cost 4 GB of disk and 5 minutes of conversion.
- **Decide now:** if you want DTLD to carry real weight, download **Frankfurt** (17 GB → ~1,100 more frames) and
  re-run the conversion command below with `--cities Bochum Frankfurt Bremen Fulda --val-cities Bremen Fulda`.
  Otherwise skip it — it is a paragraph in your report either way, and your time is better spent on your own videos.

## Today — done for you (19 Sep)

Everything in this section is already run; the commands are here so you can repeat them.

- [x] **Both datasets converted.** DTLD → `ml/data/raw/dtld_yolo` (193 images), VIDVIP →
      `C:/Users/HP/crosswise-data/vidvip_yolo` (9,753 images, 2.0 GB, deliberately outside OneDrive so it does not
      sync to the cloud). Re-run only if you add a city:
      ```bash
      cd ml
      python scripts/convert_dtld.py --dtld ../DTLD --labels ../DTLD/DTLD_Labels_v2.0 --cities Bochum Bremen Fulda --stride 2 --val-cities Fulda --out data/raw/dtld_yolo
      python scripts/prepare_vidvip.py --src "../VIDVIP/dist/vidvipo_full_2023_05_27/vidvipo_full_2023_05_27" --out C:/Users/HP/crosswise-data/vidvip_yolo
      ```
- [x] **Roboflow key used — and two of the three sets rejected.** I downloaded all three with your key and looked at
      them before letting them near training:

  | Set | Verdict |
  |---|---|
  | `pedestrian-traffic-light-puf4a` | **Kept.** 926 images, CC BY 4.0 → 887 usable, adding 174 red + 768 green boxes |
  | `aid-for-the-blind` | Rejected: 15 images, one class literally named `0` |
  | `zebra-cross-dataset` | Rejected: 40 images of "crossing clear / vehicle detected" decisions, not objects |

  The kept set boxes the signal *head* with a state-less class next to the lit lamp. Dropping those boxes would teach
  the model that a lit signal is background, so `build_dataset.py` now skips any image where a head has no red or green
  box inside it — 39 images went out that way.
- [x] **Three private Kaggle datasets uploaded**: `pcranger/vidvip-yolo`, `pcranger/dtld-yolo`,
      `pcranger/rf-pedestrian-traffic-light`. The notebook finds them by name, so there are no paths to edit.
      The command for any folder (your videos, later): `python scripts/kaggle_run.py dataset --path <folder> --slug <name>`
- [x] **Training launched** on Kaggle with all three attached:
      ```bash
      python scripts/kaggle_run.py run --mode full --gpu --epochs-v0 40 --epochs-v1 80 --dataset pcranger/vidvip-yolo --dataset pcranger/dtld-yolo --dataset pcranger/rf-pedestrian-traffic-light
      ```
      40/80 epochs instead of the 60/120 default: roughly four GPU-hours out of your 30 a week, and you can train
      longer once the numbers say it is worth it. Progress: https://www.kaggle.com/code/pcranger/crosswise-full

### What the training set now contains

| Source | Train images | ped_red | ped_green | crosswalk |
|---|---|---|---|---|
| VIDVIP (Japan, sidewalk) | 8,582 | 1,916 | 1,416 | 14,748 |
| Roboflow PTL (Europe) | 699 | 137 | 606 | 0 |
| DTLD (Germany, car) | 166 | 57 | 108 | 0 |
| **validation** | 1,386 | 350 | 333 | 2,838 |

The Roboflow set's green skew cancels VIDVIP's red skew: 2,460 red against 2,463 green overall.

### Left for you

- [ ] **If the run failed with "No GPU"**: phone-verify at kaggle.com/settings, then tell me and I will re-push.
      A Kaggle notebook cannot use a GPU or the internet until the account is verified.
- [ ] **Put a model on the phone.** `ml/kaggle_output/artifacts/yolo26n.tflite` is the COCO baseline you can import
      right now (vehicles and generic lights, colors unverified); `crosswise_v1_best.tflite` from this run is the real
      one. In the app: **Settings → Import .tflite model**.
- [ ] **Optional, later**: download DTLD **Frankfurt** (17 GB → ~1,100 more frames, the best value after Bochum) and
      re-run the conversion with `--cities Bochum Frankfurt Bremen Fulda --val-cities Bremen Fulda`.
- [ ] **Optional**: delete `VIDVIP/dist/vidvipo_10000_2023-0507/` (~3 GB). It is a subset of the full set — same
      10,000 filenames — so nothing is lost. I left it alone because deleting your download is your call.

## Set up the app (day 1–2)

- [ ] Open the `android/` folder in Android Studio and let Gradle sync. Pause OneDrive sync while building, because the
      build output is large.
- [ ] On an Android 8.0+ phone (ideally two, one mid-range): Settings → About phone → tap *Build number* 7 times →
      Developer options → turn on **USB debugging** → plug in → press Run in Android Studio.
- [ ] In the app: accept the safety notice and the camera permission.
- [ ] Copy `ml/kaggle_output/artifacts/yolo26n.tflite` (from the smoke run) to the phone, then in the app:
      **Settings → Import .tflite model**. This is the COCO baseline: vehicles and generic lights, no verified colors.
- [ ] Quick check on the phone:
  - The top bar shows fps and whether it runs on GPU or CPU.
  - Speech, tones (with headphones), vibration and the volume keys work (up = start/end crossing, down = repeat status).
  - Turn on **Settings → Log sessions to CSV**.
- [ ] Get headphones (bone-conduction if possible, so ears stay open) and a phone chest mount or lanyard.

## Week 1: your own videos

Your recordings are the honest test set — VIDVIP is Japan, DTLD is Germany, and neither is your city or your phone.

- [ ] **Record** (follow the safety rules at the bottom):
  - A sighted teammate films from the **sidewalk**, where a blind traveler would stand, phone upright at chest height.
  - Each clip covers at least one full cycle: red → green → flashing → red.
  - At least 5 intersections; day and night, plus rain if you can; include turning vehicles.
- [ ] **Upload them** and attach them to the next run:
      ```bash
      python scripts/kaggle_run.py dataset --path <folder with your clips> --slug crossing-videos
      python scripts/kaggle_run.py run --mode full --gpu --dataset <you>/vidvip-yolo --dataset <you>/dtld-yolo --dataset <you>/crossing-videos
      ```
      The run auto-labels them with the trained model and returns `local_auto.zip` in the artifacts.
- [ ] **Review every frame** (this replaces drawing boxes by hand — about 15 minutes per 300 frames):
  - Unzip `local_auto.zip`, open `review.html` in Chrome or Edge.
  - **A** = every visible pedestrian signal has a box with the right color and nothing important is missing.
  - **F** = boxes are right but red and green are swapped. **R** = anything else. Arrows move, **U** undoes.
  - Click **Download decisions.json**, put it in `ml/`, and run the pipeline again: it applies your decisions, rebuilds
    the dataset with your frames as the **test** split and scores the model on them. Your recordings never train it.
- [ ] Copy the new `best.tflite` to the phone: **Settings → Import .tflite model**.

## Week 2: measure it

- [ ] Write down the numbers listed under "Numbers to collect" below.
- [ ] **Curb-side sessions** (on the sidewalk only, logging on, a sighted teammate filming the signal at the same time):
  - Copy the logs off the phone: `Android/data/com.crosswise.app/files/logs/session_*.csv` (USB, or Android Studio →
    Device Explorer).
  - Compare the log with the video: how late WALK / DON'T WALK was announced, any false WALK, whether flashing was
    detected, whether "just came on" was correct.
- [ ] **Veer test** in a closed area such as an empty parking lot, with a sighted spotter:
  - Tape a 15 m straight line; the tester walks it with eyes closed and the phone on a chest mount.
  - Do it with and without drift guidance, and measure how far off the line they end up.
- [ ] Send me the numbers or logs if you want the thresholds tuned.

## Week 3 (1–7 Oct): one extra feature and feedback

- [ ] Choose **one or two** extra features and ask me to build them:
  - OpenStreetMap pre-brief ("signalized crossing ahead, with island").
  - Aligning with the crosswalk stripes.
  - Siren alerts.
  - Vibration on a smartwatch.
- [ ] Interviews or table demos with an orientation & mobility instructor and, if possible, 2–5 blind or low-vision
      advisors. **No street trials.** Ask your university whether interviews need ethics approval.
- [ ] Note their feedback on the wording, tones and vibration patterns.

## Week 4 (8–15 Oct): finish

- [ ] Final model and metrics table.
- [ ] Battery and heat test: 20 minutes of continuous use on both phones.
- [ ] Demo video with captions: a sighted presenter at the curb, with the detection overlay visible.
- [ ] Report and slides. Code freeze **Tue 13 Oct**, buffer day Wed 14 Oct, demo **Thu 15 Oct**.

## Numbers to collect for the report

| Number | Where it comes from |
|---|---|
| mAP50 / mAP50-95 on your reviewed test set | `artifacts/crosswise_v1_crosswise_report_test.json` |
| Share of true red boxes predicted green (with raw counts) | same file, `red_boxes_called_green` and `counts` |
| Phase accuracy on the ImVisible test set, red called green | `artifacts/eval_imvisible.json` |
| Auto-label precision (frames accepted unchanged / reviewed) | `artifacts/local_auto_review_summary.json` |
| Dataset composition (images and boxes per source) | the class-mapping table printed by the run |
| WALK / DON'T WALK announcement delay; false WALK per hour (target 0) | curb-side logs compared with video |
| Alerts for approaching vs passing vehicles | curb-side logs compared with video |
| Distance off the line after 15 m, with vs without guidance | veer test |
| fps, inference ms, battery % per 20 min, temperature | app top bar and the phones |

## Kaggle tips

- `python scripts/kaggle_run.py status` shows whether the last run is queued, running, complete or failed;
  `python scripts/kaggle_run.py output` downloads its artifacts and log again (always fresh, never a stale copy).
- The run keeps going if you close your laptop — it lives on Kaggle. Add `--no-wait` if you do not want to watch it.
- Heavy folders (`data/`, `runs/`) stay in Kaggle's scratch space and are *not* saved: whatever you need later must end
  up in `/kaggle/working/artifacts`, which is what the notebook's last cell collects.
- A step that fails stops the whole notebook (exit codes are checked), so "complete" really means everything ran.
- Uploading a dataset again with the same `--slug` adds a new version; the kernel always gets the newest.

## Licenses to state in the report

VIDVIP is CC BY-NC-ND 4.0: non-commercial research, and **do not redistribute** it — keep your Kaggle datasets
**private** (the upload command does that). DTLD is research-and-teaching use only. Both are fine for a capstone,
neither is fine for a product. Ultralytics YOLO is AGPL-3.0, so this repository stays open source.

## Safety rules (always)

- Nobody crosses a real street blindfolded or because the app said something. Street sessions stay on the sidewalk.
- Veer tests only in closed areas, with a sighted spotter.
- Film traffic, not faces. Blur faces before sharing, and keep raw videos private.
- Every demo says that CrossWise is an aid, not a replacement for a cane, a guide dog or orientation & mobility training.
