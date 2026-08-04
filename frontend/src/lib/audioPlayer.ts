// Gapless playback of per-sentence WAV chunks via a Web Audio buffer queue.
//
// Each tts_chunk is a self-contained WAV: decodeAudioData -> schedule each
// buffer at max(now, previous end) so consecutive sentences play seamlessly.
// Barge-in = stop every scheduled source and clear the queue — trivial
// because there's no container/stream state (the reason WAV-per-sentence
// beat MediaSource for this app).

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  /** Fired the moment the FIRST chunk of a turn actually starts playing —
   * reported back to the server to close the end-to-end latency measurement. */
  onFirstPlayback: ((turnId: string) => void) | null = null;
  private firstOfTurn = new Set<string>();

  /** Must be called from a user gesture (Start button) — autoplay policy. */
  init(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  async enqueue(wav: ArrayBuffer, turnId: string): Promise<void> {
    if (!this.ctx) return;
    const buffer = await this.ctx.decodeAudioData(wav.slice(0));
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    if (!this.firstOfTurn.has(turnId)) {
      this.firstOfTurn.add(turnId);
      const delayMs = Math.max(0, (startAt - now) * 1000);
      window.setTimeout(() => this.onFirstPlayback?.(turnId), delayMs);
    }

    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
  }

  /** True while anything is scheduled or playing (drives the speaking indicator). */
  get speaking(): boolean {
    return this.sources.length > 0;
  }

  /** Barge-in: kill everything scheduled, reset the clock. */
  flush(): void {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources = [];
    this.nextStartTime = 0;
  }

  newTurn(): void {
    this.nextStartTime = 0;
    this.firstOfTurn.clear();
  }

  destroy(): void {
    this.flush();
    this.ctx?.close();
    this.ctx = null;
    this.firstOfTurn.clear();
  }
}
