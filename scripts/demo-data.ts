/**
 * Demo history for trying out the Rulebook, the Coach, the Risk lab and Compare.
 *
 *   npm run demo:add      adds ~13 weeks of GOLD Model trades and check-ins, with a
 *                         few rule breaks for the Coach and the consequences, and the
 *                         two Exit-lab stories below
 *   npm run demo:more     adds only the two Exit-lab stories, before the demo begins
 *   npm run demo:fill     adds 300 trades from a disciplined, profitable trader
 *                         (`npm run demo:fill -- 500 7` for another count and seed)
 *   npm run demo:bias     writes an example Daily Bias briefing for today
 *   npm run demo:all      demo:add and demo:bias together — the whole desk filled in
 *   npm run demo:remove   removes every one of them again (and the demo briefing)
 *
 * Trades go through the running app's own API, so percentages, R and every flag are
 * worked out exactly as for real ones.
 *
 * Every demo trade's notes start with "[demo]" and every demo check-in's note is
 * "[demo]" — that tag is how `remove` finds them, and nothing without it is ever
 * touched. Days that already have a real check-in are skipped for those. (Older demo
 * runs also wrote daily plans; `remove` still clears those.)
 *
 * The demo briefing carries `"demo": true`. The desk never counts it as today's, so a
 * real briefing from Gmail still replaces it; any real briefing it covered is kept aside
 * and put back by `remove`.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, evaluate } from "../src/lib/checkin";
import { amsterdamClock } from "../src/lib/dailyBias";
import { computeGrade } from "../src/lib/grading";
import type { RulebookVersion } from "../src/lib/rulebook";
import { BIAS_OPTION } from "../src/lib/rulebookText";
import { compassFor, sessionAt } from "../src/lib/rules";
import { deskTime } from "../src/lib/tz";
import {
  EMPTY_RULEBOOK_FIELDS,
  HTF_TIMEFRAMES,
  htfRank,
  topHtf,
  type Direction,
  type ExitReason,
  type HtfReason,
  type Trade,
  type TradeInput,
} from "../src/lib/types";

const API = "http://127.0.0.1:3848/api";
const TAG = "[demo]";
/**
 * The last demo day: the day before your first real check-in (30 September), so demo
 * check-ins and trades never land on a real day.
 */
