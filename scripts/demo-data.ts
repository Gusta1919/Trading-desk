/**
 * Demo data, to see the whole desk working before your own trades exist.
 *
 *   npm run demo          about 13 weeks of GOLD Model trades and check-ins: a few
 *                         staged rule breaks (for the consequences and the Coach), B
 *                         setups logged as not taken, two Exit-lab stories, and an
 *                         example Daily Bias briefing for today
 *   npm run demo:remove   removes all of it again — nothing else is touched
 *
 * Trades go through the running desk's own API, so R, risk and every flag are worked
 * out exactly as for real ones. Every demo trade's notes start with "[demo]" and every
 * demo check-in's note is "[demo]": that tag is how `remove` finds them. The demo
 * briefing carries `"demo": true`; a real briefing it covered is kept aside and put
 * back by `remove`. The history ends on LAST_DAY, so it never lands on a real day.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, evaluate } from "../src/lib/checkin";
import { amsterdamClock } from "../src/lib/dailyBias";
import { BIAS_OPTION } from "../src/lib/goldModel";
import { computeGrade } from "../src/lib/grading";
import type { Rulebook, RulebookVersion } from "../src/lib/rulebook";
import { sessionAt } from "../src/lib/rules";
import { deskTime } from "../src/lib/tz";
import {
  HTF_TIMEFRAMES,
  htfRank,
  type Direction,
  type ExitReason,
  type HtfReason,
  type Trade,
  type TradeInput,
} from "../src/lib/types";

const API = "http://127.0.0.1:3848/api";
const TAG = "[demo]";
/** The last demo day: the day before the first real check-in (30 September 2026). */
const LAST_DAY = "2026-09-29";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, "..", "data", "trade-assistant.db");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${url}`, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new Error("The desk isn't running. Start it first (npm start), then run this again.");
  }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : res.json()) as T;
}

/** Same numbers every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261003);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const chance = (p: number) => rand() < p;
const round = (x: number, d = 2) => Number(x.toFixed(d));
const pad = (n: number) => String(n).padStart(2, "0");

/** The weekdays up to LAST_DAY, oldest first. */
function weekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${LAST_DAY}T12:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** The UTC instant of a New York wall-clock time on a day — DST worked out from the day itself. */
function nyInstant(day: string, hhmm: string): string {
  // Noon UTC reads as 08:00 in New York in summer (UTC−4) and 07:00 in winter (UTC−5).
  const offset = deskTime(new Date(`${day}T12:00:00Z`)) === "08:00" ? 4 : 5;
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h + offset, m)).toISOString();
}

/* ── One demo setup ──────────────────────────────────────────────────── */

type Aim = "A+" | "A" | "B";

/** How each grade plays out: the chance of a win, and the R of a winner. */
const PROFILE: Record<Aim, { win: number; lo: number; hi: number }> = {
  "A+": { win: 0.5, lo: 1.4, hi: 3.0 },
  A: { win: 0.42, lo: 1.0, hi: 2.4 },
  B: { win: 0.3, lo: 1.0, hi: 2.2 },
};

/** A setup's answers: the best for A+, one factor short of it for A, one factor at B for B. */
function answersFor(aim: Aim) {
  const a: Record<string, string | number> = {
    "htf-tf": "htf-4h-plus",
    disp: round(between(1.05, 2.2)),
    bias: BIAS_OPTION.matches,
    compass: Math.round(between(61, 82)),
    conviction: "conv-none",
  };
  if (aim === "A") {
    const short = pick(["htf", "disp", "conviction"] as const);
    if (short === "htf") a["htf-tf"] = "htf-1h";
    if (short === "disp") a.disp = round(between(0.3, 0.95));
    if (short === "conviction") a.conviction = "conv-lacking";
  }
  if (aim === "B") {
    const short = pick(["bias", "compass", "conviction", "disp"] as const);
    if (short === "bias") a.bias = BIAS_OPTION.unclear;
    if (short === "compass") a.compass = Math.round(between(42, 58));
    if (short === "conviction") a.conviction = "conv-unsure";
    if (short === "disp") a.disp = round(between(0.1, 0.24));
  }
  return a;
}

/**
 * The HTF reasons behind a setup, agreeing with its timeframe answer: the highest one is
 * 1H for a "1H" answer, 4H or above otherwise — sometimes with a lower one beside it.
 */
function htfFor(answers: Record<string, string | number>): HtfReason[] {
  const types = ["FVG", "FVG", "OB", "VIMB"] as const;
  const top = { type: pick(types), tf: answers["htf-tf"] === "htf-1h" ? "1H" : pick(["4H", "4H", "D", "W"]) } as HtfReason;
  const lower = HTF_TIMEFRAMES.slice(0, htfRank(top.tf)).map((x) => x.value);
  const reasons: HtfReason[] = [top];
  if (lower.length && chance(0.35)) reasons.push({ type: pick(types.filter((t) => t !== top.type)), tf: pick(lower) });
  return reasons;
}

function outcomeR(aim: Aim) {
  const p = PROFILE[aim];
  const r = rand();
  if (r < 0.06) return { r: round(between(-0.05, 0.05)), reason: "breakeven" as ExitReason };
  if (r < 0.06 + p.win) {
    const win = round(between(p.lo, p.hi));
    return { r: win, reason: (win >= 1.8 ? "target" : pick(["target", "trail", "time"])) as ExitReason };
  }
  return { r: round(between(-1.02, -0.97)), reason: "stop" as ExitReason };
}

/** One setup as the form would log it: graded against the rulebook, taken at its grade's risk. */
function makeSetup(day: string, time: string, aim: Aim, direction: Direction, balance: number, doc: Rulebook): TradeInput {
  const answers = answersFor(aim);
  const ticked = doc.baseRules.map((r) => r.id);
  const { grade } = computeGrade(doc, { ticked, answers });
  const risk = doc.grades.find((g) => g.grade === grade)?.riskPct ?? 0;
  const { r, reason } = outcomeR(aim);
  const plannedRR = reason === "target" && r > 0 ? round(r) : round(between(1.3, 3.2));
  const [h, m] = time.split(":").map(Number);
  const exitMin = Math.min(h * 60 + m + Math.floor(between(20, 170)), 11 * 60 + 55);
  const notTaken = aim === "B";

  return {
    date: `${day}T${time}`,
    symbol: doc.instrument,
    direction,
    session: sessionAt(time) ?? "London",
    riskPct: notTaken ? 0 : risk,
    plannedRR,
    pnlUsd: notTaken ? null : round((r * risk * balance) / 100),
    grade: grade ?? "",
    setupSnapshot: { baseRules: doc.baseRules, factors: doc.factors, grades: doc.grades, ticked, answers, grade },
    rulebookVersion: doc.version,
    flagNote: "",
    skipped: notTaken,
    hypotheticalR: notTaken ? r : null,
    boxSize: round(between(4, 16)),
    sweepDepth: round(between(1.5, 26)),
    took15mSwing: chance(0.55),
    levelSweep: chance(0.2),
    htfReasons: htfFor(answers),
    poiTests: pick(["fresh", "fresh", "once", "2+"] as const),
    biasMatch: chance(0.75),
    exitTime: notTaken ? "" : `${day}T${pad(Math.floor(exitMin / 60))}:${pad(exitMin % 60)}`,
    exitReason: notTaken ? "" : reason,
    earlyStopMove: notTaken ? null : false,
    releaseAtBe: null,
    mfeR: notTaken ? null : round(Math.max(r, 0) + between(0.05, 0.9)),
    maeR: notTaken ? null : r < 0 ? 1 : round(between(0.05, 0.8)),
    maxFavR: null,
    targetBeforeStop: "",
    emotion: pick([1, 2, 2, 2, 3, 3, 4]),
    mistakes: !notTaken && chance(0.08) ? [pick(["Late entry", "Hesitated", "Distracted"])] : [],
    notes: notTaken ? `${TAG} ${grade} setup, passed on` : `${TAG} ${grade} setup`,
    screenshot: "",
    screenshotAfter: "",
    news: [],
  };
}

/* ── Check-ins ───────────────────────────────────────────────────────── */

/** A check-in for each day; `clean` days always clear the trader to trade. */
async function writeCheckins(days: string[], fineChance: number, clean = new Set<string>()) {
  const existing = new Set((await api<{ date: string }[]>("/checkins")).map((c) => c.date));
  for (const day of days) {
    if (existing.has(day)) continue;
    const a: Record<string, number> = {};
    for (const q of QUESTIONS) {
      const fine = q.options.map((o, i) => ({ o, i })).filter(({ o }) => o.risk === 0).map(({ i }) => i);
      a[q.id] = (clean.has(day) || chance(fineChance)) && fine.length ? pick(fine) : Math.floor(rand() * q.options.length);
    }
    const { score, verdict } = evaluate(a);
    await api(`/checkins/${day}`, { method: "PUT", body: JSON.stringify({ answers: a, note: TAG, score, verdict, reflection: "" }) });
  }
}

/** A copy of the database before the demo writes to it, in data/archive/. */
async function backup() {
  const dir = path.join(here, "..", "data", "archive");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = path.join(dir, `before-demo-${stamp}.db`);
  const db = new Database(DB_PATH, { readonly: true });
  await db.backup(file);
  db.close();
  return path.relative(path.join(here, ".."), file);
}

/**
 * Posts a trade the way a disciplined trader takes it: the server judges it against
 * the history and the check-in, and a trade the rules would not allow is withdrawn.
 * Staged rule breaks stay as they are. Returns the $ result kept.
 */
async function post(input: TradeInput, staged = false): Promise<number> {
  const saved = await api<Trade>("/trades", { method: "POST", body: JSON.stringify(input) });
  if (staged || !saved.flags.length) return input.pnlUsd ?? 0;
  await api(`/trades/${saved.id}`, { method: "DELETE" });
  return 0;
}

/** A setup that grades at the aim on this day, trying both directions; null if none does. */
function setupAt(day: string, time: string, balance: number, doc: Rulebook, aim: Aim) {
  for (let tries = 0; tries < 20; tries++) {
    const t = makeSetup(day, time, aim, chance(0.55) ? "long" : "short", balance, doc);
    if (t.grade === aim) return t;
  }
  return null;
}

/** An entry time inside the morning window, mostly London. */
const morning = () => `0${pick([4, 4, 5, 5, 6, 7])}:${pad(Math.floor(between(2, 58)))}`;

/** The fields a staged break changes on an otherwise ordinary trade. */
function breakFields(kind: "discretionary" | "earlyMove" | "timeStop" | "overRisk", day: string, t: TradeInput): Partial<TradeInput> {
  const note = { flagNote: pick(["felt sure about it", "wanted to make back yesterday", "the move looked done"]), notes: `${TAG} staged rule break` };
  switch (kind) {
    case "discretionary":
      return { ...note, exitReason: "other", mistakes: ["FOMO entry"] };
    case "earlyMove":
      return { ...note, earlyStopMove: true };
    case "timeStop":
      return { ...note, exitTime: `${day}T12:25` };
    case "overRisk":
      return { ...note, riskPct: 0.75, pnlUsd: round(((t.pnlUsd ?? 0) * 0.75) / (t.riskPct || 1)) };
  }
}

/* ── demo ────────────────────────────────────────────────────────────── */

async function add() {
  const trades = await api<Trade[]>("/trades");
  if (trades.some((t) => t.notes.startsWith(TAG))) {
    console.log("The demo is already in — run `npm run demo:remove` first to start over.");
    return;
  }
  const { current } = await api<{ current: RulebookVersion }>("/rulebook");
  const doc = current.doc;
  console.log(`Backed up the database to ${await backup()}`);

  const days = weekdays(64);
  /*
   * Staged rule breaks, a handful over the weeks — for the consequences and the Coach.
   * Each costs the rest of its day and the trading day after it.
   */
  const staged = new Map<number, "discretionary" | "earlyMove" | "timeStop" | "overRisk" | "window" | "second">([
    [9, "discretionary"],
    [16, "window"],
    [23, "overRisk"],
    [31, "earlyMove"],
    [40, "second"],
    [49, "timeStop"],
  ]);
  // Check-ins first, so the trader can respect what each morning allowed. A staged day
  // starts cleared, so its break is the only flag on it.
  await writeCheckins(days, 0.9, new Set([...staged.keys()].map((i) => days[i])));

  let balance = doc.limits.openingBalance;
  for (const [i, day] of days.entries()) {
    const kind = staged.get(i);
    if (!kind && chance(0.13)) continue; // no setup that day
    // Now and then the morning's setup is a B: logged, not taken.
    if (!kind && chance(0.16)) {
      const b = setupAt(day, morning(), balance, doc, "B");
      if (b) await post(b);
      continue;
    }
    const aim: Aim = kind || chance(0.38) ? "A+" : "A";
    const time = kind === "window" ? "08:40" : morning(); // one entry in the 08:25–09:30 pause
    const found = setupAt(day, time, balance, doc, aim);
    if (!found) continue;
    let input = found;
    if (kind === "window") {
      // Ticked by hand: outside the window, its rule doesn't hold — a C, taken anyway.
      const ticked = found.setupSnapshot!.ticked.filter((id) => id !== "window");
      const { grade } = computeGrade(doc, { ticked, answers: found.setupSnapshot!.answers });
      input = { ...found, grade: grade ?? "", setupSnapshot: { ...found.setupSnapshot!, ticked, grade }, flagNote: "it looked too good to wait", notes: `${TAG} staged rule break` };
    } else if (kind && kind !== "second") {
      input = { ...found, ...breakFields(kind, day, found) };
    }
    balance += await post(input, !!kind);
    // Once: a second trade the same day — the one-trade rule.
    if (kind === "second") {
      const second = setupAt(day, `${pick(["09", "10"])}:${pad(Math.floor(between(31, 58)))}`, balance, doc, "A+");
      if (second) balance += await post({ ...second, flagNote: "a cleaner setup came", notes: `${TAG} staged rule break` }, true);
    }
  }
  await exitStories(doc, days[0]);
  const all = (await api<Trade[]>("/trades")).filter((t) => t.notes.startsWith(TAG));
  const notTaken = all.filter((t) => t.skipped).length;
  console.log(`Added ${all.length - notTaken} demo trades and ${notTaken} setups not taken over ${days.length} trading days, with check-ins.`);
}

/* ── Two Exit-lab stories ────────────────────────────────────────────── */

/**
 * Two hand-made trades whose excursions tell a story the Exit lab can show, on the
 * two weekdays before the first demo day:
 *  - an A+ long stopped out for −1R after running +1.4R first: breakeven at 1R would
 *    have saved it;
 *  - an A short that hit its 2.1R target while price ran on to 3.6R.
 */
async function exitStories(doc: Rulebook, first: string) {
  const days: string[] = [];
  for (const d = new Date(`${first}T12:00:00Z`); days.length < 2; ) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.unshift(d.toISOString().slice(0, 10));
  }
  // A clean morning on both days.
  await writeCheckins(days, 1);
  const balance = doc.limits.openingBalance;
  const story = (day: string, time: string, aim: "A+" | "A", direction: Direction) => {
    for (let tries = 0; tries < 50; tries++) {
      const t = makeSetup(day, time, aim, direction, balance, doc);
      if (t.grade === aim) return t;
    }
    throw new Error(`No ${aim} ${direction} setup on ${day}`);
  };

  const a = story(days[0], "05:12", "A+", "long");
  const b = story(days[1], "04:38", "A", "short");
  for (const t of [
    {
      ...a,
      exitReason: "stop" as const,
      exitTime: `${days[0]}T08:47`,
      pnlUsd: round((-1 * a.riskPct * balance) / 100),
      mfeR: 1.4,
      maeR: 1,
      plannedRR: 2.4,
      notes: `${TAG} exit story · ran +1.4R before the stop — breakeven at 1R would have saved it`,
    },
    {
      ...b,
      plannedRR: 2.1,
      exitReason: "target" as const,
      exitTime: `${days[1]}T07:16`,
      pnlUsd: round((2.1 * b.riskPct * balance) / 100),
      mfeR: 2.1,
      maeR: 0.3,
      maxFavR: 3.6,
      notes: `${TAG} exit story · target at 2.1R, price ran on to 3.6R`,
    },
  ]) {
    await post(t, true);
  }
}

/* ── The briefing ───────────────────────────────────────────────────────── */

const BIAS_FILE = path.join(here, "..", "data", "daily-bias.json");
const BIAS_KEPT = path.join(here, "..", "data", "daily-bias.before-demo.json");

const isDemoBriefing = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))?.demo === true;
  } catch {
    return false;
  }
};

/** Gold's last price from the desk's own feed, so the levels sit around the live chart. */
async function liveSpot(): Promise<number | null> {
  try {
    const { candles } = await api<{ candles: { c: number }[] }>("/candles?tf=15m");
    return candles[candles.length - 1]?.c ?? null;
  } catch {
    return null;
  }
}

/** Used when the feed can't be reached; the chart then has no candles to line up with anyway. */
const FALLBACK_SPOT = 4150;

/**
 * A complete briefing in the shape the morning routine writes, dated today, with every
 * section filled so each card on the Daily Bias tab has something to show. Prices are
 * offsets from spot; the analysts are made up and carry no links.
 */
function demoBriefing(day: string, spot: number) {
  const at = (x: number) => Math.round(spot + x);
  // The next round number above the PDH, so it is the furthest long target.
  const round50 = Math.ceil((spot + 20) / 50) * 50;
  const writtenAt = nyInstant(day, "03:50");
  const markdown = [
    `# Gold Daily Bias — ${day} (demo)`,
    "",
    `**TL;DR:** Bullish lean (55%). Buy a London sweep of the Asia low into the 4H FVG at ${at(-14)}–${at(-9)}; first target the PDH at ${at(18)}. Stand aside 15 minutes either side of US PCE at 08:30 NY.`,
    "",
    "This is a demo briefing written by `npm run demo`. The analysts are invented; nothing here is a real view.",
  ].join("\n");

  return {
    demo: true,
    date: day,
    generatedAt: writtenAt,
    spot: Math.round(spot * 10) / 10,
    spotAt: writtenAt,
    tldr: `Bullish lean: buy a London sweep of the Asia low into the 4H FVG, target the PDH at ${at(18)}. Flat into PCE.`,
    bias: {
      bullish: 55,
      range: 30,
      bearish: 15,
      why: "Daily structure still makes higher highs, the dollar is soft after Thursday's data, and price sits in the discount half of the weekly range.",
    },
    keyLevel: {
      price: at(-9),
      label: "Asia low",
      why: "The obvious sell-side liquidity under the Asia range; a sweep and reclaim here is the A+ long of the day.",
    },
    mainEvent: {
      title: "US Core PCE Price Index m/m",
      at: nyInstant(day, "08:30"),
      why: "The Fed's preferred inflation gauge. A hot print lifts yields and the dollar, the main risk to the long idea.",
    },
    structure: {
      d1: "Higher highs and higher lows since the mid-September low; yesterday closed back inside the prior day's range.",
      h4: "Pullback into a bullish FVG left by Wednesday's impulse; no bearish market-structure shift yet.",
      d1Trend: "bullish",
      h4Trend: "range",
      rangeLow: at(-40),
      rangeHigh: at(60),
      zone: "discount",
      why: `Measured on the weekly range ${at(-40)}–${at(60)}: spot sits below its midpoint at ${at(10)}.`,
    },
    levels: [
      { price: at(30), label: "4H bearish order block", kind: "orderblock", sweepProb: 20, verdict: "hold", note: "Last up-close candle before Tuesday's drop." },
      { price: round50, label: `${round50} round number`, kind: "round", sweepProb: 35, verdict: "unclear", note: "Options interest clusters here." },
      { price: at(18), label: "Previous day high (PDH)", kind: "liquidity", sweepProb: 45, verdict: "break", note: "Buy-side liquidity; first target for longs." },
      { price: at(8), label: "Asia high", kind: "resistance", sweepProb: 70, verdict: "break", note: "Likely taken in London if the long plays out." },
      { price: at(-3), label: "Daily open", kind: "open", sweepProb: null, verdict: "unclear", note: "Above it = bullish day so far." },
      { price: at(-9), label: "Asia low", kind: "liquidity", sweepProb: 65, verdict: "hold", note: "Sweep and reclaim = the long trigger." },
      { price: at(-14), label: "4H bullish FVG", kind: "fvg", sweepProb: 40, verdict: "hold", note: `Gap ${at(-14)}–${at(-9)} left by Wednesday's impulse.` },
      { price: at(-22), label: "Previous day low (PDL)", kind: "liquidity", sweepProb: 15, verdict: "hold", note: "Losing it cancels the bullish read." },
    ],
    analysts: [
      { name: "Demo Analyst A", source: "Example Research", url: "", lean: "bullish", levels: `${at(-14)} / ${at(18)}`, why: "Dips into the 4H gap get bought while the dollar stays soft.", publishedAt: nyInstant(day, "02:10") },
      { name: "Demo Analyst B", source: "Example Markets Desk", url: "", lean: "bullish", levels: `${at(-9)} / ${round50}`, why: "Targets the round number once the Asia high is cleared.", publishedAt: nyInstant(day, "01:40") },
      { name: "Demo Analyst C", source: "Example FX Notes", url: "", lean: "neutral", levels: `${at(-22)}–${at(18)}`, why: "Expects a range until PCE; would only trade the breakout.", publishedAt: nyInstant(day, "00:55") },
      { name: "Demo Analyst D", source: "Example Macro Weekly", url: "", lean: "bullish", levels: `${at(30)}`, why: "Real yields rolling over support the bigger uptrend.", publishedAt: nyInstant(day, "00:20") },
      { name: "Demo Analyst E", source: "Example Charting Blog", url: "", lean: "bearish", levels: `${at(-22)} / ${at(-40)}`, why: "Sees a double top on the 4H and a run on the PDL.", publishedAt: nyInstant(day, "00:05") },
    ],
    consensus: { bullish: 60, neutral: 20, bearish: 20, take: "Three of five lean long; the bears need a hot PCE to get going." },
    scenarios: [
      {
        kind: "primary",
        title: "London sweep of the Asia low, then the PDH",
        direction: "long",
        prob: 55,
        trigger: `Sweep below ${at(-9)}, 5m market-structure shift back above it.`,
        targets: [{ price: at(8), prob: 70 }, { price: at(18), prob: 45 }, { price: round50, prob: 25 }],
        invalidation: at(-22),
        zoneLow: at(-14),
        zoneHigh: at(-9),
        why: "Liquidity below Asia, a fresh 4H gap underneath and a bullish daily trend.",
      },
      {
        kind: "alternative",
        title: "Hot PCE: lose the PDL",
        direction: "short",
        prob: 15,
        trigger: `A 5m close below ${at(-22)} after the release.`,
        targets: [{ price: at(-40), prob: 40 }, { price: at(-60), prob: 15 }],
        invalidation: at(-3),
        zoneLow: at(-25),
        zoneHigh: at(-20),
        why: "A hot print lifts yields and the dollar, and the 4H gap fails.",
      },
      {
        kind: "chop",
        title: "Range into the release",
        direction: "flat",
        prob: 30,
        trigger: "Asia high and low both hold through London.",
        targets: [],
        invalidation: null,
        zoneLow: at(-9),
        zoneHigh: at(8),
        why: "Traders wait for PCE; no clean setup before 08:30 NY.",
      },
    ],
    sessions: [
      { label: "Asia: range", prob: 75, why: "Quiet overnight, a 17-dollar range so far." },
      { label: "London: sweeps the Asia low", prob: 60, why: "The usual London stop run before direction." },
      { label: "New York: trends after PCE", prob: 50, why: "The release decides the afternoon." },
    ],
    macro: {
      dxy: "DXY 97.8, down 0.2% — a soft dollar helps gold.",
      yields: "US 10-year 4.05%, down 3 bp; real yields easing.",
      flow: "ETF holdings up for a fifth day; futures positioning still long but not stretched.",
      drivers: [
        { name: "DXY", value: "97.8", change: "−0.2%", gold: "bullish" },
        { name: "US 10Y yield", value: "4.05%", change: "−3 bp", gold: "bullish" },
        { name: "S&P 500 futures", value: "6,710", change: "+0.1%", gold: "neutral" },
        { name: "Oil (WTI)", value: "$64.20", change: "+1.1%", gold: "neutral" },
        { name: "Silver", value: "$48.90", change: "−0.4%", gold: "bearish" },
      ],
      surprise: {
        event: "US Core PCE m/m",
        bullish: 45,
        bearish: 55,
        why: "Forecast 0.2%; a 0.3% print is a little more likely than 0.1%.",
      },
    },
    risk: {
      events: [
        { title: "US Core PCE Price Index m/m", at: nyInstant(day, "08:30"), impact: "High" },
        { title: "US Personal Spending m/m", at: nyInstant(day, "08:30"), impact: "Medium" },
        { title: "University of Michigan Sentiment", at: nyInstant(day, "10:00"), impact: "Medium" },
        { title: "FOMC member speaks", at: nyInstant(day, "13:00"), impact: "Low" },
      ],
      atr: 38,
      dayLow: at(-6),
      dayHigh: at(11),
      expectedRange: `${at(-25)}–${at(25)} (about 1.3× the daily ATR)`,
      standAside: [
        "15 minutes either side of PCE at 08:30 NY",
        "If the PDL breaks before London opens",
        "After two losing trades",
      ],
    },
    markdown,
  };
}

