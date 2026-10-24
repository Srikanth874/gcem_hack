"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Zap, Thermometer, Activity, AlertTriangle, CheckCircle2,
  Upload, Send, Eye, Shield, RefreshCw, Wrench, Sun, Clock,
  Flame, BatteryCharging, Gauge, Check, AlertCircle, FileText,
  Sliders, Cpu, Terminal, Wifi, WifiOff
} from "lucide-react"
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts"

const API_BASE = ""

interface PanelTelemetry {
  panel_id: string
  timestamp_utc: string
  voltage_v: number
  current_a: number
  power_w: number
  temperature_c: number
  irradiance_wm2: number
  efficiency_pct: number
  health_status: string
  active_alarms: string[]
  diagnostic: string
  recommended_action: string
  urgency: string
  technician_required: boolean
}

const PANEL_CONFIG: Record<string, { label: string; color: string; rgb: string }> = {
  PANEL_001: { label: "P1", color: "#00e5ff", rgb: "0, 229, 255" },
  PANEL_002: { label: "P2", color: "#fbbf24", rgb: "251, 191, 36" },
  PANEL_003: { label: "P3", color: "#10b981", rgb: "16, 185, 129" },
  PANEL_004: { label: "P4", color: "#c084fc", rgb: "192, 132, 252" },
  PANEL_005: { label: "P5", color: "#f43f5e", rgb: "244, 63, 94" },
}

interface MaintenanceOverview {
  farm_health_score: number
  active_faults_count: number
  estimated_daily_energy_loss_kwh: number
  estimated_daily_revenue_loss_usd: number
  recommended_action_plan: {
    panel_id: string
    urgency: string
    issue: string
    recommended_solution: string
    dispatch_recommended: boolean
  }[]
  open_maintenance_tickets: number
}

interface DetectionResult {
  summary?: {
    total_defects: number
    defect_types: Record<string, number>
  }
  detections: {
    class_name: string
    confidence: number
    maintenance_info?: {
      priority: string
      diagnosis: string
      recommended_action: string
      sop: string[]
      estimated_impact: string
    }
  }[]
  annotated_image_url?: string
}

