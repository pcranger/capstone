# CrossWise ML pipeline

Trains the on-device detector for the app and exports it to LiteRT. LiteRT export only runs on Linux x86-64 or macOS,
so the pipeline runs on Kaggle — from your own machine, no browser and no Google Drive:

```bash
pip install kaggle && kaggle auth login          # once; a phone-verified account can use the internet and a GPU
python scripts/kaggle_run.py run --mode smoke    # ~15 min: proves the whole chain works, on synthetic data
python scripts/kaggle_run.py run --mode full --gpu
python scripts/kaggle_run.py output              # download the artifacts of the last run again
```

`kaggle_run.py` uploads `ml/` as a private Kaggle dataset, pushes [`CrossWise_Kaggle.ipynb`](CrossWise_Kaggle.ipynb) as a
private kernel, waits for it, and downloads models, reports and the log into `kaggle_output/`. Free quota: 30 GPU-hours
a week, 12 h per run, 20 GB of output. Attach big datasets you uploaded yourself with `--dataset <user>/<slug>`.

The smoke mode is the one to run first: it renders a fake street (signal, crosswalk, looming car), merges it, teaches it,
trains 80 epochs on CPU, auto-labels a synthetic video, applies a review round-trip and exports both `.tflite` files —
so any breakage is in *your* environment, not in the scripts, and it costs no GPU quota.

**No box is drawn by hand anywhere in this pipeline.** Labels come from datasets that already have them, from automatic
conversion, from a teacher model, or from auto-labeling followed by a quick keyboard review.

## Classes

`ped_red, ped_green, crosswalk, person, bicycle, car, motorcycle, bus, truck` — see [`configs/classes.yaml`](configs/classes.yaml)
for the rules a reviewer should apply. The app maps classes **by name**, so keep these names.

## Where the labels come from

| Source | What it gives | Your effort | Script |
|---|---|---|---|
| Roboflow Universe sets | Box labels for red/green pedestrian lights. **Vet each one**: of the three examples, two were useless (15 images with a class literally named `0`; a "crossing clear / vehicle detected" decision set) and one gave 887 usable images | free account + API key | `fetch_datasets.py` |
| **VIDVIP** (Japan, sidewalk eye level) | Pedestrian signals by state (`signal_red`, `signal_blue`), crosswalks, people, vehicles | access request | `prepare_vidvip.py` |
| **DTLD** (Germany, car camera) | Pedestrian lights with red/green/off state; vehicle lights as hard negatives. Small yield: ~125 usable frames from a good 2 GB city | registration; cities total ~143 GB, so run `dtld_plan.py` first | `dtld_plan.py`, `convert_dtld.py` |
| **Mapillary Vistas v2** (worldwide) | Pedestrian-signal outlines; red/green decided from lit pixels (+ detector vote) | ~21 GB download | `convert_vistas.py` |
| ImVisible (Shanghai) | One phase label per photo → boxes kept only where the v0 detector agrees | none | `mine_imvisible.py` |
| COCO teacher (YOLO26x) | People and vehicles missing from signal datasets | none | `pseudo_label.py` |
| **Your videos** | Auto-labeled (tracking + temporal vote + color check + YOLOE second opinion), then reviewed | review with A/F/R keys | `autolabel_video.py`, `review_labels.py` |

## Steps

These are the commands the Kaggle notebook runs; run them yourself if you have a Linux/macOS GPU machine.

```bash
pip install -r requirements.txt
cp configs/sources.example.yaml configs/sources.yaml   # all sources are listed; missing ones are skipped

# 0) Day-1 baseline, no training: COCO YOLO26n (vehicles + generic lights, colors unverified in the app)
python scripts/export_litert.py --weights yolo26n.pt

# 1) Datasets
python scripts/fetch_datasets.py                       # Roboflow + ImVisible; prints what to request for the rest
python scripts/prepare_vidvip.py --src data/raw/vidvip_download --out data/raw/vidvip_yolo
python scripts/dtld_plan.py --labels data/raw/DTLD/DTLD_labels_v2.0   # which city zips are worth downloading
python scripts/convert_dtld.py --dtld data/raw/DTLD --labels data/raw/DTLD/DTLD_labels_v2.0 --out data/raw/dtld_yolo --val-cities Fulda
pip install dataset-tools && python scripts/fetch_datasets.py --only vistas_ninja
python scripts/convert_vistas.py --vistas data/raw/vistas_ninja --out data/raw/vistas_yolo
python scripts/build_dataset.py --out data/merged      # READ the printed class-mapping table
python scripts/pseudo_label.py --data data/merged/data.yaml

# 2) v0, then more labels from v0, then v1
python scripts/train.py --name crosswise_v0 --epochs 60
python scripts/mine_imvisible.py --model runs/detect/crosswise_v0/weights/best.pt
python scripts/convert_vistas.py --vistas data/raw/vistas_ninja --out data/raw/vistas_yolo --model runs/detect/crosswise_v0/weights/best.pt
python scripts/build_dataset.py --out data/merged && python scripts/pseudo_label.py --data data/merged/data.yaml
python scripts/train.py --name crosswise_v1 --epochs 120

# 3) Your own videos -> reviewed test set
python scripts/autolabel_video.py --videos data/videos --model runs/detect/crosswise_v1/weights/best.pt --out data/raw/local_auto
python scripts/review_labels.py make --dataset data/raw/local_auto     # open data/raw/local_auto/review.html
python scripts/review_labels.py apply --dataset data/raw/local_auto --decisions decisions.json --drop-unreviewed
python scripts/build_dataset.py --out data/merged

# 4) Evaluate and export
python scripts/evaluate.py --model runs/detect/crosswise_v1/weights/best.pt --data data/merged/data.yaml
python scripts/eval_imvisible.py --model runs/detect/crosswise_v1/weights/best.pt
python scripts/export_litert.py --weights runs/detect/crosswise_v1/weights/best.pt --data data/merged/data.yaml --int8 --install
```

