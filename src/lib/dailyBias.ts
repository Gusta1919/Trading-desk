/**
 * Today's gold bias: a briefing a cloud Claude routine writes every weekday morning.
 *
 * The routine researches at least five analysts and leaves the result as a Gmail
 * draft; the desk collects it into data/daily-bias.json, replacing yesterday's — so
 * the desk only ever holds one read (server/gmailBias.ts).
 * The briefing is written by a language model, so nothing in it is trusted: every field
 * is coerced here, a malformed row is dropped rather than breaking the page, and when
 * the core (date and bias split) is missing the tab shows the plain-text copy the
 * task writes alongside.
 */

import { zoneFromText } from "./chart";

export type Lean = "bullish" | "bearish" | "neutral";
export type LevelKind =
  | "resistance"
  | "support"
  | "liquidity"
  | "fvg"
  | "orderblock"
  | "round"
  | "open";
export type Verdict = "hold" | "break" | "unclear";
export type ScenarioKind = "primary" | "alternative" | "chop";
export type Zone = "premium" | "discount" | "equilibrium";
export type Trend = "bullish" | "bearish" | "range";

export interface BiasLevel {
  price: number;
  label: string;
  kind: LevelKind;
  /** Chance the level is tagged or swept today, 0–100. */
  sweepProb: number | null;
  verdict: Verdict;
  note: string;
}

export interface Analyst {
  name: string;
  source: string;
  url: string;
  lean: Lean;
  levels: string;
  why: string;
  publishedAt: string | null;
}

export interface Scenario {
  kind: ScenarioKind;
  title: string;
  direction: "long" | "short" | "flat";
  prob: number;
  trigger: string;
  targets: { price: number; prob: number | null }[];
  invalidation: number | null;
  /** The price zone the scenario plays out in: the chop range, or the trigger area. */
  zone: { low: number; high: number } | null;
  why: string;
}

export interface Odds {
  label: string;
  prob: number;
  why: string;
}

/** One intermarket driver and which way it pushes gold today. */
export interface Driver {
  name: string;
  value: string;
  change: string;
  gold: Lean;
}

export interface BiasEvent {
  title: string;
  /** UTC instant; rendered on the desk's clock like every other release. */
  at: string | null;
  impact: "High" | "Medium" | "Low";
}

export interface DailyBias {
  /** The Amsterdam calendar day the briefing was written for. */
  date: string;
  generatedAt: string | null;
  spot: number | null;
  spotAt: string | null;
  tldr: string;
  bias: { bullish: number; range: number; bearish: number; why: string };
  keyLevel: { price: number | null; label: string; why: string } | null;
  mainEvent: { title: string; at: string | null; why: string } | null;
  structure: {
    d1: string;
    h4: string;
    d1Trend: Trend | null;
    h4Trend: Trend | null;
    /** The dealing range the premium/discount call is measured against. */
    rangeLow: number | null;
    rangeHigh: number | null;
    zone: Zone | null;
    why: string;
  };
  levels: BiasLevel[];
  analysts: Analyst[];
  consensus: { bullish: number; neutral: number; bearish: number; take: string } | null;
  scenarios: Scenario[];
  sessions: Odds[];
  macro: {
    dxy: string;
    yields: string;
    flow: string;
    drivers: Driver[];
    surprise: { event: string; bullish: number; bearish: number; why: string } | null;
  };
  risk: {
    events: BiasEvent[];
    atr: number | null;
    /** The day's range so far when the briefing was written — how much of the ATR is spent. */
    dayLow: number | null;
    dayHigh: number | null;
    expectedRange: string;
    standAside: string[];
  };
  /** The whole briefing as text — shown when the structured part is unusable. */
  markdown: string;
}

/** Whether the desk can reach Gmail, and how the last check went. */
export type GmailStatus =
  | { state: "off" }
  | { state: "ok"; checkedAt: string; collected: string | null }
  | { state: "error"; checkedAt: string; message: string };

/** What the server hands over: nothing yet, a file it could read, or one it couldn't. */
export type BiasFile = (
  | { found: false }
  | { found: true; savedAt: string; data: unknown }
  | { found: true; savedAt: string; error: string; text: string }
) & { gmail?: GmailStatus };

/* ── Coercion ────────────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};

const str = (v: unknown) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

function num(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,%$\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** A probability as a whole percent. Takes 55, "55%" or 0.55 — models write all three. */
function pct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  const p = n > 0 && n < 1 ? n * 100 : n;
  return Math.round(Math.min(100, Math.max(0, p)));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = str(v).toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function instant(v: unknown): string | null {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const list = <T>(v: unknown, each: (o: Obj) => T | null): T[] =>
  Array.isArray(v) ? v.map((x) => each(obj(x))).filter((x): x is T => x != null) : [];

/**
 * An analyst link that opens the source directly. Gmail rewrites links in drafts
 * into Google redirects (google.com/url?q=…), so those are unwrapped; anything that
 * isn't plain http(s) — javascript:, data: — is dropped.
 */
export function cleanUrl(raw: unknown): string {
  let u: URL;
  try {
    u = new URL(str(raw));
  } catch {
    return "";
  }
  if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") {
    const target = u.searchParams.get("q") ?? u.searchParams.get("url");
    return target ? cleanUrl(target) : "";
  }
  return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
}

