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
import { Show, SignInButton, UserButton } from "@clerk/react";
import { Button } from "@/components/ui/button";

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
          className={cn(
            "flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all",
            down
              ? "border-red-500/30 text-red-400"
              : ok
                ? "border-[hsl(var(--accent-teal))]/30 text-muted-foreground shadow-[0_0_8px_hsla(var(--accent-teal),0.15)]"
                : "border-amber-500/30 text-amber-400"
          )}
          aria-label={label}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              down
                ? "bg-red-500"
                : ok
                  ? "bg-[hsl(var(--accent-teal))] shadow-[0_0_6px_hsl(var(--accent-teal))]"
                  : "bg-amber-500 animate-pulse"
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
    <header className="flex items-center gap-3 border-b border-border/60 bg-card/25 backdrop-blur-lg px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        {/* Stylised teal gradient mic logo */}
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--accent-teal))] to-[hsl(172,66%,30%)]">
          <Mic className="h-3.5 w-3.5 text-white" />
        </div>
        <h1 className="text-base font-bold tracking-tight">HireSense</h1>
      </div>
      <span className="hidden text-xs text-muted-foreground md:inline">
        real-time voice interview coach · local TTS · streamed sentence-by-sentence
      </span>
      <div className="ml-auto flex items-center gap-2">
        <HealthDot />
        {children}
        <Show when="signed-in">
          <SessionsMenu />
          <UserButton />
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button size="sm" className="btn-shimmer font-semibold">
              Sign In
            </Button>
          </SignInButton>
        </Show>
        <ThemeToggle />
      </div>
    </header>
  );
}
