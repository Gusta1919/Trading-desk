/**
 * News for the desk: the economic calendar and a macro headline feed.
 *
 * Both sources are free and neither has an API key, which means neither owes us
 * anything. The calendar feed rate-limits hard — two requests inside a minute get
 * an HTML "Rate Limited" page instead of XML — so everything here is built around
 * caching to disk and serving stale data rather than failing.
 */
import fs from "node:fs";
import path from "node:path";

const CACHE_FILE = path.join(process.cwd(), "data", "news-cache.json");

/*
 * The calendar is a weekly file, so refetching it often buys nothing and the feed
 * rate-limits hard — a second request inside a few minutes returns an HTML error
 * page. Three hours keeps us far away from that line.
 */
const CALENDAR_TTL_MS = 3 * 60 * 60 * 1000;
/* Cloudflare answers 1015 if this feed is polled hard; five minutes stays clear. */
const HEADLINES_TTL_MS = 5 * 60 * 1000;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) TradingDesk/1.0";

export interface CalendarEvent {
  id: string;
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  /** UTC instant, or null for "All Day" and "Tentative" entries. */
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

interface Cache {
  calendar?: { fetchedAt: string; events: CalendarEvent[] };
  headlines?: { fetchedAt: string; items: Headline[] };
}

function readCache(): Cache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(next: Cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 2));
  } catch {
    /* A cache we cannot write is a slower app, not a broken one. */
  }
}

const fresh = (at: string | undefined, ttl: number) =>
  at != null && Date.now() - new Date(at).getTime() < ttl;

/* ── Tiny XML reading ────────────────────────────────────────────────── */

/** Pulls one tag's text, unwrapping CDATA and decoding the few entities feeds use. */
function tag(block: string, name: string): string {
  const m = block.match(
    new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${name}>`, "i"),
  );
  const raw = m ? (m[1] ?? m[2] ?? "") : "";
  return (
    raw
      .replace(/<[^>]+>/g, "")
      // Feeds are full of curly quotes and dashes written as numeric entities.
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Ampersand last, so "&amp;#39;" cannot become a second round of decoding.
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const blocks = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}\\b[\\s\\S]*?</${name}>`, "gi")) ?? [];

/* ── Economic calendar ───────────────────────────────────────────────── */

/**
 * Forex Factory's weekly XML, via faireconomy.
 *
 * TradingView's endpoint was tried because it serves arbitrary date ranges, and it
 * was reverted: its "high importance" is far broader than Forex Factory's red
 * folder, so the calendar filled with JOLTs, Personal Income and regional PMIs —
 * releases this desk has no interest in. An accurate red rating matters more than
 * seeing further ahead, because the rating is what the trade blocker acts on.
 */
const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";

/**
 * The feed states times in UTC. Verified against Rightmove HPI, which publishes at
 * 00:01 UK time and appears as 11:01pm on the previous day — exactly 23:01 UTC
 * during British Summer Time.
 */
function toInstant(date: string, time: string): { at: string | null; allDay: boolean } {
  const d = date.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!d) return { at: null, allDay: true };
  const [, mm, dd, yyyy] = d;

  const t = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!t) return { at: null, allDay: true }; // "All Day", "Tentative", empty

  let hour = Number(t[1]) % 12;
  if (t[3].toLowerCase() === "pm") hour += 12;
  const at = new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hour, Number(t[2])),
  ).toISOString();
  return { at, allDay: false };
}

function parseCalendar(xml: string): CalendarEvent[] {
  return blocks(xml, "event").map((b, i) => {
    const title = tag(b, "title");
    const currency = tag(b, "country");
    const raw = tag(b, "impact");
    const impact: CalendarEvent["impact"] =
      raw === "High" || raw === "Medium" || raw === "Low" || raw === "Holiday" ? raw : "Low";
    const { at, allDay } = toInstant(tag(b, "date"), tag(b, "time"));
    return {
      id: `${currency}-${tag(b, "date")}-${tag(b, "time")}-${title}-${i}`,
      title,
      currency,
      impact,
      at,
      allDay,
      forecast: tag(b, "forecast"),
      previous: tag(b, "previous"),
      url: tag(b, "url"),
    };
  });
}

/** Two events are the same release if the currency, the instant and the name match. */
const keyOf = (e: CalendarEvent) => `${e.currency}|${e.at ?? "none"}|${e.title}`;

/** Anything older than this is dropped; the rest of the future is kept. */
const KEEP_PAST_DAYS = 14;

