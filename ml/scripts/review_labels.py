"""Review auto-labels with the keyboard instead of drawing boxes.

    # 1) build the page (inside the dataset folder, next to images/)
    python scripts/review_labels.py make --dataset data/raw/local_auto                # every frame (for a test set)
    python scripts/review_labels.py make --dataset data/raw/vistas --sample 300       # spot-check a converted dataset
    python scripts/review_labels.py make --dataset data/raw/local_auto --only-flagged # only frames the auto-labeler doubted
    # 2) open <dataset>/review.html in Chrome/Edge: A accept, F flip red/green, R reject, arrows move, U undo.
    #    Click "Download decisions.json" when done (decisions also survive closing the tab).
    # 3) apply: flips labels, moves rejected frames to <dataset>_removed/, writes review_summary.json
    python scripts/review_labels.py apply --dataset data/raw/local_auto --decisions decisions.json --drop-unreviewed

Use --drop-unreviewed for a TEST set: every test frame must have been seen by a person.
review_summary.json reports the auto-label precision (accepted unchanged / reviewed) for your report.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crosswise_ml.review import apply_decisions, build_items, render_html  # noqa: E402
from crosswise_ml.yolo_io import read_names  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("make", help="write review.html into the dataset folder")
    make.add_argument("--dataset", type=Path, required=True)
    make.add_argument("--only-flagged", action="store_true")
    make.add_argument("--sample", type=int, help="random subset size (spot check)")
    make.add_argument("--seed", type=int, default=0)
    apply = sub.add_parser("apply", help="apply downloaded decisions.json to the dataset")
    apply.add_argument("--dataset", type=Path, required=True)
    apply.add_argument("--decisions", type=Path, required=True)
    apply.add_argument("--drop-unreviewed", action="store_true", help="move frames without a decision out (test sets)")
    args = parser.parse_args()

    names = read_names(args.dataset / "data.yaml")
    if args.command == "make":
        items = build_items(args.dataset, args.only_flagged, args.sample, args.seed)
        page = args.dataset / "review.html"
        page.write_text(render_html(args.dataset.name, names, items), encoding="utf-8")
        flagged = sum(1 for it in items if it["flags"])
        print(f"{len(items)} frames ({flagged} flagged) -> {page}\nOpen it in a browser; images load from the folder next to it.")
    else:
        raw = json.loads(args.decisions.read_text(encoding="utf-8"))
        decisions = raw.get("decisions", raw)
        counts = apply_decisions(args.dataset, decisions, names, args.drop_unreviewed)
        print(dict(counts))
        print(json.loads((args.dataset / "review_summary.json").read_text(encoding="utf-8")))


if __name__ == "__main__":
    main()
