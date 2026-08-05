import { createPortal } from "react-dom";
import { Printer, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Rubric } from "@/lib/ws";
import { FeedbackCard } from "./FeedbackCard";

export interface ReportTurn {
  turn_id: string;
  question_index: number;
  is_follow_up: boolean;
  question_text: string;
  answer_text: string;
  answer_source: string;
  rubric: Rubric | null;
  coaching_text: string;
}

export interface ReportLike {
  role: string;
  seniority: string;
  overall_average: number | null;
  top_improvements: string[];
  turns: ReportTurn[];
}

/** Full session report: overall score, top improvements, and a per-turn
 * scorecard + transcript. Printable via the browser's native print dialog —
 * `.print-only`/`.no-print` classes (index.css) hide chrome (header, buttons)
 * so Ctrl+P produces a clean report, not a screenshot of the app shell. */
export function ReportCard({
  report,
  onNewInterview,
}: {
  report: ReportLike;
  onNewInterview?: () => void;
}) {
  const content = (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Interview report</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {report.role} · {report.seniority}
          {report.overall_average != null && <> · overall {report.overall_average.toFixed(1)}/5</>}
        </p>
      </div>

      {report.top_improvements.length > 0 && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="mb-1 font-medium">Top things to work on</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {report.top_improvements.map((imp, i) => (
              <li key={i}>{imp}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {report.turns.map((t) => (
          <div key={t.turn_id}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t.is_follow_up ? "Follow-up" : `Question ${t.question_index + 1}`}: {t.question_text}
            </p>
            <p className="mb-1.5 rounded-md bg-muted/40 p-2 text-xs italic text-muted-foreground">
              "{t.answer_text}" ({t.answer_source})
            </p>
            {t.rubric && <FeedbackCard rubric={t.rubric} />}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="no-print">
        {content}
        <div className="flex justify-center gap-2 pt-6">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          {onNewInterview && (
            <Button onClick={onNewInterview}>
              <RotateCcw className="h-4 w-4" /> New interview
            </Button>
          )}
        </div>
      </div>
      {typeof document !== "undefined" &&
        createPortal(
          <div className="hidden print-override px-8 py-8">
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