/**
 * Merges a fetch into what we already hold instead of replacing it.
 *
 * This source publishes only one file, ff_calendar_thisweek.xml — there is no
 * next-week endpoint (it returns 404). Accumulating means that whenever the feed
 * rolls forward to a new week, those events are added to the ones already stored,
 * so the calendar reaches past the end of the current week on its own.
 */
function merge(existing: CalendarEvent[], incoming: CalendarEvent[]): CalendarEvent[] {
  const by = new Map(existing.map((e) => [keyOf(e), e]));
  for (const e of incoming) by.set(keyOf(e), e); // a re-fetch carries updated forecasts

  const cutoff = Date.now() - KEEP_PAST_DAYS * 86_400_000;
  return [...by.values()]
    .filter((e) => !e.at || new Date(e.at).getTime() > cutoff)
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

export async function getCalendar(force = false): Promise<{
  events: CalendarEvent[];
  fetchedAt: string;
  stale: boolean;
}> {
  const cache = readCache();
  if (!force && cache.calendar && fresh(cache.calendar.fetchedAt, CALENDAR_TTL_MS)) {
    return { ...cache.calendar, stale: false };
  }

  try {
    const res = await fetch(CALENDAR_URL, { headers: { "User-Agent": UA } });
    const body = await res.text();
    // A rate-limit response is HTML with a 200, so check the shape, not the status.
    if (!body.includes("<weeklyevents")) throw new Error("feed returned no calendar");

    const incoming = parseCalendar(body);
    if (!incoming.length) throw new Error("feed parsed to zero events");

    const events = merge(cache.calendar?.events ?? [], incoming);
    const entry = { fetchedAt: new Date().toISOString(), events };
    writeCache({ ...cache, calendar: entry });
    return { ...entry, stale: false };
  } catch (err) {
    // Week-old numbers beat an empty screen; the client is told they are stale.
    if (cache.calendar) return { ...cache.calendar, stale: true };
    throw err;
  }
}

/**
 * Keeps the calendar warm without anyone opening the app, so the week ahead is
 * already there on a Saturday morning. The feed rate-limits, so this is deliberately
 * slow: one attempt every few hours, and failures are ignored until the next tick.
 */
export function startCalendarRefresh() {
  const tick = () => void getCalendar().catch(() => {});
  setTimeout(tick, 5_000).unref?.(); // once shortly after boot
  setInterval(tick, CALENDAR_TTL_MS).unref?.();
}

/*
 * Every folder and every currency is served. The page filters what it shows, and
 * the page alone decides which releases can block a trade (countsForTrading) — so
 * widening the view never widens the rules.
 */

/* ── Macro headlines ─────────────────────────────────────────────────── */

/*
 * A squawk, not a magazine. FinancialJuice publishes one-line flashes — "Oil reps
 * blindsided by Trump diesel export ban comment - WSJ" — which is what a desk reads
 * before the open. FXStreet and MarketWatch were both dropped: their feeds are
 * analysis essays and personal finance, neither of which is news you can act on.
 *
 * It sits behind Cloudflare and answers 1015 when polled hard, so the cache matters
 * as much here as it does for the calendar.
 */
const FEEDS: { name: string; url: string }[] = [
  { name: "FinancialJuice", url: "https://www.financialjuice.com/feed.ashx?xy=rss" },
];

/** Feeds label every headline with their own name; the column already says it. */
const stripSource = (title: string) => title.replace(/^\s*FinancialJuice:\s*/i, "").trim();

function parseRss(xml: string, source: string): Headline[] {
  return blocks(xml, "item").map((b, i) => ({
    id: `${source}-${i}-${tag(b, "guid") || tag(b, "link")}`,
    title: stripSource(tag(b, "title")),
    summary: tag(b, "description").slice(0, 320),
    source,
    url: tag(b, "link"),
    at: (() => {
      const d = new Date(tag(b, "pubDate"));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    })(),
  }));
}

export async function getHeadlines(): Promise<{
  items: Headline[];
  fetchedAt: string;
  stale: boolean;
}> {
  const cache = readCache();
  if (cache.headlines && fresh(cache.headlines.fetchedAt, HEADLINES_TTL_MS)) {
    return { ...cache.headlines, stale: false };
  }

  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await fetch(f.url, { headers: { "User-Agent": UA } });
      return parseRss(await res.text(), f.name);
    }),
  );

  const items = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((h) => h.title)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 60);

  if (!items.length) {
    if (cache.headlines) return { ...cache.headlines, stale: true };
    return { items: [], fetchedAt: new Date().toISOString(), stale: true };
  }

  const entry = { fetchedAt: new Date().toISOString(), items };
  writeCache({ ...readCache(), headlines: entry });
  return { ...entry, stale: false };
}

