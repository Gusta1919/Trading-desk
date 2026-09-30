/**
 * Live spot gold for the Daily Bias chart, refreshed each minute while it's on screen.
 * The server caches for the same minute, so however many tabs are open the price feed
 * sees at most one request per timeframe per minute.
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Candle, Timeframe } from "./chart";

const POLL_MS = 60 * 1000;

export function useCandles(tf: Timeframe) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState("");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .candles(tf)
        .then((r) => {
          if (!live) return;
          setCandles(r.candles);
          setSource(r.source);
          setStale(r.stale);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    setLoading(true);
    load();
    const t = window.setInterval(load, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [tf]);

  return { candles, source, stale, error, loading };
}
