# SonicMind AI 🎵
### Acoustic Optimization Engine · Powered by Groq

A full-stack AI acoustic optimization app featuring room analysis, HRTF personalization, a 10-band parametric EQ, and DSP tuning — all powered by **Groq's ultra-fast LLM inference**.

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 18 + Vite                     |
| Backend  | Node.js + Express                   |
| AI       | Groq API (`llama3-70b-8192`)        |
| Styling  | Pure CSS-in-JS (no extra libraries) |

---

## Project Structure

```
acoustic-ai/
├── package.json            ← root scripts (run both servers together)
├── .gitignore
├── README.md
│
├── backend/
│   ├── package.json
│   ├── .env.example        ← copy to .env and add your Groq key
│   └── src/
│       └── index.js        ← Express server with /api/analyze route
│
└── frontend/
    ├── package.json
    ├── vite.config.js      ← proxies /api → backend in dev
    ├── index.html
    ├── .env.example
    └── src/
        ├── main.jsx
        ├── components/
        │   └── AcousticAI.jsx   ← main React component
        └── utils/
            └── groqApi.js       ← Groq API client (calls backend)
```

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/acoustic-ai.git
cd acoustic-ai
npm run install:all
```

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and add your **Groq API key**:

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
```

Get a free key at → **https://console.groq.com**

### 3. Run (both servers)

```bash
npm run dev
```

- Frontend → http://localhost:5173  
- Backend  → http://localhost:3001

---

## Features

- **Room Acoustic Scan** — simulates sweep-tone measurements, calculates RT60, maps reflections
- **Ear / Head Scan** — generates a personalized HRTF profile from biometric inputs
- **10-Band Parametric EQ** — drag-to-adjust with real-time visualization
- **AI Auto-Optimize** — Groq returns optimal EQ + DSP JSON in one shot
- **Adaptive Learning** — live waveform + spectrum ring respond to mode changes
- **7 Audio Modes** — Cinema, Music, Lecture, Gaming, Podcast, Voice, VR/AR
- **DSP Controls** — echo cancellation, beamforming, spatial width, bass boost

---

## Groq Models

Change the model in `backend/.env`:

| Model                  | Speed     | Quality  |
|------------------------|-----------|----------|
| `llama3-70b-8192`      | Fast      | ⭐⭐⭐⭐⭐ (default) |
| `llama3-8b-8192`       | Very fast | ⭐⭐⭐⭐   |
| `mixtral-8x7b-32768`   | Fast      | ⭐⭐⭐⭐⭐ |
| `gemma2-9b-it`         | Very fast | ⭐⭐⭐⭐   |

---

## Production Deployment

### Backend (Railway / Render / Fly.io)

1. Deploy the `backend/` folder
2. Set `GROQ_API_KEY` as an environment variable
3. Set `FRONTEND_URL` to your frontend's domain (for CORS)

### Frontend (Vercel / Netlify)

1. Deploy the `frontend/` folder, build command: `npm run build`, output: `dist`
2. Set `VITE_API_URL` to your backend's URL

---

## Environment Variables

### Backend (`backend/.env`)

| Variable       | Required | Default              | Description                   |
|----------------|----------|----------------------|-------------------------------|
| `GROQ_API_KEY` | ✅ Yes   | —                    | Your Groq API key             |
| `GROQ_MODEL`   | No       | `llama3-70b-8192`    | Groq model to use             |
| `PORT`         | No       | `3001`               | Express server port           |
| `FRONTEND_URL` | No       | `http://localhost:5173` | Allowed CORS origin        |

### Frontend (`frontend/.env`)

| Variable        | Required | Default | Description                         |
|-----------------|----------|---------|-------------------------------------|
| `VITE_API_URL`  | No       | `""`    | Backend URL (empty = Vite proxy)    |

---

## License

MIT
