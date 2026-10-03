/**
 * The arithmetic behind the Daily Bias price chart, kept apart from the drawing so
 * it can be tested: which session a candle belongs to, where the CRT box is,
 * what zone a scenario is talking about, and what price range to show.
 */
import type { LevelKind, Verdict } from "./dailyBias";
import { deskDay, deskTime } from "./tz";

export interface Candle {
  /** Bar open, epoch milliseconds (UTC). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Session = "Asia" | "London" | "New York";
export type Timeframe = "5m" | "15m" | "1h";

/** Minutes since midnight on the desk's (New York) clock. */
export function deskMinutes(t: number) {
  const [h, m] = deskTime(new Date(t)).split(":").map(Number);
  return h * 60 + m;
}

/**
 * The session a bar opens in, on New York time: Asia from the 18:00 reopen to
 * 03:00, London to 08:00, New York to 17:00. The 17:00–18:00 maintenance hour
 * belongs to none.
 */
export function sessionOf(t: number): Session | null {
  const m = deskMinutes(t);
  if (m >= 18 * 60 || m < 3 * 60) return "Asia";
  if (m < 8 * 60) return "London";
  if (m < 17 * 60) return "New York";
  return null;
}

/** Runs of consecutive bars in the same session: [session, first index, last index]. */
export function sessionRuns(candles: Candle[]) {
  const runs: { session: Session; from: number; to: number }[] = [];
  candles.forEach((c, i) => {
    const s = sessionOf(c.t);
    if (!s) return;
    const last = runs[runs.length - 1];
    if (last && last.session === s && last.to === i - 1) last.to = i;
    else runs.push({ session: s, from: i, to: i });
  });
  return runs;
}

/** "HH:MM" as minutes after midnight. */
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The rulebook's CRT box: the high and low of the box hour (03:00–04:00 NY in the GOLD
 * Model) on the most recent day that has it, and the bars of its trading window — from
 * the box's end to the time stop — that are on the chart so far.
 */
export function crtBox(candles: Candle[], box = { from: "03:00", to: "04:00" }, until = "12:00") {
  const [from, to, end] = [minutesOf(box.from), minutesOf(box.to), minutesOf(until)];
  const inBox = (c: Candle) => {
    const m = deskMinutes(c.t);
    return m >= from && m < to;
  };
  const days = [...new Set(candles.filter(inBox).map((c) => deskDay(new Date(c.t))))];
  const day = days[days.length - 1];
  if (!day) return null;
  const idx = candles
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => inBox(c) && deskDay(new Date(c.t)) === day)
    .map(({ i }) => i);
  const bars = idx.map((i) => candles[i]);
  const windowEnd = candles.reduce((last, c, i) => {
    const m = deskMinutes(c.t);
    return deskDay(new Date(c.t)) === day && m >= to && m < end ? i : last;
  }, idx[idx.length - 1]);
  return {
    high: Math.max(...bars.map((b) => b.h)),
    low: Math.min(...bars.map((b) => b.l)),
    from: idx[0],
    to: idx[idx.length - 1],
    /** Last bar of the window up to the time stop on the chart. */
    windowEnd,
  };
}

/**
 * A price zone named in a scenario's words, e.g. "4136-4181 range into NFP" or
 * "Rejection 4162–4181 + M15 MSS". Only pairs that look like prices near each
 * other count, so dates and times are never mistaken for a zone.
 */
