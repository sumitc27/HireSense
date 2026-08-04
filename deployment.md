# HireSense — Cloud Deployment Guide

This guide outlines the steps, environment configurations, and security variables required to deploy HireSense to production environments (e.g. Render for the FastAPI backend and Vercel for the React frontend).

---

## 🔒 1. Production Mode Security (FastAPI)
The backend auth validator ([auth.py](file:///c:/Users/sumit/Desktop/GenAI%20Project/HireSense/backend/app/auth.py)) checks for the environment variable `FASTAPI_ENV` or `APP_ENV`.
* When set to `"production"`, the backend **demands** a valid `VITE_CLERK_PUBLISHABLE_KEY` (or `CLERK_PUBLISHABLE_KEY`).
* If the key is missing or set to a developer placeholder, the server will crash on startup with a `ValueError`. This ensures unauthenticated API routes are never exposed in production.

---

## 🖥️ 2. Backend Deployment (e.g., Render)

Deploy the backend using the Docker runtime, which reads the project's [Dockerfile](file:///c:/Users/sumit/Desktop/GenAI%20Project/HireSense/backend/Dockerfile). The build automatically downloads the local Kokoro ONNX model weights (~310MB), making the container fully self-contained.

### Step-by-Step Setup:
1. Connect your GitHub repository to a new **Web Service** on Render.
2. Set the **Root Directory** to `backend`.
3. Set the **Runtime** to `Docker`.
4. Configure a **Persistent Volume**:
   * Mount a persistent disk at path `/data`.
   * Since container filesystems are ephemeral, this ensures your SQLite session database survives server restarts.
5. Add the following **Environment Variables**:
   * `FASTAPI_ENV`: `production` (enforces strict JWT validation)
   * `GROQ_API_KEY`: `gsk_...` (your live Groq API key)
   * `GEMINI_API_KEY`: `...` (your live Gemini API key)
   * `VITE_CLERK_PUBLISHABLE_KEY`: `pk_...` (your Clerk Publishable Key)
   * `HIRESENSE_DB`: `/data/hiresense.db` (routes SQLite database to the persistent mount)
   * `CORS_ORIGINS`: `["https://your-frontend.vercel.app"]` (only allow requests from your live frontend)
   * `PORT`: `8002`

---

## 🎨 3. Frontend Deployment (Vercel)

Deploy the `frontend/` directory to Vercel. 

> [!IMPORTANT]
> **Build-Time Injection**: Vite compile-injects environment variables statically during the build process. You **MUST** add these environment variables in the Vercel Dashboard **before** building or trigger a redeployment after adding them.

### Step-by-Step Setup:
1. Create a new project in **Vercel** and select your repository.
2. Set the **Root Directory** to `frontend`.
3. Under **Environment Variables**, add the following keys:
   * `VITE_CLERK_PUBLISHABLE_KEY`: `pk_...` (your Clerk Publishable Key)
   * `VITE_API_BASE`: `https://your-backend.onrender.com` (your backend Render domain)
   * `VITE_WS_BASE`: `wss://your-backend.onrender.com` (your secure WebSocket Render domain, using `wss://`)
4. Vercel will automatically provision SSL/HTTPS, enabling secure browser microphone (`navigator.mediaDevices.getUserMedia`) and Web Speech API access.
