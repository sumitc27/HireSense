# HireSense: Logic & Bug Fixing Learnings

This document catalogs the key backend logic bugs, architectural decisions, and Git workflows learned during the development of HireSense.

## 1. Resolving Git Diverged Branches (The Rebase Workflow)
* **The Issue:** Git rejected a `git push` because commits were made directly on the GitHub website (e.g., editing `config.py`) while completely separate commits were made locally in the IDE.
* **The Learning:** When branches diverge, using a standard `git pull` creates an ugly "merge commit". Instead, using `git pull --rebase origin main` is the professional standard. It temporarily undoes local commits, downloads the remote GitHub commits, and cleanly pastes the local commits on top. This keeps the Git history perfectly linear.

## 2. Centralized Configuration (Pydantic & Azure)
* **The Issue:** Hardcoding limits like "Max 2 interviews" in both the React frontend and Python backend causes a maintenance nightmare if the limit needs to change.
* **The Fix:** Removed hardcoded numbers from the frontend `App.tsx` and replaced them with generic messages ("Your daily limit has been reached"). 
* **The Learning:** Because the FastAPI backend uses Pydantic `BaseSettings`, it automatically intercepts Azure Environment Variables. By setting `DAILY_SESSION_LIMIT=5` in Azure, the backend instantly overrides the code. Azure becomes the single source of truth without ever needing to redeploy code.

## 3. Client-Server Trust Boundaries (Question Limits)
* **The Issue:** The frontend allows users to select how many questions they want (1 to 4). What happens if a hacker intercepts the WebSocket and requests 100 questions to drain AI API credits?
* **The Fix:** The backend never trusts the frontend. In `session.py`, the backend mathematically clamps the requested number: `count = max(1, min(question_count, self.settings.max_question_count))`. 
* **The Learning:** If a hacker requests 100, the backend forces it down to the `max_question_count` (6) before sending the prompt to Gemini. The `default_question_count` acts as a safety fallback if the frontend fails to send a number at all.

## 4. The TurnMachine (Follow-up Question Math)
* **The Logic:** The backend `TurnMachine` limits the AI to a maximum of **1 follow-up per main question** (`and not self.in_follow_up`). 
* **The Learning:** The `max_question_count` only applies to the *Main Questions* generated from the resume. If a user requests 4 main questions and gives terrible answers to all of them, the AI will ask 4 follow-ups. The interview will total **8 questions**.

## 5. The "Delete History" Rate-Limit Loophole (Soft Deletes)
* **The Bug:** Users could bypass the 24-hour daily limit by deleting their past interviews. Since the database row was erased, the daily limit counter reset.
* **The Fix:** Implemented a **Soft Delete** architecture. 
    1. Added an `is_deleted` column to the `sessions` table.
    2. When a user deletes a session, it updates `is_deleted = 1`.
    3. The frontend list query (`list_sessions`) ignores deleted rows, so it disappears for the user.
    4. The rate-limit query (`count_user_sessions_today`) ignores the flag and counts *all* sessions created in the last 24 hours.
* **The Storage Optimization:** To prevent database bloat, the heavy AI grading and transcription data in the `turns` table is still permanently hard-deleted. Only the tiny "tombstone" summary row in the `sessions` table remains to enforce the limit.

## 6. Premium User Tiers via Clerk Authentication
* **The Logic:** Added the ability to assign massive daily limits to specific administrators or premium users.
* **The Implementation:** By adding `PREMIUM_USERS=user_2abc123` and `PREMIUM_DAILY_LIMIT=100` to Azure, the backend dynamically checks the Clerk JWT `sub` (User ID). If the authenticated user matches the list, they bypass the standard limit entirely.
