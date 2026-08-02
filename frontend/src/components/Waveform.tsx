import { useEffect, useRef } from "react";
import type { AudioCapture } from "@/lib/audioCapture";

/** Live mic waveform — canvas fed by the capture AnalyserNode each frame. */
export function Waveform({
  capture,
  active,
}: {
  capture: AudioCapture | null;
  active: boolean;   // brighter while actually recording
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
      const analyser = capture?.analyser;
      const styles = getComputedStyle(document.documentElement);
      const color = `hsl(${styles.getPropertyValue(active ? "--primary" : "--muted-foreground")})`;
      ctx2d.strokeStyle = color;
      ctx2d.globalAlpha = active ? 1 : 0.4;
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
  }, [capture, active]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={64}
      className="h-16 w-full max-w-md rounded-md border border-border bg-muted/30"
    />
  );
}
