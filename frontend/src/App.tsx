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

type Phase = "setup" | "connecting" | "live" | "done";

// Mic is pressable during "listening" (the normal answer window) AND while
// the coach is still talking ("asking"/"coaching") — pressing then is a
// barge-in: pressStart() flushes local playback and sends `barge_in` before
// recording starts.
const MIC_ENABLED_STATES = new Set(["listening", "asking", "coaching"]);

export default function App() {
  useApplyTheme();
  const micMode = useStore((s) => s.micMode);
  const setMicMode = useStore((s) => s.setMicMode);

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

  async function start(values: SessionSetupValues) {
    setPhase("connecting");
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

    const socket = new VoiceSocket({
      onEvent,
      onAudio: (wav, meta) => void player.enqueue(wav, meta.turn_id),
      onClose: () => {
        captureRef.current?.stopOpenMic();
        toast.info("Session ended.");
      },
      onError: () => toast.error("Connection failed — is the backend running on :8002?"),
    });
    player.onFirstPlayback = (turnId) =>
      socket.send({ type: "playback_started", turn_id: turnId, seq: 0 });

    try {
      await socket.connect();
      socketRef.current = socket;
      socket.startSession(values.role, values.seniority, values.questionCount);
      setPhase("live");
    } catch {
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

  const pressStart = useCallback(() => {
    const capture = captureRef.current;
    if (!capture?.ready || capture.recording) return;
    // Talking over the coach = barge-in.
    if (playerRef.current?.speaking) {
      playerRef.current.flush();
      socketRef.current?.send({ type: "barge_in" });
      setSpeaking(false);
    }
    capture.startRecording();
    liveCaptionsRef.current.start(upsertLive); // instant on-screen preview while you talk
    setRecording(true);
  }, []);

  const pressEnd = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture?.recording) return;
    liveCaptionsRef.current.stop();
    setRecording(false);
    const utterance = await capture.stopRecording();
    if (!utterance) {
      removeCaption(LIVE_ID);
      toast.info("Too short — hold the mic while you speak.");
      return;
    }
    const buf = await utterance.blob.arrayBuffer();
    socketRef.current?.sendUtterance(buf, utterance.durationMs, capture.mimeType);
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
  }, [micMode, phase, turnState]);

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
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <AppHeader>
          {phase === "live" && <LatencyBadge stages={latency} />}
        </AppHeader>

        <main className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6">
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
                {!useTyped && <Waveform capture={captureRef.current} active={recording} />}
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
                    <Button variant="outline" size="sm" onClick={stop}>
                      <PhoneOff className="h-3.5 w-3.5" /> End
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMicMode(micMode === "ptt" ? "open_mic" : "ptt")}
                      title="Toggle push-to-talk vs. open mic"
                    >
                      {micMode === "ptt" ? <Hand className="h-3.5 w-3.5" /> : <Ear className="h-3.5 w-3.5" />}
                      {micMode === "ptt" ? "Push-to-talk" : "Open mic"}
                    </Button>
                    {micMode === "ptt" ? (
                      <MicControl
                        enabled={micOk && MIC_ENABLED_STATES.has(turnState)}
                        recording={recording}
                        onPressStart={pressStart}
                        onPressEnd={pressEnd}
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
                    <Button variant="outline" size="sm" onClick={() => setShowTyped(true)}>
                      <Keyboard className="h-3.5 w-3.5" /> Type instead
                    </Button>
                    <Button variant="outline" size="sm" onClick={stop}>
                      <PhoneOff className="h-3.5 w-3.5" /> End
                    </Button>
                  </div>
                )}
                {speaking && (
                  <p className="text-xs text-muted-foreground">
                    Coach is speaking — {micMode === "ptt" ? "hold the mic" : "start talking"} to interrupt.
                  </p>
                )}
              </div>
            </>
          )}
        </main>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