const LAST_DAY = "2026-09-29";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, "..", "data", "trade-assistant.db");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${url}`, { headers: { "Content-Type": "application/json" }, ...init });
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
let rand = rng(20261003);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
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

/* ── One demo trade ──────────────────────────────────────────────────── */

/** How each grade plays out: the chance of a win, and the R of a winner. */
const PROFILE: Record<string, { win: number; lo: number; hi: number }> = {
  "A+": { win: 0.5, lo: 1.4, hi: 3.0 },
  A: { win: 0.42, lo: 1.0, hi: 2.4 },
};

interface Draft {
  day: string;
  time: string;
  grade: "A+" | "A";
  direction: Direction;
  balance: number;
  /** Rule breaks to stage, by field. */
  breaks?: { exitReason?: ExitReason; earlyStopMove?: boolean; exitTime?: string; riskPct?: number };
}

/** A setup's answers: the best for A+, one factor short of it for A. */
function answersFor(grade: "A+" | "A", day: string, direction: Direction, doc: RulebookVersion["doc"]) {
  const compass = compassFor(doc, day, direction) ?? 65;
  const a: Record<string, string | number> = {
    "htf-tf": "htf-4h-plus",
    disp: 1.3,
    fvg: "fvg-yes",
    bias: BIAS_OPTION.matches,
    compass,
    conviction: "conv-none",
  };
  if (grade === "A") {
    // One factor short of A+ — among the factors this rulebook still has.
    const has = new Set(doc.factors.map((f) => f.id));
    const short = pick(["htf", "disp", "fvg", "conviction"].filter((id) => has.has(id === "htf" ? "htf-tf" : id)));
    if (short === "htf") a["htf-tf"] = "htf-1h";
    if (short === "disp") a.disp = round(between(0.3, 0.95));
    if (short === "fvg") a.fvg = "fvg-no";
    if (short === "conviction") a.conviction = "conv-lacking";
  }
  return a;
}

/**
 * The HTF reasons behind a setup, agreeing with its timeframe answer: the highest one is
 * 1H for a "1H" answer, 4H or above otherwise — sometimes with a lower one beside it.
 */
function htfFor(answers: Record<string, string | number>): Pick<TradeInput, "htfReasons" | "htfReasonType"> {
  const types = ["FVG", "FVG", "OB", "VIMB"] as const;
  const top = { type: pick([...types]), tf: answers["htf-tf"] === "htf-1h" ? "1H" : pick(["4H", "4H", "D", "W"]) } as HtfReason;
  const lower = HTF_TIMEFRAMES.slice(0, htfRank(top.tf)).map((x) => x.value);
  const reasons: HtfReason[] = [top];
  if (lower.length && chance(0.35)) reasons.push({ type: pick([...types].filter((t) => t !== top.type)), tf: pick(lower) });
  return { htfReasons: reasons, htfReasonType: topHtf(reasons)!.type };
}

function outcomeR(grade: "A+" | "A", profile = PROFILE) {
  const p = profile[grade];
  const r = rand();
  if (r < 0.06) return { r: round(between(-0.05, 0.05)), reason: "breakeven" as ExitReason }; // the stop at entry, hit
  if (r < 0.06 + p.win) {
    const win = round(between(p.lo, p.hi));
    return { r: win, reason: (win >= 1.8 ? "target" : pick(["target", "trail", "time"])) as ExitReason };
  }
  return { r: round(between(-1.02, -0.97)), reason: "stop" as ExitReason };
}

function makeTrade(d: Draft, doc: RulebookVersion["doc"], profile = PROFILE): TradeInput {
  const { day, time, grade, direction } = d;
  const answers = answersFor(grade, day, direction, doc);
  const ticked = doc.baseRules.map((r) => r.id);
  const result = computeGrade(doc, { ticked, answers });
  const risk = doc.grades.find((g) => g.grade === result.grade)?.riskPct || doc.limits.maxRiskPct;
  const { r, reason } = outcomeR(grade, profile);

  // What 2.0 logs, no prices: the box and the sweep in $, the R:R, and the excursions in R.
  const boxSize = round(between(4, 16));
  const depth = round(between(1.5, 26));
  // A target exit made exactly its planned R:R; the rest planned something in the rulebook's range.
  const plannedRR = reason === "target" && r > 0 ? round(r) : round(between(1.3, 3.2));
  const riskUsd = round((d.balance * risk) / 100);
  const pnl = round((r * risk * d.balance) / 100);
  const mfeR = Math.max(r, 0) + round(between(0.05, 0.9));
  const maeR = r < 0 ? 1 : round(between(0.05, 0.8));
  const [h, m] = time.split(":").map(Number);
  const exitMin = Math.min(h * 60 + m + Math.floor(between(20, 170)), 11 * 60 + 55);

  return {
    ...EMPTY_RULEBOOK_FIELDS,
    date: `${day}T${time}`,
    symbol: doc.instrument,
    direction,
    session: sessionAt(time) ?? "London",
    setup: "",
    htf: "",
    entryModel: "",
    riskPct: risk,
    plannedRiskPct: risk,
    plannedRR,
    resultR: null,
    followedPlan: true,
    grade: result.grade,
    emotion: pick([1, 2, 2, 2, 3, 3, 4]),
    mistakes: [],
    checklist: ticked,
    checklistTotal: ticked.length,
    setupSnapshot: {
      rulebookVersion: doc.version,
      baseRules: doc.baseRules,
      factors: doc.factors,
      grades: doc.grades,
      ticked,
      answers,
      grade: result.grade,
    },
    flags: [],
    flagNote: "",
    skipped: false,
    hypotheticalR: null,
    costPct: null,
    boxSize,
    pnlUsd: pnl,
    news: [],
    notes: `${TAG} ${result.grade} setup`,
    screenshot: "",
    rulebookVersion: doc.version,
    sweepDepth: depth,
    took15mSwing: chance(0.55),
    ...htfFor(answers),
    poiTests: pick(["fresh", "fresh", "once", "2+"]),
    levelSweep: chance(0.2),
    deskAgreed: pick(["yes", "yes", "yes", "no"]),
    entryType: "",
    riskUsd,
    exitTime: `${day}T${pad(Math.floor(exitMin / 60))}:${pad(exitMin % 60)}`,
    exitReason: reason,
    earlyStopMove: false,
    releaseAtBe: null,
    mfeR: round(mfeR),
    maeR: round(maeR),
    targetBeforeStop: "",
    screenshotAfter: "",
  };
}

/* ── Check-ins ───────────────────────────────────────────────────────── */

async function writeCheckins(days: string[], fineChance: number) {
  const existing = new Set((await api<{ date: string }[]>("/checkins")).map((c) => c.date));
  for (const day of days) {
    if (existing.has(day)) continue;
    const a: Record<string, number> = {};
    for (const q of QUESTIONS) {
      const fine = q.options.map((o, i) => ({ o, i })).filter(({ o }) => o.risk === 0).map(({ i }) => i);
      a[q.id] = chance(fineChance) && fine.length ? pick(fine) : Math.floor(rand() * q.options.length);
    }
    const { score, verdict } = evaluate(a);
    await api(`/checkins/${day}`, { method: "PUT", body: JSON.stringify({ answers: a, note: TAG, score, verdict, reflection: "" }) });
  }
}

/** A copy of the database before a big write — the same kind the app's own migrations leave. */
async function snapshot(label: string) {
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
  const file = path.join(here, "..", "data", `snapshot-before-${label}-${stamp}.db`);
  const db = new Database(DB_PATH, { readonly: true });
  await db.backup(file);
  db.close();
  return file;
}

/**
 * Posts a trade the way a disciplined trader would take it: the server judges it
 * against the history and the check-in; a trade the rules would not allow
 * at all is withdrawn, and one sized above what is allowed (a half-risk week) is
 * resized. Staged rule breaks are posted as they are. Returns the $ result kept.
 */
async function postDisciplined(input: TradeInput, staged: boolean): Promise<number> {
  const saved = await api<Trade>("/trades", { method: "POST", body: JSON.stringify(input) });
  if (staged || !saved.flags.length) return input.pnlUsd ?? 0;
  const allowed = saved.plannedRiskPct ?? 0;
  const onlySize = saved.flags.every((f) => f === "during_day_off" || f === "over_risk");
  if (allowed > 0 && onlySize && input.riskPct > allowed) {
    const k = allowed / input.riskPct;
    const resized: TradeInput = {
      ...input,
      riskPct: allowed,
      plannedRiskPct: allowed,
      pnlUsd: round((input.pnlUsd ?? 0) * k),
      riskUsd: input.riskUsd != null ? round(input.riskUsd * k) : null,
      lots: input.lots != null ? Math.floor(input.lots * k * 100) / 100 : null,
    };
    const again = await api<Trade>(`/trades/${saved.id}`, { method: "PUT", body: JSON.stringify(resized) });
    if (!again.flags.length) return resized.pnlUsd ?? 0;
  }
  await api(`/trades/${saved.id}`, { method: "DELETE" });
  return 0;
}

/** A setup that grades A+ or A on this day, or null — Monday shorts cap at B on the Compass alone. */
function tradableSetup(
  day: string,
  time: string,
  balance: number,
  doc: RulebookVersion["doc"],
  profile = PROFILE,
  grade?: "A+" | "A",
) {
  for (const direction of (chance(0.55) ? ["long", "short"] : ["short", "long"]) as Direction[]) {
    const input = makeTrade({ day, time, grade: grade ?? (chance(0.38) ? "A+" : "A"), direction, balance }, doc, profile);
    if (input.grade === "A+" || input.grade === "A") return input;
  }
  return null;
}

async function guard() {
  const trades = await api<Trade[]>("/trades");
  if (trades.some((t) => t.notes.startsWith(TAG))) {
    console.log("Demo trades are already in — run `npm run demo:remove` first to start over.");
    return null;
  }
  return api<RulebookVersion>("/rulebook");
}

/** A setup entered outside the window: its window rule unticked when you tick it yourself. */
function outsideWindow(t: TradeInput, doc: RulebookVersion["doc"]): TradeInput {
  if (doc.baseRules.some((r) => r.auto === "entry-window") || !t.setupSnapshot) return t;
  const ticked = t.checklist.filter((id) => id !== "window");
  const { grade } = computeGrade(doc, { ticked, answers: t.setupSnapshot.answers });
  return { ...t, checklist: ticked, grade: grade ?? "", setupSnapshot: { ...t.setupSnapshot, ticked, grade } };
}

/** An entry time inside the morning window, mostly London. */
const morning = () => `0${pick([4, 4, 5, 5, 6, 7])}:${pad(Math.floor(between(2, 58)))}`;

/* ── demo:add ────────────────────────────────────────────────────────── */

async function add() {
  const current = await guard();
  if (!current) return;
  const doc = current.doc;
  console.log(`Backed up the database to ${path.basename(await snapshot("demo-add"))}`);

  // Since 2.0 every staged break costs two trading days, so the history runs a little longer.
  const days = weekdays(64);

  let balance = doc.limits.openingBalance;
  const before = (await api<Trade[]>("/trades")).length;

  /*
   * Staged rule breaks, a handful over nine weeks — for the Coach and the consequences.
   * Never on a Monday: under this rulebook no Monday setup is tradable (the Compass caps
   * both directions at B), so a staged Monday would simply be passed on.
   */
  const notMonday = (i: number) => {
    while (i < days.length && new Date(`${days[i]}T12:00:00Z`).getUTCDay() === 1) i++;
    return i;
  };
  const [discretionary, windowBreak, overRisk, earlyMove, secondTrade, timeStop] = [9, 14, 18, 24, 30, 36].map(notMonday);
  const stagedDays = new Set([discretionary, windowBreak, overRisk, earlyMove, secondTrade, timeStop]);
  // Check-ins first, so the trader can respect what each morning allowed.
  await writeCheckins(days, 0.88);

  for (const [i, day] of days.entries()) {
    // Most days one setup; some days none.
    if (chance(0.15) && !stagedDays.has(i)) continue;
    const breaks =
      i === discretionary
        ? { exitReason: "other" as ExitReason }
        : i === earlyMove
          ? { earlyStopMove: true }
          : i === timeStop
            ? { exitTime: `${day}T12:25` }
            : i === overRisk
              ? { riskPct: 0.75 }
              : undefined;
    const time = i === windowBreak ? "08:40" : morning(); // one entry in the 08:25–09:30 pause
    // Staged days take an A+, which even a Caution morning allows — so the break is the only flag.
    const staged = stagedDays.has(i);
    const found = tradableSetup(day, time, balance, doc, PROFILE, staged ? "A+" : undefined);
    if (!found) continue;
    // With the window ticked by hand, an entry in the pause leaves that rule unticked: a C.
    const setup = i === windowBreak ? outsideWindow(found, doc) : found;
    const input = breaks ? { ...setup, ...breakFields(breaks, day), followedPlan: false } : setup;
    balance += await postDisciplined(input, staged);
    // Once: a second trade the same day — the one-trade rule, and two days off after it.
    if (i === secondTrade) {
      const second = tradableSetup(day, `${pick(["09", "10"])}:${pad(Math.floor(between(31, 58)))}`, balance, doc, PROFILE, "A+");
      if (second) balance += await postDisciplined({ ...second, followedPlan: false }, true);
    }
  }
  await exitStories(doc);
  const n = (await api<Trade[]>("/trades")).length - before;
  console.log(`Added ${n} demo trades over ${days.length} trading days on rulebook v${doc.version}, with check-ins.`);
}

/* ── Two Exit-lab stories ────────────────────────────────────────────── */

/**
 * Two hand-made trades whose MFE tells a story the Exit lab can show — dated on the
 * two weekdays before the first demo trade, so nothing after them changes day:
 *  - an A+ long stopped out for −1R after running +1.4R first: breakeven at 1R would
 *    have saved it;
 *  - an A short that hit its 2.1R target while price ran on to 3.6R: a bigger target
 *    would have paid.
 * Together with the regular demo they also bring the MFE count up past the Exit lab's
 * minimum, so its table opens.
 */
async function exitStories(doc: RulebookVersion["doc"]) {
  const trades = await api<Trade[]>("/trades");
  if (trades.some((t) => t.notes.startsWith(`${TAG} exit story`))) {
    console.log("The two Exit-lab stories are already in.");
    return 0;
  }
  const first = trades.filter((t) => t.notes.startsWith(TAG)).map((t) => t.date.slice(0, 10)).sort()[0] ?? LAST_DAY;
  // The two weekdays before the first demo day, skipping Mondays (no setup is tradable then).
  const days: string[] = [];
  for (const d = new Date(`${first}T12:00:00Z`); days.length < 2; ) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && wd !== 1) days.unshift(d.toISOString().slice(0, 10));
  }
  // A clean morning on both days, so each A+ and A is tradable.
  await writeCheckins(days, 1);

  const balance = doc.limits.openingBalance;
  const story = (day: string, time: string, direction: Direction, grade: "A+" | "A") => {
    for (let tries = 0; tries < 50; tries++) {
      const t = makeTrade({ day, time, grade, direction, balance }, doc);
      if (t.grade === grade) return t;
    }
    throw new Error(`No ${grade} ${direction} setup on ${day}`);
  };

  // 1. Ran +1.4R, came all the way back, stopped out.
  const a = story(days[0], "05:12", "long", "A+");
  const lossA: TradeInput = {
    ...a,
    exitReason: "stop",
    exitTime: `${days[0]}T08:47`,
    pnlUsd: round((-1 * a.riskPct * balance) / 100),
    mfeR: 1.4,
    maeR: 1,
    plannedRR: 2.4,
    notes: `${TAG} exit story · ran +1.4R before the stop — breakeven at 1R would have saved it`,
  };

  // 2. Hit the target at 2.1R; price kept going to 3.6R.
  const b = story(days[1], "04:38", "short", "A");
  const winB: TradeInput = {
    ...b,
    plannedRR: 2.1,
    exitReason: "target",
    exitTime: `${days[1]}T07:16`,
    pnlUsd: round((2.1 * b.riskPct * balance) / 100),
    mfeR: 2.1,
    maeR: 0.3,
    maxFavR: 3.6,
    notes: `${TAG} exit story · target at 2.1R, price ran on to 3.6R`,
  };

  let n = 0;
  for (const t of [lossA, winB]) {
    const saved = await api<Trade>("/trades", { method: "POST", body: JSON.stringify(t) });
    console.log(`  ${saved.date} ${saved.direction} ${saved.grade} → ${saved.resultR?.toFixed(2)}R${saved.flags.length ? ` · flags: ${saved.flags.join(", ")}` : ""}`);
    n++;
  }
  return n;
}

async function more() {
  const current = await api<RulebookVersion>("/rulebook");
  console.log(`Backed up the database to ${path.basename(await snapshot("demo-more"))}`);
  const n = await exitStories(current.doc);
  if (n) console.log(`Added ${n} Exit-lab demo trades on rulebook v${current.doc.version}.`);
}

/** The fields a staged break changes on an otherwise ordinary trade. */
function breakFields(b: NonNullable<Draft["breaks"]>, day: string): Partial<TradeInput> {
  return {
    ...(b.exitReason ? { exitReason: b.exitReason, mistakes: ["Early exit"] } : {}),
    ...(b.earlyStopMove ? { earlyStopMove: true, mistakes: ["Moved stop"] } : {}),
    ...(b.exitTime ? { exitTime: b.exitTime } : {}),
    ...(b.riskPct ? { riskPct: b.riskPct, plannedRiskPct: b.riskPct, mistakes: ["Oversized"] } : {}),
    flagNote: pick(["felt sure about it", "wanted to make back yesterday", "the move looked done"]),
    notes: `${TAG} staged rule break · ${day}`,
  };
}

/* ── demo:fill ───────────────────────────────────────────────────────── */

/**
 * `count` trades from a disciplined, profitable trader: one trade a day at most,
 * no rule broken — about a 45% win rate with winners near 1.8R.
 */
const PROFITABLE: Record<string, { win: number; lo: number; hi: number }> = {
  "A+": { win: 0.48, lo: 1.4, hi: 2.9 },
  A: { win: 0.44, lo: 1.1, hi: 2.3 },
};

async function fill(count: number, seed?: number) {
  if (seed) rand = rng(seed);
  const current = await guard();
  if (!current) return;
  const doc = current.doc;
  console.log(`Backed up the database to ${path.basename(await snapshot("demo-fill"))}`);

  // Enough weekdays for `count` trades at ~85% of days.
  const days = weekdays(Math.ceil(count / 0.8) + 5);
  await writeCheckins(days, 0.92);
  let balance = doc.limits.openingBalance;
  let n = 0;
  for (const day of days) {
    if (n >= count) break;
    if (chance(0.15)) continue; // no setup that day
    const setup = tradableSetup(day, morning(), balance, doc, PROFITABLE);
    if (!setup) continue;
    const kept = await postDisciplined(setup, false);
    if (kept === 0 && setup.pnlUsd !== 0) continue; // withdrawn: the rules would not have allowed it
    balance += kept;
    n++;
    if (n % 100 === 0) console.log(`  ${n} trades…`);
  }
  console.log(
    `Added ${n} demo trades up to ${LAST_DAY}. ` +
      `Balance $${Math.round(doc.limits.openingBalance).toLocaleString()} → $${Math.round(balance).toLocaleString()}.`,
  );
}

/* ── demo:bias ───────────────────────────────────────────────────────── */

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
    return candles.at(-1)?.c ?? null;
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
    "This is a demo briefing written by `npm run demo:bias`. The analysts are invented; nothing here is a real view.",
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
  // Check-ins (and plans from older demo runs) have no delete route; remove only the tagged ones, straight from the file.
  const db = new Database(DB_PATH);
  const checkins = db.prepare("DELETE FROM checkins WHERE note = ?").run(TAG).changes;
  const plans = db.prepare("DELETE FROM plans WHERE notes = ?").run(TAG).changes;
  db.close();
  // Through the API, so the balance and every later trade's % and flags are recalculated.
  for (const t of demo) await api(`/trades/${t.id}`, { method: "DELETE" });
  console.log(`Removed ${demo.length} demo trades, ${checkins} demo check-ins and ${plans} demo plans.`);

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
const run =
  mode === "remove"
    ? remove()
    : mode === "add"
      ? add()
      : mode === "more"
        ? more()
      : mode === "fill"
        ? fill(Number(process.argv[3]) || 300, Number(process.argv[4]) || undefined)
      : mode === "bias"
        ? bias()
      : mode === "all"
        ? add().then(bias)
        : Promise.reject(new Error("Use: add | more | fill [count] [seed] | bias | all | remove"));
run.catch((e) => {
  console.error(e.message);
  process.exit(1);
});