export default function SCADADashboard() {
  const [telemetry, setTelemetry] = useState<PanelTelemetry[]>([])
  const [farmOverview, setFarmOverview] = useState<MaintenanceOverview | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [activeScenario, setActiveScenario] = useState("normal")
  const [lastSync, setLastSync] = useState<string>("--:--:--")
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(true)
  const [selectedPanel, setSelectedPanel] = useState<string>("PANEL_001")
  const [powerHistory, setPowerHistory] = useState<any[]>([])
  const [dataSource, setDataSource] = useState<"esp32_wokwi" | "simulation">("simulation")
  const [esp32Raw, setEsp32Raw] = useState<any>(null)
  const [esp32PacketCount, setEsp32PacketCount] = useState<number>(0)
  const [esp32Age, setEsp32Age] = useState<number | null>(null)
  
  // Graph controls: All panels or individual panel spotlight
  const [graphFilter, setGraphFilter] = useState<string>("ALL")
  const [graphMetric, setGraphMetric] = useState<"power" | "voltage" | "current" | "temperature">("power")
  
  // AI Defect Detector State
  const [samples, setSamples] = useState<string[]>([])
  const [selectedSample, setSelectedSample] = useState<string>("")
  const [isDetecting, setIsDetecting] = useState(false)
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch telemetry & farm overview
  const fetchData = useCallback(async () => {
    try {
      const [tRes, oRes, eRes] = await Promise.all([
        fetch(`/api/telemetry/live`),
        fetch(`/api/maintenance/overview`),
        fetch(`/api/events?limit=15`)
      ])

      if (tRes.ok) {
        const tData = await tRes.json()
        setTelemetry(tData.panels || [])
        setActiveScenario(tData.active_scenario || "normal")
        
        // Retain ESP32 connection state smoothly without flipping
        if (tData.data_source === "esp32_wokwi") {
          setDataSource("esp32_wokwi")
        } else if (!tData.esp32_raw) {
          setDataSource("simulation")
        }
        
        setEsp32Raw(tData.esp32_raw || null)
        setEsp32PacketCount(tData.esp32_packet_count || 0)
        setEsp32Age(tData.esp32_age_seconds ?? null)
        setIsLiveConnected(true)
        
        // Track history
        const now = new Date().toLocaleTimeString([], { hour12: false })
        setLastSync(now)
        
        setPowerHistory(prev => {
          const newEntry: any = { time: now }
          ;(tData.panels || []).forEach((p: PanelTelemetry) => {
            newEntry[p.panel_id] = p.power_w
            newEntry[`${p.panel_id}_power`] = p.power_w
            newEntry[`${p.panel_id}_voltage`] = p.voltage_v
            newEntry[`${p.panel_id}_current`] = p.current_a
            newEntry[`${p.panel_id}_temperature`] = p.temperature_c
          })
          const updated = [...prev, newEntry]
          return updated.slice(-20) // Keep last 20 readings
        })
      }

      if (oRes.ok) {
        const oData = await oRes.json()
        setFarmOverview(oData)
      }

      if (eRes.ok) {
        const eData = await eRes.json()
        setEvents(eData.events || [])
      }
    } catch {
      // Graceful offline fallback without uncaught console error popups
      setIsLiveConnected(false)
    }
  }, [])

  // Load sample images for one-click testing
  useEffect(() => {
    fetchData()
    fetch(`${API_BASE}/api/detect/samples`)
      .then(res => res.json())
      .then(data => {
        if (data.samples && data.samples.length > 0) {
          setSamples(data.samples)
          setSelectedSample(data.samples[0])
        }
      })
      .catch(err => console.error("Could not fetch samples:", err))

    const interval = setInterval(fetchData, 4000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Change Scenario
  const handleScenarioChange = async (scenario: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/simulator/scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario })
      })
      if (res.ok) {
        setActiveScenario(scenario)
        fetchData()
      }
    } catch (e) {
      console.error("Failed to switch scenario", e)
    }
  }

  // Run AI Defect Detection on Sample
  const handleAnalyzeSample = async (sampleName: string) => {
    if (!sampleName) return
    setIsDetecting(true)
    setDetectionResult(null)
    try {
      const res = await fetch(`${API_BASE}/api/detect/analyze-sample/${sampleName}`, { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setDetectionResult(data)
      }
    } catch (err) {
      console.error("Sample detection error:", err)
    } finally {
      setIsDetecting(false)
    }
  }

  // Run AI Detection on File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsDetecting(true)
    setDetectionResult(null)
    const formData = new FormData()
    formData.append("file", file)
    try {
      const res = await fetch(`${API_BASE}/api/detect/upload`, {
        method: "POST",
        body: formData
      })
      if (res.ok) {
        const data = await res.json()
        setDetectionResult(data)
      }
    } catch (err) {
      console.error("Upload error:", err)
    } finally {
      setIsDetecting(false)
    }
  }

  // Dispatch technician ticket
  const handleDispatch = async (panelId: string, issue: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/maintenance/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panel_id: panelId,
          issue_type: issue || "FAULT_DERATE",
          notes: "Operator manual SCADA dispatch"
        })
      })
      if (res.ok) {
        const data = await res.json()
        setDispatchStatus(`Ticket ${data.ticket.ticket_id} created for ${panelId}!`)
        fetchData()
        setTimeout(() => setDispatchStatus(null), 4000)
      }
    } catch (e) {
      console.error("Dispatch error:", e)
    }
  }

  const activePanel = telemetry.find(p => p.panel_id === selectedPanel) || telemetry[0]
  const totalPower = telemetry.reduce((acc, p) => acc + (p.power_w || 0), 0)
  const avgTemp = telemetry.length ? (telemetry.reduce((acc, p) => acc + p.temperature_c, 0) / telemetry.length).toFixed(1) : "0"
  const faultsCount = farmOverview?.active_faults_count ?? 0

  return (
    <div className="min-h-screen bg-[#07090e] text-[#cbd5e1] p-3 flex flex-col gap-3 font-sans">
      {/* ── TOP SCADA STATUS HEADER BAR ── */}
      <header className="scada-panel p-2.5 flex flex-wrap items-center justify-between gap-3 border-cyan-900/40">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-950/60 border border-cyan-500/30 rounded flex items-center justify-center">
            <Cpu className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wide text-white font-mono">SOLARWATCH-SCADA</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-cyan-950 text-cyan-400 border border-cyan-800 rounded">
                v1.2.0-LIVE
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2">
              <span className="led-dot led-green" />
              <span>STATION: GCEM-SOLAR-ARRAY-01</span>
              <span>•</span>
              <span className="font-mono text-slate-300">SYNC: {lastSync}</span>
            </div>
          </div>
        </div>

        {/* Quick Simulator Control in Header */}
        <div className="flex items-center gap-2 bg-[#0c101c] p-1.5 px-3 rounded border border-slate-800">
          <Sliders className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs font-mono text-slate-300">FAULT SCENARIO:</span>
          <select
            value={activeScenario}
            onChange={(e) => handleScenarioChange(e.target.value)}
            className="bg-[#141b2d] text-xs font-mono text-white border border-slate-700 rounded px-2 py-1 outline-none focus:border-cyan-500"
          >
            <option value="normal">NORMAL (Optimal)</option>
            <option value="high_temperature">HIGH TEMPERATURE</option>
            <option value="reduced_power">REDUCED POWER (Dust/Soil)</option>
            <option value="partial_shading">PARTIAL SHADING</option>
            <option value="open_circuit">OPEN CIRCUIT (String Break)</option>
          </select>
          <button
            onClick={fetchData}
            title="Force refresh"
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Global Key Stats in Header */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <div className="text-[10px] text-slate-400">TOTAL GENERATION</div>
            <div className="text-sm font-bold text-cyan-400">{totalPower.toFixed(1)} W</div>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400">HEALTH SCORE</div>
            <div className={`text-sm font-bold ${faultsCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {farmOverview?.farm_health_score ?? 100}%
            </div>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div className="text-right">
            <div className="text-[10px] text-slate-400">ACTIVE FAULTS</div>
            <div className="text-sm font-bold text-rose-400">{faultsCount}</div>
          </div>
        </div>
      </header>

      {/* ── ESP32 / SIMULATION DATA SOURCE BANNER ── */}
      <div className={`flex flex-wrap items-center justify-between px-4 py-2.5 rounded border font-mono text-xs transition-all gap-2 ${
        dataSource === "esp32_wokwi"
          ? "bg-emerald-950/70 border-emerald-500/60 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
          : "bg-slate-900/60 border-slate-700/50 text-slate-400"
      }`}>
        <div className="flex items-center gap-2 flex-wrap">
          {dataSource === "esp32_wokwi" ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-bold">LIVE ESP32 SENSOR ONLINE</span>
              <span className="text-emerald-600">•</span>
              {esp32Raw ? (
                <div className="flex items-center gap-2 text-[11px] text-emerald-200 bg-emerald-900/50 px-2 py-0.5 rounded border border-emerald-700/50 font-mono">
                  <span>Packet <strong className="text-white">#{esp32PacketCount}</strong></span>
                  <span className="text-emerald-700">|</span>
                  <span>V: <strong className="text-white">{esp32Raw.voltage}V</strong></span>
                  <span className="text-emerald-700">|</span>
                  <span>I: <strong className="text-white">{esp32Raw.current}A</strong></span>
                  <span className="text-emerald-700">|</span>
                  <span>P: <strong className="text-cyan-300">{esp32Raw.power}W</strong></span>
                  <span className="text-emerald-700">|</span>
                  <span>Irr: <strong className="text-amber-300">{esp32Raw.irradiance} W/m²</strong></span>
                  <span className="text-emerald-700">|</span>
                  <span>T: <strong className="text-white">{esp32Raw.panel_temperature}°C</strong></span>
                </div>
              ) : (
                <span>Data streaming from physical ESP32 simulation</span>
              )}
            </>
          ) : (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500"></span>
              <WifiOff className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-bold text-slate-300">SIMULATION MODE</span>
              <span className="text-slate-600">•</span>
              <span>No ESP32 detected — start Wokwi simulation to stream live hardware telemetry</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="opacity-60">SOURCE:</span>
          <span className={`px-2 py-0.5 rounded font-bold ${
            dataSource === "esp32_wokwi"
              ? "bg-emerald-800 text-emerald-100 border border-emerald-600 shadow-sm"
              : "bg-slate-800 text-slate-400 border border-slate-700"
          }`}>
            {dataSource === "esp32_wokwi" ? `WOKWI ESP32 [PKT #${esp32PacketCount}]` : "INTERNAL SIM"}
          </span>
          <span className="opacity-60">SYNC: {lastSync}</span>
        </div>
      </div>

      {/* Dispatch Notification Banner */}
      {dispatchStatus && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 px-4 py-2 rounded text-xs font-mono flex items-center justify-between animate-fadeIn">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            {dispatchStatus}
          </span>
          <span className="text-[10px] opacity-75">Alpha Team Dispatched</span>
        </div>
      )}

      {/* ── ROW 1: 5-PANEL SCADA TELEMETRY GRID ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 min-h-[160px]">
        {telemetry.map((p) => {
          const isFault = p.health_status === "FAULT"
          const isSelected = p.panel_id === selectedPanel
          const cfg = PANEL_CONFIG[p.panel_id] || { color: "#00e5ff", label: p.panel_id }

          return (
            <div
              key={p.panel_id}
              onClick={() => {
                setSelectedPanel(p.panel_id)
                setGraphFilter(p.panel_id)
              }}
              className={`scada-panel p-3 cursor-pointer transition-all border ${
                isSelected ? "border-cyan-400 ring-2 ring-cyan-500/30 scale-[1.01]" : "hover:border-slate-700"
              } ${isFault ? "bg-[#181119]" : ""}`}
            >
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                <div className="flex items-center gap-1.5">
                  <span className={`led-dot ${isFault ? "led-red" : "led-green"}`} />
                  <span className="font-mono text-xs font-bold text-white flex items-center gap-1.5">
                    <span style={{ color: cfg.color }}>●</span>
                    {p.panel_id}
                  </span>
                </div>
                <span className={`scada-tag ${isFault ? "tag-critical" : "tag-normal"}`}>
                  {isFault ? "FAULT" : "NORMAL"}
                </span>
              </div>

              <div className="space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Power:</span>
                  <span className="font-bold text-cyan-300">{p.power_w.toFixed(1)} W</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Voltage:</span>
                  <span>{p.voltage_v.toFixed(1)} V</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Current:</span>
                  <span>{p.current_a.toFixed(2)} A</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Temp:</span>
                  <span className={p.temperature_c > 60 ? "text-rose-400 font-bold" : ""}>
                    {p.temperature_c.toFixed(1)} °C
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Eff:</span>
                  <span className="text-emerald-400">{p.efficiency_pct.toFixed(1)}%</span>
                </div>
              </div>

              {isFault && (
                <div className="mt-2.5 pt-2 border-t border-rose-950/60 flex items-center justify-between">
                  <span className="text-[10px] text-rose-400 font-mono font-semibold truncate max-w-[100px]">
                    {p.active_alarms?.[0] || "ALARM"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDispatch(p.panel_id, p.active_alarms?.[0] || "FAULT")
                    }}
                    className="text-[10px] px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded font-mono font-bold"
                  >
                    DISPATCH
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── ROW 2: DETAILED LIVE INSPECTION & REAL-TIME POWER GRAPH ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 min-h-[340px]">
        {/* Real-time Multi-Panel / Single-Panel Chart */}
        <div className="scada-panel p-3 lg:col-span-2 flex flex-col justify-between">
          <div className="scada-panel-header -mx-3 -mt-3 mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span>REAL-TIME STRING TELEMETRY</span>
              <span className="text-cyan-400 font-mono text-xs">
                {graphFilter === "ALL" ? "5-PANEL COMPARISON" : `${graphFilter} FOCUSED`}
              </span>
            </div>

            {/* Metric Selector Pills */}
            <div className="flex items-center gap-1 bg-[#0b0e17] p-1 rounded border border-slate-800 text-[10px] font-mono">
              <button
                onClick={() => setGraphMetric("power")}
                className={`px-2 py-0.5 rounded transition ${
                  graphMetric === "power" ? "bg-cyan-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                Power (W)
              </button>
              <button
                onClick={() => setGraphMetric("voltage")}
                className={`px-2 py-0.5 rounded transition ${
                  graphMetric === "voltage" ? "bg-cyan-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                Voltage (V)
              </button>
              <button
                onClick={() => setGraphMetric("current")}
                className={`px-2 py-0.5 rounded transition ${
                  graphMetric === "current" ? "bg-cyan-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                Current (A)
              </button>
              <button
                onClick={() => setGraphMetric("temperature")}
                className={`px-2 py-0.5 rounded transition ${
                  graphMetric === "temperature" ? "bg-cyan-600 text-white font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                Temp (°C)
              </button>
            </div>
          </div>

          {/* Panel Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80 font-mono text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400 mr-1">Filter Panel:</span>
              <button
                onClick={() => setGraphFilter("ALL")}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition border ${
                  graphFilter === "ALL"
                    ? "bg-slate-700 text-white border-slate-500 shadow-sm"
                    : "bg-[#0c101c] text-slate-400 border-slate-800 hover:text-white hover:border-slate-700"
                }`}
              >
                All 5 Panels
              </button>
              {Object.keys(PANEL_CONFIG).map((pId) => {
                const cfg = PANEL_CONFIG[pId]
                const isCurrent = graphFilter === pId
                return (
                  <button
                    key={pId}
                    onClick={() => {
                      setGraphFilter(pId)
                      setSelectedPanel(pId)
                    }}
                    style={{
                      borderColor: isCurrent ? cfg.color : undefined,
                      color: isCurrent ? "#ffffff" : cfg.color,
                      backgroundColor: isCurrent ? `rgba(${cfg.rgb}, 0.25)` : "#0c101c"
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition border border-slate-800 hover:border-slate-700 flex items-center gap-1`}
                  >
                    <span>●</span>
                    {cfg.label}
                  </button>
                )
              })}
            </div>

            {/* Quick Stats when a single panel is selected */}
            {graphFilter !== "ALL" && (
              <div className="text-[11px] text-slate-300 font-mono flex items-center gap-3">
                <span>
                  Current:{" "}
                  <strong style={{ color: PANEL_CONFIG[graphFilter]?.color }}>
                    {telemetry.find(p => p.panel_id === graphFilter)?.[
                      graphMetric === "power" ? "power_w" :
                      graphMetric === "voltage" ? "voltage_v" :
                      graphMetric === "current" ? "current_a" : "temperature_c"
                    ]?.toFixed(1) ?? "--"}
                    {graphMetric === "power" ? " W" :
                     graphMetric === "voltage" ? " V" :
                     graphMetric === "current" ? " A" : " °C"}
                  </strong>
                </span>
              </div>
            )}
          </div>

          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {graphFilter === "ALL" ? (
                /* Multi-line Comparison View */
                <LineChart data={powerHistory}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#1e263d" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0c101c", borderColor: "#1e263d", fontSize: "11px", fontFamily: "monospace" }}
                  />
                  {Object.keys(PANEL_CONFIG).map((pId) => {
                    const cfg = PANEL_CONFIG[pId]
                    const dataKey = graphMetric === "power" ? pId : `${pId}_${graphMetric}`
                    return (
                      <Line
                        key={pId}
                        type="monotone"
                        dataKey={dataKey}
                        name={`${pId} (${cfg.label})`}
                        stroke={cfg.color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    )
                  })}
                </LineChart>
              ) : (
                /* Single-Panel Focused Area View */
                <AreaChart data={powerHistory}>
                  <defs>
                    <linearGradient id={`gradient_${graphFilter}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={PANEL_CONFIG[graphFilter]?.color || "#00e5ff"} stopOpacity={0.4}/>
                      <stop offset="95%" stopColor={PANEL_CONFIG[graphFilter]?.color || "#00e5ff"} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 2" stroke="#1e263d" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0c101c", borderColor: "#1e263d", fontSize: "11px", fontFamily: "monospace" }}
                  />
                  <Area
                    type="monotone"
                    dataKey={graphMetric === "power" ? graphFilter : `${graphFilter}_${graphMetric}`}
                    stroke={PANEL_CONFIG[graphFilter]?.color || "#00e5ff"}
                    fill={`url(#gradient_${graphFilter})`}
                    strokeWidth={2}
                    name={graphFilter}
                  />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 mt-2 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-3 flex-wrap">
              {Object.keys(PANEL_CONFIG).map((pId) => {
                const cfg = PANEL_CONFIG[pId]
                const isSelected = graphFilter === pId
                return (
                  <button
                    key={pId}
                    onClick={() => {
                      setGraphFilter(graphFilter === pId ? "ALL" : pId)
                      setSelectedPanel(pId)
                    }}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-800 transition ${
                      isSelected ? "ring-1 ring-cyan-500 font-bold text-white" : ""
                    }`}
                  >
                    <span style={{ color: cfg.color }}>■</span>
                    <span style={{ color: isSelected ? "#ffffff" : cfg.color }}>{cfg.label}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isLiveConnected ? "bg-emerald-400 animate-ping" : "bg-amber-400"}`} />
              <span className={isLiveConnected ? "text-slate-300" : "text-amber-400"}>
                {isLiveConnected ? "LIVE SYNC: 4s" : "CONNECTING..."}
              </span>
            </div>
          </div>
        </div>

        {/* Selected Panel Diagnostics Window */}
        <div className="scada-panel p-3 flex flex-col justify-between">
          <div className="scada-panel-header -mx-3 -mt-3 mb-3">
            <span>SELECTED UNIT: {activePanel?.panel_id}</span>
            <span className={activePanel?.health_status === "FAULT" ? "text-rose-400" : "text-emerald-400"}>
              {activePanel?.health_status}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="bg-[#0b0f1a] p-2.5 rounded border border-slate-800 space-y-1">
              <div className="text-[10px] uppercase font-mono text-slate-400">Diagnosis</div>
              <p className="text-slate-200 text-xs leading-relaxed">
                {activePanel?.diagnostic || "Operating at expected physical parameters."}
              </p>
            </div>

            <div className="bg-[#0b0f1a] p-2.5 rounded border border-slate-800 space-y-1">
              <div className="text-[10px] uppercase font-mono text-slate-400">SOP Action Required</div>
              <p className="text-cyan-300 text-xs leading-relaxed">
                {activePanel?.recommended_action || "Routine monitoring only."}
              </p>
            </div>

            <div className="flex items-center justify-between font-mono text-xs pt-1">
              <span className="text-slate-400">Priority Level:</span>
              <span className="text-amber-400 font-bold">{activePanel?.urgency || "P0 - Normal"}</span>
            </div>
          </div>

          <button
            onClick={() => handleDispatch(activePanel.panel_id, activePanel.active_alarms?.[0] || "MANUAL_CHECK")}
            className="w-full mt-3 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-mono text-xs font-bold transition flex items-center justify-center gap-2"
          >
            <Send className="w-3.5 h-3.5" /> DISPATCH CREW TO {activePanel?.panel_id}
          </button>
        </div>
      </div>

      {/* ── ROW 3: AI DEFECT DETECTION (YOLOv8) & MAINTENANCE SOP ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-[320px]">
        {/* Computer Vision YOLOv8 Detector Panel */}
        <div className="scada-panel p-3">
          <div className="scada-panel-header -mx-3 -mt-3 mb-3">
            <span>AI COMPUTER VISION: YOLOv8 DEFECT DETECTOR</span>
            <span className="text-cyan-400">LIVE INFERENCE</span>
          </div>

          <div className="space-y-3">
            {/* Quick Test Samples Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">Test Sample:</span>
              <select
                value={selectedSample}
                onChange={(e) => {
                  setSelectedSample(e.target.value)
                  handleAnalyzeSample(e.target.value)
                }}
                className="bg-[#141b2d] text-xs font-mono text-white border border-slate-700 rounded px-2 py-1 flex-1 outline-none"
              >
                {samples.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                onClick={() => handleAnalyzeSample(selectedSample)}
                disabled={isDetecting}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono rounded font-bold"
              >
                {isDetecting ? "ANALYZING..." : "SCAN"}
              </button>
            </div>

            {/* Custom Upload or View */}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 border border-dashed border-slate-700 hover:border-cyan-500 rounded bg-[#0b0e17] text-xs font-mono text-slate-300 hover:text-white flex items-center justify-center gap-2 transition"
              >
                <Upload className="w-4 h-4 text-cyan-400" />
                <span>Upload Custom Drone/Panel Photo</span>
              </button>
            </div>

            {/* Detection Image View */}
            <div className="relative bg-[#07090f] rounded border border-slate-800 overflow-hidden"
              style={{ minHeight: "210px", height: "210px" }}>
              {detectionResult?.annotated_image_url ? (
                <img
                  src={`${API_BASE}${detectionResult.annotated_image_url}`}
                  alt="Detected Defects"
                  width={400}
                  height={210}
                  className="w-full h-full object-contain rounded"
                  style={{ aspectRatio: "400 / 210" }}
                />
              ) : selectedSample ? (
                <img
                  src={`${API_BASE}/api/sample/image/${selectedSample}`}
                  alt="Sample Solar Panel"
                  width={400}
                  height={210}
                  className="w-full h-full object-contain opacity-70"
                  style={{ aspectRatio: "400 / 210" }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-center text-xs font-mono text-slate-500">
                  Select a sample or upload an image to run AI defect detection.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Findings & Expert Action Plan */}
        <div className="scada-panel p-3 flex flex-col justify-between">
          <div className="scada-panel-header -mx-3 -mt-3 mb-3">
            <span>DIAGNOSTIC REPORT & SOP RECOMMENDATION</span>
            <span className="font-mono text-xs text-amber-400">
              {detectionResult ? `${detectionResult.summary?.total_defects ?? 0} DEFECTS FOUND` : "READY"}
            </span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[240px] pr-1">
            {detectionResult?.detections && detectionResult.detections.length > 0 ? (
              detectionResult.detections.map((det, idx) => (
                <div key={idx} className="bg-[#0b0e17] border border-slate-800 p-2.5 rounded space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-bold text-rose-400 uppercase">
                      ⚠ {det.class_name} ({(det.confidence * 100).toFixed(1)}%)
                    </span>
                    <span className="scada-tag tag-critical">
                      {det.maintenance_info?.priority || "HIGH"}
                    </span>
                  </div>

                  <p className="text-slate-300 text-[11px]">
                    <strong className="text-slate-400">Diagnosis: </strong>
                    {det.maintenance_info?.diagnosis}
                  </p>

                  <p className="text-cyan-300 text-[11px]">
                    <strong className="text-slate-400">Recommended Action: </strong>
                    {det.maintenance_info?.recommended_action}
                  </p>

                  {det.maintenance_info?.sop && det.maintenance_info.sop.length > 0 && (
                    <div className="pt-1 border-t border-slate-800/80">
                      <span className="text-[10px] font-mono text-slate-400 block mb-1">Standard Operating Procedure:</span>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-400">
                        {det.maintenance_info.sop.map((step, sIdx) => (
                          <li key={sIdx}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))
            ) : detectionResult ? (
              <div className="p-6 text-center text-xs font-mono text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 rounded">
                ✔ Panel surfaces clean and free of visible physical anomalies.
              </div>
            ) : (
              <div className="p-8 text-center text-xs font-mono text-slate-500">
                Click <strong>"SCAN"</strong> above to inspect the solar panel for micro-cracks, dust, bird drop, or physical faults.
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">Financial Impact:</span>
            <span className="text-rose-400 font-bold">
              -${farmOverview?.estimated_daily_revenue_loss_usd ?? 0.00} / day
            </span>
          </div>
        </div>
      </div>

      {/* ── ROW 4: ALARM LOG AUDIT TRAIL ── */}
      <div className="scada-panel p-3">
        <div className="scada-panel-header -mx-3 -mt-3 mb-2">
          <span>EVENT AUDIT TRAIL (CHRONOLOGICAL FAULT LOG)</span>
          <span className="text-slate-400">REAL-TIME LOG</span>
        </div>

        <div className="overflow-x-auto max-h-[140px]">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800 bg-[#090d16]">
                <th className="py-1.5 px-2">TIMESTAMP (UTC)</th>
                <th className="py-1.5 px-2">PANEL</th>
                <th className="py-1.5 px-2">EVENT TYPE</th>
                <th className="py-1.5 px-2">SEVERITY</th>
                <th className="py-1.5 px-2">MEASURED</th>
                <th className="py-1.5 px-2">THRESHOLD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {events.slice(0, 5).map((e, idx) => (
                <tr key={idx} className="hover:bg-slate-900/40">
                  <td className="py-1.5 px-2 text-slate-400">{e.timestamp_utc?.slice(11, 19)}</td>
                  <td className="py-1.5 px-2 font-bold text-white">{e.panel_id}</td>
                  <td className="py-1.5 px-2 text-amber-300">{e.event_type}</td>
                  <td className="py-1.5 px-2">
                    <span className={`scada-tag ${e.severity === "CRITICAL" ? "tag-critical" : "tag-warning"}`}>
                      {e.severity}
                    </span>
                  </td>
                  <td className="py-1.5 px-2">{e.measured_value}</td>
                  <td className="py-1.5 px-2 text-slate-400">{e.threshold_value}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-slate-500">
                    No alarms or threshold crossings recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
