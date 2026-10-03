/**
 * The rulebook's small, exact checks — each a pure function of a trade's own numbers.
 *
 * Everything here is New York wall-clock time read straight off the trade's string
 * ("2026-10-05T04:23"), never through a Date in this machine's timezone: Gustaw's Mac
 * runs on Amsterdam time, and a Date would quietly move a 04:23 entry to 10:23.
 */
import { BIAS_OPTION } from "./rulebookText";
import { WEEKDAY_KEYS, type Rulebook, type TimeWindow, type Weekday } from "./rulebook";
import type { PlanBias } from "./plans";
import type { Direction } from "./types";

/** Minutes since midnight for "HH:mm", or null. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "HH:mm" of a "YYYY-MM-DDTHH:mm" stamp. */
export const timeOf = (stamp: string) => stamp.slice(11, 16);
export const dayOf = (stamp: string) => stamp.slice(0, 10);

/* ── When ────────────────────────────────────────────────────────────── */

/**
 * Whether an entry time is inside the entry windows.
 *
 * A window includes its start. Its end is excluded when another window follows —
 * "no entries from 08:25 to 09:30" — and included for the last one — "no entries
 * after 11:00" — which is exactly how the rulebook words the two edges.
 */
export function inEntryWindow(time: string, windows: TimeWindow[]): boolean {
  const t = minutesOf(time);
  if (t == null) return false;
  return windows.some((w, i) => {
    const from = minutesOf(w.from)!;
    const to = minutesOf(w.to)!;
    const last = i === windows.length - 1;
    return t >= from && (last ? t <= to : t < to);
  });
}

/** After the time stop: an exit later than it, on the trade's day or after. */
export function pastTimeStop(entry: string, exit: string, timeStop: string): boolean {
  if (!exit) return false;
  if (dayOf(exit) > dayOf(entry)) return true; // never overnight
  const e = minutesOf(timeOf(exit));
  const stop = minutesOf(timeStop);
  return e != null && stop != null && e > stop;
}

/** The session a New York time falls in — the same borders as the chart's session strip. */
export function sessionAt(time: string): "Asia" | "London" | "New York" | null {
  const m = minutesOf(time);
  if (m == null) return null;
  if (m >= 18 * 60 || m < 3 * 60) return "Asia";
  if (m < 8 * 60) return "London";
  if (m < 17 * 60) return "New York";
  return null;
}

/** Mon–Fri for a "YYYY-MM-DD", or null on a weekend. Read from the date itself, timezone-free. */
export function weekdayOf(day: string): Weekday | null {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return wd >= 1 && wd <= 5 ? WEEKDAY_KEYS[wd - 1] : null;
}

/* ── Grade inputs ────────────────────────────────────────────────────── */

/**
 * The frozen Compass value for a trade: its weekday, and its direction — a long comes
 * after the low was swept, a short after the high. Null on a weekend (asked by hand).
 */
export function compassFor(doc: Pick<Rulebook, "compass">, day: string, direction: Direction): number | null {
  const wd = weekdayOf(day);
  if (!wd) return null;
  return doc.compass.days[wd]?.[direction] ?? null;
}

/**
 * How far the MSS candle closed beyond the swing, in 5m ATRs. Rounded to four places
 * before it is graded: 0.30 ÷ 1.20 is 0.2499999… in floating point, and an exact 0.25
 * must land on the boundary the rulebook gives it.
 */
export function displacementMultiple(mssBeyond: number | null, atr: number | null): number | null {
  if (mssBeyond == null || atr == null || !(atr > 0) || mssBeyond < 0) return null;
  return Number((mssBeyond / atr).toFixed(4));
}

/** The daily-bias answer from the plan's bias and the trade's direction. */
export function biasAnswer(bias: PlanBias | "" | undefined, direction: Direction): string | null {
  if (!bias) return null;
  if (bias === "unclear") return BIAS_OPTION.unclear;
  const matches = (bias === "bullish" && direction === "long") || (bias === "bearish" && direction === "short");
  return matches ? BIAS_OPTION.matches : BIAS_OPTION.against;
}

/* ── Prices ──────────────────────────────────────────────────────────── */

/** Gross planned R:R from the three prices: reward ÷ risk. Null until all three make sense. */
export function plannedRR(entry: number | null, stop: number | null, target: number | null): number | null {
  if (entry == null || stop == null || target == null) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  return Number((Math.abs(target - entry) / risk).toFixed(2));
}

/**
 * Lots for a $ risk: risk ÷ (stop distance × ounces per lot). Rounded down to 0.01 —
 * the broker's step — so the size never risks more than the rules allow.
 */
export function lotSize(riskUsd: number | null, entry: number | null, stop: number | null, ozPerLot: number): number | null {
  if (riskUsd == null || entry == null || stop == null || !(riskUsd > 0)) return null;
  const perLot = Math.abs(entry - stop) * ozPerLot;
  if (!(perLot > 0)) return null;
  return Math.floor((riskUsd / perLot) * 100 + 1e-9) / 100;
}

/** Whether the stop is on the losing side of the entry for this direction. */
export function stopOnRightSide(direction: Direction, entry: number | null, stop: number | null): boolean | null {
  if (entry == null || stop == null) return null;
  return direction === "long" ? stop < entry : stop > entry;
}

/**
 * How far a price is from the entry in R, measured from the initial stop: positive in
 * your favour. MFE is this at the best price; MAE is its opposite at the worst, so a
 * trade that went 0.4R against you has an MAE of 0.4.
 */
export function priceR(direction: Direction, entry: number | null, stop: number | null, price: number | null): number | null {
  if (entry == null || stop == null || price == null) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const sign = direction === "long" ? 1 : -1;
  return Number((((price - entry) * sign) / risk).toFixed(2));
}

export function excursions(t: {
  direction: Direction;
  entryPrice: number | null;
  stopPrice: number | null;
  mfePrice: number | null;
  maePrice: number | null;
}): { mfeR: number | null; maeR: number | null } {
  const mfe = priceR(t.direction, t.entryPrice, t.stopPrice, t.mfePrice);
  const mae = priceR(t.direction, t.entryPrice, t.stopPrice, t.maePrice);
  return { mfeR: mfe, maeR: mae == null ? null : Number((-mae).toFixed(2)) };
}

/** $ beyond the box edge the sweep reached: above the high for a short, below the low for a long. */
export function sweepDepthOf(
  direction: Direction,
  boxHigh: number | null,
  boxLow: number | null,
  extreme: number | null,
): number | null {
  if (extreme == null) return null;
  const edge = direction === "short" ? boxHigh : boxLow;
  if (edge == null) return null;
  const depth = direction === "short" ? extreme - edge : edge - extreme;
  return depth >= 0 ? Number(depth.toFixed(2)) : null;
}
