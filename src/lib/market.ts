/**
 * When gold trades, on New York's clock. Spot XAUUSD runs from Sunday 18:00 to Friday
 * 17:00, with a one-hour break every weekday evening from 17:00 to 18:00. Bank holidays
 * that shorten a session are not modelled: the news calendar marks those days.
 */

const CLOSE = 17 * 60;
const OPEN = 18 * 60;
const DAY = 24 * 60;

export interface GoldMarket {
  open: boolean;
  /** Why it is shut: the weekend, or the daily 17:00–18:00 break. */
  closedFor: "weekend" | "daily break" | null;
  /** The next change: when it opens (while shut) or closes (while open). */
  next: { what: "opens" | "closes"; day: "today" | "tomorrow" | "Sunday"; time: string; inMinutes: number };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The market at a New York wall-clock moment, "YYYY-MM-DDTHH:mm" (as `deskNow` gives it). */
export function goldMarket(nyStamp: string): GoldMarket {
  const [y, mo, d] = nyStamp.slice(0, 10).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 Sunday … 6 Saturday
  const m = Number(nyStamp.slice(11, 13)) * 60 + Number(nyStamp.slice(14, 16));
  const at = (days: number, minute: number) => days * DAY + minute - m;
  const opensSunday = (daysAhead: number) => ({ what: "opens" as const, day: daysAhead === 0 ? ("today" as const) : ("Sunday" as const), time: hhmm(OPEN), inMinutes: at(daysAhead, OPEN) });

  if (weekday === 6) return { open: false, closedFor: "weekend", next: opensSunday(1) };
  if (weekday === 0 && m < OPEN) return { open: false, closedFor: "weekend", next: opensSunday(0) };
  if (weekday === 5 && m >= CLOSE) return { open: false, closedFor: "weekend", next: opensSunday(2) };
  if (weekday !== 0 && m >= CLOSE && m < OPEN) {
    return { open: false, closedFor: "daily break", next: { what: "opens", day: "today", time: hhmm(OPEN), inMinutes: at(0, OPEN) } };
  }
  // Open: until 17:00 today, or — in the evening session — until 17:00 tomorrow.
  return m < CLOSE
    ? { open: true, closedFor: null, next: { what: "closes", day: "today", time: hhmm(CLOSE), inMinutes: at(0, CLOSE) } }
    : { open: true, closedFor: null, next: { what: "closes", day: "tomorrow", time: hhmm(CLOSE), inMinutes: at(1, CLOSE) } };
}

/** "2h 05m", "25m", "1d 3h" — how long until the next change. */
export function inLabel(minutes: number): string {
  if (minutes >= DAY) return `${Math.floor(minutes / DAY)}d ${Math.floor((minutes % DAY) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${minutes}m`;
}
