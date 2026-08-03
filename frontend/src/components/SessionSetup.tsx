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
  AlertTriangle,
  Loader2,
  Check,
  X,
  Upload,
  Trash2,
  FileText,
  Briefcase,
  Award,
  HelpCircle,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { uploadResume } from "@/lib/api";
import { useAuth } from "@clerk/react";

const SENIORITIES = ["junior", "mid-level", "senior", "staff"] as const;
const ROLE_PRESETS = [
  "backend engineer",
  "frontend engineer",
  "full-stack engineer",
  "data scientist",
  "product manager",
];

const FILE_TYPE_CHIPS = [
  { label: ".PDF", color: "text-red-400 bg-red-500/10 border-red-500/20" },
  { label: ".DOCX", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  { label: ".TXT", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
];

export interface SessionSetupValues {
  role: string;
  seniority: string;
  questionCount: number;
  resumeText?: string;
  resumeFileName?: string;
}

/** Stylised microphone icon with teal gradient circle */
function StylisedMicIcon({ className }: { className?: string }) {
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[hsl(var(--accent-teal))] to-[hsl(172,66%,35%)] opacity-15" />
      <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-[hsla(var(--accent-teal),0.3)] bg-gradient-to-br from-[hsla(var(--accent-teal),0.15)] to-[hsla(172,66%,35%,0.08)]">
        <Mic className="h-5 w-5 text-[hsl(var(--accent-teal))]" />
      </div>
    </div>
  );
}

/** pre-interview configuration wizard:
 * 1. Step 1: Configuration Form (role, seniority, questionCount, optional resume upload).
 * 2. Configure Setup button opens the VerificationModal popup screen.
 * 3. Step 2 (Popup Modal): Verification of microphone (canvas visualizer + mute/unmute status toggle) and network latency strength check.
 * 4. Step 3: Selection Review Screen (displays selected options + resume name, edit button, and start button).
 */
export function SessionSetup({
  onStart,
  starting,
}: {
  onStart: (values: SessionSetupValues) => void;
  starting: boolean;
}) {
  const { getToken } = useAuth();
  const [role, setRole] = useState(ROLE_PRESETS[0]);
  const [seniority, setSeniority] = useState<(typeof SENIORITIES)[number]>("senior");
  const [questionCount, setQuestionCount] = useState(3);
  const [step, setStep] = useState<"form" | "review">("form");
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  // Resume state
  const [resumeText, setResumeText] = useState("");
  const [resumeFileName, setResumeFileName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File is too large. Max size is 5MB.");
      return;
    }

    // Validate extension
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx" && ext !== "txt") {
      setUploadError("Unsupported format. Please upload PDF, DOCX, or TXT.");
      return;
    }

    setIsUploading(true);
    setUploadError("");

    try {
      const token = await getToken();
      const res = await uploadResume(file, token ?? undefined);
      setResumeText(res.text);
      setResumeFileName(file.name);
    } catch (err: any) {
      console.error(err);
      setUploadError(err.message || "Failed to parse resume. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const removeResume = () => {
    setResumeText("");
    setResumeFileName("");
    setUploadError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      {step === "form" ? (
        <Card glass className="mx-auto mt-10 w-full max-w-md p-8">
          <div className="mb-6 text-center">
            <StylisedMicIcon className="mx-auto mb-3" />
            <h2 className="text-lg font-bold tracking-tight">Set up your mock interview</h2>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              The coach asks role-specific questions out loud, scores each answer,
              and coaches you back — in real time.
            </p>
          </div>

          <div className="space-y-6">
            {/* Role field */}
            <div>
              <label className="label-premium mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5 text-[hsl(var(--accent-teal))]" />
                Role
              </label>
              <input
                list="role-presets"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. backend engineer"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring transition-shadow"
              />
              <datalist id="role-presets">
                {ROLE_PRESETS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            {/* Seniority field */}
            <div>
              <label className="label-premium mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Award className="h-3.5 w-3.5 text-[hsl(var(--accent-teal))]" />
                Seniority
              </label>
              <div className="grid grid-cols-4 gap-2">
                {SENIORITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeniority(s)}
                    className={cn(
                      "rounded-lg border px-2.5 py-2 text-xs capitalize transition-all duration-200",
                      s === seniority
                        ? "seniority-glow font-semibold"
                        : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/30"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Question stepper */}
            <div>
              <label className="label-premium mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Questions
              </label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  disabled={questionCount <= 1}
                  onClick={() => setQuestionCount((c) => Math.max(1, c - 1))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center text-base font-semibold tabular-nums">{questionCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  disabled={questionCount >= 6}
                  onClick={() => setQuestionCount((c) => Math.min(6, c + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  main question{questionCount > 1 ? "s" : ""}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground/70 hover:text-muted-foreground transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px] text-xs">
                      Weak answers automatically trigger follow-up questions to help you improve.
                    </TooltipContent>
                  </Tooltip>
                </span>
              </div>
            </div>

            {/* Resume Upload Section */}
            <div className="rounded-xl border border-dashed border-border/80 bg-muted/5 p-4 space-y-2.5">
              <label className="label-premium flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <FileText className="h-3.5 w-3.5 text-[hsl(var(--accent-teal))]" />
                Resume (Optional)
              </label>

              {!resumeFileName ? (
                <div className="space-y-2.5">
                  <div
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center py-5 px-3 rounded-xl border border-dashed border-border hover:border-[hsl(var(--accent-teal))]/50 bg-background cursor-pointer hover:bg-muted/10 transition-all text-center gap-2.5 group"
                  >
                    {isUploading ? (
                      <Loader2 className="h-6 w-6 text-[hsl(var(--accent-teal))] animate-spin" />
                    ) : (
                      <Upload className="h-6 w-6 text-muted-foreground group-hover:text-[hsl(var(--accent-teal))] transition-colors" />
                    )}
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-foreground">
                        {isUploading ? "Uploading & parsing..." : "Upload your resume"}
                      </p>
                      {/* File-type preview chips */}
                      <div className="flex items-center justify-center gap-1.5 pt-0.5">
                        {FILE_TYPE_CHIPS.map((chip) => (
                          <span
                            key={chip.label}
                            className={cn(
                              "inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold border",
                              chip.color
                            )}
                          >
                            {chip.label}
                          </span>
                        ))}
                        <span className="text-[10px] text-muted-foreground/60 ml-0.5">Max 5MB</span>
                      </div>
                    </div>
                  </div>
                  {/* Upload progress bar */}
                  {isUploading && (
                    <div className="w-full rounded-full bg-muted/30 overflow-hidden">
                      <div className="upload-progress-bar" />
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={isUploading}
                  />
                  {uploadError && (
                    <p className="text-[11px] text-rose-500 font-medium flex items-center gap-1 justify-center">
                      <AlertTriangle className="h-3.5 w-3.5" /> {uploadError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="truncate font-medium text-foreground">{resumeFileName}</span>
                    <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">
                      Parsed
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={removeResume}
                    className="text-muted-foreground hover:text-rose-500 transition-colors p-1"
                    title="Remove resume"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Configure Setup button */}
            <Button
              type="button"
              className="mt-2 w-full gap-2 font-semibold btn-shimmer"
              disabled={role.trim().length === 0 || isUploading}
              onClick={() => setIsPopupOpen(true)}
            >
              <Settings2 className="h-4 w-4" />
              Configure Setup
            </Button>
          </div>
        </Card>
      ) : (
        <Card glass className="mx-auto mt-10 w-full max-w-md p-8">
          <div className="mb-6 text-center">
            <StylisedMicIcon className="mx-auto mb-3" />
            <h2 className="text-lg font-bold tracking-tight">Review your setup</h2>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Confirm your selections before starting the interview.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/10 p-5 space-y-3.5">
              <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5 text-[hsl(var(--accent-teal))]" />
                  Role
                </span>
                <span className="text-sm font-semibold capitalize text-foreground">{role}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Award className="h-3.5 w-3.5 text-[hsl(var(--accent-teal))]" />
                  Level
                </span>
                <span className="text-xs font-semibold capitalize seniority-glow px-2.5 py-0.5 rounded-md">
                  {seniority}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
                <span className="text-xs font-medium text-muted-foreground">Max Questions</span>
                <span className="text-sm font-semibold text-foreground">{questionCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Resume</span>
                {resumeFileName ? (
                  <span
                    className="text-xs font-semibold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded truncate max-w-[200px]"
                    title={resumeFileName}
                  >
                    {resumeFileName}
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-muted-foreground italic">
                    None uploaded
                  </span>
                )}
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
                className="flex-1 gap-2 btn-shimmer"
                disabled={starting}
                onClick={() =>
                  onStart({
                    role: role.trim(),
                    seniority,
                    questionCount,
                    resumeText,
                    resumeFileName,
                  })
                }
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
      <div className="glass-card relative w-full max-w-md rounded-2xl border border-border p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="text-lg font-bold text-foreground mb-4 tracking-tight">Device & Connection Setup</h3>

        <div className="space-y-6">
          {/* Microphone Section */}
          <div className="space-y-2.5 rounded-xl border border-border bg-muted/10 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Microphone Test</span>
              {stream ? (
                <button
                  type="button"
                  onClick={toggleMute}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors border",
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
          <div className="space-y-2.5 rounded-xl border border-border bg-muted/10 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Network Strength</span>
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
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--accent-teal))]" />
              ) : networkStatus === "offline" ? (
                <WifiOff className="h-3.5 w-3.5 text-rose-500" />
              ) : (
                <Wifi className="h-3.5 w-3.5 text-[hsl(var(--accent-teal))]" />
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

          // Use teal gradient instead of blue
          const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
          grad.addColorStop(0, "rgba(20, 184, 166, 0.15)");
          grad.addColorStop(1, "rgb(20, 184, 166)");

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
      className="h-16 w-full rounded-lg border border-border bg-muted/10"
    />
  );
}
