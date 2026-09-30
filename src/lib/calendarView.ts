/**
 * What the news calendar shows, and how a day's releases turn into the moments
 * price is likely to move.
 *
 * The calendar is a day trader's tool: today first, the rest of the week folded
 * away. Its main question is "when will it get volatile today?", so releases that
 * land close together are merged into windows rather than read one by one.
 */
import type { CalendarEvent } from "./news";
import { NEWS_CATEGORIES, NEWS_CURRENCIES, categoryLabel, categoryOf } from "./newsRules";
import { deskDay, deskTime } from "./tz";

export type Impact = CalendarEvent["impact"];

/** Forex Factory's folders, strongest first. */
export const IMPACTS: { id: Impact; label: string; colour: string; hint: string }[] = [
  { id: "High", label: "High", colour: "var(--color-down)", hint: "Red folder — moves price hard" },
  { id: "Medium", label: "Medium", colour: "var(--color-accent-2)", hint: "Orange folder — can move price" },
  { id: "Low", label: "Low", colour: "var(--color-low)", hint: "Yellow folder — rarely matters" },
  { id: "Holiday", label: "Holiday", colour: "var(--color-faint)", hint: "Grey folder — bank holiday, thin market" },
];

export const impactColour = (i: Impact) =>
  IMPACTS.find((x) => x.id === i)?.colour ?? "var(--color-faint)";

/** Every currency the feed publishes, the desk's own first. */
export const ALL_CURRENCIES = [...NEWS_CURRENCIES, "JPY", "CHF", "NZD", "CNY"];

/** Release kinds for the type filter: the rule categories, plus everything unnamed. */
export const OTHER_TYPE = "other";
export const TYPE_OPTIONS = [
  ...NEWS_CATEGORIES.filter((c) => c.id !== "holiday").map((c) => c.id),
  OTHER_TYPE,
];
export const typeLabel = (id: string) => (id === OTHER_TYPE ? "Other" : categoryLabel(id));

export interface CalendarFilters {
  impacts: Impact[];
  currencies: string[];
  /**
   * Kinds switched OFF, rather than on — a category added later then shows up by
   * default instead of being silently hidden by an old saved filter.
   */
  hiddenTypes: string[];
  /** Drop releases that already printed today. */
  hidePast: boolean;
}

/**
 * Red, orange and grey on the desk's five currencies. Yellow is off by default:
 * it is three quarters of the feed and almost never moves price.
 */
export const DEFAULT_FILTERS: CalendarFilters = {
  impacts: ["High", "Medium", "Holiday"],
  currencies: [...NEWS_CURRENCIES],
  hiddenTypes: [],
  hidePast: false,
};

const STORE_KEY = "trade-assistant.calendar-filters.v1";

/** Your last filters, or the defaults if there are none or storage is blocked. */
export function loadFilters(): CalendarFilters {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      // Older saves carried an "only what my rules block" switch; it is ignored.
      const { impacts, currencies, hiddenTypes, hidePast } = { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
      return { impacts, currencies, hiddenTypes, hidePast };
    }
  } catch {
    /* private window or corrupted value — the defaults are fine */
  }
  return DEFAULT_FILTERS;
}

export function saveFilters(f: CalendarFilters) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(f));
  } catch {
    /* not remembering is not worth an error */
  }
}

const OPEN_KEY = "trade-assistant.calendar-filters-open.v1";

/** Whether the filter panel was left open. Closed unless you opened it. */
export function loadFiltersOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveFiltersOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* not remembering is not worth an error */
  }
}

/** The calendar only judges importance; what to trade through is your call. */
export function passes(e: CalendarEvent, f: CalendarFilters): boolean {
  if (!f.impacts.includes(e.impact)) return false;
  if (!f.currencies.includes(e.currency)) return false;
  // Holidays are governed by the grey folder chip alone.
  if (e.impact !== "Holiday" && f.hiddenTypes.includes(categoryOf(e) ?? OTHER_TYPE)) return false;
  return true;
}

/* ── Days ────────────────────────────────────────────────────────────── */

export interface DaySplit {
  /** Today's releases, in order. */
  today: CalendarEvent[];
  /** Later days, each already in order, soonest first. */
  later: { day: string; events: CalendarEvent[] }[];
  /** Tentative releases without a time. */
  undated: CalendarEvent[];
}

/** Sorts releases onto New York calendar days. Days before today are dropped. */
export function splitByDay(events: CalendarEvent[], now: Date): DaySplit {
  const today = deskDay(now);
  const todays: CalendarEvent[] = [];
  const later = new Map<string, CalendarEvent[]>();
  const undated: CalendarEvent[] = [];

  for (const e of events) {
    if (!e.at) {
      undated.push(e);
      continue;
    }
    const day = deskDay(new Date(e.at));
    // "YYYY-MM-DD" strings sort the same way the dates do.
    if (day === today) todays.push(e);
    else if (day > today) {
      const list = later.get(day);
      if (list) list.push(e);
      else later.set(day, [e]);
    }
  }

  const byTime = (a: CalendarEvent, b: CalendarEvent) => (a.at ?? "").localeCompare(b.at ?? "");
  return {
    today: todays.sort(byTime),
    later: [...later.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, list]) => ({ day, events: list.sort(byTime) })),
    undated,
  };
}

/** Minutes since midnight on the desk's clock, for placing a release on the day map. */
export function deskMinutes(iso: string) {
  const [h, m] = deskTime(iso).split(":").map(Number);
  return h * 60 + m;
}

/* ── Volatility ──────────────────────────────────────────────────────── */

/**
 * Releases this close together move price as one burst: an 08:30 CPI and a 09:45
 * PMI are one volatile morning, not two separate ones.
 */
const WINDOW_GAP_MS = 30 * 60_000;

/** How long price usually stays jumpy after the last release in a window. */
export const AFTERSHOCK_MS = 30 * 60_000;

export interface VolatilityWindow {
  start: number;
  end: number;
  events: CalendarEvent[];
  strongest: Impact;
}

/**
 * Groups the day's red and orange releases into the stretches of time when price
 * is likely to move. Yellow and holidays never make a window on their own.
 */
export function volatilityWindows(events: CalendarEvent[]): VolatilityWindow[] {
  const movers = events
    .filter((e) => e.at && (e.impact === "High" || e.impact === "Medium"))
    .sort((a, b) => a.at!.localeCompare(b.at!));

  const windows: VolatilityWindow[] = [];
  for (const e of movers) {
    const t = Date.parse(e.at!);
    const last = windows[windows.length - 1];
    if (last && t - last.end <= WINDOW_GAP_MS) {
      last.end = t;
      last.events.push(e);
      if (e.impact === "High") last.strongest = "High";
    } else {
      windows.push({ start: t, end: t, events: [e], strongest: e.impact });
    }
  }
  return windows;
}

/** Where a window is relative to now. */
export function windowPhase(w: VolatilityWindow, now: number): "ahead" | "live" | "done" {
  if (now < w.start) return "ahead";
  return now <= w.end + AFTERSHOCK_MS ? "live" : "done";
}

/** "in 1h 18m", "in 12m", "now". */
export function untilLabel(ms: number) {
  const mins = Math.round(ms / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}
