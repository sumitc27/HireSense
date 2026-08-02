import { useState } from "react";
import { Mic, Minus, Plus } from "lucide-react";
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

/** Pre-interview form: role, seniority, question count. Plain HTML controls —
 * this project hand-styles inputs against the existing token system rather
 * than pulling in shadcn's input/select (which aren't in this kit yet). */
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

  const canStart = role.trim().length > 0 && !starting;

  return (
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
          className="mt-2 w-full"
          disabled={!canStart}
          onClick={() => onStart({ role: role.trim(), seniority, questionCount })}
        >
          {starting ? "Preparing questions…" : "Start interview"}
        </Button>
      </div>
    </Card>
  );
}
