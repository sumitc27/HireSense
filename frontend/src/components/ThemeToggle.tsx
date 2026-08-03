import { Moon, Sun } from "lucide-react";
import { useStore } from "@/store";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { theme, setTheme } = useStore();

  // Resolve effective theme for visual indicator
  const isDark =
    theme === "dark" ||
    (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const cycle = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  const label =
    theme === "system"
      ? "System theme (click to switch to Light)"
      : theme === "light"
        ? "Light mode (click to switch to Dark)"
        : "Dark mode (click to switch to System)";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={cycle}
          className="theme-switch"
          aria-label={label}
        >
          {/* Sliding indicator */}
          <span
            className="theme-switch-indicator"
            style={{ left: isDark ? "calc(100% - 27px)" : "3px" }}
          />
          {/* Sun icon */}
          <span
            className={cn(
              "relative z-10 flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-200",
              !isDark ? "text-amber-500" : "text-muted-foreground/50"
            )}
          >
            <Sun className="h-3.5 w-3.5" />
          </span>
          {/* Moon icon */}
          <span
            className={cn(
              "relative z-10 flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-200",
              isDark ? "text-blue-400" : "text-muted-foreground/50"
            )}
          >
            <Moon className="h-3.5 w-3.5" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
