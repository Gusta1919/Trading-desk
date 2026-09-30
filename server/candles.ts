/**
 * Intraday XAU/USD candles for the Daily Bias chart.
 *
 * The briefing's levels are spot prices, so the chart must be spot too. OANDA's API
 * needs a personal token, Yahoo rate-limits anonymous requests, and gold futures (GC)
 * sit ~$35 above spot — which would put every level in the wrong place. Dukascopy's
 * public chart feed serves spot bid candles with no key, so it is used here.
 *
 * It is an undocumented widget endpoint, so it is treated as a courtesy: one request
 * per timeframe per minute at most, the last good answer served if it fails, and the
 * chart simply says so if there has never been one. Nothing else depends on it.
 */

export type Timeframe = "5m" | "15m" | "1h";

export interface Candle {
  /** Bar open, epoch milliseconds (UTC). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

const INTERVAL: Record<Timeframe, string> = { "5m": "5MIN", "15m": "15MIN", "1h": "1HOUR" };
/* 96 bars: 8 hours of 5m, a full trading day of 15m, about a trading week of 1h. */
const LIMIT = 96;
const TTL_MS = 60 * 1000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TradingDesk/1.0";

const cache = new Map<Timeframe, { at: number; candles: Candle[] }>();

/** The feed answers JSONP newest-first: _cb([[t, o, h, l, c, volume], …]); */
export function parseFeed(body: string): Candle[] {
  const start = body.indexOf("(");
  const end = body.lastIndexOf(")");
  if (start === -1 || end <= start) throw new Error("Unexpected price feed response");
  const rows = JSON.parse(body.slice(start + 1, end)) as unknown;
  if (!Array.isArray(rows)) throw new Error("Unexpected price feed response");
  return rows
    .map((r) => (Array.isArray(r) ? r.slice(0, 5).map(Number) : []))
    .filter((r) => r.length === 5 && r.every(Number.isFinite) && r[2] >= r[3])
    .map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
    .sort((a, b) => a.t - b.t);
}

export async function getCandles(tf: Timeframe) {
  const hit = cache.get(tf);
  if (hit && Date.now() - hit.at < TTL_MS) return { candles: hit.candles, fetchedAt: hit.at, stale: false };

  const url =
    "https://freeserv.dukascopy.com/2.0/index.php?path=chart%2Fjson3&instrument=XAU%2FUSD" +
    `&offer_side=B&interval=${INTERVAL[tf]}&splits=true&stocks=true&limit=${LIMIT}` +
    `&time_direction=P&timestamp=${Date.now()}&jsonp=_cb`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://freeserv.dukascopy.com/" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Price feed answered ${res.status}`);
    const candles = parseFeed(await res.text());
    if (!candles.length) throw new Error("Price feed returned no candles");
    cache.set(tf, { at: Date.now(), candles });
    return { candles, fetchedAt: Date.now(), stale: false };
  } catch (err) {
    // A chart a few minutes old beats no chart.
    if (hit) return { candles: hit.candles, fetchedAt: hit.at, stale: true };
    throw err;
  }
}
