# HireSense — Real-Time Voice AI Interview Coach

**HireSense** is a real-time AI-powered mock interview coach you literally *talk to*. It asks you role-specific interview questions **out loud**, listens to your spoken answer, scores it against a rubric, coaches you back with **voice + text**, and hands you a scored report card at the end — all on **free-tier models** (Groq `gpt-oss-120b`, Groq Whisper, and a **local, zero-cost** Kokoro-82M TTS voice).

It also supports optional **resume upload** (PDF, DOCX, or TXT) to generate customized interview questions and provide context-aware feedback based on your actual achievements, skills, and background!

---

## ✨ Features

- **Multi-Step Interview Wizard**: Configure your role, seniority (Junior to Staff), and question count, and verify your equipment before starting.
- **Resume Customization**: Upload a resume (`.pdf`, `.docx`, or `.txt`) to experience an interview tailored directly to your projects, achievements, and technical skills.
- **Interactive Device Check Modal**: Test your microphone with a live Canvas frequency visualizer, toggle mute/unmute status, and automatically verify network latency strength.
- **Low-Latency Voice Loop**: Sentence-by-sentence streaming logic processes Kokoro TTS audio on the fly, speaking answers before the LLM has even finished generating the full text.
- **Barge-in Support**: Speak over the coach at any point to interrupt and start answering.
- **Printable Report Card**: View overall scores, strength badges, and detailed improvement tips at the end of the session, persisting history via SQLite.

---

## 📂 Project Structure

```
.
├── backend/                   # FastAPI Python backend
│   ├── app/
│   │   ├── api/
│   │   │   └── main.py        # REST API endpoints (including resume parsing)
│   │   ├── brain.py           # LLM generation, scoring & coaching router
│   │   ├── prompts.py         # Prompt templates (including resume-aware versions)
│   │   ├── session.py         # Session controller driving WebSocket loop
│   │   └── sessions_store.py  # SQLite-backed persistence
│   ├── tests/                 # 43-test pytest suite (100% keyless)
│   └── requirements.txt       # Backend dependencies (FastAPI, pypdf, python-docx, etc.)
│
├── frontend/                  # React + TypeScript + Vite + TailwindCSS frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── SessionSetup.tsx # Pre-interview wizard form + Verification modal
│   │   │   ├── MicControl.tsx   # PTT and Open Mic handling
│   │   │   └── ReportCard.tsx   # Performance scorecards
│   │   ├── lib/
│   │   │   ├── api.ts           # REST API client (endpoints for resume upload)
│   │   │   └── ws.ts            # WebSocket client for low-latency loop
│   │   └── App.tsx              # Main UI routing and voice-state coordinator
└── README.md
```

---

## 🛠️ Setup & Running Locally

### Prerequisites
- Python 3.11+
- Node 20+
- Groq & Gemini API keys

### 1. Environment Configuration
Copy `.env.example` to `.env` in the project root and provide your keys:
```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
```

### 2. Backend Setup
```bash
cd backend
# Create virtual environment and install dependencies
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt

# Download Kokoro TTS model weights (~310MB)
python scripts/download_models.py

# Verify Kokoro is working
python scripts/smoke_tts.py

# Start the uvicorn development server
python -m uvicorn app.api.main:app --reload --port 8002
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing

### Frontend Typecheck
```bash
cd frontend
npx tsc --noEmit
```

### Backend Tests
Execute the 43-test keyless `pytest` suite:
```bash
cd backend
.venv\Scripts\python.exe -m pytest
```

---

## 🔌 API Summary

| Method | Path | Payload | Description |
| --- | --- | --- | --- |
| **WS** | `/ws/session` | JSON WebSocket Frames | Live interview WebSocket loop |
| **POST** | `/upload_resume` | FormData (file) | Extracts text from PDF, DOCX, and TXT resumes |
| **GET** | `/sessions` | None | Lists past sessions |
| **GET** | `/sessions/{id}` | None | Reopens transcript + rubric scores for a session |
| **DELETE** | `/sessions/{id}` | None | Removes a session |
| **GET** | `/health` | None | Checks Kokoro TTS & Whisper STT readiness |
