/**
 * One vocabulary for news, used everywhere.
 *
 * A strategy names the kinds of release it will not trade through, and the same
 * names drive the calendar's colours, the warning in the trade form and the block
 * on the save button. Without a shared vocabulary those three disagree, which is
 * how a "rule" quietly becomes a suggestion.
 *
 * Patterns are matched against Forex Factory titles, which are stable and plain —
 * "Federal Funds Rate", "Core CPI m/m", "FOMC Member Williams Speaks".
 */
import type { CalendarEvent } from "./news";

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
  {
    id: "cpi",
    label: "Inflation",
    hint: "CPI, PPI, PCE, HICP",
    match: /\b(cpi|ppi|pce|hicp|inflation)\b/i,
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

/** What a strategy says about one event. */
export type Stance = "forbidden" | "caution" | "holiday";

/**
 * One set of rules for the whole desk. These used to hang off each strategy, but
 * they never differed between them, and two copies of a rule is one rule too many.
 */
export interface NewsStance {
  /** Kinds of release that stop a trade. */
  forbidden: string[];
  /** The no-trading rule only bites on these currencies; the rest stay "careful". */
  blockCurrencies: string[];
}

/** The desk's own currencies: the only ones whose red news or holidays can stop a trade. */
export const NEWS_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];

/**
 * Sensible opening position: never trade through the releases that reprice a
 * currency in a single print, and only for the currencies that actually move the
 * instruments traded here. Everything else red is automatically "careful" — there
 * is no second list to keep in sync, because only red news gets this far.
 */
export const DEFAULT_STANCE: NewsStance = {
  forbidden: ["cpi", "adp", "nfp", "rates"],
  blockCurrencies: ["USD", "EUR", "GBP"],
};

/** Falls back to the defaults while the saved rules are still loading. */
export const stanceFor = (rules: NewsStance | null | undefined): NewsStance =>
  rules ?? DEFAULT_STANCE;

/**
 * Where an event sits. Only call this for events that pass `countsForTrading` —
 * orange and yellow releases are shown on the calendar but never judged.
 *
 * Both the no-trade kinds and the holidays are scoped to the same currency list: a
 * rate decision matters differently depending on whose rate it is, and a bank
 * holiday only empties the book for the market that is shut. Anything red that is
 * not on the no-trade list is tradeable — you simply must not be holding through it.
 */
export function stanceOf(event: CalendarEvent, rules: NewsStance): Stance {
  const covered = rules.blockCurrencies.includes(event.currency);
  if (event.impact === "Holiday") return covered ? "forbidden" : "holiday";
  const cat = categoryOf(event);
  return cat && covered && rules.forbidden.includes(cat) ? "forbidden" : "caution";
}

/**
 * Whether a release is allowed to make a sound.
 *
 * The calendar shows every folder so the day's volatility can be read at a glance,
 * but only red releases on the desk's currencies chime. Deciding what not to trade
 * through is left to you — nothing in the app blocks a trade over news.
 */
export const countsForTrading = (e: CalendarEvent) =>
  e.impact === "High" && NEWS_CURRENCIES.includes(e.currency);

export const STANCE_LABEL: Record<Stance, string> = {
  forbidden: "No trading",
  caution: "Be flat for this",
  holiday: "Holiday elsewhere — thin liquidity",
};
