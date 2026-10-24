# -*- coding: utf-8 -*-
"""
server.py
=========
FastAPI Backend for Solar Farm Fault Detection.

Provides REST endpoints for:
  - Real-time simulated sensor telemetry (Voltage, Current, Power, Temp, Efficiency)
  - Controllable fault scenario injection
  - Visual defect detection with YOLOv8 (Image upload & sample gallery)
  - Detected fault event log
  - CORS enabled for seamless integration with v0 / React / Next.js frontends

Usage
-----
  python scripts/server.py
  (Runs on http://localhost:8000 -- Swagger docs at http://localhost:8000/docs)
"""

import io
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Safe Windows stdout encoding
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw" / "solar_panel_defects"
LOGS_DIR = DATA_DIR / "sensor_logs"
DETECTIONS_DIR = DATA_DIR / "detections"

# Import simulator logic
sys.path.append(str(ROOT / "scripts"))
import sensor_simulator as sim
import detect_defects as detector

app = FastAPI(
    title="AI Solar Farm Fault Detection API",
    description="Backend API providing real-time telemetry, defect detection, and fault management.",
    version="1.0.0"
)

# Enable CORS for any frontend (v0 / Vite / Next.js)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active scenario in memory
current_scenario_name = "normal"

# Latest ESP32 / Wokwi sensor reading stored in memory
import time as _time
_esp32_store = {
    "data": None,          # dict of raw fields from Wokwi
    "received_at": 0.0,    # epoch seconds
    "packet_count": 0
}

ESP32_STALE_SECONDS = 90  # Generous 90s tolerance to prevent rapid reverting to simulation mode

# Per-panel variation seeds (multipliers vs base reading)
_PANEL_VARIATION = {
    "PANEL_001": {"v": 1.00, "i": 1.00, "t": 1.00},
    "PANEL_002": {"v": 0.98, "i": 1.02, "t": 1.01},
    "PANEL_003": {"v": 1.01, "i": 0.97, "t": 0.99},
    "PANEL_004": {"v": 0.99, "i": 1.03, "t": 1.02},
    "PANEL_005": {"v": 1.02, "i": 0.98, "t": 0.98},
}


class ScenarioRequest(BaseModel):
    scenario: str


@app.post("/api/simulator/scenario")
def set_scenario(req: ScenarioRequest):
    global current_scenario_name
    valid_scenarios = list(sim.FAULT_SCENARIOS.keys())
    if req.scenario not in valid_scenarios:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scenario '{req.scenario}'. Valid options: {valid_scenarios}"
        )
    current_scenario_name = req.scenario
    return {
        "success": True,
        "active_scenario": current_scenario_name,
        "message": f"Fault scenario switched to {current_scenario_name}"
    }


@app.get("/api/health")
def get_health():
    return {
        "status": "healthy",
        "dataset_ready": (RAW_DIR / "data.yaml").exists(),
        "active_fault_scenario": current_scenario_name,
        "timestamp_utc": datetime.now(timezone.utc).isoformat()
    }


# In-memory maintenance tickets database
maintenance_tickets = []