export function zoneFromText(text: string): { low: number; high: number } | null {
  const m = text.match(/(\d{3,5}(?:\.\d+)?)\s*[-–—]\s*(\d{3,5}(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (low < 100 || high - low <= 0 || (high - low) / low > 0.05) return null;
  return { low, high };
}

/**
 * The price range to draw: the candles, stretched to take in overlay levels that are
 * reasonably near (up to `reach` × the candles' own range beyond them). Levels further
 * out stay off the scale and are drawn as edge markers instead of squashing the candles.
 */
export function priceDomain(candles: Candle[], levels: number[], reach = 0.8, pad = 0.06) {
  const baseLo = Math.min(...candles.map((c) => c.l));
  const baseHi = Math.max(...candles.map((c) => c.h));
  const span = Math.max(baseHi - baseLo, 1);
  let lo = baseLo;
  let hi = baseHi;
  // Reach is measured from the candles, never from a level already let in — otherwise
  // TP2 would stretch the scale and drag TP3 in behind it.
  for (const p of levels) {
    if (p < lo && baseLo - p <= span * reach) lo = p;
    if (p > hi && p - baseHi <= span * reach) hi = p;
  }
  const margin = (hi - lo) * pad;
  return [lo - margin, hi + margin] as const;
}

/* ── Key levels on the chart ─────────────────────────────────────────── */

/**
 * What a level does to price, in three families — this, not colour, is what the
 * chart encodes (by line style), because it's what a trader acts on:
 * - liquidity: resting stops; price is drawn to it, often sweeps it, then turns;
 * - reaction: support, resistance, round numbers, opens; price tends to react there;
 * - imbalance: fair value gaps and order blocks; price tends to come back to them.
 */
export type LevelRole = "liquidity" | "reaction" | "imbalance";

export function levelRole(kind: LevelKind): LevelRole {
  if (kind === "liquidity") return "liquidity";
  if (kind === "fvg" || kind === "orderblock") return "imbalance";
  return "reaction";
}

/** One plain sentence on what the level can do to price, for the hover card. */
export function levelEffect(kind: LevelKind, above: boolean): string {
  switch (kind) {
    case "liquidity":
      return above
        ? "Buy-side liquidity: stops from shorts rest above, so price is often drawn up to it. A sweep that closes back below signals a reversal; acceptance above signals continuation."
        : "Sell-side liquidity: stops from longs rest below, so price is often drawn down to it. A sweep that closes back above signals a reversal; acceptance below signals continuation.";
    case "resistance":
      return "Resistance: sellers defended it before. Expect a reaction on the first touch.";
    case "support":
      return "Support: buyers defended it before. Expect a reaction on the first touch.";
    case "fvg":
      return "Fair value gap: an imbalance a fast move left behind. Price tends to come back to fill it and react inside it.";
    case "orderblock":
      return "Order block: where the last strong move began. Price often reacts when it returns.";
    case "round":
      return "Round number: orders cluster at psychological prices. Expect a pause or a reaction.";
    case "open":
      return "Open: the price the session or week is measured from. Holding above or below it sets the tone.";
  }
}

/**
 * The briefing's hold/break call, in the words that fit the kind of level: stops
 * get "taken", zones "fail", lines "break" — so the call never contradicts what the
 * level is said to do.
 */
export function verdictEffect(verdict: Verdict, kind: LevelKind): string {
  const role = levelRole(kind);
  if (verdict === "unclear") return role === "liquidity" ? "No clear read on whether these stops get taken today." : "No clear read on hold or break.";
  if (role === "liquidity") {
    return verdict === "break"
      ? "Likely taken today: expect price to run these stops."
      : "Likely left untouched: price probably turns before reaching it.";
  }
  if (role === "imbalance") {
    return verdict === "hold"
      ? "Likely holds: price should react inside the zone and turn."
      : "Likely fails: price may cut straight through the zone.";
  }
  return verdict === "hold"
    ? "Likely holds: a rejection is more likely than a break."
    : "Likely breaks: continuation through it is more likely.";
}

/**
 * Spreads labels so none overlap: each keeps its own height when it can, and is
 * pushed down just enough to clear the one above; if the stack then runs past the
 * bottom, the whole run slides up. Input and output are in the same order.
 */
export function stackLabels(ys: number[], gap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y: Math.min(Math.max(y, top), bottom), i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  }
  const over = order.length ? order[order.length - 1].y - bottom : 0;
  if (over > 0) {
    order[order.length - 1].y -= over;
    for (let k = order.length - 2; k >= 0; k--) {
      if (order[k + 1].y - order[k].y < gap) order[k].y = order[k + 1].y - gap;
    }
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/**
 * Which bars get a time mark along the bottom: every hour on 5m, every three hours
 * on 15m, and each midnight (as a date) on 1h. `minGap` bars keeps them uncrowded.
 */
export function timeMarks(candles: Candle[], tf: Timeframe, minGap: number): number[] {
  const every = tf === "5m" ? 60 : tf === "15m" ? 180 : 1440;
  const marks: number[] = [];
  candles.forEach((c, i) => {
    if (deskMinutes(c.t) % every !== 0) return;
    if (marks.length && i - marks[marks.length - 1] < minGap) return;
    marks.push(i);
  });
  return marks;
}
