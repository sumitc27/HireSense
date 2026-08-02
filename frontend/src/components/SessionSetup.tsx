import { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Minus,
  Plus,
  Wifi,
  WifiOff,
  Edit2,
  Play,
  Sliders,
  AlertTriangle,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SENIORITIES = ["junior", "mid-level", "senior", "staff"] as const;
const ROLE_PRESETS = [
  "backend engineer",
  "frontend engineer",
  "full-stack engineer",
  "data scientist",
  "product manager",
];

export interface SessionSetupValues {
  role: string;
  seniority: string;
  questionCount: number;
}

/** pre-interview configuration wizard:
 * 1. Step 1: Configuration Form (role, seniority, questionCount).
 * 2. Configure Setup button opens the VerificationModal popup screen.
 * 3. Step 2 (Popup Modal): Verification of microphone (canvas visualizer + mute/unmute status toggle) and network latency strength check.
 * 4. Step 3: Selection Review Screen (displays selected options, edit button, and start button).
 */
export function SessionSetup({
  onStart,
  starting,
}: {
  onStart: (values: SessionSetupValues) => void;
  starting: boolean;
}) {
  const [role, setRole] = useState(ROLE_PRESETS[0]);
  const [seniority, setSeniority] = useState<(typeof SENIORITIES)[number]>("senior");
  const [questionCount, setQuestionCount] = useState(3);
  const [step, setStep] = useState<"form" | "review">("form");
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  return (
    <>
      {step === "form" ? (
        <Card className="mx-auto mt-10 w-full max-w-md p-6">
          <div className="mb-5 text-center">
            <Mic className="mx-auto mb-2 h-7 w-7 text-primary" />
            <h2 className="text-lg font-semibold">Set up your mock interview</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The coach asks role-specific questions out loud, scores each answer,
              and coaches you back — in real time.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Role</label>
              <input
                list="role-presets"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. backend engineer"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="role-presets">
                {ROLE_PRESETS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Seniority</label>
              <div className="grid grid-cols-4 gap-1.5">
                {SENIORITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeniority(s)}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs capitalize transition-colors",
                      s === seniority
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Questions
              </label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={questionCount <= 1}
                  onClick={() => setQuestionCount((c) => Math.max(1, c - 1))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-6 text-center text-sm tabular-nums">{questionCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={questionCount >= 6}
                  onClick={() => setQuestionCount((c) => Math.min(6, c + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  main question{questionCount > 1 ? "s" : ""} (plus follow-ups on weak answers)
                </span>
              </div>
            </div>

            <Button
              type="button"
              className="mt-2 w-full gap-2 font-medium"
              disabled={role.trim().length === 0}
              onClick={() => setIsPopupOpen(true)}
            >
              <Sliders className="h-4 w-4" />
              Configure Setup
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mx-auto mt-10 w-full max-w-md p-6">
          <div className="mb-6 text-center">
            <Mic className="mx-auto mb-2 h-7 w-7 text-primary" />
            <h2 className="text-lg font-semibold">Review your setup</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm your selections before starting the interview.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-medium text-muted-foreground">Role</span>
                <span className="text-sm font-semibold capitalize text-foreground">{role}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-medium text-muted-foreground">Level</span>
                <span className="text-sm font-semibold capitalize text-primary bg-primary/10 px-2.5 py-0.5 rounded text-xs">
                  {seniority}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Max Questions</span>
                <span className="text-sm font-semibold text-foreground">{questionCount}</span>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => setStep("form")}
              >
                <Edit2 className="h-4 w-4" />
                Edit Setup
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={starting}
                onClick={() => onStart({ role: role.trim(), seniority, questionCount })}
              >
                {starting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Start Interview
                  </>
                )}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isPopupOpen && (
        <VerificationModal
          onClose={() => setIsPopupOpen(false)}
          onDone={() => {
            setIsPopupOpen(false);
            setStep("review");
          }}
        />
      )}
    </>
  );
}

function VerificationModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Network check states
  const [networkLatency, setNetworkLatency] = useState<number | null>(null);
  const [networkStatus, setNetworkStatus] = useState<
    "checking" | "excellent" | "good" | "fair" | "weak" | "offline"
  >("checking");

  // Request mic on mount
  useEffect(() => {
    let active = true;
    let localStream: MediaStream | null = null;

    async function initMic() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream = s;
        setStream(s);
        setMicError(null);
        const track = s.getAudioTracks()[0];
        if (track) {
          setIsMuted(!track.enabled);
        }
      } catch (err) {
        if (!active) return;
        setMicError("Please allow mic access");
      }
    }

    initMic();

    return () => {
      active = false;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Ping backend to measure latency
  useEffect(() => {
    let active = true;
    async function checkLatency() {
      setNetworkStatus("checking");
      const pings: number[] = [];

      for (let i = 0; i < 3; i++) {
        if (!active) return;
        const start = performance.now();
        try {
          // Use VITE_API_BASE proxy which is mapped to /api
          await fetch("/api/health", { cache: "no-store" });
          const end = performance.now();
          pings.push(end - start);
        } catch (e) {
          console.error("Ping failure:", e);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!active) return;

      if (pings.length > 0) {
        const avg = pings.reduce((sum, val) => sum + val, 0) / pings.length;
        setNetworkLatency(Math.round(avg));
        if (avg < 80) {
          setNetworkStatus("excellent");
        } else if (avg < 200) {
          setNetworkStatus("good");
        } else if (avg < 450) {
          setNetworkStatus("fair");
        } else {
          setNetworkStatus("weak");
        }
      } else {
        setNetworkStatus("offline");
      }
    }

    checkLatency();

    return () => {
      active = false;
    };
  }, []);

  const toggleMute = () => {
    if (stream) {
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsMuted(!track.enabled);
      }
    }
  };

  const retryMic = async () => {
    setMicError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(s);
      const track = s.getAudioTracks()[0];
      if (track) {
        setIsMuted(!track.enabled);
      }
    } catch (err) {
      setMicError("Please allow mic access");
    }
  };

  const isAllWell = !!stream && networkStatus !== "offline" && networkStatus !== "checking";

  // WiFi bars mapping
  const barsCount = {
    offline: 0,
    checking: 0,
    weak: 1,
    fair: 2,
    good: 3,
    excellent: 4,
  }[networkStatus];

  const barColor = {
    offline: "bg-muted-foreground/35",
    checking: "bg-muted-foreground/35 animate-pulse",
    weak: "bg-rose-500",
    fair: "bg-amber-500",
    good: "bg-blue-500",
    excellent: "bg-emerald-500",
  }[networkStatus];

  const networkText = {
    checking: "Checking connection...",
    excellent: "Excellent Connection",
    good: "Good Connection",
    fair: "Fair Connection",
    weak: "Weak Connection",
    offline: "Offline - Connection Failed",
  }[networkStatus];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="text-lg font-semibold text-foreground mb-4">Device & Connection Setup</h3>

        <div className="space-y-6">
          {/* Microphone Section */}
          <div className="space-y-2.5 rounded-lg border border-border bg-muted/15 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Microphone Test</span>
              {stream ? (
                <button
                  type="button"
                  onClick={toggleMute}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors border",
                    isMuted
                      ? "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20"
                      : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20"
                  )}
                >
                  {isMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                  {isMuted ? "Muted" : "Unmuted"}
                </button>
              ) : (
                <span className="text-xs font-medium text-rose-500 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> No Mic
                </span>
              )}
            </div>

            {micError ? (
              <div className="space-y-2">
                <p className="text-xs text-rose-500 font-medium">{micError}</p>
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={retryMic}>
                  Grant Mic Access
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <MicVisualizer stream={stream} isMuted={isMuted} />
                <p className="text-xs text-muted-foreground text-center">
                  {isMuted
                    ? "Microphone is muted. Click 'Muted' to unmute and test your voice."
                    : "Speak to see your audio levels."}
                </p>
              </div>
            )}
          </div>

          {/* Network Strength Section */}
          <div className="space-y-2.5 rounded-lg border border-border bg-muted/15 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Network Strength</span>
              <div className="flex items-center gap-2">
                {networkLatency !== null && (
                  <span className="text-xs font-mono text-muted-foreground">{networkLatency}ms</span>
                )}
                <div className="flex items-end gap-0.5 h-4 w-6">
                  {[1, 2, 3, 4].map((bar) => (
                    <div
                      key={bar}
                      className={cn(
                        "w-1 rounded-t-sm transition-all duration-300",
                        bar <= barsCount ? barColor : "bg-muted-foreground/15",
                        bar === 1 && "h-1.5",
                        bar === 2 && "h-2.5",
                        bar === 3 && "h-3.5",
                        bar === 4 && "h-4.5"
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {networkStatus === "checking" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : networkStatus === "offline" ? (
                <WifiOff className="h-3.5 w-3.5 text-rose-500" />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-primary" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  networkStatus === "offline"
                    ? "text-rose-500"
                    : networkStatus === "checking"
                      ? "text-muted-foreground"
                      : "text-foreground"
                )}
              >
                {networkText}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!isAllWell} onClick={onDone} className="gap-1.5">
            <Check className="h-4 w-4" />
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function MicVisualizer({ stream, isMuted }: { stream: MediaStream | null; isMuted: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!stream || isMuted) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(100, 116, 139, 0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
      return;
    }

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let raf: number = 0;

    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      analyser.fftSize = 64;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const draw = () => {
        raf = requestAnimationFrame(draw);
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        analyser!.getByteFrequencyData(dataArray);

        const barWidth = (width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = (dataArray[i] / 255) * height * 0.95;

          const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
          grad.addColorStop(0, "rgba(59, 130, 246, 0.15)");
          grad.addColorStop(1, "rgb(59, 130, 246)");

          ctx.fillStyle = grad;
          ctx.fillRect(x, height - barHeight, barWidth - 3, barHeight);

          x += barWidth;
        }
      };

      draw();
    } catch (e) {
      console.error("AudioContext initialization failed", e);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (audioCtx) {
        audioCtx.close();
      }
    };
  }, [stream, isMuted]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={60}
      className="h-16 w-full rounded-md border border-border bg-muted/20"
    />
  );
}

