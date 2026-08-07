import { useCallback, useEffect, useRef, useState } from "react";
import { Ear, Hand, Keyboard, Mic as MicIcon, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { useApplyTheme } from "@/lib/theme";
import { useStore } from "@/store";
import { AudioCapture } from "@/lib/audioCapture";
import { AudioPlayer } from "@/lib/audioPlayer";
import { LiveCaptions } from "@/lib/liveCaptions";
import { VoiceSocket, type Report, type ServerEvent } from "@/lib/ws";
import { AppHeader } from "./components/AppHeader";
import { CaptionsPanel, type CaptionEntry } from "./components/CaptionsPanel";
import { FeedbackCard } from "./components/FeedbackCard";
import { LatencyBadge } from "./components/LatencyBadge";
import { MicControl } from "./components/MicControl";
import { ReportCard } from "./components/ReportCard";
import { SessionSetup, type SessionSetupValues } from "./components/SessionSetup";
import { TurnTimeline, type TimelineTurn } from "./components/TurnTimeline";
import { TypedAnswerInput } from "./components/TypedAnswerInput";
import { Waveform } from "./components/Waveform";
import { Show, SignInButton, SignUpButton, useAuth } from "@clerk/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { checkDailyLimit } from "@/lib/api";

type Phase = "setup" | "connecting" | "live" | "done";

// Mic is pressable during "listening" (the normal answer window) AND while
// the coach is still talking ("asking"/"coaching") — pressing then is a
// barge-in: pressStart() flushes local playback and sends `barge_in` before
// recording starts.
const MIC_ENABLED_STATES = new Set(["listening"]);

// ── Feature flag: open-mic mode ──────────────────────────────────────────
// Set to `true` to re-enable the open-mic / VAD toggle in the live UI.
// See docs/inactive_features.md for full reactivation instructions.
const ENABLE_OPEN_MIC = false;

export default function App() {
  const { getToken } = useAuth();
  useApplyTheme();
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const storedMicMode = useStore((s) => s.micMode);
  const setMicMode = useStore((s) => s.setMicMode);
  // When the feature flag is off, force push-to-talk regardless of stored pref.
  const micMode = ENABLE_OPEN_MIC ? storedMicMode : "ptt" as const;

  const [phase, setPhase] = useState<Phase>("setup");
  const [recording, setRecording] = useState(false);
  const [micOk, setMicOk] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [captions, setCaptions] = useState<CaptionEntry[]>([]);
  const [latency, setLatency] = useState<Record<string, number> | null>(null);
  const [turnState, setTurnState] = useState<string>("idle");
  const [question, setQuestion] = useState<{ index: number; total: number; isFollowUp: boolean } | null>(null);
  const [rubricTurnId, setRubricTurnId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineTurn[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [showTyped, setShowTyped] = useState(false);

  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const socketRef = useRef<VoiceSocket | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const liveCaptionsRef = useRef<LiveCaptions>(new LiveCaptions());
  const coachEntryRef = useRef<string | null>(null);
  const openMicCalibratedRef = useRef(false); // calibrate ambient noise once per session, not per turn
  const rubricsRef = useRef<Map<string, ServerEvent & { type: "scoring" }>>(new Map());

  const LIVE_ID = "you-live"; // provisional caption shown while you speak, before Whisper's result

  const appendCaption = (entry: CaptionEntry) => setCaptions((c) => [...c, entry]);
  const patchCaption = (id: string, patch: Partial<CaptionEntry>) =>
    setCaptions((c) => c.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const appendCoachText = (id: string, text: string) =>
    setCaptions((c) => c.map((e) => (e.id === id ? { ...e, text: e.text + text } : e)));
  const removeCaption = (id: string) => setCaptions((c) => c.filter((e) => e.id !== id));
  // Upsert the single live "you" preview caption as Web Speech interim text grows.
  const upsertLive = (text: string) =>
    setCaptions((c) => {
      const existing = c.find((e) => e.id === LIVE_ID);
      if (existing) return c.map((e) => (e.id === LIVE_ID ? { ...e, text } : e));
      return [...c, { id: LIVE_ID, who: "you", text, streaming: true }];
    });

  const onEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "state":
        setTurnState(event.state);
        break;
      case "question":
        setQuestion({ index: event.index, total: event.total, isFollowUp: event.is_follow_up });
        setRubricTurnId(null);
        appendCaption({ id: `q-${event.turn_id}`, who: "coach", text: event.text });
        setTimeline((t) => [...t, { questionIndex: event.index, isFollowUp: event.is_follow_up, overall: null }]);
        break;
      case "stt_result":
        // Whisper's authoritative transcript replaces the live Web Speech preview.
        removeCaption(LIVE_ID);
        appendCaption({ id: `you-${event.turn_id}`, who: "you", text: event.text });
        break;
      case "scoring":
        rubricsRef.current.set(event.turn_id, event);
        setRubricTurnId(event.turn_id);
        setTimeline((t) => {
          const next = [...t];
          const last = next[next.length - 1];
          if (last) last.overall = event.rubric.overall;
          return next;
        });
        break;
      case "coaching_delta": {
        const id = `coach-${event.turn_id}`;
        if (coachEntryRef.current !== id) {
          coachEntryRef.current = id;
          playerRef.current?.newTurn();
          appendCaption({ id, who: "coach", text: event.text, streaming: true });
        } else {
          appendCoachText(id, event.text);
        }
        break;
      }
      case "tts_end":
        if (coachEntryRef.current) {
          patchCaption(coachEntryRef.current, { streaming: false });
          coachEntryRef.current = null;
        }
        setSpeaking(false);
        break;
      case "tts_chunk":
        setSpeaking(true);
        break;
      case "latency":
        setLatency(event.stages);
        break;
      case "report":
        setReport(event.report);
        setPhase("done");
        break;
      case "error":
        toast[event.recoverable ? "warning" : "error"](event.message);
        break;
    }
  }, []);

  useEffect(() => {
    if (phase !== "live") return;
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Refreshing the page will end your interview session. You cannot resume it.";
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase]);

  async function start(values: SessionSetupValues) {
    setPhase("connecting");
    const token = await getToken();

    // Check daily limit before allocating devices or connecting WebSocket
    try {
      const limitInfo = await checkDailyLimit(token ?? undefined);
      if (limitInfo.exceeded) {
        setShowLimitDialog(true);
        setPhase("setup");
        return;
      }
    } catch (err) {
      console.error("Failed to check daily session limit", err);
    }

    // AudioContext + mic must be requested inside this click (autoplay policy).
    const player = new AudioPlayer();
    player.init();
    playerRef.current = player;

    const capture = new AudioCapture();
    try {
      await capture.init();
      // Ambient VAD calibration is only needed for open-mic mode — it's run
      // lazily in the open-mic effect below, not here, so push-to-talk (the
      // default) starts without the ~500ms calibration stall.
      captureRef.current = capture;
      setMicOk(true);
    } catch {
      setMicOk(false);
      toast.error("Microphone access denied — voice input unavailable. Type your answers instead.");
    }

    let socket: VoiceSocket;
    try {
      const token = await getToken();

      const connectWithRetry = async (maxWaitMs = 30000): Promise<VoiceSocket> => {
        const startTime = Date.now();
        let isFirstFailure = true;
        let hasConnected = false;

        while (true) {
          const s = new VoiceSocket({
            onEvent,
            onAudio: (wav, meta) => void player.enqueue(wav, meta.turn_id),
            onClose: (code) => {
              captureRef.current?.stopOpenMic();
              if (code === 4003) {
                toast.error("Your daily interview limit has been reached. Please try again tomorrow!");
              } else if (code === 4008) {
                toast.error("Session closed: Authentication required.");
              } else if (hasConnected) {
                toast.info("Session ended.");
              }
            },
            // We handle the connection error via the promise rejection in the loop below.
            onError: () => {}, 
          });

          try {
            await s.connect(token ?? undefined);
            hasConnected = true;
            if (!isFirstFailure) {
              toast.success("Backend is ready, starting interview!");
            }
            return s;
          } catch (e) {
            if (isFirstFailure) {
              toast.info("The AI coach is waking up. This takes about 30 seconds, please wait...", { duration: 10000 });
              isFirstFailure = false;
            }
            if (Date.now() - startTime > maxWaitMs) {
              throw new Error("Timeout waiting for backend");
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      };

      socket = await connectWithRetry(30000);
      socketRef.current = socket;
      
      player.onFirstPlayback = (turnId) =>
        socket.send({ type: "playback_started", turn_id: turnId, seq: 0 });

      socket.startSession(values.role, values.seniority, values.questionCount, values.resumeText);
      setPhase("live");
    } catch {
      toast.error("Some technical issue occurred. Please try again later.");
      setPhase("setup");
      capture.destroy();
      player.destroy();
    }
  }

  function stop() {
    socketRef.current?.close();
    liveCaptionsRef.current.stop();
    captureRef.current?.destroy();
    playerRef.current?.destroy();
    socketRef.current = null;
    captureRef.current = null;
    playerRef.current = null;
    openMicCalibratedRef.current = false;
    setPhase("setup");
    setRecording(false);
    setSpeaking(false);
    setCaptions([]);
    setTimeline([]);
    setQuestion(null);
    setReport(null);
    // Reset per-turn UI so a fresh session doesn't flash stale state.
    setTurnState("idle");
    setShowTyped(false);
    setLatency(null);
    rubricsRef.current.clear();
  }

  const toggleRecording = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture?.ready) return;

    if (!capture.recording) {
      // Talking over the coach = barge-in.
      if (playerRef.current?.speaking) {
        playerRef.current.flush();
        socketRef.current?.send({ type: "barge_in" });
        setSpeaking(false);
      }
      capture.startRecording();
      recordingStartTimeRef.current = performance.now();
      liveCaptionsRef.current.start(upsertLive); // instant on-screen preview while you talk
      setRecording(true);
    } else {
      if (performance.now() - recordingStartTimeRef.current < 4000) {
        toast.info("Please speak for at least 4 seconds before stopping.");
        return;
      }
      liveCaptionsRef.current.stop();
      setRecording(false);
      const utterance = await capture.stopRecording();
      if (!utterance) {
        removeCaption(LIVE_ID);
        toast.info("Recording was too short or empty.");
        return;
      }
      const buf = await utterance.blob.arrayBuffer();
      socketRef.current?.sendUtterance(buf, utterance.durationMs, capture.mimeType);
    }
  }, []);

  // Open-mic mode: auto-arm the VAD whenever we enter LISTENING, disarm otherwise.
  useEffect(() => {
    const capture = captureRef.current;
    if (!capture || micMode !== "open_mic" || phase !== "live") return;
    if (turnState !== "listening") {
      capture.stopOpenMic();
      liveCaptionsRef.current.stop();
      return;
    }
    let cancelled = false;
    const arm = () => {
      if (cancelled) return;
      liveCaptionsRef.current.start(upsertLive);
      capture.startOpenMic(async (utterance) => {
        liveCaptionsRef.current.stop();
        setRecording(false);
        if (!utterance) {
          removeCaption(LIVE_ID);
          return;
        }
        const buf = await utterance.blob.arrayBuffer();
        socketRef.current?.sendUtterance(buf, utterance.durationMs, capture.mimeType);
      });
      setRecording(true);
    };
    // Calibrate ambient noise lazily — only when open-mic is actually used
    // (kept out of session start so push-to-talk isn't stalled), and only
    // once per session (later turns arm the mic immediately, no re-stall).
    if (openMicCalibratedRef.current) {
      arm();
    } else {
      void capture.calibrateAmbient().then(() => {
        openMicCalibratedRef.current = true;
        arm();
      });
    }
    return () => {
      cancelled = true;
      capture.stopOpenMic();
      liveCaptionsRef.current.stop();
    };
  }, [micMode, phase, turnState, upsertLive, removeCaption]);

  // Monitor for system-level mic mute during the live interview
  useEffect(() => {
    if (phase !== "live" || !micOk) return;

    let active = true;
    let silentSamples = 0;
    const SILENT_THRESHOLD = 0.005; // RMS below this = silence
    const REQUIRED_SILENT_CHECKS = 10; // 10 checks × 500ms = 5s of silence
    let lastToastTime = 0;

    const interval = window.setInterval(() => {
      if (!active) return;
      const capture = captureRef.current;
      if (!capture || !capture.ready) return;

      const rms = capture.level();
      if (rms < SILENT_THRESHOLD) {
        silentSamples++;
        if (silentSamples >= REQUIRED_SILENT_CHECKS) {
          const now = Date.now();
          // Warn once every 15 seconds max to avoid spam
          if (now - lastToastTime > 15000) {
            toast.warning("System microphone appears muted. Please check your system settings or taskbar.", {
              id: "system-mute-warning",
              duration: 5000,
            });
            lastToastTime = now;
          }
          silentSamples = 0;
        }
      } else {
        silentSamples = 0;
      }
    }, 500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [phase, micOk]);

  const submitTyped = useCallback((text: string) => {
    socketRef.current?.sendTypedAnswer(text);
  }, []);

  const currentRubric = rubricTurnId ? rubricsRef.current.get(rubricTurnId)?.rubric ?? null : null;
  const useTyped = showTyped || !micOk;
  const statusLabel: Record<string, string> = {
    generating_questions: "Preparing your questions…",
    asking: "Coach is asking…",
    listening: micMode === "open_mic" ? "Listening — just start talking" : "Hold the mic and answer",
    transcribing: "Transcribing…",
    scoring: "Scoring your answer…",
    coaching: "Coaching…",
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="bg-decorations flex print:block h-screen print:h-auto w-screen print:w-auto flex-col overflow-hidden print:overflow-visible bg-background text-foreground">
        <AppHeader>
          {phase === "live" && <LatencyBadge stages={latency} />}
        </AppHeader>

        <main className="flex print:block min-h-0 flex-1 flex-col items-center overflow-y-auto print:overflow-visible px-6 py-6">
          <Show when="signed-in">
            {phase === "setup" || phase === "connecting" ? (
              <SessionSetup onStart={start} starting={phase === "connecting"} />
            ) : phase === "done" && report ? (
              <div className="mt-6 w-full">
                <ReportCard report={report} onNewInterview={stop} />
              </div>
            ) : (
              <>
                <div className="w-full max-w-2xl pb-2">
                  <TurnTimeline
                    turns={timeline}
                    total={question?.total ?? 1}
                    currentIndex={question?.index ?? 0}
                  />
                </div>
                <div className="scroll-thin w-full max-w-2xl flex-1 overflow-y-auto py-2">
                  <CaptionsPanel entries={captions} />
                  {currentRubric && (
                    <div className="mt-3">
                      <FeedbackCard rubric={currentRubric} />
                    </div>
                  )}
                </div>
                <div className="flex w-full max-w-2xl flex-col items-center gap-3 border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground">
                    {statusLabel[turnState] ?? ""}
                  </p>
                  {!useTyped && (
                    <Waveform
                      capture={captureRef.current}
                      player={playerRef.current}
                      userActive={recording}
                      coachActive={speaking}
                    />
                  )}
                  {useTyped ? (
                    <div className="flex w-full items-end gap-2">
                      <TypedAnswerInput
                        onSubmit={submitTyped}
                        disabled={turnState !== "listening"}
                        autoFocus
                      />
                      {micOk && (
                        <Button variant="outline" size="sm" onClick={() => setShowTyped(false)}>
                          <MicIcon className="h-3.5 w-3.5" /> Voice
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setShowEndDialog(true)}>
                        <PhoneOff className="h-3.5 w-3.5" /> End
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      {ENABLE_OPEN_MIC && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setMicMode(micMode === "ptt" ? "open_mic" : "ptt")}
                          title="Toggle push-to-talk vs. open mic"
                        >
                          {micMode === "ptt" ? <Hand className="h-3.5 w-3.5" /> : <Ear className="h-3.5 w-3.5" />}
                          {micMode === "ptt" ? "Push-to-talk" : "Open mic"}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setShowTyped(true)}>
                        <Keyboard className="h-3.5 w-3.5" /> Type instead
                      </Button>
                      {micMode === "ptt" ? (
                        <MicControl
                          enabled={micOk && MIC_ENABLED_STATES.has(turnState)}
                          recording={recording}
                          onToggle={toggleRecording}
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border">
                          <Ear
                            className={
                              recording ? "h-6 w-6 animate-pulse text-red-600" : "h-6 w-6 text-muted-foreground"
                            }
                          />
                        </div>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setShowEndDialog(true)}>
                        <PhoneOff className="h-3.5 w-3.5" /> End
                      </Button>
                    </div>
                  )}
                  {speaking && (
                    <p className="text-xs text-muted-foreground">
                      Coach is speaking — {micMode === "ptt" ? "press the mic" : "start talking"} to interrupt.
                    </p>
                  )}
                </div>
              </>
            )}
          </Show>
          <Show when="signed-out">
            <div className="mx-auto mt-20 max-w-md w-full text-center space-y-6 rounded-2xl border border-border bg-card/45 backdrop-blur-md p-8 shadow-2xl">
              <img
                src="/HireSense.png"
                alt="HireSense Logo"
                className="h-12 w-12 rounded-full mx-auto shadow-sm object-cover"
              />
              <div className="space-y-2">
                <h2 className="text-xl font-bold tracking-tight text-foreground">Welcome to HireSense</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your real-time AI mock interview coach. Sign in to practice interview sessions with custom role, level, and resume integration.
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <SignInButton mode="modal">
                  <Button className="btn-shimmer font-semibold px-6">Sign In</Button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <Button variant="outline" className="font-semibold px-6">Sign Up</Button>
                </SignUpButton>
              </div>
            </div>
          </Show>
        </main>
      </div>
      <Toaster position="bottom-right" />
      <AlertDialog open={showLimitDialog} onOpenChange={setShowLimitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Daily Limit Reached</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              Your daily interview limit has been reached.
              <br /><br />
              Please visit again after 24 hours.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowLimitDialog(false)}>
              Okay
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Interview?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              Are you sure you want to end this interview?
              <br /><br />
              Any progress will be lost and you will not be able to resume this session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowEndDialog(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => {
                setShowEndDialog(false);
                stop();
              }}
            >
              End Interview
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
