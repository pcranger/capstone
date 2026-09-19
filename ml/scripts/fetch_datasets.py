"""Downloads the dataset sources listed in configs/sources.yaml, and says what to do for the ones that need a request.

    export ROBOFLOW_API_KEY=...          # free account at roboflow.com -> Settings -> API key
    python scripts/fetch_datasets.py --sources configs/sources.yaml

Supported entries:
  roboflow: {workspace, project, version}   -> YOLO export into `path`
  imvisible: true                           -> ImVisible PTL images (876x657) + CSV annotations into `path`
  dataset_ninja: "Mapillary Vistas"         -> Supervisely-format download via dataset-tools into `path` (~21 GB)
  manual: "instructions"                    -> printed when `path` has no data.yaml yet (VIDVIP, DTLD, ...)
Sources that already exist on disk are skipped.
"""

from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path
from urllib.request import urlretrieve

import yaml

IMVISIBLE_DRIVE_ID = "1KhKT3mfcYcdb9Zwq5jZS1bkAJyogHZbZ"  # 876x657 version, all splits (MIT license)
IMVISIBLE_CSV = "https://raw.githubusercontent.com/samuelyu2002/ImVisible/master/Annotations/{}_file.csv"


def fetch_roboflow(entry: dict, target: Path) -> None:
    from roboflow import Roboflow

    key = os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        raise SystemExit("Set ROBOFLOW_API_KEY first (Colab: userdata.get('ROBOFLOW_API_KEY')).")
    rf = entry["roboflow"]
    project = Roboflow(api_key=key).workspace(rf["workspace"]).project(rf["project"])
    project.version(int(rf["version"])).download("yolov8", location=str(target), overwrite=False)


def fetch_imvisible(target: Path) -> None:
    import gdown

    target.mkdir(parents=True, exist_ok=True)
    archive = target / "ptl_876x657.zip"
    if not archive.exists():
        gdown.download(id=IMVISIBLE_DRIVE_ID, output=str(archive), quiet=False)
    with zipfile.ZipFile(archive) as z:
        z.extractall(target / "images_raw")
    for split in ("training", "validation", "testing"):
        urlretrieve(IMVISIBLE_CSV.format(split), target / f"{split}_file.csv")


def fetch_dataset_ninja(name: str, target: Path) -> None:
    try:
        import dataset_tools as dtools
    except ImportError as error:
        raise SystemExit("pip install dataset-tools   (needed for Dataset Ninja downloads)") from error
    target.mkdir(parents=True, exist_ok=True)
    dtools.download(dataset=name, dst_dir=str(target))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sources", type=Path, default=Path("configs/sources.yaml"))
    parser.add_argument("--only", nargs="*", help="names of entries to fetch (default: all)")
    args = parser.parse_args()
    config = yaml.safe_load(args.sources.read_text(encoding="utf-8"))
    base = args.sources.parent.parent
    for entry in config["sources"] + config.get("raw", []):
        name = entry["name"]
        if args.only and name not in args.only:
            continue
        target = base / entry["path"]
        if "roboflow" in entry:
            if any(target.rglob("data.yaml")):
                print(f"[have] {name}")
                continue
            print(f"[get ] {name} from Roboflow")
            fetch_roboflow(entry, target)
        elif entry.get("imvisible"):
            if (target / "testing_file.csv").exists():
                print(f"[have] {name}")
                continue
            print(f"[get ] {name} (ImVisible, ~450 MB)")
            fetch_imvisible(target)
        elif entry.get("dataset_ninja"):
            if target.exists() and any(target.iterdir()):
                print(f"[have] {name}")
                continue
            print(f"[get ] {name} from Dataset Ninja ({entry['dataset_ninja']}, large download)")
            fetch_dataset_ninja(entry["dataset_ninja"], target)
        elif entry.get("manual") and not any(target.rglob("data.yaml")):
            print(f"[todo] {name}: {entry['manual']}")


if __name__ == "__main__":
    main()
