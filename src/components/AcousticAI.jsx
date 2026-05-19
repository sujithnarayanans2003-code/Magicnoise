import { useState, useRef, useEffect, useCallback } from "react";
import { analyzeWithGroq } from "../utils/groqApi";

const AUDIO_MODES = ["Cinema", "Music", "Lecture", "Gaming", "Podcast", "Voice", "VR/AR"];
const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const DEFAULT_EQ = Object.fromEntries(EQ_BANDS.map((b) => [b, 0]));
const DSP_DEFAULTS = { echoCancellation: false, beamforming: false, spatialWidth: 50, bassBoost: 0 };

const SYSTEM_PROMPT = `You are SonicMind AI, an expert acoustic engineer.
When given room, mode, and listener data, respond ONLY with a JSON object in this exact shape:
{
  "eq": { "32": 0, "64": 0, "125": 0, "250": 0, "500": 0, "1000": 0, "2000": 0, "4000": 0, "8000": 0, "16000": 0 },
  "dsp": { "echoCancellation": false, "beamforming": false, "spatialWidth": 50, "bassBoost": 0 },
  "analysis": "Brief explanation of the recommendations."
}
EQ values are in dB, range -12 to +12. spatialWidth 0-100. bassBoost 0-12.`;

// ── Audio Engine ────────────────────────────────────────────────────────────

function createAudioEngine() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Analyser for visualizer
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  // 10-band EQ chain
  const filters = EQ_BANDS.map((freq) => {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = freq;
    f.Q.value = 1.4;
    f.gain.value = 0;
    return f;
  });

  // Bass boost (low-shelf)
  const bassBoostFilter = ctx.createBiquadFilter();
  bassBoostFilter.type = "lowshelf";
  bassBoostFilter.frequency.value = 200;
  bassBoostFilter.gain.value = 0;

  // Spatial width via splitter/merger
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const leftGain = ctx.createGain();
  const rightGain = ctx.createGain();
  leftGain.gain.value = 1;
  rightGain.gain.value = 1;

  // Master gain
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1;

  // Chain: source → filters → bassBoost → splitter → L/R gains → merger → analyser → destination
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  filters[filters.length - 1].connect(bassBoostFilter);
  bassBoostFilter.connect(splitter);
  splitter.connect(leftGain, 0);
  splitter.connect(rightGain, 1);
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);
  merger.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  return { ctx, analyser, filters, bassBoostFilter, leftGain, rightGain, masterGain };
}

