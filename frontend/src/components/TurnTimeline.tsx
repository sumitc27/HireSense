import { CornerDownRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface TimelineTurn {
  questionIndex: number;
  isFollowUp: boolean;
  overall: number | null;   // null while the turn hasn't been scored yet
}

/** Compact progress strip: one chip per turn asked so far (main Qs + follow-ups). */
export function TurnTimeline({
  turns,
  total,
  currentIndex,
}: {
  turns: TimelineTurn[];
  total: number;
  currentIndex: number;
}) {
  return (
    <div className="flex w-full max-w-2xl flex-wrap items-center gap-1.5">
      {turns.map((t, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] tabular-nums",
                t.overall == null
                  ? "border-border text-muted-foreground"
                  : t.overall >= 4
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : t.overall >= 3
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
              )}
            >
              {t.isFollowUp && <CornerDownRight className="h-2.5 w-2.5" />}
              Q{t.questionIndex + 1}
              {t.overall != null && <span>· {t.overall.toFixed(1)}</span>}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t.isFollowUp ? "Follow-up" : "Main question"} {t.questionIndex + 1}
            {t.overall != null ? ` — scored ${t.overall.toFixed(1)}/5` : " — in progress"}
          </TooltipContent>
        </Tooltip>
      ))}
      <span className="ml-1 text-[11px] text-muted-foreground">
        question {Math.min(currentIndex + 1, total)} of {total}
      </span>
    </div>
  );
}
