import { useEffect } from "react";
import { Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Push-to-talk control: press-and-hold the button OR hold Space.
 * (Open-mic VAD mode arrives in Phase 4 — PTT is the demo-reliable default.)
 */
export function MicControl({
  enabled,
  recording,
  onPressStart,
  onPressEnd,
}: {
  enabled: boolean;
  recording: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
}) {
  // Hold Space anywhere (except inputs) = hold the mic button.
  useEffect(() => {
    if (!enabled) return;
    const isTyping = (t: EventTarget | null) => {
      const n = t as HTMLElement | null;
      return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTyping(e.target)) {
        e.preventDefault();
        onPressStart();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        e.preventDefault();
        onPressEnd();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [enabled, onPressStart, onPressEnd]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        size="icon"
        disabled={!enabled}
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onPointerLeave={() => recording && onPressEnd()}
        className={cn(
          "h-16 w-16 rounded-full transition-all",
          recording && "scale-110 bg-red-600 hover:bg-red-600 text-white shadow-lg shadow-red-600/30"
        )}
        title="Hold to talk (or hold Space)"
      >
        {enabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        {recording ? "Release to send" : enabled ? "Hold to talk · or hold Space" : "Mic unavailable"}
      </p>
    </div>
  );
}