def get_panel_recommendation(reading: dict, events: list) -> dict:
    if not events:
        return {
            "diagnostic": "Operating within optimal efficiency curve.",
            "recommended_action": "No intervention required. Keep under standard monitoring.",
            "urgency": "P0 - Routine",
            "technician_required": False
        }

    event_types = [e["event_type"] for e in events]

    if "HIGH_TEMPERATURE" in event_types:
        return {
            "diagnostic": f"Cell temperature at {reading['temperature_c']}°C exceeds safe threshold (60°C). Risk of bypass diode failure and thermal derating.",
            "recommended_action": "Inspect backside airflow and module junction box. Clean cooling intakes on string inverter. If temperature does not drop, dispatch technician to test for bypass diode failure.",
            "urgency": "P1 - High Priority",
            "technician_required": True
        }
    elif "POSSIBLE_OPEN_CIRCUIT" in event_types:
        return {
            "diagnostic": f"Open circuit detected! Panel is under irradiance ({reading['irradiance_wm2']} W/m²) but current is near zero ({reading['current_a']} A).",
            "recommended_action": "Immediate electrical check: verify DC disconnect switch, string fuses, and inspect MC4 connectors for loose or damaged crimps.",
            "urgency": "P1 - Urgent Intervention",
            "technician_required": True
        }
    elif "LOW_POWER_OUTPUT" in event_types:
        return {
            "diagnostic": f"Power output is {reading['power_w']} W, well below rated standard under current solar irradiance.",
            "recommended_action": "Likely caused by surface dust, bird drop soiling, or localized shading. Schedule robotic/manual cleaning cycle with demineralized water.",
            "urgency": "P2 - Scheduled Maintenance",
            "technician_required": False
        }
    elif "LOW_VOLTAGE" in event_types:
        return {
            "diagnostic": f"Voltage ({reading['voltage_v']} V) has dropped below 28V operational threshold.",
            "recommended_action": "Check string for partial shading or damaged cell substring. Verify bypass diode conduction.",
            "urgency": "P2 - Scheduled Maintenance",
            "technician_required": True
        }
    else:
        return {
            "diagnostic": "Unusual sensor telemetry variance detected.",
            "recommended_action": "Monitor trend over the next 15 minutes. Dispatch field tech if condition persists.",
            "urgency": "P2 - Scheduled Maintenance",
            "technician_required": False
        }


# --------------------------------------------------------------------------
# ESP32 Wokwi Sensor Ingestion Endpoint
# --------------------------------------------------------------------------
class ESP32SensorPayload(BaseModel):
    voltage: float
    current: float
    power: float
    irradiance: float
    panel_temperature: float
    ambient_temperature: float
    energy_kwh: float
    efficiency: float = 0.0
    shading_level: float = 0.0
    sensor_status: str = "OPTIMAL"
    timestamp: Optional[str] = None


@app.post("/api/esp32/data")
def ingest_esp32_data(payload: ESP32SensorPayload):
    """Receives live telemetry from the Wokwi virtual ESP32 sensor."""
    global _esp32_store
    _esp32_store["data"] = payload.model_dump()
    _esp32_store["received_at"] = _time.time()
    _esp32_store["packet_count"] += 1
    return {
        "success": True,
        "packet_id": _esp32_store["packet_count"],
        "message": "ESP32 telemetry ingested"
    }


@app.get("/api/esp32/status")
def get_esp32_status():
    """Returns current ESP32 connection status and latest reading."""
    age = round(_time.time() - _esp32_store["received_at"], 1) if _esp32_store["data"] else None
    return {
        "connected": _esp32_store["data"] is not None and (age or 9999) < ESP32_STALE_SECONDS,
        "packet_count": _esp32_store["packet_count"],
        "age_seconds": age,
        "latest": _esp32_store["data"]
    }


def _build_panels_from_esp32(esp: dict, dt: datetime) -> tuple[list, int]:
    """Map a single ESP32 reading to 5 panel readings with per-panel variation."""
    panels_data = []
    total_power = 0.0
    critical_faults = 0

    status = esp.get("sensor_status", "OPTIMAL")
    is_fault = status not in ("OPTIMAL", "LOW_LIGHT")

    for panel_id in sim.PANELS:
        var = _PANEL_VARIATION[panel_id]
        v = round(esp["voltage"] * var["v"], 2)
        i = round(esp["current"] * var["i"], 2)
        p = round(v * i, 2)
        t = round(esp["panel_temperature"] * var["t"], 1)
        irr = round(esp["irradiance"], 1)
        eff = round(esp.get("efficiency", 0.0), 1)

        alarms = []
        if t > 65.0:
            alarms.append("HIGH_TEMPERATURE")
        if irr > 300 and i < 1.0:
            alarms.append("POSSIBLE_OPEN_CIRCUIT")
        if irr > 300 and p < 50:
            alarms.append("LOW_POWER_OUTPUT")
        if irr > 300 and v < 28.0:
            alarms.append("LOW_VOLTAGE")

        panel_reading = {
            "panel_id": panel_id,
            "timestamp_utc": dt.isoformat(),
            "voltage_v": v,
            "current_a": i,
            "power_w": p,
            "temperature_c": t,
            "irradiance_wm2": irr,
            "efficiency_pct": eff,
            "health_status": "FAULT" if alarms else ("FAULT" if is_fault else "NORMAL"),
            "active_alarms": alarms,
        }

        recom = get_panel_recommendation(
            {"voltage_v": v, "current_a": i, "power_w": p,
             "temperature_c": t, "irradiance_wm2": irr},
            [{"event_type": a} for a in alarms]
        )
        panel_reading["diagnostic"] = recom["diagnostic"]
        panel_reading["recommended_action"] = recom["recommended_action"]
        panel_reading["urgency"] = recom["urgency"]
        panel_reading["technician_required"] = recom["technician_required"]

        if panel_reading["health_status"] == "FAULT":
            critical_faults += 1

        panels_data.append(panel_reading)
        total_power += p

    return panels_data, critical_faults


