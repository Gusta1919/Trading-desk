import { deskDay, deskNow } from "./tz";

const signed = (v: number, digits: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

export const fmtR = (v: number | null) => (v == null ? "—" : `${signed(v, 2)}R`);
export const fmtPct = (v: number | null, digits = 2) =>
  v == null ? "—" : `${signed(v, digits)}%`;
export const fmtRate = (v: number | null) =>
  v == null || Number.isNaN(v) ? "—" : `${Math.round(v * 100)}%`;
export const fmtNum = (v: number | null, digits = 2) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);

/** Class for text that shows a gain or a loss. Neutral when zero/empty. */
export const tone = (v: number | null | undefined) =>
  v == null || Math.abs(v) < 1e-9 ? "" : v > 0 ? "text-up" : "text-down";

export function fmtDate(local: string) {
  return new Date(local).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function fmtTime(local: string) {
  return new Date(local).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Now, on the desk's clock, in the format <input type="datetime-local"> expects.
 * Trade times are stored and shown in New York, never in the machine's timezone.
 */
export const nowLocal = () => deskNow();

/** "YYYY-MM-DD" for an instant, on the desk's calendar. */
export const dayKey = (d: Date) => deskDay(d);
