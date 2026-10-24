"""
verify_dataset.py
=================
Inspects and validates the downloaded Solar Panel Defect dataset.

Usage
-----
  python scripts/verify_dataset.py

What it checks
--------------
  1. Folder structure (train / valid / test splits)
  2. data.yaml content and class names
  3. Image ↔ label file pairing
  4. Class distribution across all splits
  5. Sample bounding-box annotation stats
"""

import sys
from pathlib import Path
from collections import Counter

ROOT     = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "raw" / "solar_panel_defects"


def find_yaml() -> Path | None:
    for p in DATA_DIR.rglob("data.yaml"):
        return p
    return None


def load_yaml(yaml_path: Path) -> dict:
    try:
        import yaml
    except ImportError:
        # Fallback: simple line-by-line parser for nc / names
        result = {"nc": 0, "names": []}
        with open(yaml_path, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("nc:"):
                    result["nc"] = int(line.split(":")[1].strip())
                if line.startswith("names:"):
                    # collect list items on the following lines
                    result["_parse_names"] = True
                elif result.get("_parse_names") and line.startswith("-"):
                    result["names"].append(line.lstrip("- ").strip())
                elif result.get("_parse_names") and not line.startswith("-"):
                    result.pop("_parse_names", None)
        return result

    with open(yaml_path, "r") as f:
        return yaml.safe_load(f)


def check_split(split_dir: Path, class_names: list[str]) -> dict:
    img_dir   = split_dir / "images"
    label_dir = split_dir / "labels"

    if not img_dir.exists() or not label_dir.exists():
        return {"images": 0, "labels": 0, "paired": 0, "class_dist": {}}

    images = set(p.stem for p in img_dir.iterdir()
                 if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"})
    labels = set(p.stem for p in label_dir.iterdir() if p.suffix == ".txt")

    paired   = images & labels
    img_only = images - labels
    lbl_only = labels - images

    class_counts: Counter = Counter()
    total_boxes = 0
    for lbl_file in label_dir.glob("*.txt"):
        with open(lbl_file, "r") as f:
            lines = [l.strip() for l in f if l.strip()]
        for line in lines:
            parts = line.split()
            if parts:
                cls_idx = int(parts[0])
                name = class_names[cls_idx] if cls_idx < len(class_names) else f"cls_{cls_idx}"
                class_counts[name] += 1
                total_boxes += 1

    if img_only:
        print(f"    [WARN] {len(img_only)} image(s) without label files")
    if lbl_only:
        print(f"    [WARN] {len(lbl_only)} label file(s) without matching image")

    return {
        "images": len(images),
        "labels": len(labels),
        "paired": len(paired),
        "total_boxes": total_boxes,
        "class_dist": dict(class_counts),
    }


def print_class_dist(dist: dict, indent: int = 6) -> None:
    pad = " " * indent
    total = sum(dist.values())
    for name, count in sorted(dist.items(), key=lambda x: -x[1]):
        pct = 100 * count / total if total else 0
        bar = "█" * int(pct / 5)
        print(f"{pad}{name:<22} {count:>5}  ({pct:5.1f}%)  {bar}")


def main() -> None:
    import io, sys
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    print("=" * 60)
    print("  Solar Panel Defect Dataset Verifier")
    print("=" * 60)

    if not DATA_DIR.exists():
        print(f"\n[ERROR] Dataset folder not found:\n  {DATA_DIR}\n"
              "  Run  python scripts/download_dataset.py  first.")
        sys.exit(1)

    yaml_path = find_yaml()
    if yaml_path is None:
        print(f"\n[ERROR] No data.yaml found under {DATA_DIR}.\n"
              "  The download may be incomplete. Re-run download_dataset.py.")
        sys.exit(1)

    print(f"\n[OK]  data.yaml found: {yaml_path.relative_to(ROOT)}")
    meta = load_yaml(yaml_path)

    nc    = meta.get("nc", 0)
    names = meta.get("names", [])

    print(f"\n── Dataset metadata ─────────────────────────────────")
    print(f"   Number of classes : {nc}")
    print(f"   Class names       : {names}")

    dataset_root = yaml_path.parent
    splits = ["train", "valid", "test"]
    global_dist: Counter = Counter()
    global_boxes = 0

    print(f"\n── Per-split summary ────────────────────────────────")
    for split in splits:
        split_dir = dataset_root / split
        if not split_dir.exists():
            print(f"\n  [{split}]  (not present — skipped)")
            continue
        print(f"\n  [{split}]")
        stats = check_split(split_dir, names)
        print(f"    Images  : {stats['images']}")
        print(f"    Labels  : {stats['labels']}")
        print(f"    Paired  : {stats['paired']}")
        print(f"    Boxes   : {stats.get('total_boxes', 0)}")
        if stats["class_dist"]:
            print(f"    Class distribution:")
            print_class_dist(stats["class_dist"])
            global_dist.update(stats["class_dist"])
        global_boxes += stats.get("total_boxes", 0)

    print(f"\n── Global class distribution ────────────────────────")
    print_class_dist(dict(global_dist))
    print(f"\n   Total bounding-box annotations: {global_boxes}")

    print(f"\n[OK]  Verification complete.")
    print(f"   Dataset root: {dataset_root}")


if __name__ == "__main__":
    main()
