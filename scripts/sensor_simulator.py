# -*- coding: utf-8 -*-
"""
sensor_simulator.py
====================
[!!] SIMULATED DATA -- NOT REAL SOLAR FARM MEASUREMENTS [!!]
=============================================================
All readings produced by this script are synthetically generated using
statistical models.  They do NOT come from physical sensors, real solar
panels, or any live monitoring system.

Purpose
-------
Generates realistic-looking timestamped sensor readings for a solar farm
fault-detection pipeline.  Readings are saved to CSV files so they can be
used to train, test, or demonstrate anomaly-detection models alongside the
visual defect dataset.

Usage
-----
  # Normal operation (Ctrl+C to stop):
  python scripts/sensor_simulator.py

  # Inject a specific fault scenario:
  python scripts/sensor_simulator.py --fault high_temperature
  python scripts/sensor_simulator.py --fault reduced_power
  python scripts/sensor_simulator.py --fault partial_shading
  python scripts/sensor_simulator.py --fault open_circuit
  python scripts/sensor_simulator.py --fault normal

  # Custom interval (seconds between readings):
  python scripts/sensor_simulator.py --interval 2 --fault high_temperature

Output files (auto-created in  data/sensor_logs/ )
---------------------------------------------------
  sensor_readings.csv   -- one row per reading (all panels)
  detected_events.csv   -- rows inserted whenever a fault threshold is crossed

Simulated panels
----------------
  PANEL_001 ... PANEL_005  (five independent panels)
"""

import argparse
import csv
import math
import os
import random
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Project root ────────────────────────────────────────────────────────────
ROOT     = Path(__file__).resolve().parent.parent
LOG_DIR  = ROOT / "data" / "sensor_logs"
READINGS_CSV = LOG_DIR / "sensor_readings.csv"
EVENTS_CSV   = LOG_DIR / "detected_events.csv"

# ── Panel IDs ───────────────────────────────────────────────────────────────
PANELS = [f"PANEL_{i:03d}" for i in range(1, 6)]

# ── Fault scenario definitions ───────────────────────────────────────────────
FAULT_SCENARIOS = {
    "normal": {
        "description": "All panels operating within normal parameters",
        "temp_offset":    0.0,
        "power_factor":   1.0,
        "voltage_factor": 1.0,
        "current_factor": 1.0,
        "irradiance_factor": 1.0,
    },
    "high_temperature": {
        "description": "Panels overheating -- cell efficiency drops",
        "temp_offset":    15.0,   # degC above normal
        "power_factor":   0.82,   # ~18% efficiency loss
        "voltage_factor": 0.93,
        "current_factor": 1.02,
        "irradiance_factor": 1.0,
    },
    "reduced_power": {
        "description": "Reduced power output -- possible dust / soiling",
        "temp_offset":    2.0,
        "power_factor":   0.65,
        "voltage_factor": 0.90,
        "current_factor": 0.72,
        "irradiance_factor": 0.70,
    },
    "partial_shading": {
        "description": "Partial shading from obstruction or cloud cover",
        "temp_offset":   -3.0,
        "power_factor":   0.55,
        "voltage_factor": 0.78,
        "current_factor": 0.70,
        "irradiance_factor": 0.50,
    },
    "open_circuit": {
        "description": "Open-circuit fault -- string disconnected",
        "temp_offset":    1.0,
        "power_factor":   0.02,
        "voltage_factor": 1.10,   # Voc rises at open circuit
        "current_factor": 0.01,
        "irradiance_factor": 1.0,
    },
}

# ── Physical reference constants (STC = Standard Test Conditions) ─────────
STC = {
    "voltage_v":       36.0,   # V  -- open-circuit ~45 V, MPP ~36 V
    "current_a":        8.5,   # A  -- Isc ~9 A, IMPP ~8.5 A
    "power_w":        305.0,   # W  (Vmpp x Impp)
    "temp_cell_c":     25.0,   # degC -- STC cell temperature
    "irradiance_wm2": 1000.0,  # W/m2 -- STC irradiance
}

# ── Fault detection thresholds ───────────────────────────────────────────────
THRESHOLDS = {
    "temp_high_c":        65.0,   # degC -- flag if cell temp exceeds this
    "power_low_pct":      70.0,   # %  -- flag if power < 70% of rated
    "voltage_low_v":      28.0,   # V
    "current_low_a":       2.0,   # A  -- open-circuit condition
}

# ── CSV field names ──────────────────────────────────────────────────────────
READING_FIELDS = [
    "timestamp_utc", "panel_id",
    "voltage_v", "current_a", "power_w",
    "temperature_c", "irradiance_wm2",
    "efficiency_pct", "fault_scenario", "data_source",
]

