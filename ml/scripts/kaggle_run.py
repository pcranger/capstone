"""Runs this pipeline on Kaggle's free GPU straight from the repo (no Google Drive, no web UI).

    python scripts/kaggle_run.py run --mode smoke              # ~15 min: proves every script works end to end
    python scripts/kaggle_run.py run --mode full --gpu         # the real pipeline
    python scripts/kaggle_run.py dataset --path data/raw/dtld_yolo --slug dtld-yolo   # upload data you converted
    python scripts/kaggle_run.py run --mode full --gpu --dataset me/vidvip-yolo --dataset me/dtld-yolo
    python scripts/kaggle_run.py status                        # of the last pushed kernel
    python scripts/kaggle_run.py output                        # download artifacts + log again

What `run` does:
  1. uploads `ml/` (code only) as the private Kaggle dataset <user>/crosswise-ml-code (new version each time),
  2. writes kernel-metadata.json, rewrites the notebook's CONFIG line for the chosen mode,
  3. pushes CrossWise_Kaggle.ipynb as a private kernel and waits for it,
  4. downloads the outputs (models, reports, log) into ml/kaggle_output/.

Requires the Kaggle CLI to be installed and logged in (`pip install kaggle`, then `kaggle auth login`, or put
kaggle.json in ~/.kaggle). Internet must be enabled for the kernel, which needs a phone-verified Kaggle account.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
BUILD_DIR = ML_DIR / ".kaggle_build"
OUTPUT_DIR = ML_DIR / "kaggle_output"
NOTEBOOK = ML_DIR / "CrossWise_Kaggle.ipynb"
CODE_SLUG = "crosswise-ml-code"
CODE_IGNORE = shutil.ignore_patterns("data", "runs", "kaggle_output", ".kaggle_build", "__pycache__",
                                     ".ipynb_checkpoints", "*.pt", "*.tflite", "*.zip", ".git")


def kaggle(*args: str, check: bool = True, quiet: bool = False) -> subprocess.CompletedProcess:
    # PYTHONUTF8 keeps the CLI from crashing on Windows when a log line has characters cp1252 cannot encode.
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    for command in (["kaggle", *args], [sys.executable, "-m", "kaggle", *args]):
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                                    errors="replace", env=env)
        except FileNotFoundError:
            continue
        if not quiet:
            print((result.stdout or "").strip() or (result.stderr or "").strip())
        if check and result.returncode != 0:
            raise SystemExit(f"kaggle {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")
        return result
    raise SystemExit("Kaggle CLI not found. Install it with: pip install kaggle")


def kaggle_username() -> str:
    result = kaggle("config", "view", quiet=True)
    match = re.search(r"username:\s*(\S+)", result.stdout or "")
    if not match or match.group(1) == "None":
        raise SystemExit("Kaggle CLI is not logged in. Run: kaggle auth login")
    return match.group(1)


def upload_code(user: str) -> str:
    """Creates or versions the private dataset holding ml/ (code only)."""
    staging = BUILD_DIR / "code"
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(ML_DIR, staging / "ml", ignore=CODE_IGNORE)
    reference = f"{user}/{CODE_SLUG}"
    (staging / "dataset-metadata.json").write_text(json.dumps({
        "title": "CrossWise ML code",
        "id": reference,
        "licenses": [{"name": "CC0-1.0"}],
    }, indent=1), encoding="utf-8")
    exists = kaggle("datasets", "status", reference, check=False, quiet=True).returncode == 0
    if exists:
        kaggle("datasets", "version", "-p", str(staging), "-m", f"code {time.strftime('%Y-%m-%d %H:%M')}", "-r", "zip")
    else:
        kaggle("datasets", "create", "-p", str(staging), "-r", "zip")
    return reference


def upload_folder(user: str, folder: Path, slug: str, title: str | None = None) -> str:
    """Publishes any folder (a converted dataset, your videos) as a private Kaggle dataset the kernel can attach."""
    if not folder.is_dir():
        raise SystemExit(f"{folder} is not a folder")
    reference = f"{user}/{slug}"
    metadata = folder / "dataset-metadata.json"
    metadata.write_text(json.dumps({
        "title": title or slug.replace("-", " ").title(),
        "id": reference,
        "licenses": [{"name": "other"}],     # source datasets keep their own terms; these copies stay private
    }, indent=1), encoding="utf-8")
    size = sum(p.stat().st_size for p in folder.rglob("*") if p.is_file()) / 1e9
    print(f"uploading {folder} ({size:.2f} GB) as {reference} — this is the slow part")
    exists = kaggle("datasets", "status", reference, check=False, quiet=True).returncode == 0
    if exists:
        kaggle("datasets", "version", "-p", str(folder), "-m", f"update {time.strftime('%Y-%m-%d %H:%M')}", "-r", "zip")
    else:
        kaggle("datasets", "create", "-p", str(folder), "-r", "zip")
    wait_for_dataset(reference)
    print(f"attach it with: --dataset {reference}")
    return reference


def wait_for_dataset(reference: str, timeout: int = 900) -> None:
    """A brand-new dataset version needs a moment before a kernel can attach it."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = kaggle("datasets", "status", reference, check=False, quiet=True)
        if "ready" in (status.stdout or "").lower():
            return
        time.sleep(10)
    print(f"[warn] {reference} still not 'ready'; pushing anyway")


