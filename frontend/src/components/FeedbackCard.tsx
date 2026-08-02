import { CheckCircle2, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Rubric } from "@/lib/ws";
import { cn } from "@/lib/utils";

const DIMENSIONS: { key: keyof Rubric; label: string }[] = [
  { key: "structure", label: "Structure" },
  { key: "specificity", label: "Specificity" },
  { key: "correctness", label: "Correctness" },
  { key: "conciseness", label: "Conciseness" },
];

function scoreColor(n: number) {
  if (n >= 4) return "bg-emerald-500";
  if (n >= 3) return "bg-amber-500";
  return "bg-red-500";
}

/** Rubric scorecard shown right after an answer is scored. */
export function FeedbackCard({ rubric }: { rubric: Rubric }) {
  return (
    <Card className="w-full max-w-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Answer scorecard</h3>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
          {rubric.overall.toFixed(1)} / 5
        </span>
      </div>

      <div className="space-y-2">
        {DIMENSIONS.map(({ key, label }) => {
          const value = rubric[key] as number;
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", scoreColor(value))}
                  style={{ width: `${(value / 5) * 100}%` }}
                />
              </div>
              <span className="w-3 text-right tabular-nums">{value}</span>
            </div>
          );
        })}
      </div>

      {(rubric.strengths.length > 0 || rubric.improvements.length > 0) && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
          {rubric.strengths.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Strengths
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {rubric.strengths.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {rubric.improvements.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                <TrendingUp className="h-3 w-3" /> To improve
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {rubric.improvements.map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
