/*
  ========================================================================
  SolarWatch AI — Virtual Sensor Dashboard Controller (script.js)
  ========================================================================
  Polls Flask backend every 2s, safely updates DOM textContent,
  manages real-time Chart.js waveforms, and evaluates rule-based faults.
*/

// Configuration
const FLASK_BACKEND_URL = "http://127.0.0.1:5000/sensor";
const POLL_INTERVAL_MS = 2000;

// State
let activeMetric = "power";
let telemetryHistory = {
  labels: [],
  power: [],
  voltage: [],
  current: [],
  temp: []
};

// DOM References
const elVoltage       = document.getElementById("val-voltage");
const elCurrent       = document.getElementById("val-current");
const elPower         = document.getElementById("val-power");
const elIrradiance    = document.getElementById("val-irradiance");
const elPanelTemp     = document.getElementById("val-panel-temp");
const elAmbientTemp   = document.getElementById("val-ambient-temp");
const elEnergy        = document.getElementById("val-energy");
const elEfficiency    = document.getElementById("val-efficiency");
const elShading       = document.getElementById("val-shading");
const elStatus        = document.getElementById("val-status");
const elTimestamp     = document.getElementById("val-timestamp");

const elStatusDot     = document.getElementById("status-indicator");
const elConnectionText = document.getElementById("connection-text");
const elFaultAlert    = document.getElementById("fault-alert-box");
const elFaultTitle    = document.getElementById("fault-title");
const elFaultDesc     = document.getElementById("fault-desc");
const elFaultSeverity = document.getElementById("fault-severity");

// ----------------------------------------------------------------------
// Chart.js Setup
// ----------------------------------------------------------------------
let chartInstance = null;

function initChart() {
  const ctx = document.getElementById("telemetryChart").getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Power (W)",
        data: [],
        borderColor: "#00e5ff",
        backgroundColor: "rgba(0, 229, 255, 0.15)",
        borderWidth: 2,
        tension: 0.35,
        fill: true,
        pointRadius: 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      scales: {
        x: {
          grid: { color: "#1e263d" },
          ticks: { color: "#64748b", font: { family: "monospace", size: 10 } }
        },
        y: {
          grid: { color: "#1e263d" },
          ticks: { color: "#64748b", font: { family: "monospace", size: 10 } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0d121d",
          titleColor: "#94a3b8",
          bodyColor: "#00e5ff",
          borderColor: "#1e263d",
          borderWidth: 1,
          padding: 8,
          bodyFont: { family: "monospace" }
        }
      }
    }
  });
}

function switchMetric(metric) {
  activeMetric = metric;

  // Update button active states
  document.querySelectorAll(".btn-metric").forEach(btn => {
    btn.classList.remove("active");
  });
  if (event && event.target) {
    event.target.classList.add("active");
  }

  // Update chart dataset colors and labels
  let color = "#00e5ff";
  let label = "Power (W)";

  if (metric === "voltage") {
    color = "#38bdf8";
    label = "Voltage (V)";
  } else if (metric === "current") {
    color = "#fbbf24";
    label = "Current (A)";
  } else if (metric === "temp") {
    color = "#f43f5e";
    label = "Cell Temp (°C)";
  }

  chartInstance.data.datasets[0].label = label;
  chartInstance.data.datasets[0].borderColor = color;
  chartInstance.data.datasets[0].backgroundColor = color.replace(")", ", 0.15)").replace("rgb", "rgba").replace("#", "");
  // Simple hex to rgba fallback
  if (color.startsWith("#")) {
    chartInstance.data.datasets[0].backgroundColor = `${color}25`;
  }
  chartInstance.data.datasets[0].data = telemetryHistory[metric];
  chartInstance.update();
}

// ----------------------------------------------------------------------
// Telemetry Ingestion Loop (Polls Flask every 2s)
// ----------------------------------------------------------------------
async function fetchSensorTelemetry() {
  try {
    const response = await fetch(FLASK_BACKEND_URL);
    if (!response.ok) {
      setConnectionStatus("DISCONNECTED", "dot-disconnected");
      triggerFaultAlert("HTTP Error", `Backend returned HTTP ${response.status}`, "CRITICAL");
      return;
    }

    const payload = await response.json();

    if (payload.status === "waiting_for_data") {
      setConnectionStatus("WAITING FOR ESP32", "dot-waiting");
      triggerFaultAlert("Virtual Sensor Inactive", "Flask is running, but no data received from Wokwi yet. Start the Wokwi simulation.", "WARNING");
      return;
    }

    if (payload.status === "stale") {
      setConnectionStatus(`STALE (${payload.age_seconds}s ago)`, "dot-stale");
      triggerFaultAlert("Stale Sensor Data", `No telemetry received for ${payload.age_seconds}s. Check if Wokwi is running.`, "WARNING");
    } else {
      setConnectionStatus("ESP32 ONLINE", "dot-connected");
    }

    if (payload.reading) {
      updateDashboard(payload.reading);
      evaluateRuleBasedFaults(payload.reading, payload.age_seconds);
    }

  } catch (error) {
    setConnectionStatus("BACKEND OFFLINE", "dot-disconnected");
    triggerFaultAlert("Connection Failure", "Cannot reach Flask backend at http://127.0.0.1:5000. Confirm app.py is running.", "CRITICAL");
  }
}

