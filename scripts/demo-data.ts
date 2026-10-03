/**
 * Demo history for trying out the Rulebook, the Coach, the Risk lab and Compare.
 *
 *   npm run demo:add      adds ~9 weeks of GOLD Model trades and check-ins, with a
 *                         few rule breaks for the Coach and the consequences, and the
 *                         two Exit-lab stories below
 *   npm run demo:more     adds only the two Exit-lab stories, before the demo begins
 *   npm run demo:fill     adds 300 trades from a disciplined, profitable trader
 *                         (`npm run demo:fill -- 500 7` for another count and seed)
 *   npm run demo:remove   removes every one of them again
 *
 * Trades go through the running app's own API, so percentages, R and every flag are
 * worked out exactly as for real ones.
 *
 * Every demo trade's notes start with "[demo]" and every demo check-in's note is
 * "[demo]" — that tag is how `remove` finds them, and nothing without it is ever
 * touched. Days that already have a real check-in are skipped for those. (Older demo
 * runs also wrote daily plans; `remove` still clears those.)
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, evaluate } from "../src/lib/checkin";
import { computeGrade } from "../src/lib/grading";
import type { RulebookVersion } from "../src/lib/rulebook";
import { BIAS_OPTION } from "../src/lib/rulebookText";
import { compassFor, lotSize, sessionAt } from "../src/lib/rules";
import { deskTime } from "../src/lib/tz";
import { EMPTY_RULEBOOK_FIELDS, type Direction, type ExitReason, type Trade, type TradeInput } from "../src/lib/types";

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
    const short = pick(["htf", "disp", "fvg", "conviction"]);
    if (short === "htf") a["htf-tf"] = "htf-1h";
    if (short === "disp") a.disp = round(between(0.3, 0.95));
    if (short === "fvg") a.fvg = "fvg-no";
    if (short === "conviction") a.conviction = "conv-lacking";
  }
  return a;
}

function outcomeR(grade: "A+" | "A", profile = PROFILE) {
  const p = profile[grade];
  const r = rand();
  if (r < 0.06) return { r: round(between(-0.05, 0.1)), reason: "trail" as ExitReason }; // trailed out at breakeven
  if (r < 0.06 + p.win) {
    const win = round(between(p.lo, p.hi));
    return { r: win, reason: (win >= 1.8 ? "target" : pick(["target", "trail", "time"])) as ExitReason };
  }
  return { r: round(between(-1.02, -0.97)), reason: "stop" as ExitReason };
}

function makeTrade(d: Draft, doc: RulebookVersion["doc"], profile = PROFILE): TradeInput {
  const { day, time, grade, direction } = d;
  const sign = direction === "long" ? 1 : -1;
  const answers = answersFor(grade, day, direction, doc);
  const ticked = doc.baseRules.map((r) => r.id);
  const result = computeGrade(doc, { ticked, answers });
  const risk = doc.grades.find((g) => g.grade === result.grade)?.riskPct || doc.limits.maxRiskPct;
  const { r, reason } = outcomeR(grade, profile);

  // A believable price picture around a 2,650 gold, the box an hour wide.
  const boxLow = round(between(2580, 2720));
  const boxHigh = round(boxLow + between(4, 16));
  const depth = round(between(1.5, 26));
  const sweepExtreme = direction === "long" ? round(boxLow - depth) : round(boxHigh + depth);
  const stopDist = round(between(2.5, 7));
  const entry = round(sweepExtreme + sign * (stopDist + between(0.2, 1.5)));
  const stop = round(entry - sign * stopDist);
  const target = direction === "long" ? boxHigh : boxLow;
  const plannedRR = round(Math.abs(target - entry) / stopDist);
  const atr = round(between(1, 2.4));
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
    boxSize: round(boxHigh - boxLow),
    pnlUsd: pnl,
    news: [],
    notes: `${TAG} ${result.grade} setup`,
    screenshot: "",
    rulebookVersion: doc.version,
    boxHigh,
    boxLow,
    sweepExtreme,
    sweepDepth: depth,
    took15mSwing: chance(0.55),
    htfReasonType: pick(["FVG", "FVG", "OB", "VIMB"]),
    poiTests: pick(["fresh", "fresh", "once", "2+"]),
    levelSweep: chance(0.2),
    deskAgreed: pick(["yes", "yes", "no", "none"]),
    entryType: chance(0.85) ? "market" : "limit",
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    lots: lotSize(riskUsd, entry, stop, doc.ozPerLot),
    riskUsd,
    atr,
    mssBeyond: round(atr * Number(answers.disp)),
    exitTime: `${day}T${pad(Math.floor(exitMin / 60))}:${pad(exitMin % 60)}`,
    exitPrice: round(entry + sign * r * stopDist),
    exitReason: reason,
    earlyStopMove: false,
    releaseAtBe: null,
    mfePrice: round(entry + sign * mfeR * stopDist),
    maePrice: round(entry - sign * maeR * stopDist),
    targetBeforeStop: "",
    maxFavPrice: null,
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

/** An entry time inside the morning window, mostly London. */
const morning = () => `0${pick([4, 4, 5, 5, 6, 7])}:${pad(Math.floor(between(2, 58)))}`;

/* ── demo:add ────────────────────────────────────────────────────────── */

async function add() {
  const current = await guard();
  if (!current) return;
  const doc = current.doc;
  console.log(`Backed up the database to ${path.basename(await snapshot("demo-add"))}`);

  const days = weekdays(45);

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
    const setup = tradableSetup(day, time, balance, doc, PROFILE, staged ? "A+" : undefined);
    if (!setup) continue;
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
  const distA = a.entryPrice! - a.stopPrice!;
  const lossA: TradeInput = {
    ...a,
    exitPrice: a.stopPrice,
    exitReason: "stop",
    exitTime: `${days[0]}T08:47`,
    pnlUsd: round((-1 * a.riskPct * balance) / 100),
    mfePrice: round(a.entryPrice! + 1.4 * distA),
    maePrice: a.stopPrice,
    targetPrice: round(a.entryPrice! + 2.4 * distA),
    plannedRR: 2.4,
    notes: `${TAG} exit story · ran +1.4R before the stop — breakeven at 1R would have saved it`,
  };

  // 2. Hit the target at 2.1R; price kept going to 3.6R.
  const b = story(days[1], "04:38", "short", "A");
  const distB = b.stopPrice! - b.entryPrice!;
  const target = round(b.entryPrice! - 2.1 * distB);
  const winB: TradeInput = {
    ...b,
    targetPrice: target,
    plannedRR: 2.1,
    exitPrice: target,
    exitReason: "target",
    exitTime: `${days[1]}T07:16`,
    pnlUsd: round((2.1 * b.riskPct * balance) / 100),
    mfePrice: target,
    maePrice: round(b.entryPrice! + 0.3 * distB),
    maxFavPrice: round(b.entryPrice! - 3.6 * distB),
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
        : Promise.reject(new Error("Use: add | more | fill [count] [seed] | remove"));
run.catch((e) => {
  console.error(e.message);
  process.exit(1);
});