# --------------------------------------------------------------------------
# Fix get_panel_recommendation to accept both old and new key names
# --------------------------------------------------------------------------
def _safe_get(d, *keys, default=0.0):
    for k in keys:
        if k in d:
            return d[k]
    return default


@app.get("/api/telemetry/live")
def get_live_telemetry():
    """Returns live panel telemetry — uses ESP32 data when fresh, simulation otherwise."""
    dt = datetime.now(timezone.utc)
    age = round(_time.time() - _esp32_store["received_at"], 1) if _esp32_store["received_at"] > 0 else 9999
    # Connected if packet received within 90s OR locked to esp32_live
    use_esp32 = _esp32_store["data"] is not None and (age < ESP32_STALE_SECONDS or current_scenario_name == "esp32_live")

    if use_esp32:
        # ── ESP32 / Wokwi path ──────────────────────────────────────────
        panels_data, critical_faults = _build_panels_from_esp32(_esp32_store["data"], dt)
        data_source = "esp32_wokwi"
    else:
        # ── Simulation fallback ─────────────────────────────────────────
        scenario = dict(sim.FAULT_SCENARIOS.get(current_scenario_name, sim.FAULT_SCENARIOS["normal"]))
        scenario["_name"] = current_scenario_name
        panels_data = []
        critical_faults = 0

        for panel_id in sim.PANELS:
            reading = sim.generate_reading(panel_id, scenario, dt)
            events = sim.detect_events(reading, current_scenario_name)
            recom = get_panel_recommendation(reading, events)

            reading["active_alarms"] = [e["event_type"] for e in events]
            reading["health_status"] = "FAULT" if events else "NORMAL"
            reading["diagnostic"] = recom["diagnostic"]
            reading["recommended_action"] = recom["recommended_action"]
            reading["urgency"] = recom["urgency"]
            reading["technician_required"] = recom["technician_required"]

            if events:
                critical_faults += 1
            panels_data.append(reading)
        data_source = "simulation"

    total_power = sum(p["power_w"] for p in panels_data)
    health_score = max(20, int(100 - (critical_faults * 16.0)))

    return {
        "timestamp_utc": dt.isoformat(),
        "active_scenario": current_scenario_name if not use_esp32 else "esp32_live",
        "total_power_output_w": round(total_power, 2),
        "farm_health_score_pct": health_score,
        "total_panels": len(sim.PANELS),
        "panels_with_faults": critical_faults,
        "data_source": data_source,
        "esp32_raw": _esp32_store["data"],
        "esp32_packet_count": _esp32_store["packet_count"],
        "esp32_age_seconds": age if _esp32_store["received_at"] > 0 else None,
        "panels": panels_data
    }


class DispatchRequest(BaseModel):
    panel_id: str
    issue_type: str
    notes: Optional[str] = "Operator initiated dispatch from dashboard"


@app.post("/api/maintenance/dispatch")
def dispatch_technician(req: DispatchRequest):
    """Allows operators to dispatch maintenance or call technicians for a specific panel."""
    ticket = {
        "ticket_id": f"TKT-{len(maintenance_tickets) + 101}",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "panel_id": req.panel_id,
        "issue_type": req.issue_type,
        "notes": req.notes,
        "assigned_team": "Field Electrical Team Alpha",
        "estimated_arrival": "45 mins",
        "status": "DISPATCHED"
    }
    maintenance_tickets.insert(0, ticket)
    return {
        "success": True,
        "message": f"Maintenance ticket {ticket['ticket_id']} created. Technician team dispatched to {req.panel_id}.",
        "ticket": ticket
    }


