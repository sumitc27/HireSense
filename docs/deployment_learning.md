# HireSense Deployment Learnings

This document serves as a record of the key challenges, debugging steps, and cloud networking concepts learned while deploying the HireSense AI backend to Azure App Service and connecting it to a Vercel frontend.

## 1. Azure for Students Constraints
- **The Issue:** Azure student subscriptions have strict hidden policies that block the creation of certain resources (like Azure Container Registry and Log Analytics Workspaces) in most regions to prevent accidental billing.
- **The Error:** `RequestDisallowedByAzure` or `No registries found for this subscription`.
- **The Solution:** Bypass Azure's enterprise registries entirely. Create a GitHub Action to automatically build and push the Docker image to a free, public **Docker Hub** repository. Then, tell Azure to pull the container directly from Docker Hub.

## 2. The "Sidecar" Trap
- **The Issue:** When using Azure's "Quickstart" image, it launches a temporary NGINX placeholder website. If a custom Docker image is added as a "Sidecar", it runs invisibly in the background, disconnected from the internet, while visitors just see the NGINX page.
- **The Solution:** Always ensure your custom Docker image replaces the **Main** container in the Azure *Deployment Center*, rather than being added as a supplementary sidecar.

## 3. Azure Networking (`WEBSITES_PORT`)
- **The Issue:** Custom Docker containers listen on specific ports (e.g., `8002` for Uvicorn). Azure's load balancer defaults to port `80`. If it doesn't know your port, it fails to route traffic.
- **The Solution:** Adding the `WEBSITES_PORT = 8002` environment variable in the Azure Portal explicitly tells the load balancer exactly where to send internet traffic.

## 4. Persistent Storage for SQLite
- **The Concept:** Standard cloud containers are ephemeral; any files saved inside them are wiped when the server reboots.
- **The Solution:** Azure Linux Web Apps include a built-in permanent hard drive mapped to the `/home` directory. By setting `WEBSITES_ENABLE_APP_SERVICE_STORAGE = true` and configuring the database path to `/home/hiresense.db`, the SQLite database becomes permanently persistent without needing a heavy PostgreSQL server.

## 5. Strict WebSocket Routing
- **The Issue:** The frontend tried to connect to `/session`, but the FastAPI backend was strictly listening on `/ws/session`. 
- **The Result:** The connection was instantly rejected because the route did not exist.
- **The Lesson:** WebSockets and API routes are unforgiving. A missing `/ws` or a trailing slash will cause complete failure. Always verify the exact path string in the frontend `.env` configuration (`VITE_WS_BASE`).

## 6. CORS and Credentials Security
- **The Concept:** CORS (Cross-Origin Resource Sharing) prevents malicious websites from stealing your API data. 
- **The Conflict:** If a backend requires credentials (like Clerk authentication tokens), modern security standards completely forbid using a wildcard (`*`) for the allowed origins.
- **The Vercel Problem:** Vercel generates dynamic URLs for every commit (e.g., `-lmmmtfzqf-` or `-git-main-`). Hardcoding these into a secure CORS list is a nightmare.
- **The Solution:** Use the permanent Vercel Production Domain (`https://hiresense-27th.vercel.app`) in the `CORS_ORIGINS` variable and never rely on the dynamic preview hashes for API testing.

## 7. Azure's Built-in CORS Interceptor
- **The Issue:** Azure App Service has its own CORS settings in the portal (API -> CORS) that sit *in front* of the Python code. If "Enable Access-Control-Allow-Credentials" is checked in Azure, the NGINX gateway will enforce strict CORS rules and block requests with a `403 Forbidden` before FastAPI even sees them.
- **The Solution:** When using frameworks like FastAPI that handle their own CORS middleware, always clear out and disable the Azure Portal's built-in CORS settings to prevent the two security systems from conflicting.