def write_kernel(user: str, mode: str, gpu: bool, datasets: list[str], config: dict) -> str:
    staging = BUILD_DIR / "kernel"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    replaced = 0
    for cell in notebook["cells"]:
        for i, line in enumerate(cell.get("source", [])):
            if line.startswith("CONFIG = {"):
                cell["source"][i] = f"CONFIG = {json.dumps(config)}  # set by kaggle_run.py\n"
                replaced += 1
    if replaced != 1:
        raise SystemExit(f"Expected exactly one CONFIG line in {NOTEBOOK.name}, found {replaced}")
    (staging / NOTEBOOK.name).write_text(json.dumps(notebook, indent=1, ensure_ascii=False), encoding="utf-8")
    slug = f"crosswise-{mode}"
    (staging / "kernel-metadata.json").write_text(json.dumps({
        "id": f"{user}/{slug}",
        "title": f"CrossWise {mode}",
        "code_file": NOTEBOOK.name,
        "language": "python",
        "kernel_type": "notebook",
        "is_private": "true",
        "enable_gpu": "true" if gpu else "false",
        "enable_tpu": "false",
        "enable_internet": "true",
        "dataset_sources": datasets,
        "competition_sources": [],
        "kernel_sources": [],
        "model_sources": [],
    }, indent=1), encoding="utf-8")
    return f"{user}/{slug}"


def wait_for_kernel(reference: str, poll: int = 30, timeout: int = 9 * 3600) -> str:
    start = time.time()
    last = ""
    while time.time() - start < timeout:
        result = kaggle("kernels", "status", reference, check=False, quiet=True)
        text = (result.stdout or "") + (result.stderr or "")
        state = next((s for s in ("complete", "error", "cancel", "running", "queued") if s in text.lower()), "unknown")
        if state != last:
            print(f"[{time.strftime('%H:%M:%S')}] {state}")
            last = state
        if state in ("complete", "error", "cancel"):
            return state
        time.sleep(poll)
    return "timeout"


def log_lines(path: Path) -> list[str]:
    """The kernel log is a JSON array of {time, stream_name, data} entries, but falls back to plain text."""
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        entries = json.loads(text)
    except json.JSONDecodeError:
        return text.splitlines()
    return [(e.get("data", "") if isinstance(e, dict) else str(e)).rstrip("\n") for e in entries]


def fetch_output(reference: str, tail: int = 40) -> None:
    # Start empty and force every download: the CLI otherwise skips files whose local copy is newer, so artifacts
    # from a previous run silently survive and look like results of this one.
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    kaggle("kernels", "output", reference, "-p", str(OUTPUT_DIR), "--force")
    logs = sorted(OUTPUT_DIR.glob("*.log"), key=lambda p: p.stat().st_mtime)
    if logs and logs[-1].stat().st_size:
        lines = log_lines(logs[-1])
        print(f"\n--- {logs[-1].name}: last {tail} of {len(lines)} lines ---")
        print("\n".join(lines[-tail:]))
    else:
        print("\n[warn] no kernel log downloaded; check the run page for the output")
    print(f"\nArtifacts in {OUTPUT_DIR}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run", "push", "code", "dataset", "status", "output"])
    parser.add_argument("--mode", choices=["smoke", "full"], default="smoke")
    parser.add_argument("--gpu", action="store_true", help="use a GPU (counts against your 30 h/week quota)")
    parser.add_argument("--dataset", action="append", default=[], help="extra Kaggle dataset to attach (user/slug)")
    parser.add_argument("--path", type=Path, help="dataset command: folder to upload")
    parser.add_argument("--slug", help="dataset command: name it gets on Kaggle, e.g. vidvip-yolo")
    parser.add_argument("--epochs-v0", type=int, default=60)
    parser.add_argument("--epochs-v1", type=int, default=120)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--no-wait", action="store_true")
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):     # kernel logs contain emoji; a cp1252 console must not abort on them
        stream.reconfigure(errors="replace")

    user = kaggle_username()
    kernel = f"{user}/crosswise-{args.mode}"
    if args.command == "status":
        kaggle("kernels", "status", kernel)
        return
    if args.command == "output":
        fetch_output(kernel)
        return
    if args.command == "dataset":
        if not args.path or not args.slug:
            raise SystemExit("dataset needs --path <folder> --slug <name>")
        upload_folder(user, args.path, args.slug)
        return

    datasets = [f"{user}/{CODE_SLUG}", *args.dataset]
    if args.command in ("run", "code"):
        reference = upload_code(user)
        wait_for_dataset(reference)
        if args.command == "code":
            return

    config = {"mode": args.mode, "epochs_v0": args.epochs_v0, "epochs_v1": args.epochs_v1, "imgsz": args.imgsz}
    kernel = write_kernel(user, args.mode, args.gpu, datasets, config)
    kaggle("kernels", "push", "-p", str(BUILD_DIR / "kernel"))
    print(f"https://www.kaggle.com/code/{kernel}")
    if args.no_wait:
        return
    state = wait_for_kernel(kernel)
    print(f"final state: {state}")
    fetch_output(kernel)
    if state != "complete":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