EVENT_FIELDS = [
    "timestamp_utc", "panel_id", "event_type", "severity",
    "measured_value", "threshold_value", "fault_scenario", "data_source",
]

DATA_SOURCE_TAG = "SIMULATED -- synthetic data, not real sensor measurements"

# ── Graceful shutdown flag ───────────────────────────────────────────────────
_RUNNING = True


def _shutdown(sig, frame):
    global _RUNNING
    print("\n\n[INFO] Shutdown signal received. Flushing and exiting ...")
    _RUNNING = False


signal.signal(signal.SIGINT,  _shutdown)
signal.signal(signal.SIGTERM, _shutdown)


# ════════════════════════════════════════════════════════════════════════════
#  Reading generation
# ════════════════════════════════════════════════════════════════════════════

def _diurnal_factor(dt: datetime) -> float:
    """
    Simulate a solar irradiance curve across the day using local time.
    Returns a value in [0, 1] peaking at midday.
    """
    local_dt = dt.astimezone() if dt.tzinfo else dt
    hour = local_dt.hour + local_dt.minute / 60.0
    # Sine-bell from 6:00 to 18:00
    if 6.0 <= hour <= 18.0:
        return max(0.2, math.sin(math.pi * (hour - 6.0) / 12.0))
    return 0.15   # baseline ambient daylight for testing


def generate_reading(panel_id: str, scenario: dict, dt: datetime) -> dict:
    """
    Produce one simulated sensor reading for a single panel.

    Physics sketch
    --------------
    Irradiance drives current (roughly linear).
    Voltage has a weaker irradiance dependence but drops with temperature.
    Power = Voltage x Current.
    Efficiency = Power / (Irradiance x panel_area).
    """
    diurnal = _diurnal_factor(dt)

    # Base irradiance with diurnal curve + cloud noise
    irr_base = STC["irradiance_wm2"] * diurnal * scenario["irradiance_factor"]
    irradiance = max(0.0, irr_base + random.gauss(0, 20))

    # Cell temperature: ambient + irradiance heating + fault offset
    ambient_c   = 28.0 + random.gauss(0, 1.5)
    temp_rise   = 0.03 * irradiance                     # NOCT approximation
    temperature = ambient_c + temp_rise + scenario["temp_offset"] + random.gauss(0, 0.8)

    # Voltage: drops ~0.3%/degC above STC
    temp_coeff_v = -0.003
    v_temp_derate = 1 + temp_coeff_v * (temperature - STC["temp_cell_c"])
    voltage = (STC["voltage_v"] * scenario["voltage_factor"]
               * v_temp_derate
               * (irradiance / STC["irradiance_wm2"]) ** 0.05   # slight log dep.
               + random.gauss(0, 0.4))
    voltage = max(0.0, voltage)

    # Current: nearly linear with irradiance
    current = (STC["current_a"] * scenario["current_factor"]
               * (irradiance / STC["irradiance_wm2"])
               * scenario["power_factor"] ** 0.5          # soiling affects Isc too
               + random.gauss(0, 0.15))
    current = max(0.0, current)

    power   = voltage * current
    panel_area_m2 = 1.65
    efficiency = (power / (irradiance * panel_area_m2) * 100) if irradiance > 1 else 0.0
    efficiency  = max(0.0, min(efficiency, 25.0))

    return {
        "timestamp_utc":  dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "panel_id":       panel_id,
        "voltage_v":      round(voltage,     3),
        "current_a":      round(current,     3),
        "power_w":        round(power,       3),
        "temperature_c":  round(temperature, 3),
        "irradiance_wm2": round(irradiance,  2),
        "efficiency_pct": round(efficiency,  3),
        "fault_scenario": scenario.get("_name", "normal"),
        "data_source":    DATA_SOURCE_TAG,
    }


# ════════════════════════════════════════════════════════════════════════════
#  Fault detection
# ════════════════════════════════════════════════════════════════════════════

