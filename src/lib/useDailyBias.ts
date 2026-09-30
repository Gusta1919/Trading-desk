/**
 * The morning's gold bias, kept current while the desk is open.
 *
 * Reading the file is a local disk read, so polling once a minute costs nothing —
 * and it means a briefing that lands while the journal is already open shows up on
 * its own. The same tick re-judges freshness, so "waiting" turns into "late" without
 * a reload.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { freshness, parseBias, type DailyBias, type Freshness } from "./dailyBias";

const POLL_MS = 60 * 1000;

export interface DailyBiasState {
  /** The structured briefing, when the file had a usable core. */
  bias: DailyBias | null;
  /** Plain text to fall back on when the structured part is unusable. */
  fallback: string | null;
  /** The date the saved file was written for, even when it couldn't be parsed. */
  date: string | null;
  savedAt: string | null;
  freshness: Freshness;
  loading: boolean;
  error: string | null;
}

export function useDailyBias(): DailyBiasState {
  const [file, setFile] = useState<Awaited<ReturnType<typeof api.bias>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(() => {
    api
      .bias()
      .then((f) => {
        setFile(f);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setNow(new Date()));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, POLL_MS);
    // Coming back to the window is when you'd look — don't make it wait a minute.
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  return useMemo(() => {
    if (!file || !file.found) {
      return {
        bias: null,
        fallback: null,
        date: null,
        savedAt: null,
        freshness: freshness(null, now),
        loading: file == null && error == null,
        error,
      };
    }
    const bias = "data" in file ? parseBias(file.data) : null;
    const raw = "data" in file ? (file.data as Record<string, unknown> | null) : null;
    const date = bias?.date ?? (typeof raw?.date === "string" ? raw.date : null);
    const markdown = typeof raw?.markdown === "string" ? raw.markdown : null;
    return {
      bias,
      fallback: bias ? null : "text" in file ? file.text : markdown,
      date,
      savedAt: file.savedAt,
      freshness: freshness(date, now),
      loading: false,
      error,
    };
  }, [file, error, now]);
}
