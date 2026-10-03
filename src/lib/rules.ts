/**
 * The rulebook's small, exact checks — each a pure function of a trade's own numbers.
 *
 * Everything here is New York wall-clock time read straight off the trade's string
 * ("2026-10-05T04:23"), never through a Date in this machine's timezone: Gustaw's Mac
 * runs on Amsterdam time, and a Date would quietly move a 04:23 entry to 10:23.
 */
import { WEEKDAY_KEYS, type TimeWindow, type Weekday } from "./rulebook";

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





