import { useEffect } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Push-to-talk control: press the button OR press Space to toggle recording.
 */
export function MicControl({
  enabled,
  recording,
  onToggle,
}: {
  enabled: boolean;
  recording: boolean;
  onToggle: () => void;
}) {
  // Press Space anywhere (except inputs) = toggle the mic button.
  useEffect(() => {
    if (!enabled) return;
    const isTyping = (t: EventTarget | null) => {
      const n = t as HTMLElement | null;
      return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTyping(e.target)) {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", down);
    return () => {
      window.removeEventListener("keydown", down);
    };
  }, [enabled, onToggle]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button
        size="icon"
        disabled={!enabled}
        onClick={onToggle}
        className={cn(
          "h-16 w-16 rounded-full transition-all",
          recording && "scale-110 bg-red-600 hover:bg-red-600 text-white shadow-lg shadow-red-600/30"
        )}
        title="Click to talk (or press Space)"
      >
        <Mic className="h-6 w-6" />
      </Button>
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
        {recording ? "PRESS TO STOP" : "PRESS TO TALK"}
      </span>
    </div>
  );
}
