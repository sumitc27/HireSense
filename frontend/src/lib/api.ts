// Typed REST client for the HireSense backend (the live session runs over
// WebSocket — see ws.ts; REST covers health + session history).
const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface Health {
  status: string;
  tts_ready: boolean;
  tts_error: string | null;
  stt_model: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = (body as any).detail;
    const msg =
      typeof detail === "string" ? detail : detail?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function health(): Promise<Health> {
  return jsonOrThrow(await fetch(`${BASE}/health`));
}

export interface SessionSummary {
  id: string;
  role: string;
  seniority: string;
  question_count: number;
  status: "running" | "completed" | "incomplete";
  created_at: string;
  overall_average: number | null;
  top_improvements: string[];
}

export interface SessionDetail extends SessionSummary {
  turns: {
    turn_id: string;
    question_index: number;
    is_follow_up: boolean;
    question_text: string;
    answer_text: string;
    answer_source: string;
    rubric: import("./ws").Rubric | null;
    coaching_text: string;
    latency_ms: Record<string, number>;
  }[];
}

export async function listSessions(): Promise<SessionSummary[]> {
  return jsonOrThrow(await fetch(`${BASE}/sessions`));
}

export async function getSession(id: string): Promise<SessionDetail> {
  return jsonOrThrow(await fetch(`${BASE}/sessions/${id}`));
}

export async function deleteSession(id: string): Promise<{ ok: boolean }> {
  return jsonOrThrow(await fetch(`${BASE}/sessions/${id}`, { method: "DELETE" }));
}
