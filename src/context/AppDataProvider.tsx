import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  getAllJournalEntries,
  getAllTrades,
  initDatabase,
  seedDemoData,
} from "@/lib/db";
import type { JournalEntry, Trade } from "@/types";
import { AppDataContext } from "./AppDataContext";

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [t, j] = await Promise.all([
      getAllTrades(),
      getAllJournalEntries(),
    ]);
    setTrades(t);
    setJournal(j);
  }, []);

  useEffect(() => {
    async function boot() {
      await initDatabase();
      await seedDemoData();
      await refresh();
      setLoading(false);
    }
    void boot();
  }, [refresh]);

  return (
    <AppDataContext.Provider value={{ trades, journal, loading, refresh }}>
      {children}
    </AppDataContext.Provider>
  );
}

export { useAppData } from "./AppDataContext";
