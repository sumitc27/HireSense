import { Timer } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STAGE_LABEL: Record<string, string> = {
  stt_done: "STT",
  llm_first_token: "LLM 1st token",
  tts_first_chunk: "TTS 1st audio",
  playback_started: "playback",
  e2e_ms: "end-to-end",
};

/** Always-visible voice-loop latency — the project's headline metric. */
export function LatencyBadge({ stages }: { stages: Record<string, number> | null }) {
  const e2e = stages?.e2e_ms ?? stages?.tts_first_chunk;
  const color =
    e2e == null
      ? "text-muted-foreground"
      : e2e < 2000
        ? "text-emerald-600 dark:text-emerald-400"
        : e2e < 4000
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex cursor-default items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs tabular-nums",
            color
          )}
        >
          <Timer className="h-3.5 w-3.5" />
          {e2e != null ? `${(e2e / 1000).toFixed(1)}s voice loop` : "latency —"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {stages ? (
          <div className="space-y-0.5">
            {Object.entries(stages).map(([k, v]) => (
              <p key={k} className="flex justify-between gap-4 tabular-nums">
                <span>{STAGE_LABEL[k] ?? k}</span>
                <span>{v}ms</span>
              </p>
            ))}
          </div>
        ) : (
          "Per-stage voice-loop timings appear after your first answer"
        )}
      </TooltipContent>
    </Tooltip>
  );
}
