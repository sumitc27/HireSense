// WebSocket client for the live voice session.
//
// Protocol: JSON control frames both ways; binary audio frames are each
// announced by the immediately-preceding JSON frame (`utterance` upstream,
// `tts_chunk` downstream) — WS ordering per connection makes the pairing safe.

const WS_BASE = import.meta.env.VITE_WS_BASE ?? "/ws";

export type ServerEvent =
  | { type: "session_started"; session_id: string }
  | { type: "state"; state: string; turn_id: string; question_index?: number }
  | { type: "question"; turn_id: string; index: number; total: number; text: string; is_follow_up: boolean }
  | { type: "stt_result"; turn_id: string; text: string; language: string; stt_ms: number }
  | { type: "scoring"; turn_id: string; rubric: Rubric }
  | { type: "coaching_delta"; turn_id: string; text: string }
  | { type: "tts_chunk"; turn_id: string; seq: number; sentence_index: number; text: string }
  | { type: "tts_end"; turn_id: string; interrupted: boolean }
  | { type: "latency"; turn_id: string; stages: Record<string, number> }
  | { type: "report"; session_id: string; report: Report }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "pong" };

export interface Rubric {
  structure: number;
  specificity: number;
  correctness: number;
  conciseness: number;
  overall: number;
  strengths: string[];
  improvements: string[];
  follow_up_needed: boolean;
  follow_up_question: string | null;
}

export interface TurnRecord {
  turn_id: string;
  question_index: number;
  is_follow_up: boolean;
  question_text: string;
  answer_text: string;
  answer_source: "voice" | "typed" | "skipped";
  rubric: Rubric | null;
  coaching_text: string;
  latency_ms: Record<string, number>;
}

export interface Report {
  role: string;
  seniority: string;
  completed: boolean;
  overall_average: number;
  top_improvements: string[];
  turns: TurnRecord[];
}

export interface VoiceSocketHandlers {
  onEvent: (event: ServerEvent) => void;
  /** Binary frame following the most recent tts_chunk announcement. */
  onAudio: (wav: ArrayBuffer, meta: Extract<ServerEvent, { type: "tts_chunk" }>) => void;
  onClose?: () => void;
  onError?: (err: Event) => void;
}

export class VoiceSocket {
  private ws: WebSocket | null = null;
  private pendingChunkMeta: Extract<ServerEvent, { type: "tts_chunk" }> | null = null;

  constructor(private handlers: VoiceSocketHandlers) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const base = WS_BASE.startsWith("ws")
        ? WS_BASE
        : `${proto}//${location.host}${WS_BASE}`;
      const ws = new WebSocket(`${base}/session`);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => resolve();
      ws.onerror = (e) => {
        this.handlers.onError?.(e);
        reject(e);
      };
      ws.onclose = () => this.handlers.onClose?.();
      ws.onmessage = (msg) => {
        if (msg.data instanceof ArrayBuffer) {
          if (this.pendingChunkMeta) {
            this.handlers.onAudio(msg.data, this.pendingChunkMeta);
            this.pendingChunkMeta = null;
          }
          return;
        }
        const event = JSON.parse(msg.data) as ServerEvent;
        if (event.type === "tts_chunk") this.pendingChunkMeta = event;
        this.handlers.onEvent(event);
      };
      this.ws = ws;
    });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(frame: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(frame));
  }

  sendUtterance(blob: ArrayBuffer, durationMs: number, mime: string): void {
    this.send({ type: "utterance", duration_ms: durationMs, mime });
    this.ws?.send(blob);
  }

  startSession(role: string, seniority: string, questionCount: number): void {
    this.send({ type: "start_session", role, seniority, question_count: questionCount });
  }

  sendTypedAnswer(text: string): void {
    this.send({ type: "typed_answer", text });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