def detect_events(reading: dict, scenario_name: str) -> list[dict]:
    events = []
    ts  = reading["timestamp_utc"]
    pid = reading["panel_id"]

    def _event(etype, severity, measured, threshold):
        return {
            "timestamp_utc":   ts,
            "panel_id":        pid,
            "event_type":      etype,
            "severity":        severity,
            "measured_value":  measured,
            "threshold_value": threshold,
            "fault_scenario":  scenario_name,
            "data_source":     DATA_SOURCE_TAG,
        }

    # High temperature
    if reading["temperature_c"] > THRESHOLDS["temp_high_c"]:
        events.append(_event(
            "HIGH_TEMPERATURE", "WARNING",
            reading["temperature_c"], THRESHOLDS["temp_high_c"],
        ))

    # Low power output
    rated_power = STC["power_w"]
    pct = 100 * reading["power_w"] / rated_power if rated_power else 0
    if pct < THRESHOLDS["power_low_pct"] and reading["irradiance_wm2"] > 200:
        events.append(_event(
            "LOW_POWER_OUTPUT", "WARNING",
            round(pct, 1), THRESHOLDS["power_low_pct"],
        ))

    # Low voltage
    if reading["voltage_v"] < THRESHOLDS["voltage_low_v"] and reading["irradiance_wm2"] > 200:
        events.append(_event(
            "LOW_VOLTAGE", "CAUTION",
            reading["voltage_v"], THRESHOLDS["voltage_low_v"],
        ))

    # Open-circuit proxy: very low current but normal irradiance
    if reading["current_a"] < THRESHOLDS["current_low_a"] and reading["irradiance_wm2"] > 200:
        events.append(_event(
            "POSSIBLE_OPEN_CIRCUIT", "CRITICAL",
            reading["current_a"], THRESHOLDS["current_low_a"],
        ))

    return events


# ════════════════════════════════════════════════════════════════════════════
#  CSV I/O
# ════════════════════════════════════════════════════════════════════════════

def _open_csv(path: Path, fields: list[str]):
    """Open CSV for appending; write header if new file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    is_new = not path.exists()
    fh = open(path, "a", newline="", encoding="utf-8")
    writer = csv.DictWriter(fh, fieldnames=fields)
    if is_new:
        writer.writeheader()
    return fh, writer


# ════════════════════════════════════════════════════════════════════════════
#  Main loop
# ════════════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(
        description="⚠️ SIMULATED solar panel sensor data generator ⚠️"
    )
    parser.add_argument(
        "--fault",
        choices=list(FAULT_SCENARIOS.keys()),
        default="normal",
        help="Fault scenario to inject (default: normal)",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.environ.get("SENSOR_INTERVAL_SECONDS", "5")),
        help="Seconds between readings (default: 5)",
    )
    args = parser.parse_args()

    scenario      = dict(FAULT_SCENARIOS[args.fault])
    scenario["_name"] = args.fault
    interval_sec  = max(0.5, args.interval)

    import io, sys
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    print("=" * 65)
    print("  [!!] SIMULATED SOLAR PANEL SENSOR SIMULATOR [!!]")
    print("  All readings are SYNTHETIC -- not real measurements.")
    print("=" * 65)
    print(f"  Scenario : {args.fault}")
    print(f"  Description: {scenario['description']}")
    print(f"  Interval : {interval_sec}s")
    print(f"  Panels   : {', '.join(PANELS)}")
    print(f"  Readings → {READINGS_CSV}")
    print(f"  Events   → {EVENTS_CSV}")
    print("  Press Ctrl+C to stop.")
    print("-" * 65)

    r_fh, r_writer = _open_csv(READINGS_CSV, READING_FIELDS)
    e_fh, e_writer = _open_csv(EVENTS_CSV,   EVENT_FIELDS)

    reading_count = 0
    event_count   = 0

    try:
        while _RUNNING:
            dt = datetime.now(timezone.utc)

            for panel_id in PANELS:
                reading = generate_reading(panel_id, scenario, dt)
                r_writer.writerow(reading)

                events = detect_events(reading, args.fault)
                if events:
                    for ev in events:
                        e_writer.writerow(ev)
                    event_count += len(events)

            r_fh.flush()
            e_fh.flush()
            reading_count += len(PANELS)

            # Console summary
            sample = generate_reading(PANELS[0], scenario, dt)  # for display
            print(
                f"[{dt.strftime('%H:%M:%S')}]  "
                f"Scenario={args.fault:<16}  "
                f"V={sample['voltage_v']:>6.2f}V  "
                f"I={sample['current_a']:>5.2f}A  "
                f"P={sample['power_w']:>7.2f}W  "
                f"T={sample['temperature_c']:>5.1f}degC  "
                f"Readings={reading_count}  Events={event_count}"
            )

            time.sleep(interval_sec)

    finally:
        r_fh.close()
        e_fh.close()
        print(f"\n[INFO] Stopped. Wrote {reading_count} readings and {event_count} events.")
        print(f"[INFO] Readings: {READINGS_CSV}")
        print(f"[INFO] Events  : {EVENTS_CSV}")


if __name__ == "__main__":
    main()
