import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";
export type MicMode = "ptt" | "open_mic";

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;

  // Persisted mic preference; live session state stays in React components
  // (the server owns the authoritative session via the WS connection).
  micMode: MicMode;
  setMicMode: (m: MicMode) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (t) => set({ theme: t }),

      micMode: "ptt",
      setMicMode: (m) => set({ micMode: m }),
    }),
    {
      name: "hiresense-app",
      version: 1,
      partialize: (s) => ({ theme: s.theme, micMode: s.micMode }),
    }
  )
);
