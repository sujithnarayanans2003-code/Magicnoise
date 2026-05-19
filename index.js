import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "1mb" }));

// ── Groq Client ────────────────────────────────────────────────────────────
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

if (!process.env.GROQ_API_KEY) {
  console.warn("⚠  GROQ_API_KEY is not set. Set it in backend/.env");
}

// ── Routes ─────────────────────────────────────────────────────────────────

/** Health check */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: "llama3-70b-8192", provider: "groq" });
});

/**
 * POST /api/analyze
 * Body: { systemPrompt: string, userPrompt: string, jsonMode?: boolean }
 * Returns: { result: string }
 */
app.post("/api/analyze", async (req, res) => {
  const { systemPrompt, userPrompt, jsonMode = false } = req.body;

  if (!userPrompt || typeof userPrompt !== "string") {
    return res.status(400).json({ error: "userPrompt is required and must be a string." });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: "GROQ_API_KEY not configured on server." });
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama3-70b-8192",
      max_tokens: 1024,
      temperature: 0.5,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: userPrompt },
      ],
    });

    const result = chatCompletion.choices?.[0]?.message?.content ?? "";
    return res.json({ result });
  } catch (err) {
    console.error("Groq API error:", err?.message ?? err);
    const status = err?.status ?? 500;
    return res.status(status).json({
      error: err?.message ?? "Unknown error from Groq API.",
    });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 AcousticAI backend running → http://localhost:${PORT}`);
  console.log(`   Model : ${process.env.GROQ_MODEL || "llama3-70b-8192"}`);
  console.log(`   GROQ  : ${process.env.GROQ_API_KEY ? "✓ key loaded" : "✗ missing key"}`);
});
