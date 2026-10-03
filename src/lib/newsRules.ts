/**
 * One vocabulary for news, used everywhere.
 *
 * The rulebook names the kinds of release that make a skip day or open a release
 * window, and the same names drive the calendar's colours, the setup check's news
 * rule and the alerts. Without a shared vocabulary those disagree, which is how a
 * "rule" quietly becomes a suggestion.
 *
 * Patterns are matched against Forex Factory titles, which are stable and plain —
 * "Federal Funds Rate", "Core CPI m/m", "FOMC Member Williams Speaks".
 */
import type { CalendarEvent } from "./news";
import type { NewsPair, NewsRules } from "./rulebook";
import { deskDay, deskTime } from "./tz";
import type { TradeNews } from "./types";
export interface NewsCategory {
  id: string;
  label: string;
  hint: string;
  match: RegExp;
}

/** Order matters: the first match wins, so the specific comes before the general. */
export const NEWS_CATEGORIES: NewsCategory[] = [
  {
    id: "holiday",
    label: "Bank holidays",
    hint: "Thin liquidity, wider spreads",
    match: /bank holiday|daylight saving/i,
  },
  {
    id: "rates",
    label: "Rate decisions",
    hint: "Fed, ECB, BOE, RBA, BOC, SNB",
    match: /\b(federal funds rate|official bank rate|main refinancing rate|deposit facility rate|cash rate|overnight rate|policy rate|interest rate decision|rate (decision|statement)|monetary policy (assessment|statement|decision))\b/i,
  },
  {
    id: "cb-comms",
    label: "Central bank statements",
    hint: "Minutes, press conferences, bulletins",
    match: /\b(fomc (statement|press conference|meeting|meeting minutes|minutes|economic projections)|press conference|meeting minutes|\bminutes\b|monetary policy report|economic bulletin)\b/i,
  },
  { id: "adp", label: "ADP employment", hint: "The NFP rehearsal", match: /\badp\b/i },
  {
    id: "sentiment",
    label: "Confidence surveys",
    hint: "Consumer and business sentiment",
    match: /\b(consumer (confidence|sentiment|climate)|business (climate|confidence)|ifo|gfk|uom|sentiment)\b/i,
  },
  /*
   * CPI on its own: US CPI day is a skip day, while PPI and PCE only open a release
   * window — so the two can no longer share a kind.
   */
  { id: "cpi", label: "CPI", hint: "Consumer prices", match: /\bcpi\b/i },
  {
    id: "ppi-pce",
    label: "Other inflation",
    hint: "PPI, PCE, HICP",
    match: /\b(ppi|pce|hicp|inflation)\b/i,
  },
  {
    id: "nfp",
    label: "Jobs reports",
    hint: "NFP, employment change, unemployment rate",
    // "Non Farm Payrolls" (TradingView) and "Non-Farm Employment Change" (Forex
    // Factory) are the same release written two ways; both must land here.
    match: /\b(non[- ]?farm|nfp|payrolls|employment change|unemployment rate|average hourly earnings|claimant count|jobs report)\b/i,
  },
  {
    id: "claims",
    label: "Jobless claims",
    hint: "Weekly unemployment claims",
    match: /\b(unemployment|jobless) claims\b/i,
  },
  { id: "gdp", label: "GDP", hint: "Growth releases", match: /\b(gdp|gross domestic)\b/i },
  { id: "pmi", label: "PMI & ISM", hint: "Business activity surveys", match: /\b(pmi|ism)\b/i },
  { id: "retail", label: "Retail sales", hint: "Consumer spending", match: /\bretail sales\b/i },
  {
    id: "cb-speak",
    label: "Central bankers speaking",
    hint: "Governors, FOMC and MPC members",
    match: /\b(gov|governor|president|fomc member|mpc member|member|chair)\b.*\bspeaks\b/i,
  },
  {
    id: "political",
    label: "Political events",
    hint: "Heads of state, budgets, elections",
    match: /\b(trump|prime minister|parliament|election|budget|tariff)\b/i,
  },
  {
    id: "energy",
    label: "Energy inventories",
    hint: "Crude oil, natural gas",
    match: /\b(crude oil inventories|natural gas storage|api weekly)\b/i,
  },
];

const BY_ID = new Map(NEWS_CATEGORIES.map((c) => [c.id, c]));
export const categoryLabel = (id: string) => BY_ID.get(id)?.label ?? id;

/** The kind of release this is, or null when it fits none of the named kinds. */
export function categoryOf(event: CalendarEvent): string | null {
  return NEWS_CATEGORIES.find((c) => c.match.test(event.title))?.id ?? null;
}

