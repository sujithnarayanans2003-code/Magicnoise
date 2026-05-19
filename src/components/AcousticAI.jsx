import { useState, useRef, useEffect } from "react";
import { analyzeWithGroq } from "../utils/groqApi";

const AUDIO_MODES = ["Cinema", "Music", "Lecture", "Gaming", "Podcast", "Voice", "VR/AR"];

const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const DEFAULT_EQ = Object.fromEntries(EQ_BANDS.map((b) => [b, 0]));

const DSP_DEFAULTS = {
  echoCancellation: false,
  beamforming: false,
  spatialWidth: 50,
  bassBoost: 0,
};

const SYSTEM_PROMPT = `You are SonicMind AI, an expert acoustic engineer. 
When given room and listener data, respond ONLY with a JSON object in this exact shape:
{
  "eq": { "32": 0, "64": 0, "125": 0, "250": 0, "500": 0, "1000": 0, "2000": 0, "4000": 0, "8000": 0, "16000": 0 },
  "dsp": { "echoCancellation": false, "beamforming": false, "spatialWidth": 50, "bassBoost": 0 },
  "analysis": "Brief explanation of the recommendations."
}
EQ values are in dB, range -12 to +12. spatialWidth 0-100. bassBoost 0-12.`;

export default function AcousticAI() {
  const [mode, setMode] = useState("Music");
  const [eq, setEq] = useState(DEFAULT_EQ);
  const [dsp, setDsp] = useState(DSP_DEFAULTS);
  const [roomData, setRoomData] = useState({ size: "medium", shape: "rectangular", material: "mixed" });
  const [hrtf, setHrtf] = useState({ headWidth: 15, earSpacing: 17, pinnaHeight: 6 });
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("idle");
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    function draw() {
      timeRef.current += 0.03;
      const t = timeRef.current;
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "#0a0a1a";
      ctx.fillRect(0, 0, W, H);

      const bars = EQ_BANDS.length;
      const barW = W / bars - 2;
      EQ_BANDS.forEach((freq, i) => {
        const gain = eq[freq] || 0;
        const norm = (gain + 12) / 24;
        const wave = Math.sin(t + i * 0.5) * 0.15;
        const h = Math.max(4, (norm + wave) * H * 0.8);
        const x = i * (barW + 2) + 1;
        const y = H - h;
        const hue = 200 + i * 12;
        ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
        ctx.fillRect(x, y, barW, h);
      });

      const cx = W / 2;
      const cy = H / 2;
      const r = Math.min(W, H) * 0.35;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const wobble = 1 + 0.05 * Math.sin(t * 2 + a * 6);
        const px = cx + Math.cos(a) * r * wobble;
        const py = cy + Math.sin(a) * r * wobble;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(100, 200, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [eq]);

  async function handleOptimize() {
    setLoading(true);
    setError("");
    setPhase("scanning");

    await new Promise((r) => setTimeout(r, 800));
    setPhase("analyzing");

    const userPrompt = `
Audio Mode: ${mode}
Room: size=${roomData.size}, shape=${roomData.shape}, material=${roomData.material}
HRTF: headWidth=${hrtf.headWidth}cm, earSpacing=${hrtf.earSpacing}cm, pinnaHeight=${hrtf.pinnaHeight}cm
Optimize the EQ and DSP settings for the best acoustic experience.`;

    try {
      const { result } = await analyzeWithGroq({ systemPrompt: SYSTEM_PROMPT, userPrompt, jsonMode: true });
      const parsed = JSON.parse(result);
      if (parsed.eq) setEq((prev) => ({ ...prev, ...parsed.eq }));
      if (parsed.dsp) setDsp((prev) => ({ ...prev, ...parsed.dsp }));
      if (parsed.analysis) setAnalysis(parsed.analysis);
      setPhase("done");
    } catch (e) {
      setError(e.message || "Failed to get AI recommendations.");
      setPhase("idle");
    } finally {
      setLoading(false);
    }
  }

  function handleEqChange(freq, val) {
    setEq((prev) => ({ ...prev, [freq]: Number(val) }));
  }

  function resetEq() {
    setEq(DEFAULT_EQ);
    setAnalysis("");
    setPhase("idle");
  }

  const styles = {
    app: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #080818 0%, #0d1a2e 50%, #0a0a1a 100%)",
      color: "#e0e8ff",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: "24px",
    },
    header: {
      textAlign: "center",
      marginBottom: "32px",
    },
    title: {
      fontSize: "2.4rem",
      fontWeight: 700,
      background: "linear-gradient(90deg, #4fc3f7, #7c4dff, #4fc3f7)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      margin: 0,
    },
    subtitle: { color: "#7090c0", marginTop: "6px", fontSize: "0.95rem" },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
      gap: "20px",
      maxWidth: "1200px",
      margin: "0 auto",
    },
    card: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(100,150,255,0.15)",
      borderRadius: "16px",
      padding: "20px",
      backdropFilter: "blur(10px)",
    },
    cardTitle: {
      fontSize: "0.85rem",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      color: "#4fc3f7",
      marginBottom: "16px",
    },
    modeGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
      gap: "8px",
    },
    modeBtn: (active) => ({
      padding: "8px 4px",
      borderRadius: "8px",
      border: active ? "1px solid #4fc3f7" : "1px solid rgba(255,255,255,0.1)",
      background: active ? "rgba(79,195,247,0.15)" : "rgba(255,255,255,0.03)",
      color: active ? "#4fc3f7" : "#8090b0",
      cursor: "pointer",
      fontSize: "0.8rem",
      fontWeight: active ? 600 : 400,
      transition: "all 0.2s",
    }),
    label: { fontSize: "0.8rem", color: "#7090c0", display: "block", marginBottom: "4px" },
    select: {
      width: "100%",
      padding: "8px 12px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(100,150,255,0.2)",
      borderRadius: "8px",
      color: "#e0e8ff",
      marginBottom: "12px",
      fontSize: "0.9rem",
    },
    input: {
      width: "100%",
      padding: "8px 12px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(100,150,255,0.2)",
      borderRadius: "8px",
      color: "#e0e8ff",
      marginBottom: "12px",
      fontSize: "0.9rem",
      boxSizing: "border-box",
    },
    eqRow: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      marginBottom: "10px",
    },
    eqLabel: { width: "50px", fontSize: "0.75rem", color: "#7090c0", textAlign: "right" },
    eqSlider: { flex: 1, accentColor: "#4fc3f7" },
    eqVal: { width: "36px", fontSize: "0.75rem", color: "#c0d0f0", textAlign: "right" },
    toggle: (active) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 14px",
      borderRadius: "8px",
      border: active ? "1px solid #4fc3f7" : "1px solid rgba(255,255,255,0.1)",
      background: active ? "rgba(79,195,247,0.15)" : "rgba(255,255,255,0.03)",
      color: active ? "#4fc3f7" : "#8090b0",
      cursor: "pointer",
      fontSize: "0.85rem",
      marginRight: "8px",
      marginBottom: "8px",
    }),
    btn: {
      width: "100%",
      padding: "14px",
      borderRadius: "12px",
      border: "none",
      background: loading
        ? "rgba(79,195,247,0.3)"
        : "linear-gradient(135deg, #4fc3f7, #7c4dff)",
      color: "#fff",
      fontSize: "1rem",
      fontWeight: 700,
      cursor: loading ? "not-allowed" : "pointer",
      letterSpacing: "0.05em",
    },
    analysis: {
      background: "rgba(79,195,247,0.07)",
      border: "1px solid rgba(79,195,247,0.2)",
      borderRadius: "10px",
      padding: "14px",
      fontSize: "0.875rem",
      lineHeight: 1.6,
      color: "#c0d8f8",
      marginTop: "12px",
    },
    error: {
      background: "rgba(255,80,80,0.1)",
      border: "1px solid rgba(255,80,80,0.3)",
      borderRadius: "10px",
      padding: "12px",
      color: "#ff8080",
      fontSize: "0.875rem",
      marginTop: "12px",
    },
    phaseTag: {
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: "20px",
      fontSize: "0.75rem",
      fontWeight: 600,
      background: phase === "done" ? "rgba(79,195,247,0.2)" : "rgba(255,200,80,0.15)",
      color: phase === "done" ? "#4fc3f7" : "#ffc850",
      marginBottom: "12px",
    },
    canvas: {
      width: "100%",
      borderRadius: "10px",
      background: "#0a0a1a",
      display: "block",
    },
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>SonicMind AI</h1>
        <p style={styles.subtitle}>Acoustic Optimization Engine · Powered by Groq</p>
      </header>

      <div style={styles.grid}>
        {/* Visualizer */}
        <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={styles.cardTitle}>Live Spectrum Visualizer</div>
          <canvas ref={canvasRef} width={900} height={120} style={styles.canvas} />
        </div>

        {/* Audio Mode */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Audio Mode</div>
          <div style={styles.modeGrid}>
            {AUDIO_MODES.map((m) => (
              <button key={m} style={styles.modeBtn(m === mode)} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Room Setup */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Room Acoustic Scan</div>
          <label style={styles.label}>Room Size</label>
          <select style={styles.select} value={roomData.size} onChange={(e) => setRoomData((p) => ({ ...p, size: e.target.value }))}>
            {["small", "medium", "large", "open plan"].map((v) => <option key={v}>{v}</option>)}
          </select>
          <label style={styles.label}>Room Shape</label>
          <select style={styles.select} value={roomData.shape} onChange={(e) => setRoomData((p) => ({ ...p, shape: e.target.value }))}>
            {["rectangular", "square", "L-shaped", "irregular"].map((v) => <option key={v}>{v}</option>)}
          </select>
          <label style={styles.label}>Primary Material</label>
          <select style={styles.select} value={roomData.material} onChange={(e) => setRoomData((p) => ({ ...p, material: e.target.value }))}>
            {["hard surfaces", "mixed", "soft furnishings", "acoustic panels", "outdoor"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>

        {/* HRTF */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Ear / Head Scan (HRTF)</div>
          <label style={styles.label}>Head Width (cm)</label>
          <input type="number" style={styles.input} value={hrtf.headWidth} min={12} max={22}
            onChange={(e) => setHrtf((p) => ({ ...p, headWidth: Number(e.target.value) }))} />
          <label style={styles.label}>Ear Spacing (cm)</label>
          <input type="number" style={styles.input} value={hrtf.earSpacing} min={12} max={24}
            onChange={(e) => setHrtf((p) => ({ ...p, earSpacing: Number(e.target.value) }))} />
          <label style={styles.label}>Pinna Height (cm)</label>
          <input type="number" style={styles.input} value={hrtf.pinnaHeight} min={3} max={10}
            onChange={(e) => setHrtf((p) => ({ ...p, pinnaHeight: Number(e.target.value) }))} />
        </div>

        {/* EQ */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>10-Band Parametric EQ</div>
          {EQ_BANDS.map((freq) => (
            <div key={freq} style={styles.eqRow}>
              <span style={styles.eqLabel}>{freq >= 1000 ? `${freq / 1000}k` : freq}</span>
              <input type="range" style={styles.eqSlider} min={-12} max={12} step={0.5}
                value={eq[freq]} onChange={(e) => handleEqChange(freq, e.target.value)} />
              <span style={styles.eqVal}>{eq[freq] > 0 ? `+${eq[freq]}` : eq[freq]}</span>
            </div>
          ))}
          <button onClick={resetEq} style={{ ...styles.btn, background: "rgba(255,255,255,0.08)", marginTop: "8px", fontSize: "0.85rem", padding: "8px" }}>
            Reset EQ
          </button>
        </div>

        {/* DSP + AI */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>DSP Controls</div>
          <button style={styles.toggle(dsp.echoCancellation)} onClick={() => setDsp((p) => ({ ...p, echoCancellation: !p.echoCancellation }))}>
            {dsp.echoCancellation ? "✓" : "○"} Echo Cancel
          </button>
          <button style={styles.toggle(dsp.beamforming)} onClick={() => setDsp((p) => ({ ...p, beamforming: !p.beamforming }))}>
            {dsp.beamforming ? "✓" : "○"} Beamforming
          </button>
          <div style={{ marginTop: "12px" }}>
            <label style={styles.label}>Spatial Width: {dsp.spatialWidth}%</label>
            <input type="range" style={{ ...styles.eqSlider, width: "100%" }} min={0} max={100}
              value={dsp.spatialWidth} onChange={(e) => setDsp((p) => ({ ...p, spatialWidth: Number(e.target.value) }))} />
          </div>
          <div style={{ marginTop: "12px" }}>
            <label style={styles.label}>Bass Boost: +{dsp.bassBoost} dB</label>
            <input type="range" style={{ ...styles.eqSlider, width: "100%" }} min={0} max={12}
              value={dsp.bassBoost} onChange={(e) => setDsp((p) => ({ ...p, bassBoost: Number(e.target.value) }))} />
          </div>

          <div style={{ marginTop: "24px" }}>
            <div style={styles.cardTitle}>AI Auto-Optimize</div>
            {phase !== "idle" && (
              <div style={styles.phaseTag}>
                {phase === "scanning" && "Scanning room..."}
                {phase === "analyzing" && "AI analyzing..."}
                {phase === "done" && "Optimization complete"}
              </div>
            )}
            <button style={styles.btn} onClick={handleOptimize} disabled={loading}>
              {loading ? "Optimizing..." : "Auto-Optimize with AI"}
            </button>
            {error && <div style={styles.error}>{error}</div>}
            {analysis && <div style={styles.analysis}><strong>AI Analysis:</strong> {analysis}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