const texts = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/**
 * Scales parts to add up to exactly 100, fixing rounding by largest remainder.
 * Estimates of 55/30/14 are common; a bar that runs 1% short looks broken.
 */
export function toHundred(parts: number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return parts.map(() => 0);
  const raw = parts.map((p) => (p / total) * 100);
  const out = raw.map(Math.floor);
  let short = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (short-- <= 0) break;
    out[i]++;
  }
  return out;
}

/** A low/high pair, swapped if written the wrong way round; both null unless both are there. */
function orderedRange(a: number | null, b: number | null) {
  if (a == null || b == null || a === b) return { rangeLow: null, rangeHigh: null };
  return { rangeLow: Math.min(a, b), rangeHigh: Math.max(a, b) };
}

/* ── Reading the file ────────────────────────────────────────────────── */

/**
 * Turns whatever the task wrote into a briefing the page can trust, or null when the
 * core is missing. Everything past the date and the bias split is optional.
 */
export function parseBias(raw: unknown): DailyBias | null {
  const r = obj(raw);
  const date = str(r.date);
  const b = obj(r.bias);
  const split = [pct(b.bullish), pct(b.range), pct(b.bearish)];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || split.some((p) => p == null)) return null;
  const [bullish, range, bearish] = toHundred(split as number[]);
  if (bullish + range + bearish === 0) return null;

  const key = obj(r.keyLevel);
  const event = obj(r.mainEvent);
  const st = obj(r.structure);
  const cons = obj(r.consensus);
  const macro = obj(r.macro);
  const surprise = obj(macro.surprise);
  const risk = obj(r.risk);

  const scenarios = list(r.scenarios, (s): Scenario | null => {
    const prob = pct(s.prob);
    if (prob == null) return null;
    return {
      kind: oneOf(s.kind, ["primary", "alternative", "chop"], "chop"),
      title: str(s.title),
      direction: oneOf(s.direction, ["long", "short", "flat"], "flat"),
      prob,
      trigger: str(s.trigger),
      targets: list(s.targets, (t) => {
        const price = num(t.price);
        return price == null ? null : { price, prob: pct(t.prob) };
      }),
      invalidation: num(s.invalidation),
      zone: (() => {
        const r = orderedRange(num(s.zoneLow), num(s.zoneHigh));
        // Older briefings name the zone only in words ("4136-4181 range into NFP").
        return r.rangeLow != null
          ? { low: r.rangeLow, high: r.rangeHigh! }
          : zoneFromText(`${str(s.title)} ${str(s.trigger)}`);
      })(),
      why: str(s.why),
    };
  });
  // Primary, alternative and chop are one set of outcomes, so they share 100%.
  const shares = toHundred(scenarios.map((s) => s.prob));
  scenarios.forEach((s, i) => (s.prob = shares[i]));

  const consSplit = [pct(cons.bullish), pct(cons.neutral), pct(cons.bearish)];
  const [cBull, cNeutral, cBear] = consSplit.every((p) => p != null)
    ? toHundred(consSplit as number[])
    : [];

  const sBull = pct(surprise.bullish);
  const sBear = pct(surprise.bearish);
  const [surBull, surBear] = sBull != null && sBear != null ? toHundred([sBull, sBear]) : [];

  return {
    date,
    generatedAt: instant(r.generatedAt),
    spot: num(r.spot),
    spotAt: instant(r.spotAt),
    tldr: str(r.tldr),
    bias: { bullish, range, bearish, why: str(b.why) },
    keyLevel: str(key.label) || num(key.price) != null
      ? { price: num(key.price), label: str(key.label), why: str(key.why) }
      : null,
    mainEvent: str(event.title)
      ? { title: str(event.title), at: instant(event.at), why: str(event.why) }
      : null,
    structure: {
      d1: str(st.d1),
      h4: str(st.h4),
      d1Trend: str(st.d1Trend) ? oneOf<Trend>(st.d1Trend, ["bullish", "bearish", "range"], "range") : null,
      h4Trend: str(st.h4Trend) ? oneOf<Trend>(st.h4Trend, ["bullish", "bearish", "range"], "range") : null,
      ...orderedRange(num(st.rangeLow), num(st.rangeHigh)),
      zone: str(st.zone) ? oneOf<Zone>(st.zone, ["premium", "discount", "equilibrium"], "equilibrium") : null,
      why: str(st.why),
    },
    levels: list(r.levels, (l): BiasLevel | null => {
      const price = num(l.price);
      if (price == null) return null;
      return {
        price,
        label: str(l.label),
        kind: oneOf(
          l.kind,
          ["resistance", "support", "liquidity", "fvg", "orderblock", "round", "open"],
          "support",
        ),
        sweepProb: pct(l.sweepProb),
        verdict: oneOf(l.verdict, ["hold", "break", "unclear"], "unclear"),
        note: str(l.note),
      };
    }),
    analysts: list(r.analysts, (a): Analyst | null =>
      str(a.name)
        ? {
            name: str(a.name),
            source: str(a.source),
            url: cleanUrl(a.url),
            lean: oneOf(a.lean, ["bullish", "bearish", "neutral"], "neutral"),
            levels: str(a.levels),
            why: str(a.why),
            publishedAt: instant(a.publishedAt),
          }
        : null,
    ),
    consensus:
      cBull != null ? { bullish: cBull, neutral: cNeutral, bearish: cBear, take: str(cons.take) } : null,
    scenarios,
    sessions: list(r.sessions, (s) => {
      const prob = pct(s.prob);
      return prob == null || !str(s.label) ? null : { label: str(s.label), prob, why: str(s.why) };
    }),
    macro: {
      dxy: str(macro.dxy),
      yields: str(macro.yields),
      flow: str(macro.flow),
      drivers: list(macro.drivers, (d): Driver | null =>
        str(d.name)
          ? {
              name: str(d.name),
              value: str(d.value),
              change: str(d.change),
              gold: oneOf(d.gold, ["bullish", "bearish", "neutral"], "neutral"),
            }
          : null,
      ),
      surprise:
        surBull != null
          ? { event: str(surprise.event), bullish: surBull, bearish: surBear, why: str(surprise.why) }
          : null,
    },
    risk: {
      events: list(risk.events, (e) =>
        str(e.title)
          ? {
              title: str(e.title),
              at: instant(e.at),
              impact: oneOf(
                str(e.impact).toLowerCase(),
                ["high", "medium", "low"],
                "medium",
              ).replace(/^./, (c) => c.toUpperCase()) as BiasEvent["impact"],
            }
          : null,
      ),
      atr: num(risk.atr),
      ...(() => {
        const r = orderedRange(num(risk.dayLow), num(risk.dayHigh));
        return { dayLow: r.rangeLow, dayHigh: r.rangeHigh };
      })(),
      expectedRange: str(risk.expectedRange),
      standAside: texts(risk.standAside),
    },
    markdown: str(r.markdown),
  };
}

