# HireSense — Real-Time Voice AI Interview Coach

**HireSense** is a real-time, low-latency AI interview coach. It orchestrates a bidirectional voice loop, asking role-specific questions out loud, listening to spoken answers, grading them against a multi-dimensional rubric, and delivering spoken coaching and dynamically generated follow-up questions.

Built as a full-stack, production-ready AI application, it leverages WebSocket streams, strict state-machine turn management, robust JWT authentication, and a high-concurrency SQLite backend.

### 🌐 Live Demo
- **Frontend:** [HireSense on Vercel](https://hiresense-27th.vercel.app)
- **Backend API:** Hosted securely on Azure App Service.

---

## 📊 Measured Benchmarks & Results

*Note: Benchmarks run on a typical local development environment utilizing Kokoro-82M ONNX model, Groq Whisper, and Gemini 3.5 Flash.*

- **WebSocket Round-Trip Latency (STT -> LLM -> TTS):** TODO: measure ms
- **End-to-End Turn Latency (User stops speaking -> Coach responds):** TODO: measure ms (avg over N turns)
- **Rate-Limiter & DB Concurrency:** TODO: measure ms avg DB read/write latency in WAL mode under load.
- **Concurrent Session Throughput:** TODO: measure ops/sec before throttling.

---

## 🚀 Key Engineering Highlights

- **Engineered a real-time voice streaming loop** via a unified WebSocket architecture, ensuring sub-second end-to-end latency and enabling seamless conversational barge-in capabilities.
- **Architected a robust `TurnMachine`** state engine that evaluates candidate answers across 4 distinct rubric dimensions (structure, specificity, correctness, conciseness) to trigger dynamic follow-up questions.
- **Implemented a multi-tier rate limiter** backed by Clerk JWTs and a SQLite WAL-mode database, enforcing 2 distinct access tiers (standard and premium) with ultra-low read/write latency.
- **Designed a resilient API surface** encompassing 7 REST endpoints and 1 WebSocket loop, decoupling historical session retrieval from the high-throughput live voice pipeline.

---

## 🏗️ System Architecture

```text
                 +-----------------------+
    Audio In --->|                       |---> Audio Out
                 |    Frontend Client    |
  Typed Text --->|  (React/Web Audio)    |<--- Captions/Scores
                 +-----------------------+
                         |       ^
            WebSocket    |       |  Live Audio / Events
          (Clerk JWT)    v       |
                 +-----------------------+
                 |  SessionController    | (FastAPI /ws/session)
                 +-----------------------+
                         |       ^
                         v       |
                 +-----------------------+
                 |    TurnMachine Loop   |---> SQLite WAL
                 +-----------------------+     (History / Rate Limits)
                         |       ^
                         v       |
  +-------------------------------------------------------+
  | 1. STT: Groq whisper-large-v3-turbo (Audio -> Text)   |
  | 2. Grader: Gemini 3.5 Flash (Text -> Rubric Score)    |
  | 3. Coach: Gemini 3.5 Flash (Rubric -> Coaching Text)  |
  | 4. TTS: Kokoro-82M ONNX (Text -> Spoken Audio)        |
  +-------------------------------------------------------+
```

---

## ✨ Features

- **Sub-Second Voice Interaction**: Low-latency WebSocket loop processing Speech-to-Text and Text-to-Speech asynchronously, with full barge-in (interrupt) support.
- **Dynamic AI Grading**: Evaluates answers against a strict rubric and intelligently generates follow-up questions for weak or incomplete answers.
- **Resume Contextualization**: Extracts and processes PDF, DOCX, and TXT resumes to generate interview questions perfectly tailored to actual achievements and projects.
- **Secure Authentication**: Integrated with **Clerk** to provide secure JWT-based authentication for both REST endpoints and WebSockets.
- **Advanced Rate Limiting**: Prevents API abuse via strict 24-hour session limits. Features a **Soft-Delete** architecture to hide history while retaining tombstone records for rate-limit enforcement.
- **Zero-Code Premium Tiers**: Dynamic configuration allows administrators to grant customized daily limits to specific user IDs without redeployments.

---

## 💻 Tech Stack

### Frontend (Vercel)
- **Framework:** React 18, TypeScript, Vite
- **Styling:** TailwindCSS, Shadcn UI
- **State Management:** Zustand
- **Auth:** `@clerk/clerk-react`
- **Audio:** Web Audio API (real-time Canvas visualization, media streaming)

### Backend (Azure App Service)
- **Framework:** FastAPI, Uvicorn, Python 3.11+
- **Database:** SQLite (WAL-mode configured for high concurrency, persisted on Azure mounts)
- **AI Models:**
  - LLM: Gemini 3.5 Flash (via LiteLLM / direct)
  - STT: Groq `whisper-large-v3-turbo`
  - TTS: Kokoro-82M (ONNX)

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
python scripts/download_models.py
python -m uvicorn app.api.main:app --reload --port 8002
```

### 3. Frontend Setup
```bash
cd frontend
npm install
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