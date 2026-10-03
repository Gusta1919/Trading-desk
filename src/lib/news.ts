/** The news the desk reads: the calendar, the wire, and what was out on a trade's day. */
import type { NewsRules } from "./rulebook";
import { deskDay } from "./tz";

export interface CalendarEvent {
  id: string;
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  /** UTC instant; null for all-day and tentative entries. */
  at: string | null;
  allDay: boolean;
  forecast: string;
  previous: string;
  url: string;
}

export interface Headline {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  at: string | null;
}

export interface CalendarFeed {
  events: CalendarEvent[];
  total: number;
  fetchedAt: string;
  stale: boolean;
}

export interface HeadlineFeed {
  items: Headline[];
  fetchedAt: string;
  stale: boolean;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const newsApi = {
  calendar: () => get<CalendarFeed>("/api/news/calendar"),
  headlines: () => get<HeadlineFeed>("/api/news/headlines"),
  /** The rulebook's news rules — edited, like every rule, in the Rulebook tab. */
  rules: () => get<NewsRules>("/api/news/rules"),
};

/* ── News on a trade's day ───────────────────────────────────────────── */

/**
 * Which currencies a symbol is exposed to. Metals and indices are priced in dollars,
 * so US news moves them whatever else is in the ticker.
 */
export function currenciesOf(symbol: string): string[] {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const known = ["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "JPY", "NZD"];
  const found = known.filter((c) => s.includes(c));
  if (found.length) return found;
  // XAUUSD already matched USD above; this catches indices and crypto tickers.
  return ["USD"];
}

/**
 * The releases on a trade's New York day that could move its symbol — red, orange and
 * holidays, in the order they happen.
 *
 * `nyDay` is the trade's own "YYYY-MM-DD". Trade times are stored as New York wall
 * clock, so the day is read straight off the string: turning it into a Date would read
 * it as this machine's time and slide early-morning trades onto the previous day.
 */
export function newsForTrade(events: CalendarEvent[], symbol: string, nyDay: string): CalendarEvent[] {
  const currencies = new Set(currenciesOf(symbol));
  return events
    .filter(
      (e) =>
        e.at &&
        e.impact !== "Low" &&
        currencies.has(e.currency) &&
        deskDay(new Date(e.at)) === nyDay,
    )
    .sort((a, b) => a.at!.localeCompare(b.at!));
}