async function bias() {
  const day = amsterdamClock(new Date()).date;
  const live = await liveSpot();
  const spot = live ?? FALLBACK_SPOT;
  fs.mkdirSync(path.dirname(BIAS_FILE), { recursive: true });
  // A real briefing on disk is kept aside, never overwritten.
  if (fs.existsSync(BIAS_FILE) && !isDemoBriefing(BIAS_FILE)) fs.copyFileSync(BIAS_FILE, BIAS_KEPT);
  fs.writeFileSync(BIAS_FILE, JSON.stringify(demoBriefing(day, spot), null, 2));
  console.log(
    `Wrote a demo Daily Bias briefing for ${day} around ${live != null ? `live spot ${spot}` : `$${spot} (price feed unreachable)`}.`,
  );
}

/* ── demo:remove ─────────────────────────────────────────────────────── */

async function remove() {
  const trades = await api<Trade[]>("/trades");
  const demo = trades.filter((t) => t.notes.startsWith(TAG));
  // Through the API, so the balance and every later trade's % and flags are recalculated.
  for (const t of demo) await api(`/trades/${t.id}`, { method: "DELETE" });
  // Check-ins have no delete route; only the tagged ones go, straight from the file.
  const db = new Database(DB_PATH);
  const checkins = db.prepare("DELETE FROM checkins WHERE note = ?").run(TAG).changes;
  db.close();
  console.log(`Removed ${demo.length} demo trades and setups, and ${checkins} demo check-ins.`);

  // The demo briefing goes; a real one it covered comes back. A real briefing that has
  // since replaced the demo stays where it is.
  if (isDemoBriefing(BIAS_FILE)) {
    if (fs.existsSync(BIAS_KEPT)) fs.renameSync(BIAS_KEPT, BIAS_FILE);
    else fs.rmSync(BIAS_FILE);
    console.log("Removed the demo briefing.");
  } else if (fs.existsSync(BIAS_KEPT)) {
    fs.rmSync(BIAS_KEPT);
  }
}

const mode = process.argv[2];
const run = mode === "remove" ? remove() : mode === "add" ? add().then(bias) : Promise.reject(new Error("Use: add | remove"));
run.catch((e) => {
  console.error(e.message);
  process.exit(1);
});
