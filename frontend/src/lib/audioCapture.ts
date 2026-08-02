// Microphone capture: one webm/opus blob per utterance via MediaRecorder
// (Whisper is a batch API — blobs, not chunk streaming), plus an AnalyserNode
// that always runs for the waveform and (Phase 4) open-mic VAD.

export interface UtteranceResult {
  blob: Blob;
  durationMs: number;
}

const MIN_UTTERANCE_MS = 400;   // Groq bills 10s minimum per request — never send blips
const MAX_UTTERANCE_MS = 90_000;
const VAD_POLL_MS = 50;
const VAD_HANGOVER_MS = 800;      // silence needed to end an utterance
const VAD_THRESHOLD_MULTIPLIER = 2.2;   // speech must clear ambient RMS by this factor
const VAD_MIN_THRESHOLD = 0.02;         // floor so a dead-silent room doesn't self-trigger

export class AudioCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private maxTimer: number | null = null;
  private ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  mimeType = "audio/webm";

  private vadTimer: number | null = null;
  private vadSilenceSince = 0;
  private vadThreshold = VAD_MIN_THRESHOLD;
  /** True while the VAD-driven mic is armed and waiting to hear speech (as
   * opposed to actively recording an utterance) — lets the UI show a
   * "listening" vs "recording" distinction in open-mic mode. */
  vadArmed = false;

  /** Request mic access + start the analyser. Throws on permission denial —
   * callers switch the UI to typed-input mode. */
  async init(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,   // keeps the coach's own voice out of the mic
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
    // Preferred mime; Safari records mp4 — Groq accepts both.
    if (!MediaRecorder.isTypeSupported(this.mimeType)) {
      this.mimeType = "audio/mp4";
    }
  }

  get ready(): boolean {
    return this.stream !== null;
  }

  /** Current input level 0..1 (RMS) — feeds the waveform and VAD. */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      const c = (v - 128) / 128;
      sum += c * c;
    }
    return Math.sqrt(sum / buf.length);
  }

  startRecording(onAutoStop?: (r: UtteranceResult | null) => void): void {
    if (!this.stream || this.recorder) return;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.startedAt = performance.now();
    if (onAutoStop) {
      this.maxTimer = window.setTimeout(async () => {
        onAutoStop(await this.stopRecording());
      }, MAX_UTTERANCE_MS);
    }
  }

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  /** Stop and return the utterance, or null if it was too short to send. */
  stopRecording(): Promise<UtteranceResult | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state !== "recording") {
        resolve(null);
        return;
      }
      if (this.maxTimer !== null) {
        clearTimeout(this.maxTimer);
        this.maxTimer = null;
      }
      const durationMs = performance.now() - this.startedAt;
      rec.onstop = () => {
        this.recorder = null;
        if (durationMs < MIN_UTTERANCE_MS) {
          resolve(null);
          return;
        }
        resolve({
          blob: new Blob(this.chunks, { type: this.mimeType }),
          durationMs: Math.round(durationMs),
        });
      };
      rec.stop();
    });
  }

  destroy(): void {
    this.stopOpenMic();
    this.recorder?.state === "recording" && this.recorder.stop();
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }

  // ---- open-mic VAD (voice-activity detection) -----------------------------
  /** Sample ambient noise for ~500ms and set the speech threshold above it.
   * Call once when open-mic mode is enabled, before the coach starts talking. */
  async calibrateAmbient(durationMs = 500): Promise<void> {
    if (!this.analyser) return;
    const samples: number[] = [];
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      samples.push(this.level());
      await new Promise((r) => setTimeout(r, VAD_POLL_MS));
    }
    const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    this.vadThreshold = Math.max(VAD_MIN_THRESHOLD, avg * VAD_THRESHOLD_MULTIPLIER);
  }

  /** Poll input level; auto-start recording on speech, auto-stop after
   * VAD_HANGOVER_MS of silence, and hand the result to `onUtterance`
   * (null for bursts shorter than the minimum). Mutually exclusive with PTT —
   * callers should not also call startRecording/stopRecording while armed. */
  startOpenMic(onUtterance: (r: UtteranceResult | null) => void): void {
    if (this.vadTimer !== null || !this.stream) return;
    this.vadArmed = true;
    this.vadTimer = window.setInterval(() => {
      const speaking = this.level() > this.vadThreshold;
      if (!this.recording) {
        if (speaking) {
          this.vadArmed = false;
          this.startRecording();
          this.vadSilenceSince = 0;
        }
        return;
      }
      if (speaking) {
        this.vadSilenceSince = 0;
        return;
      }
      if (this.vadSilenceSince === 0) {
        this.vadSilenceSince = performance.now();
      } else if (performance.now() - this.vadSilenceSince >= VAD_HANGOVER_MS) {
        this.vadSilenceSince = 0;
        this.vadArmed = true;
        void this.stopRecording().then(onUtterance);
      }
    }, VAD_POLL_MS);
  }

  stopOpenMic(): void {
    if (this.vadTimer !== null) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    this.vadArmed = false;
    this.vadSilenceSince = 0;
  }
}
