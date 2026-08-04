import { useEffect, useRef } from "react";
import type { AudioCapture } from "@/lib/audioCapture";
import type { AudioPlayer } from "@/lib/audioPlayer";

/** Live mic waveform — canvas fed by the capture or player AnalyserNode each frame. */
export function Waveform({
  capture,
  player,
  userActive,
  coachActive,
}: {
  capture: AudioCapture | null;
  player: AudioPlayer | null;
  userActive: boolean;
  coachActive: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { width, height } = canvas;
      ctx2d.clearRect(0, 0, width, height);
      let analyser = null;
      let color = "hsl(var(--muted-foreground))";
      let alpha = 0.4;

      if (userActive) {
        analyser = capture?.analyser;
        color = "#e11d48"; // Rose-600 for recording
        alpha = 1;
      } else if (coachActive) {
        analyser = player?.analyser;
        color = "hsl(var(--accent-teal))"; // Teal for coach speaking
        alpha = 1;
      } else {
        // Idle mode (capturing ambient but not recording)
        analyser = capture?.analyser;
      }

      ctx2d.strokeStyle = color;
      ctx2d.globalAlpha = alpha;
      ctx2d.lineWidth = 2;

      if (!analyser) {
        ctx2d.beginPath();
        ctx2d.moveTo(0, height / 2);
        ctx2d.lineTo(width, height / 2);
        ctx2d.stroke();
        return;
      }
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      ctx2d.beginPath();
      const step = width / buf.length;
      for (let i = 0; i < buf.length; i++) {
        const y = (buf[i] / 255) * height;
        i === 0 ? ctx2d.moveTo(0, y) : ctx2d.lineTo(i * step, y);
      }
      ctx2d.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [capture, player, userActive, coachActive]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={64}
      className="h-16 w-full max-w-md rounded-md border border-border bg-muted/30"
    />
  );
}
