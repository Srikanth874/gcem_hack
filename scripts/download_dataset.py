"""
download_dataset.py
===================
Downloads the Solar Panel Defect Detection dataset from Roboflow Universe
into  data/raw/solar_panel_defects/  (YOLOv8 format).

Usage
-----
1. Copy .env.example → .env and add your Roboflow API key.
2. Run:  python scripts/download_dataset.py

The script is idempotent: it skips the download if the target folder
already contains a data.yaml file.

Dataset
-------
  Workspace : solar-panel-defect-detection
  Project   : solar-panel-defect-detection
  Version   : 5  (YOLOv8 format)
  Labels    : Bird-Drop, Dusty, Electrical-Damage, Physical-Damage,
              Snow-Covered, Clean (6 classes)
  License   : CC BY 4.0
  URL       : https://universe.roboflow.com/solar-panel-defect-detection/
              solar-panel-defect-detection

NOTE: A free Roboflow account is required.
      Sign up at https://app.roboflow.com  →  Settings → API
"""

import os
import sys
from pathlib import Path

# ── Locate project root (one level above this script) ──────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "raw" / "solar_panel_defects"
ENV_FILE = ROOT / ".env"


def load_env() -> None:
    """Load .env if python-dotenv is available; fall back to bare env vars."""
    try:
        from dotenv import load_dotenv
        load_dotenv(ENV_FILE)
        print(f"[INFO] Loaded environment from {ENV_FILE}")
    except ImportError:
        print("[WARN] python-dotenv not installed — reading environment variables directly.")


def get_api_key() -> str:
    api_key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    if not api_key or api_key == "your_api_key_here":
        print(
            "\n[ERROR] ROBOFLOW_API_KEY is not set.\n"
            "  Steps to fix:\n"
            "    1. Copy .env.example → .env\n"
            "    2. Sign up free at https://app.roboflow.com\n"
            "    3. Go to Settings → API → copy your key\n"
            "    4. Paste it into .env:  ROBOFLOW_API_KEY=<your_key>\n"
            "    5. Re-run this script.\n"
        )
        sys.exit(1)
    return api_key


def dataset_already_downloaded() -> bool:
    """Return True if data.yaml already exists (idempotency check)."""
    yaml_candidates = list(DATA_DIR.rglob("data.yaml"))
    return bool(yaml_candidates)


def download(api_key: str) -> None:
    try:
        from roboflow import Roboflow
    except ImportError:
        print("[ERROR] roboflow package not found.  Run:  pip install roboflow")
        sys.exit(1)

    workspace  = os.environ.get("ROBOFLOW_WORKSPACE", "solar-panel-defect-detection")
    project    = os.environ.get("ROBOFLOW_PROJECT",   "yolov8-4qenz")
    version    = int(os.environ.get("ROBOFLOW_VERSION", "1"))
    fmt        = os.environ.get("ROBOFLOW_FORMAT",    "yolov8")

    print(f"\n[INFO] Connecting to Roboflow workspace: {workspace}")
    rf = Roboflow(api_key=api_key)
    proj = rf.workspace(workspace).project(project)

    print(f"[INFO] Downloading project '{project}' v{version} in '{fmt}' format ...")
    proj.version(version).download(fmt, location=str(DATA_DIR), overwrite=True)
    print(f"\n[SUCCESS] Dataset downloaded to: {DATA_DIR}")


def main() -> None:
    print("=" * 60)
    print("  Solar Panel Defect Dataset Downloader")
    print("=" * 60)

    load_env()

    if dataset_already_downloaded():
        print(f"\n[SKIP] Dataset already present at:\n  {DATA_DIR}\n"
              "  Delete the folder and re-run to force a fresh download.")
        return

    api_key = get_api_key()
    download(api_key)
    print("\n[INFO] Run  python scripts/verify_dataset.py  to inspect the dataset.")


if __name__ == "__main__":
    main()
