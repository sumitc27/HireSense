// Live speech preview via the browser's built-in Web Speech API.
//
// Groq Whisper (the authoritative transcript used for scoring) is a *batch*
// API — your words only appear after you release the mic. This wrapper runs
// the browser's on-device/cloud recognizer in parallel purely to show interim
// text WHILE you talk; the Whisper result then replaces it. It never feeds
// scoring, so its lower accuracy doesn't matter — it's a preview only.
//
// Supported in Chrome/Edge/Safari; absent in Firefox. When unsupported (or on
// any error) every method is a safe no-op, so the session behaves exactly as
// before — just without the live preview.

// The Web Speech API types aren't in the standard DOM lib, so declare the
// minimal surface we use rather than pulling in @types/dom-speech-recognition.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class LiveCaptions {
  private recognition: SpeechRecognitionLike | null = null;
  readonly supported: boolean;

  constructor() {
    this.supported = getCtor() !== null;
  }

  /** Start live recognition. `onInterim` receives the running transcript
   * (interim + finalized) as it grows. No-op if unsupported. */
  start(onInterim: (text: string) => void): void {
    const Ctor = getCtor();
    if (!Ctor) return;
    this.stop(); // never run two recognizers at once

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? "";
      }
      const trimmed = text.trim();
      if (trimmed) onInterim(trimmed);
    };
    // Recognition errors (no-speech, network, aborted) are non-fatal here:
    // the authoritative Whisper transcript still arrives over the WebSocket.
    rec.onerror = () => {};
    rec.onend = () => {};
    try {
      rec.start();
      this.recognition = rec;
    } catch {
      // start() throws if called while already running — ignore.
      this.recognition = null;
    }
  }

  stop(): void {
    if (!this.recognition) return;
    try {
      this.recognition.abort();
    } catch {
      /* already stopped */
    }
    this.recognition = null;
  }
}
