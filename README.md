# GCEM Hack — AI-Powered Solar Farm Fault Detection
## Data Pipeline

> **Simulated data disclaimer:** The sensor simulator in this project generates
> **synthetic readings only**. They are statistical models — not real
> measurements from physical solar panels or live monitoring systems.

---

## Project Structure

```
GCEM_HACK/
├── .env.example              # ← Copy to .env and add your Roboflow API key
├── .gitignore
├── requirements.txt
├── README.md
│
├── scripts/
│   ├── download_dataset.py   # Downloads solar panel defect dataset from Roboflow
│   ├── verify_dataset.py     # Validates dataset structure, labels, class distribution
│   ├── sensor_simulator.py   # [SIMULATED] Generates timestamped sensor readings
│   └── detect_defects.py     # Visual Defect Detection & YOLOv8 Inference
│
└── data/
    ├── raw/
    │   └── solar_panel_defects/   # Downloaded YOLOv8 dataset (1,126 images, 7,333 boxes)
    │       ├── train/
    │       ├── valid/
    │       ├── test/
    │       └── data.yaml          # Class names, paths
    ├── sensor_logs/
    │   ├── sensor_readings.csv    # [SIMULATED] Timestamped voltage/current/temp/power
    │   └── detected_events.csv    # [SIMULATED] Detected fault events
    └── detections/                # Output annotated images & JSON detection summaries
```

---

## Dataset

| Property    | Value                                                  |
|-------------|--------------------------------------------------------|
| Source      | Roboflow Universe                                      |
| Workspace   | `solar-panel-defect-detection`                         |
| Project     | `yolov8-4qenz`                                         |
| Version     | 1 (YOLOv8 Object Detection)                            |
| Classes     | Bird Drop, Dusty, Electrical Damage, Non Defective, Physical Damage, Snow |
| Total Annotations | 7,333 bounding boxes across 1,126 images         |
| Format      | YOLOv8 (YOLO-style bounding boxes in `.txt` files)     |

---

## Quick Start

### 1. Install dependencies

```powershell
pip install -r requirements.txt
```

### 2. Configure your Roboflow API key  *(manual step required)*

```powershell
# Windows PowerShell
Copy-Item .env.example .env
notepad .env
```

Edit `.env`:
```
ROBOFLOW_API_KEY=your_actual_key_here
```

**How to get a free key:**
1. Sign up at <https://app.roboflow.com> (free, no credit card)
2. Go to **Settings → API** → copy your private API key
3. Paste it into `.env`

### 3. Download the dataset

```powershell
python scripts/download_dataset.py
```

The script is **idempotent** — it will skip the download if the dataset is already present.

### 4. Verify the dataset

```powershell
python scripts/verify_dataset.py
```

Expected output: folder structure check, class names, image/label counts, class distribution bar chart, and bounding-box totals.

### 5. Run the sensor simulator *(SIMULATED data only)*

```powershell
# Normal operation — Ctrl+C to stop
python scripts/sensor_simulator.py

# Inject a fault scenario
python scripts/sensor_simulator.py --fault high_temperature
python scripts/sensor_simulator.py --fault reduced_power
python scripts/sensor_simulator.py --fault partial_shading
python scripts/sensor_simulator.py --fault open_circuit

# Custom interval (seconds)
python scripts/sensor_simulator.py --interval 2 --fault reduced_power
```

Sensor readings are appended to `data/sensor_logs/sensor_readings.csv`.  
Detected fault events are appended to `data/sensor_logs/detected_events.csv`.

---

## Sensor Readings Schema

### `sensor_readings.csv`

| Column          | Type    | Description                                   |
|-----------------|---------|-----------------------------------------------|
| timestamp_utc   | string  | ISO-8601 UTC timestamp                        |
| panel_id        | string  | Panel identifier (PANEL_001 … PANEL_005)       |
| voltage_v       | float   | Panel output voltage (V)                      |
| current_a       | float   | Panel output current (A)                      |
| power_w         | float   | Computed power = V × I (W)                    |
| temperature_c   | float   | Simulated cell temperature (°C)               |
| irradiance_wm2  | float   | Simulated solar irradiance (W/m²)             |
| efficiency_pct  | float   | Estimated efficiency (%)                      |
| fault_scenario  | string  | Active fault scenario name                    |
| data_source     | string  | Always "SIMULATED -- synthetic data …"        |

### `detected_events.csv`

| Column          | Type    | Description                                   |
|-----------------|---------|-----------------------------------------------|
| timestamp_utc   | string  | ISO-8601 UTC timestamp                        |
| panel_id        | string  | Panel identifier                              |
| event_type      | string  | HIGH_TEMPERATURE, LOW_POWER_OUTPUT, LOW_VOLTAGE, POSSIBLE_OPEN_CIRCUIT |
| severity        | string  | CAUTION / WARNING / CRITICAL                  |
| measured_value  | float   | The actual measured value that triggered      |
| threshold_value | float   | The threshold that was crossed                |
| fault_scenario  | string  | Active fault scenario name                    |
| data_source     | string  | Always "SIMULATED -- synthetic data …"        |

---

## Fault Scenarios

| Scenario         | Description                                       | Power Factor | Temp Offset |
|------------------|---------------------------------------------------|:------------:|:-----------:|
| `normal`         | All panels within normal parameters               | 1.00         | 0°C         |
| `high_temperature` | Overheating — ~18% efficiency loss             | 0.82         | +15°C       |
| `reduced_power`  | Dust/soiling — ~35% power reduction               | 0.65         | +2°C        |
| `partial_shading`| Cloud/obstruction — ~45% power reduction          | 0.55         | −3°C        |
| `open_circuit`   | String disconnected — near-zero current output    | 0.02         | +1°C        |

---

## Manual Steps Required

> [!IMPORTANT]
> The following steps **cannot** be automated and must be completed by you:
>
> 1. **Create a free Roboflow account** at <https://app.roboflow.com>
> 2. **Copy `.env.example` → `.env`** and paste your API key
> 3. **Run `python scripts/download_dataset.py`** to download the dataset (one-time)
> 4. **Run `python scripts/verify_dataset.py`** to confirm the download is valid

---

## Notes

- The sensor simulator uses a physics-inspired model (diurnal irradiance curve, NOCT temperature approximation, temperature voltage coefficient) — it produces plausible-looking readings, **but is not a substitute for real sensor data**.
- All CSV rows carry a `data_source` column tagged `"SIMULATED -- synthetic data, not real sensor measurements"` so that no downstream system can mistake them for real readings.
- The dataset download is a one-time operation. Re-running `download_dataset.py` will skip if data is already present.