// ── Main Component ──────────────────────────────────────────────────────────

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

  // Audio state
  const [audioSource, setAudioSource] = useState(null); // "file" | "mic"
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const audioRef = useRef(null); // HTMLAudioElement
  const engineRef = useRef(null);
  const sourceNodeRef = useRef(null); // MediaElementSourceNode or MediaStreamSourceNode
  const micStreamRef = useRef(null);
  const fileInputRef = useRef(null);
  const timeRef = useRef(0);

  // ── Engine management ──────────────────────────────────────────────────

  function getEngine() {
    if (!engineRef.current) {
      engineRef.current = createAudioEngine();
    }
    return engineRef.current;
  }

  function disconnectSource() {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch (_) {}
      sourceNodeRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }

  // ── Apply EQ to audio engine ───────────────────────────────────────────

  const applyEqToEngine = useCallback((eqValues) => {
    if (!engineRef.current) return;
    const { filters } = engineRef.current;
    EQ_BANDS.forEach((freq, i) => {
      if (filters[i]) filters[i].gain.value = eqValues[freq] ?? 0;
    });
  }, []);

  const applyDspToEngine = useCallback((dspValues) => {
    if (!engineRef.current) return;
    const { bassBoostFilter, leftGain, rightGain, masterGain } = engineRef.current;

    bassBoostFilter.gain.value = dspValues.bassBoost ?? 0;

    const width = (dspValues.spatialWidth ?? 50) / 100;
    leftGain.gain.value = 0.5 + width * 0.5;
    rightGain.gain.value = 0.5 + width * 0.5;

    masterGain.gain.value = volume;
  }, [volume]);

  useEffect(() => { applyEqToEngine(eq); }, [eq, applyEqToEngine]);
  useEffect(() => { applyDspToEngine(dsp); }, [dsp, applyDspToEngine]);

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.masterGain.gain.value = volume;
    }
    if (audioRef.current) audioRef.current.volume = 1; // managed by Web Audio
  }, [volume]);

  // ── File upload ────────────────────────────────────────────────────────

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    stopMic();
    disconnectSource();

    const engine = getEngine();
    if (engine.ctx.state === "suspended") await engine.ctx.resume();

    const url = URL.createObjectURL(file);

    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
    }

    const audio = new Audio();
    audio.src = url;
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("ended", () => setIsPlaying(false));

    const srcNode = engine.ctx.createMediaElementSource(audio);
    srcNode.connect(engine.filters[0]);
    sourceNodeRef.current = srcNode;

    setFileName(file.name);
    setAudioSource("file");
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    applyEqToEngine(eq);
    applyDspToEngine(dsp);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    const engine = getEngine();
    if (engine.ctx.state === "suspended") engine.ctx.resume();

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  }

  function handleSeek(e) {
    if (audioRef.current) {
      audioRef.current.currentTime = Number(e.target.value);
      setCurrentTime(Number(e.target.value));
    }
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  // ── Microphone ─────────────────────────────────────────────────────────

  async function toggleMic() {
    if (isMicActive) {
      stopMic();
    } else {
      await startMic();
    }
  }

  async function startMic() {
    try {
      if (audioRef.current) { audioRef.current.pause(); setIsPlaying(false); }
      disconnectSource();

      const constraints = {
        audio: {
          echoCancellation: dsp.echoCancellation,
          noiseSuppression: dsp.beamforming,
          autoGainControl: false,
          channelCount: 2,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;

      const engine = getEngine();
      if (engine.ctx.state === "suspended") await engine.ctx.resume();

      const srcNode = engine.ctx.createMediaStreamSource(stream);
      srcNode.connect(engine.filters[0]);
      sourceNodeRef.current = srcNode;

      setAudioSource("mic");
      setIsMicActive(true);

      applyEqToEngine(eq);
      applyDspToEngine(dsp);
    } catch (err) {
      setError("Microphone access denied. Please allow microphone permission.");
    }
  }

  function stopMic() {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (sourceNodeRef.current && audioSource === "mic") {
      try { sourceNodeRef.current.disconnect(); } catch (_) {}
      sourceNodeRef.current = null;
    }
    setIsMicActive(false);
    setAudioSource(null);
  }

  // ── Visualizer ─────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0a1a";
      ctx.fillRect(0, 0, W, H);

      const engine = engineRef.current;
      if (engine && (isPlaying || isMicActive)) {
        // Real spectrum from AnalyserNode
        const bufferLen = engine.analyser.frequencyBinCount;
        const dataArr = new Uint8Array(bufferLen);
        engine.analyser.getByteFrequencyData(dataArr);

        const barCount = 80;
        const barW = W / barCount - 1;
        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * bufferLen * 0.7);
          const val = dataArr[idx] / 255;
          const h = Math.max(3, val * H * 0.9);
          const x = i * (barW + 1);
          const hue = 200 + (i / barCount) * 160;
          ctx.fillStyle = `hsla(${hue}, 85%, ${40 + val * 30}%, ${0.6 + val * 0.4})`;
          ctx.fillRect(x, H - h, barW, h);
        }

        // Waveform overlay
        const waveArr = new Uint8Array(bufferLen);
        engine.analyser.getByteTimeDomainData(waveArr);
        ctx.beginPath();
        ctx.strokeStyle = "rgba(79,195,247,0.4)";
        ctx.lineWidth = 1.5;
        const sliceW = W / bufferLen;
        let x = 0;
        for (let i = 0; i < bufferLen; i++) {
          const v = waveArr[i] / 128.0;
          const y = (v * H) / 2;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          x += sliceW;
        }
        ctx.stroke();
      } else {
        // Idle animation
        timeRef.current += 0.025;
        const t = timeRef.current;
        const bars = EQ_BANDS.length;
        const barW = W / bars - 2;
        EQ_BANDS.forEach((freq, i) => {
          const gain = eq[freq] || 0;
          const norm = (gain + 12) / 24;
          const wave = Math.sin(t + i * 0.6) * 0.12;
          const h = Math.max(4, (norm + 0.1 + wave) * H * 0.7);
          const x2 = i * (barW + 2) + 1;
          const hue = 200 + i * 14;
          ctx.fillStyle = `hsla(${hue}, 70%, 55%, 0.5)`;
          ctx.fillRect(x2, H - h, barW, h);
        });
      }
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, isMicActive, eq]);

  // ── AI Optimize ────────────────────────────────────────────────────────

  async function handleOptimize() {
    setLoading(true);
    setError("");
    setPhase("scanning");
    await new Promise((r) => setTimeout(r, 600));
    setPhase("analyzing");

    const userPrompt = `
Audio Mode: ${mode}
Audio Source: ${audioSource === "mic" ? "Microphone (live)" : fileName ? `File: ${fileName}` : "No audio loaded"}
Room: size=${roomData.size}, shape=${roomData.shape}, material=${roomData.material}
HRTF: headWidth=${hrtf.headWidth}cm, earSpacing=${hrtf.earSpacing}cm, pinnaHeight=${hrtf.pinnaHeight}cm
Current EQ: ${JSON.stringify(eq)}
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
    const next = { ...eq, [freq]: Number(val) };
    setEq(next);
  }

  function resetEq() {
    setEq(DEFAULT_EQ);
    setAnalysis("");
    setPhase("idle");
  }

  // ── Styles ─────────────────────────────────────────────────────────────

  const S = {
    app: {
      minHeight: "100vh",
      background: "linear-gradient(135deg, #080818 0%, #0d1a2e 50%, #0a0a1a 100%)",
      color: "#e0e8ff",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      padding: "24px",
    },
    header: { textAlign: "center", marginBottom: "28px" },
    title: {
      fontSize: "2.2rem",
      fontWeight: 700,
      background: "linear-gradient(90deg, #4fc3f7, #7c4dff, #4fc3f7)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      margin: 0,
    },
    subtitle: { color: "#7090c0", marginTop: "6px", fontSize: "0.9rem" },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: "18px",
      maxWidth: "1300px",
      margin: "0 auto",
    },
    card: {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(100,150,255,0.15)",
      borderRadius: "16px",
      padding: "18px",
      backdropFilter: "blur(10px)",
    },
    cardTitle: {
      fontSize: "0.78rem",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      color: "#4fc3f7",
      marginBottom: "14px",
    },
    modeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(85px, 1fr))", gap: "7px" },
    modeBtn: (active) => ({
      padding: "8px 4px",
      borderRadius: "8px",
      border: active ? "1px solid #4fc3f7" : "1px solid rgba(255,255,255,0.1)",
      background: active ? "rgba(79,195,247,0.15)" : "rgba(255,255,255,0.03)",
      color: active ? "#4fc3f7" : "#8090b0",
      cursor: "pointer",
      fontSize: "0.78rem",
      fontWeight: active ? 600 : 400,
      transition: "all 0.18s",
    }),
    label: { fontSize: "0.78rem", color: "#7090c0", display: "block", marginBottom: "4px" },
    select: {
      width: "100%",
      padding: "7px 10px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(100,150,255,0.2)",
      borderRadius: "8px",
      color: "#e0e8ff",
      marginBottom: "10px",
      fontSize: "0.88rem",
    },
    input: {
      width: "100%",
      padding: "7px 10px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(100,150,255,0.2)",
      borderRadius: "8px",
      color: "#e0e8ff",
      marginBottom: "10px",
      fontSize: "0.88rem",
      boxSizing: "border-box",
    },
    eqRow: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" },
    eqLabel: { width: "44px", fontSize: "0.72rem", color: "#7090c0", textAlign: "right", flexShrink: 0 },
    eqSlider: { flex: 1, accentColor: "#4fc3f7", cursor: "pointer" },
    eqVal: { width: "34px", fontSize: "0.72rem", color: "#c0d0f0", textAlign: "right", flexShrink: 0 },
    btn: (variant) => ({
      width: "100%",
      padding: "12px",
      borderRadius: "10px",
      border: "none",
      background: variant === "primary"
        ? "linear-gradient(135deg, #4fc3f7, #7c4dff)"
        : variant === "danger"
        ? "rgba(255,80,80,0.2)"
        : "rgba(255,255,255,0.07)",
      color: variant === "danger" ? "#ff8080" : "#fff",
      fontSize: "0.92rem",
      fontWeight: 600,
      cursor: "pointer",
      letterSpacing: "0.03em",
      transition: "opacity 0.2s",
    }),
    iconBtn: (active, color) => ({
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "7px",
      padding: "10px 16px",
      borderRadius: "9px",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.12)"}`,
      background: active ? `${color}22` : "rgba(255,255,255,0.04)",
      color: active ? color : "#8090b0",
      cursor: "pointer",
      fontSize: "0.85rem",
      fontWeight: 600,
      flex: 1,
      transition: "all 0.18s",
    }),
    toggle: (active) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: "7px",
      padding: "7px 12px",
      borderRadius: "8px",
      border: active ? "1px solid #4fc3f7" : "1px solid rgba(255,255,255,0.1)",
      background: active ? "rgba(79,195,247,0.13)" : "rgba(255,255,255,0.03)",
      color: active ? "#4fc3f7" : "#8090b0",
      cursor: "pointer",
      fontSize: "0.82rem",
      marginRight: "8px",
      marginBottom: "8px",
    }),
    canvas: { width: "100%", borderRadius: "10px", background: "#0a0a1a", display: "block" },
    progress: { width: "100%", accentColor: "#4fc3f7", cursor: "pointer" },
    phaseTag: {
      display: "inline-block",
      padding: "3px 10px",
      borderRadius: "20px",
      fontSize: "0.72rem",
      fontWeight: 600,
      background: phase === "done" ? "rgba(79,195,247,0.2)" : "rgba(255,200,80,0.15)",
      color: phase === "done" ? "#4fc3f7" : "#ffc850",
      marginBottom: "10px",
    },
    analysis: {
      background: "rgba(79,195,247,0.07)",
      border: "1px solid rgba(79,195,247,0.2)",
      borderRadius: "10px",
      padding: "12px",
      fontSize: "0.84rem",
      lineHeight: 1.6,
      color: "#c0d8f8",
      marginTop: "10px",
    },
    error: {
      background: "rgba(255,80,80,0.1)",
      border: "1px solid rgba(255,80,80,0.3)",
      borderRadius: "10px",
      padding: "10px",
      color: "#ff8080",
      fontSize: "0.82rem",
      marginTop: "10px",
    },
    fileZone: {
      border: "2px dashed rgba(79,195,247,0.3)",
      borderRadius: "10px",
      padding: "20px",
      textAlign: "center",
      cursor: "pointer",
      marginBottom: "12px",
      background: "rgba(79,195,247,0.03)",
      transition: "all 0.18s",
    },
    playerRow: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" },
    timeLabel: { fontSize: "0.75rem", color: "#7090c0", minWidth: "36px" },
    statusDot: (active, color) => ({
      width: "8px", height: "8px", borderRadius: "50%",
      background: active ? color : "#333",
      boxShadow: active ? `0 0 6px ${color}` : "none",
      flexShrink: 0,
    }),
  };

  return (
    <div style={S.app}>
      <header style={S.header}>
        <h1 style={S.title}>SonicMind AI</h1>
        <p style={S.subtitle}>Acoustic Optimization Engine · Powered by Groq</p>
      </header>

      <div style={S.grid}>

        {/* ── Visualizer ── */}
        <div style={{ ...S.card, gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <div style={S.cardTitle}>Live Spectrum Visualizer</div>
            <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={S.statusDot(isPlaying, "#4fc3f7")} />
              <span style={{ fontSize: "0.72rem", color: isPlaying ? "#4fc3f7" : "#445" }}>
                {isPlaying ? "Playing" : isMicActive ? "Mic Live" : "Idle"}
              </span>
              <div style={S.statusDot(isMicActive, "#f74fc3")} />
              <span style={{ fontSize: "0.72rem", color: isMicActive ? "#f74fc3" : "#445" }}>
                {isMicActive ? "Mic On" : "Mic Off"}
              </span>
            </div>
          </div>
          <canvas ref={canvasRef} width={1200} height={130} style={S.canvas} />
        </div>

        {/* ── Audio Input ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>Audio Input</div>

          {/* File Upload */}
          <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: "none" }}
            onChange={handleFileUpload} />
          <div style={S.fileZone} onClick={() => fileInputRef.current?.click()}>
            <div style={{ fontSize: "1.6rem", marginBottom: "6px" }}>🎵</div>
            <div style={{ fontSize: "0.85rem", color: "#6090c0" }}>
              {fileName ? (
                <span style={{ color: "#4fc3f7", fontWeight: 600 }}>{fileName.length > 30 ? fileName.slice(0, 30) + "…" : fileName}</span>
              ) : (
                <>Click to upload <strong>music or lecture</strong><br />
                <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>MP3, WAV, OGG, M4A, FLAC, AAC…</span></>
              )}
            </div>
          </div>

          {/* Player controls */}
          {audioSource === "file" && (
            <div>
              <div style={S.playerRow}>
                <button style={S.iconBtn(isPlaying, "#4fc3f7")} onClick={togglePlay}>
                  {isPlaying ? "⏸ Pause" : "▶ Play"}
                </button>
                <button style={S.iconBtn(false, "#7090c0")} onClick={() => {
                  if (audioRef.current) { audioRef.current.currentTime = 0; setCurrentTime(0); }
                }}>↩ Reset</button>
              </div>
              <div style={S.playerRow}>
                <span style={S.timeLabel}>{formatTime(currentTime)}</span>
                <input type="range" style={S.progress} min={0} max={duration || 0} step={0.5}
                  value={currentTime} onChange={handleSeek} />
                <span style={S.timeLabel}>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          {/* Microphone */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: "12px", marginTop: "4px" }}>
            <div style={S.cardTitle}>Live Microphone</div>
            <button style={S.iconBtn(isMicActive, "#f74fc3")} onClick={toggleMic}>
              {isMicActive ? "🎙 Stop Microphone" : "🎙 Start Microphone"}
            </button>
            {isMicActive && (
              <div style={{ marginTop: "8px", fontSize: "0.78rem", color: "#f74fc3" }}>
                ● Microphone active — EQ & DSP applied in real-time
              </div>
            )}
          </div>

          {/* Volume */}
          <div style={{ marginTop: "14px" }}>
            <label style={S.label}>Output Volume: {Math.round(volume * 100)}%</label>
            <input type="range" style={{ ...S.eqSlider, width: "100%" }} min={0} max={1} step={0.01}
              value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
          </div>
        </div>

        {/* ── Audio Mode ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>Audio Mode</div>
          <div style={S.modeGrid}>
            {AUDIO_MODES.map((m) => (
              <button key={m} style={S.modeBtn(m === mode)} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>

          <div style={{ marginTop: "18px" }}>
            <div style={S.cardTitle}>Room Acoustic Scan</div>
            <label style={S.label}>Room Size</label>
            <select style={S.select} value={roomData.size} onChange={(e) => setRoomData((p) => ({ ...p, size: e.target.value }))}>
              {["small", "medium", "large", "open plan"].map((v) => <option key={v}>{v}</option>)}
            </select>
            <label style={S.label}>Room Shape</label>
            <select style={S.select} value={roomData.shape} onChange={(e) => setRoomData((p) => ({ ...p, shape: e.target.value }))}>
              {["rectangular", "square", "L-shaped", "irregular"].map((v) => <option key={v}>{v}</option>)}
            </select>
            <label style={S.label}>Primary Material</label>
            <select style={S.select} value={roomData.material} onChange={(e) => setRoomData((p) => ({ ...p, material: e.target.value }))}>
              {["hard surfaces", "mixed", "soft furnishings", "acoustic panels", "outdoor"].map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* ── HRTF ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>Ear / Head Scan (HRTF)</div>
          <label style={S.label}>Head Width (cm)</label>
          <input type="number" style={S.input} value={hrtf.headWidth} min={12} max={22}
            onChange={(e) => setHrtf((p) => ({ ...p, headWidth: Number(e.target.value) }))} />
          <label style={S.label}>Ear Spacing (cm)</label>
          <input type="number" style={S.input} value={hrtf.earSpacing} min={12} max={24}
            onChange={(e) => setHrtf((p) => ({ ...p, earSpacing: Number(e.target.value) }))} />
          <label style={S.label}>Pinna Height (cm)</label>
          <input type="number" style={S.input} value={hrtf.pinnaHeight} min={3} max={10}
            onChange={(e) => setHrtf((p) => ({ ...p, pinnaHeight: Number(e.target.value) }))} />

          {/* ── AI Optimize ── */}
          <div style={{ marginTop: "20px" }}>
            <div style={S.cardTitle}>AI Auto-Optimize</div>
            {phase !== "idle" && (
              <div style={S.phaseTag}>
                {phase === "scanning" && "Scanning room..."}
                {phase === "analyzing" && "AI analyzing..."}
                {phase === "done" && "Optimization complete"}
              </div>
            )}
            <button style={{ ...S.btn("primary"), opacity: loading ? 0.6 : 1 }}
              onClick={handleOptimize} disabled={loading}>
              {loading ? "Optimizing…" : "Auto-Optimize with AI"}
            </button>
            {error && <div style={S.error}>{error}</div>}
            {analysis && <div style={S.analysis}><strong>AI Analysis:</strong> {analysis}</div>}
          </div>
        </div>

        {/* ── 10-Band EQ ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>10-Band Parametric EQ</div>
          {EQ_BANDS.map((freq) => (
            <div key={freq} style={S.eqRow}>
              <span style={S.eqLabel}>{freq >= 1000 ? `${freq / 1000}k` : freq} Hz</span>
              <input type="range" style={S.eqSlider} min={-12} max={12} step={0.5}
                value={eq[freq]} onChange={(e) => handleEqChange(freq, e.target.value)} />
              <span style={S.eqVal}>{eq[freq] > 0 ? `+${eq[freq]}` : eq[freq]}</span>
            </div>
          ))}
          <button onClick={resetEq}
            style={{ ...S.btn("secondary"), marginTop: "8px", fontSize: "0.82rem", padding: "8px" }}>
            Reset EQ
          </button>
        </div>

        {/* ── DSP Controls ── */}
        <div style={S.card}>
          <div style={S.cardTitle}>DSP Controls</div>
          <button style={S.toggle(dsp.echoCancellation)}
            onClick={() => setDsp((p) => ({ ...p, echoCancellation: !p.echoCancellation }))}>
            {dsp.echoCancellation ? "✓" : "○"} Echo Cancellation
          </button>
          <button style={S.toggle(dsp.beamforming)}
            onClick={() => setDsp((p) => ({ ...p, beamforming: !p.beamforming }))}>
            {dsp.beamforming ? "✓" : "○"} Noise Suppression
          </button>

          <div style={{ marginTop: "10px" }}>
            <label style={S.label}>Spatial Width: {dsp.spatialWidth}%</label>
            <input type="range" style={{ ...S.eqSlider, width: "100%" }} min={0} max={100}
              value={dsp.spatialWidth} onChange={(e) => setDsp((p) => ({ ...p, spatialWidth: Number(e.target.value) }))} />
          </div>
          <div style={{ marginTop: "12px" }}>
            <label style={S.label}>Bass Boost: +{dsp.bassBoost} dB</label>
            <input type="range" style={{ ...S.eqSlider, width: "100%" }} min={0} max={12}
              value={dsp.bassBoost} onChange={(e) => setDsp((p) => ({ ...p, bassBoost: Number(e.target.value) }))} />
          </div>

          <div style={{ marginTop: "20px", padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "10px" }}>
            <div style={{ ...S.cardTitle, marginBottom: "8px" }}>Audio Status</div>
            <div style={{ fontSize: "0.8rem", color: "#6080a0", lineHeight: 1.8 }}>
              <div>Source: <span style={{ color: "#c0d8f8" }}>
                {audioSource === "file" ? `File — ${fileName}` : audioSource === "mic" ? "Microphone" : "None"}
              </span></div>
              <div>Mode: <span style={{ color: "#c0d8f8" }}>{mode}</span></div>
              <div>EQ: <span style={{ color: "#c0d8f8" }}>
                {Object.values(eq).every((v) => v === 0) ? "Flat" : "Custom"}
              </span></div>
              <div>Bass Boost: <span style={{ color: "#c0d8f8" }}>+{dsp.bassBoost} dB</span></div>
              <div>Spatial Width: <span style={{ color: "#c0d8f8" }}>{dsp.spatialWidth}%</span></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
