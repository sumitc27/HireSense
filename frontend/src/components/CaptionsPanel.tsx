import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface CaptionEntry {
  id: string;
  who: "you" | "coach";
  text: string;
  streaming?: boolean;
}

/** Live captions: what you said (STT) and what the coach says (streamed). */
export function CaptionsPanel({ entries }: { entries: CaptionEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-muted-foreground">
        Live captions of the conversation appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <Card
          key={e.id}
          className={cn(
            "max-w-[90%] px-4 py-2.5",
            e.who === "you" ? "ml-auto bg-primary/5" : "mr-auto"
          )}
        >
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            {e.who === "you" ? (
              <>
                <User className="h-3 w-3" /> You
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3 text-primary" /> Coach
              </>
            )}
          </p>
          <div className="prose-chat text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.text}</ReactMarkdown>
            {e.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
            )}
          </div>
        </Card>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
