import { createContext, useContext } from "react";
import type { JournalEntry, Trade } from "@/types";

export interface AppDataContextValue {
  trades: Trade[];
  journal: JournalEntry[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export const AppDataContext = createContext<AppDataContextValue | null>(null);

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
