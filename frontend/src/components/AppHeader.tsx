import { useQuery } from "@tanstack/react-query";
import { Mic } from "lucide-react";
import { health } from "@/lib/api";
import { SessionsMenu } from "./SessionsMenu";
import { ThemeToggle } from "./ThemeToggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function HealthDot() {
  const { data, isError } = useQuery({
    queryKey: ["health"],
    queryFn: health,
    refetchInterval: 15_000,
  });

  const down = isError || !data;
  const ok = data?.tts_ready;
  const label = down
    ? "Backend unreachable"
    : ok
      ? `Voice ready · STT: ${data.stt_model} · TTS: Kokoro-82M (local)`
      : data.tts_error ?? "Voice synthesis unavailable — captions-only mode";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex cursor-default items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
          aria-label={label}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              down ? "bg-red-500" : ok ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
            )}
          />
          {down ? "Offline" : ok ? "Voice ready" : "Captions only"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex items-center gap-3 border-b border-border bg-card/40 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5 text-primary" />
        <h1 className="text-base font-semibold tracking-tight">HireSense</h1>
      </div>
      <span className="hidden text-xs text-muted-foreground md:inline">
        real-time voice interview coach · local TTS · streamed sentence-by-sentence
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <HealthDot />
        {children}
        <SessionsMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