/* ── Is it today's? ──────────────────────────────────────────────────── */

/**
 * Where the briefing stands relative to now:
 * - "today"   — written for today; show it.
 * - "waiting" — not today's, but today's run hasn't had time to land yet.
 * - "late"    — a trading day, well past the run, and still nothing new.
 * - "offday"  — no run is expected (weekend).
 */
export type Freshness = "today" | "waiting" | "late" | "offday";

/** The routine runs on Amsterdam time, so freshness is judged on that clock too. */
export function amsterdamClock(now: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) if (part.type !== "literal") p[part.type] = part.value;
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  return {
    /** "YYYY-MM-DD" on the Amsterdam calendar. */
    date: `${p.year}-${p.month}-${p.day}`,
    /** Minutes since Amsterdam midnight, e.g. 10:30 → 630. */
    minutes: hour * 60 + Number(p.minute),
    weekend: p.weekday === "Sat" || p.weekday === "Sun",
  };
}

/** The run is scheduled for 9:46; research takes a few minutes on top. */
export const RUN_AT_MIN = 9 * 60 + 46;

/**
 * How long after 9:46 a missing briefing counts as late: the routine's dispatch can lag
 * a few minutes, the research takes 5–15, and the desk looks in Gmail every two — 45
 * minutes covers all of it with room to spare, so "late" means something went wrong.
 */
export const LATE_AFTER_MIN = 45;

export function freshness(briefingDate: string | null, now: Date = new Date()): Freshness {
  const clock = amsterdamClock(now);
  // Written for today — or, with a clock a little off, for a day that hasn't begun here yet.
  if (briefingDate != null && briefingDate >= clock.date) return "today";
  if (clock.weekend) return "offday";
  return clock.minutes < RUN_AT_MIN + LATE_AFTER_MIN ? "waiting" : "late";
}

/**
 * Which way the briefing leans: its largest of the three odds. A range day reads as
 * "unclear" — it has no direction for a trade to agree or disagree with.
 */
export function briefingLean(
  odds: { bullish: number; range: number; bearish: number } | null | undefined,
): "bullish" | "bearish" | "unclear" | null {
  if (!odds) return null;
  const { bullish, range, bearish } = odds;
  if (bullish > range && bullish > bearish) return "bullish";
  if (bearish > range && bearish > bullish) return "bearish";
  return "unclear";
}