/** The desk's own currencies: the only ones whose red news can chime. */
export const NEWS_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

/* ── What the rulebook says about a release ──────────────────────────── */

/**
 * Where a release sits:
 *  - `skip`: the whole day is a skip day
 *  - `window`: no new entries from a few minutes before to an hour after it
 *  - `info`: shown, never a rule — every orange or yellow release, and the red ones
 *    the rulebook doesn't name
 */
export type Stance = "skip" | "window" | "info";

/** A release reduced to what the rules read: from the live calendar or a trade's saved copy. */
export interface NewsItem {
  title: string;
  currency: string;
  impact: string;
  /** Minutes since midnight, New York; null for all-day or untimed entries. */
  minutes: number | null;
}

const hhmmToMinutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const fromEvent = (e: CalendarEvent): NewsItem => ({
  title: e.title,
  currency: e.currency,
  impact: e.impact,
  minutes: e.at && !e.allDay ? hhmmToMinutes(deskTime(e.at)) : null,
});

export const fromTradeNews = (n: TradeNews): NewsItem => ({
  title: n.title,
  currency: n.currency,
  impact: n.impact,
  minutes: hhmmToMinutes(n.time),
});

const hasPair = (pairs: NewsPair[], category: string | null, currency: string) =>
  category != null && pairs.some((p) => p.category === category && p.currency === currency);

export function stanceOf(item: Pick<NewsItem, "title" | "currency" | "impact">, rules: NewsRules): Stance {
  if (item.impact === "Holiday") return rules.holidayCurrencies.includes(item.currency) ? "skip" : "info";
  // Only red releases trigger rules; orange is information only.
  if (item.impact !== "High") return "info";
  const category = NEWS_CATEGORIES.find((c) => c.match.test(item.title))?.id ?? null;
  if (hasPair(rules.skip, category, item.currency)) return "skip";
  if (rules.windowCurrencies.includes(item.currency) || hasPair(rules.windowExtra, category, item.currency)) {
    return "window";
  }
  return "info";
}

/** Whether a "YYYY-MM-DD" falls in the rulebook's fixed no-trading stretch (which may span new year). */
export function inSkipRange(day: string, rules: NewsRules): boolean {
  if (!rules.skipRange) return false;
  const md = day.slice(5, 10);
  const { from, to } = rules.skipRange;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

export interface ReleaseWindow {
  /** Minutes since midnight, New York. */
  start: number;
  end: number;
  /** The release itself. */
  at: number;
  title: string;
  currency: string;
}

/** What the news rules make of one New York day. */
export interface NewsDay {
  /** Why the day is a skip day — empty when it isn't. */
  skip: string[];
  windows: ReleaseWindow[];
}

export function newsDay(day: string, items: NewsItem[], rules: NewsRules): NewsDay {
  const skip: string[] = [];
  if (inSkipRange(day, rules)) skip.push("the year-end break");
  const windows: ReleaseWindow[] = [];
  for (const item of items) {
    const stance = stanceOf(item, rules);
    if (stance === "skip") skip.push(`${item.currency} ${item.title}`);
    else if (stance === "window" && item.minutes != null) {
      windows.push({
        start: item.minutes - rules.beforeMin,
        end: item.minutes + rules.afterMin,
        at: item.minutes,
        title: item.title,
        currency: item.currency,
      });
    }
  }
  windows.sort((a, b) => a.start - b.start);
  return { skip: [...new Set(skip)], windows };
}

/** The release window an entry time falls in, if any. Both ends count as inside. */
export function releaseWindowAt(minutes: number, day: NewsDay): ReleaseWindow | null {
  return day.windows.find((w) => minutes >= w.start && minutes <= w.end) ?? null;
}

/**
 * The New York days the live calendar covers — Forex Factory publishes one week. A
 * day outside it has no data, which is not the same as no news.
 */
export function coveredDays(events: CalendarEvent[]): { from: string; to: string } | null {
  const days = events.filter((e) => e.at).map((e) => deskDay(new Date(e.at!)));
  if (!days.length) return null;
  days.sort();
  return { from: days[0], to: days[days.length - 1] };
}

/**
 * Whether a release is allowed to make a sound.
 *
 * The calendar shows every folder so the day's volatility can be read at a glance,
 * but only red releases on the desk's currencies chime.
 */
export const countsForTrading = (e: CalendarEvent) =>
  e.impact === "High" && NEWS_CURRENCIES.includes(e.currency);

