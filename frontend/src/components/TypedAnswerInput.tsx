import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Text fallback for answering: always available during LISTENING so mic
 * denial, STT failures, or a non-English attempt never dead-end a session. */
export function TypedAnswerInput({
  onSubmit,
  disabled,
  autoFocus,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setText("");
  }

  return (
    <form onSubmit={submit} className="flex w-full items-end gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder="Type your answer instead…"
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit(e);
          }
        }}
        className="w-full flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
      <Button type="submit" size="icon" disabled={disabled || !text.trim()}>
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