Converters refuse to write into (or over) their input folder — on Windows and macOS `data/raw/dtld` and `data/raw/DTLD` are
the same folder, which is why outputs are named `*_yolo`.

## Reviewing instead of labeling

`review_labels.py make` writes `review.html` next to the images. Open it in Chrome or Edge:

| Key | Meaning |
|---|---|
| **A** / Enter | Accept: every visible pedestrian signal has a box with the right color, nothing important missing |
| **F** | Flip: boxes are right but red and green are swapped |
| **R** | Reject: anything else (missed signal, wrong box, unclear frame) |
| ← → / **U** | Move / undo |

Frames the auto-labeler doubted are flagged (close to a phase change, lit color disagrees, tracked signal missing, YOLOE sees
another signal). Use `--only-flagged` to review just those for training data, `--sample 200` to spot-check a converted dataset,
and review **every** frame (plus `--drop-unreviewed`) for the test set. `review_summary.json` gives the auto-label precision
(accepted unchanged / reviewed), a useful number for the report.

## Design choices worth mentioning in the report

* **No hue augmentation** (`hsv_h=0`): the color *is* the label; hue jitter can turn red into orange/green.
* **Teacher pseudo-labels** for people and vehicles in signal datasets, otherwise the student learns traffic as background.
  Test labels are never pseudo-labeled. Every added box is logged in `data/merged/meta/pseudo_labels.csv`.
* **Never teach a lit signal as background**: converters skip an image when a visible pedestrian signal has an unknown state,
  is cut by a crop, or its color cannot be decided — instead of leaving it unlabeled. Sources that box the signal *head*
  with a state-less class (`unstated_signal_class` in `sources.yaml`) are held to the same rule: the image is dropped
  unless every head contains a red or green box.
* **Vehicle signals as hard negatives**: DTLD and Vistas vehicle lights are deliberately left unlabeled.
* **Scale matching**: DTLD and Vistas images are cropped around the signals so they stay as large as they look to the phone.
* **Weak-label mining** (ImVisible) and **consensus labeling** (Vistas color rule + detector vote).
* **Temporal voting** for video auto-labels: a real signal does not flicker red/green between frames.
* **Leakage control**: Roboflow augmentations stay together; VIDVIP splits by recording, DTLD by city; your own data is test-only.
* **Safety metric**: `train.py` and `evaluate.py` report the share of true `ped_red` boxes predicted as `ped_green`
  (with raw counts, because on a small split one box makes an alarming ratio); `eval_imvisible.py` reports
  red-called-green at image level. Your reviewed recordings are test-only, so `evaluate.py` scores them without retraining.
* **Export**: FP32 NMS-free head `[1,300,6]` for the phone GPU; INT8 raw head for CPU-only phones. The script prints the exact
  tensor shapes the app will receive and re-validates the exported file's mAP.

## Tests

```bash
python -m pytest tests -q     # 52 tests on synthetic data in each dataset's real format; no GPU needed
```

## Licenses

Ultralytics YOLO/YOLOE: AGPL-3.0 (keep the project open source or get an Enterprise license). ImVisible: MIT. VIDVIP:
CC BY-NC-ND 4.0 (non-commercial; do not redistribute modified copies). DTLD: research and teaching use. Mapillary Vistas:
CC BY-NC-SA 4.0. Roboflow Universe datasets: check each (often CC BY 4.0). COCO: CC BY 4.0. All fine for a capstone,
not for a commercial product.