// ----------------------------------------------------------------------
// Update DOM Elements Safely using textContent
// ----------------------------------------------------------------------
function updateDashboard(data) {
  elVoltage.textContent     = Number(data.voltage).toFixed(1);
  elCurrent.textContent     = Number(data.current).toFixed(2);
  elPower.textContent       = Number(data.power).toFixed(1);
  elIrradiance.textContent  = Number(data.irradiance).toFixed(1);
  elPanelTemp.textContent   = Number(data.panel_temperature).toFixed(1);
  elAmbientTemp.textContent = Number(data.ambient_temperature).toFixed(1);
  elEnergy.textContent      = Number(data.energy_kwh).toFixed(4);
  elEfficiency.textContent  = `${Number(data.efficiency).toFixed(1)}%`;
  elShading.textContent     = `${Number(data.shading_level).toFixed(0)}%`;
  elStatus.textContent      = data.sensor_status || "OPTIMAL";

  // Timestamp
  const now = new Date();
  elTimestamp.textContent = now.toLocaleTimeString([], { hour12: false });

  // Update Status Pill Color
  elStatus.className = "meta-pill-val";
  if (data.sensor_status === "OPTIMAL") {
    elStatus.classList.add("status-normal");
  } else if (data.sensor_status === "OVERHEATING" || data.sensor_status === "LOW_VOLTAGE") {
    elStatus.classList.add("status-crit");
  } else {
    elStatus.classList.add("status-warn");
  }

  // Update Chart History Buffer (last 20 points)
  const timeLabel = now.toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
  telemetryHistory.labels.push(timeLabel);
  telemetryHistory.power.push(data.power);
  telemetryHistory.voltage.push(data.voltage);
  telemetryHistory.current.push(data.current);
  telemetryHistory.temp.push(data.panel_temperature);

  if (telemetryHistory.labels.length > 20) {
    telemetryHistory.labels.shift();
    telemetryHistory.power.shift();
    telemetryHistory.voltage.shift();
    telemetryHistory.current.shift();
    telemetryHistory.temp.shift();
  }

  if (chartInstance) {
    chartInstance.data.labels = telemetryHistory.labels;
    chartInstance.data.datasets[0].data = telemetryHistory[activeMetric];
    chartInstance.update();
  }
}

function setConnectionStatus(text, dotClass) {
  elConnectionText.textContent = text;
  elStatusDot.className = `status-dot ${dotClass}`;
}

// ----------------------------------------------------------------------
// Rule-Based Fault Detection (Threshold Heuristics)
// ----------------------------------------------------------------------
function evaluateRuleBasedFaults(data, ageSeconds) {
  if (ageSeconds > 6.0) {
    triggerFaultAlert(
      "Telemetry Timeout Anomaly",
      `Sensor packets delayed by ${ageSeconds} seconds. Check ESP32 WiFi or tunnel latency.`,
      "CRITICAL"
    );
    return;
  }

  // 1. Overheating rule (> 65°C)
  if (data.panel_temperature > 65.0) {
    triggerFaultAlert(
      "Panel Overheating Detected",
      `Cell temperature (${data.panel_temperature}°C) exceeds safe 65°C threshold. Thermal derating active.`,
      "CRITICAL"
    );
    return;
  }

  // 2. Abnormally low voltage under active sunlight (< 28V under > 300 W/m²)
  if (data.irradiance > 300.0 && data.voltage < 28.0) {
    triggerFaultAlert(
      "Abnormally Low String Voltage",
      `Voltage (${data.voltage}V) depressed under high irradiance (${data.irradiance} W/m²). Potential bypass diode conduction.`,
      "WARNING"
    );
    return;
  }

  // 3. Unexpectedly low current under sun (< 1.0A under > 350 W/m²)
  if (data.irradiance > 350.0 && data.current < 1.0) {
    triggerFaultAlert(
      "Unexpectedly Low String Current",
      `Current output (${data.current}A) near zero despite strong sunlight. Check for open-circuit or blown string fuse.`,
      "CRITICAL"
    );
    return;
  }

  // 4. Excessive Shading / Soiling (> 25%)
  if (data.shading_level > 25.0) {
    triggerFaultAlert(
      "Severe Surface Shading / Obstruction",
      `Shading estimate is ${data.shading_level}%. Output capacity severely reduced by physical obstruction.`,
      "WARNING"
    );
    return;
  }

  // Normal Condition: Clear Fault Alert
  clearFaultAlert();
}

function triggerFaultAlert(title, description, severity) {
  elFaultAlert.classList.remove("hidden");
  elFaultAlert.className = `fault-banner severity-${severity.toLowerCase()}`;
  elFaultTitle.textContent = title;
  elFaultDesc.textContent = description;
  elFaultSeverity.textContent = severity;
}

function clearFaultAlert() {
  elFaultAlert.classList.add("hidden");
}

// ----------------------------------------------------------------------
// Initialization
// ----------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initChart();
  fetchSensorTelemetry();
  setInterval(fetchSensorTelemetry, POLL_INTERVAL_MS);
});
