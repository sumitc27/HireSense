# HireSense — Real-Time Voice AI Interview Coach

**HireSense** is a real-time AI-powered mock interview coach you literally *talk to*. It asks you role-specific interview questions **out loud**, listens to your spoken answer, scores it against a rubric, coaches you back with **voice + text**, and hands you a scored report card at the end.

This project was built to showcase a full-stack, production-ready AI application featuring real-time WebSockets, robust authentication, rate limiting, and seamless cloud deployment.

### 🌐 Live Demo

- **Frontend:** [HireSense on Vercel](https://hiresense-27th.vercel.app)
- **Backend API:** Hosted securely on Azure App Service.

---

## ✨ Key Features

- **Real-Time Voice Interaction**: Low-latency WebSocket loop processes Speech-to-Text (Whisper) and Text-to-Speech on the fly, with full barge-in (interrupt) support.
- **Dynamic AI Grading & Follow-ups**: The `TurnMachine` evaluates answers against a strict rubric (Structure, Specificity, Correctness, Conciseness) and intelligently generates follow-up questions for weak answers.
- **Resume Contextualization**: Upload a resume (PDF, DOCX, TXT) to generate an interview perfectly tailored to actual achievements and projects.
- **Secure Authentication**: Integrated with **Clerk** to provide secure JWT-based authentication for both REST endpoints and WebSockets.
- **Advanced Rate Limiting**:
  - Prevents API abuse via strict 24-hour session limits.
  - Features a **Soft-Delete** architecture: deleting history hides it from the UI but safely retains a tombstone record to prevent rate-limit circumvention.
- **Premium Tiers**: Dynamic configuration allows administrators to grant customized daily limits to specific Clerk User IDs on the fly without touching code.

---

## 🏗️ Architecture & Tech Stack

### Frontend (Vercel)

- **Framework:** React 18, TypeScript, Vite
- **Styling:** TailwindCSS, Shadcn UI
- **State Management:** Zustand
- **Auth:** `@clerk/clerk-react`
- **Audio:** Web Audio API (real-time Canvas visualization, media streaming)

### Backend (Azure App Service)

- **Framework:** FastAPI, Uvicorn, Python 3.11+
- **Database:** SQLite (WAL-mode configured for concurrency, persisted on Azure's `/home` mount)
- **AI Models:**
  - LLM: Gemini 3.5 Flash (via LiteLLM / direct)
  - STT: Groq `whisper-large-v3-turbo`
  - TTS: Kokoro-82M (ONNX)
- **Security:** Pydantic `BaseSettings` intercepting Azure Environment Variables for centralized, zero-code configuration overrides.

---

## 🛠️ Setup & Running Locally

### Prerequisites

- Python 3.11+
- Node 20+
- API Keys: Groq, Gemini, and Clerk (Publishable & Secret keys)

### 1. Environment Configuration

Create a `.env` file in the project root:

```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
VITE_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

### 2. Backend Setup

```bash
cd backend
python -m venv .venv
# Activate venv (.venv\Scripts\activate on Windows, source .venv/bin/activate on Mac/Linux)
pip install -r requirements.txt

# Download Kokoro TTS model weights (~310MB)
python scripts/download_models.py

# Start the development server
python -m uvicorn app.api.main:app --reload --port 8002
```

### 3. Frontend Setup

```bash
cd frontend
npm install
# Ensure VITE_WS_BASE is set to ws://localhost:8002/ws in frontend/.env
npm run dev
```

Open <http://localhost:5173> in your browser.

---

## 🔌 API Summary

| Method | Path | Description |
| --- | --- | --- |
| **WS** | `/ws/session` | Live authenticated WebSocket loop |
| **GET** | `/sessions/today_count` | Retrieves current session count & enforces limits |
| **POST** | `/upload_resume` | Extracts text from PDF, DOCX, and TXT resumes |
| **GET** | `/sessions` | Lists past sessions (excluding soft-deleted) |
| **GET** | `/sessions/{id}` | Reopens transcript + rubric scores |
| **DELETE** | `/sessions/{id}` | Soft-deletes a session and hard-deletes heavy audio turns |
| **GET** | `/health` | Server readiness check |

---

*Built with ❤️ as a personal project showcasing modern AI integration and scalable web architecture.*\
*- By @sumitc27 :)*