@app.get("/api/maintenance/tickets")
def get_maintenance_tickets():
    return {
        "total": len(maintenance_tickets),
        "tickets": maintenance_tickets
    }


@app.get("/api/maintenance/overview")
def get_maintenance_overview():
    """High-level summary of farm health, energy loss, and prioritized action plan."""
    telemetry = get_live_telemetry()
    actions = []
    for p in telemetry["panels"]:
        if p["health_status"] == "FAULT":
            actions.append({
                "panel_id": p["panel_id"],
                "urgency": p["urgency"],
                "issue": ", ".join(p["active_alarms"]),
                "recommended_solution": p["recommended_action"],
                "dispatch_recommended": p["technician_required"]
            })

    # Sort actions by urgency (P1 first)
    actions.sort(key=lambda x: x["urgency"])

    daily_loss_kwh = round((1525.0 - telemetry["total_power_output_w"]) * 5.5 / 1000.0, 2)
    daily_loss_kwh = max(0.0, daily_loss_kwh)

    return {
        "farm_health_score": telemetry["farm_health_score_pct"],
        "active_faults_count": telemetry["panels_with_faults"],
        "estimated_daily_energy_loss_kwh": daily_loss_kwh,
        "estimated_daily_revenue_loss_usd": round(daily_loss_kwh * 0.12, 2),
        "recommended_action_plan": actions,
        "open_maintenance_tickets": len([t for t in maintenance_tickets if t["status"] == "DISPATCHED"])
    }


@app.get("/api/events")
def get_recent_events(limit: int = 50):
    events_csv = LOGS_DIR / "detected_events.csv"
    if not events_csv.exists():
        return {"events": []}

    import csv
    events = []
    with open(events_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            events.append(row)
    return {"total": len(events), "events": events[-limit:]}


@app.get("/api/detect/samples")
def get_sample_images():
    test_dir = RAW_DIR / "test" / "images"
    if not test_dir.exists():
        return {"samples": []}

    all_files = list(test_dir.glob("*.jpg"))
    # Group by category prefix so user gets variety in test samples
    categories = {}
    for f in all_files:
        cat = f.name.split("_")[0]
        categories.setdefault(cat, []).append(f.name)

    diverse_samples = []
    # Pick up to 2-3 from each category
    for cat in ["Electrical", "Physical", "Bird", "Dusty", "Snow", "Clean"]:
        diverse_samples.extend(categories.get(cat, [])[:2])

    # Fill any remaining slots up to 14
    for f in all_files:
        if f.name not in diverse_samples:
            diverse_samples.append(f.name)
        if len(diverse_samples) >= 14:
            break

    return {"samples": diverse_samples}


@app.get("/api/sample/image/{filename}")
def get_sample_image(filename: str):
    img_path = RAW_DIR / "test" / "images" / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Sample image not found")
    return FileResponse(img_path)


@app.post("/api/detect/analyze-sample/{filename}")
def analyze_sample(filename: str):
    img_path = RAW_DIR / "test" / "images" / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Sample image not found")

    result = detector.run_inference(img_path)
    result["annotated_image_url"] = f"/api/detections/image/annotated_{filename}"
    return result


@app.post("/api/detect/upload")
async def analyze_uploaded_image(file: UploadFile = File(...)):
    DETECTIONS_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = DETECTIONS_DIR / f"upload_{file.filename}"

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    result = detector.run_inference(temp_path)
    result["annotated_image_url"] = f"/api/detections/image/annotated_upload_{file.filename}"
    return result


@app.get("/api/detections/image/{filename}")
def get_annotated_image(filename: str):
    img_path = DETECTIONS_DIR / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Annotated image not found")
    return FileResponse(img_path)


def main():
    import uvicorn
    print("=" * 60)
    print("  Solar Farm Fault Detection API Server")
    print("  Live at: http://localhost:8000")
    print("  API Docs: http://localhost:8000/docs")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
