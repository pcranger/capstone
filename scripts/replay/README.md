# Video replay: what would the app say on this road video?

Feeds a video through the app's real TypeScript decision code and prints a timeline. Videos and outputs stay out of git.

1. One-time: `python -m venv .replay-venv` then `.replay-venv/Scripts/python -m pip install opencv-python-headless numpy ai-edge-litert`.
2. `.replay-venv/Scripts/python scripts/replay/extract.py VIDEO.mp4 --out OUTDIR/name.json [--fps 5] [--png-at 3,20]`
   runs `assets/models/crosswise-416.tflite` on CPU and the native worker's optical flow (`VehicleFlow.kt`), one JSON frame per sample.
   `--png-at` saves annotated frames (t-0.6 s, t, t+0.6 s side by side) for eyeballing.
3. `REPLAY_JSON=OUTDIR/name.json npx jest -c scripts/replay/jest.config.js` feeds the frames to the real tracker, `VehicleMotion`
   and `CrossingEngine` and writes `OUTDIR/name.timeline.txt` (one row per frame: mode and check result, Cross yes/no, each car as
   moving / stationary / unknown, plus every spoken line). `REPLAY_FIXED=1` keeps the heading fixed for the whole run.
4. The normal `npx jest` never picks this up (its `testMatch` only looks in `__tests__`).

Known differences from the phone: bilinear resize in OpenCV vs the camera's GPU resizer (sub-pixel); the video is landscape,
the phone feeds upright portrait frames; fps defaults to 5 (what `scripts/benchmark_vehicle_flow.py` uses; the phone runs 3-17);
the heading sensor is faked: fixed at 0 except the scripted left/right looks of each check (the video cannot show what a real look
would see, so car warnings during the looks are about the same road view); camera field of view is assumed 65 x 50 degrees.
5. Each run also writes `<name>.lowlight.txt` (median/p10/p90 brightness, whether the low-light warning fired, when); `cat *.lowlight.txt` gives the calibration table. The replay runs the real `LowLightMonitor` on the same smoothed brightness the controller uses.
