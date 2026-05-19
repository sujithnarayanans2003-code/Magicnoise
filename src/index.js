import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json({ limit: "1mb" }));

if (!process.env.GROQ_API_KEY) {
  console.warn("⚠  GROQ_API_KEY is not set. AI features will be unavailable.");
}

let _groq = null;
function getGroq() {
  if (!process.env.GROQ_API_KEY) return null;
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: process.env.GROQ_MODEL || "llama3-70b-8192", provider: "groq" });
});

app.post("/api/analyze", async (req, res) => {
  const { systemPrompt, userPrompt, jsonMode = false } = req.body;

  if (!userPrompt || typeof userPrompt !== "string") {
    return res.status(400).json({ error: "userPrompt is required and must be a string." });
  }

  const groq = getGroq();
  if (!groq) {
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
    return res.status(status).json({ error: err?.message ?? "Unknown error from Groq API." });
  }
});

app.listen(PORT, "localhost", () => {
  console.log(`AcousticAI backend running on http://localhost:${PORT}`);
  console.log(`  Model : ${process.env.GROQ_MODEL || "llama3-70b-8192"}`);
  console.log(`  GROQ  : ${process.env.GROQ_API_KEY ? "key loaded" : "missing key - set GROQ_API_KEY"}`);
});
