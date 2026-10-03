/**
 * Insights — finds the connections between everything you log and your results.
 *
 * Every field (and a few derived ones, like "right after a loss") becomes a
 * factor. For each factor we compare trades WITH it against trades WITHOUT it,
 * then keep only differences that are big enough and backed by enough trades.
 */
import { QUESTIONS, VERDICTS, type CheckIn } from "./checkin";
import { dayKey } from "./format";
import { answerLabel, rangeIndex, rangeLabel, withUnit } from "./grading";
import { fromTradeNews, newsDay } from "./newsRules";
import type { Rulebook } from "./rulebook";
import { WEEKDAYS, classifyOutcome, isClosed, tradePct } from "./stats";
import {
  EMOTIONS,
  FLAG_LABEL,
  POI_TESTS,
  htfTfLabel,
  topHtf,
  exitReasonLabel,
  type Trade,
} from "./types";

/* ── Small stats helpers ─────────────────────────────────────────────── */

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
};

/** Minimum trades on each side of a comparison. */
export const MIN_GROUP = 4;
/** Shrinkage strength: a group of k trades counts half. Protects against lucky small samples. */
export const SHRINK_K = 5;

/** A difference in R, shrunk toward zero by how few trades stand behind it. */
export const shrunk = (diff: number, n: number) => diff * (n / (n + SHRINK_K));
/** Differences smaller than this (in R, after shrinkage) are treated as noise. */
const MIN_EFFECT = 0.15;

export type Confidence = "strong" | "likely" | "early";

export interface Insight {
  key: string; // unique id: dimension + value
  dimension: string;
  label: string; // human sentence fragment, e.g. "Entry: IFVG"
  n: number;
  avgR: number;
  restAvgR: number;
  diff: number; // raw difference in R per trade
  effect: number; // diff after shrinkage — used for ranking
  winRate: number | null;
  netPct: number;
  confidence: Confidence;
}

/* ── Context for each trade ──────────────────────────────────────────── */

export interface TradeContext {
  trade: Trade;
  prev: Trade | null; // previous closed trade (any day)
  indexInDay: number; // 0 = first trade of the day
  daysSincePrev: number | null;
  checkin: CheckIn | undefined;
  /** Where this trade's box sat in your own size distribution. */
  boxBucket: string | null;
}

const dateOf = (t: Trade) => t.date.slice(0, 10);
const days = (a: string, b: string) =>
  Math.round((new Date(`${a}T00:00`).getTime() - new Date(`${b}T00:00`).getTime()) / 86_400_000);

export function contexts(trades: Trade[], checkins: CheckIn[]): TradeContext[] {
  // Skipped setups were never traded: they have no result to learn from here.
  const closed = trades.filter((t) => isClosed(t) && !t.skipped).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(checkins.map((c) => [c.date, c]));
  const boxes = closed.map((t) => t.boxSize).filter((b): b is number => b != null).sort((a, b) => a - b);

  return closed.map((t, i) => {
    const prev = i > 0 ? closed[i - 1] : null;
    return {
      trade: t,
      prev,
      indexInDay: closed.slice(0, i).filter((x) => dateOf(x) === dateOf(t)).length,
      daysSincePrev: prev ? days(dateOf(t), dateOf(prev)) : null,
      checkin: byDate.get(dateOf(t)),
      boxBucket: boxBucketOf(t.boxSize, boxes, "$"),
    };
  });
}

/** A trade that broke a rule (the desk flagged it) or carried a mistake you tagged. */
export const brokeRules = (t: Trade) => t.mistakes.length > 0 || t.flags.length > 0;

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function hourBucket(t: Trade) {
  const h = Number(t.date.slice(11, 13));
  if (Number.isNaN(h)) return null;
  const from = h - (h % 2);
  return `${String(from).padStart(2, "0")}:00–${String(from + 2).padStart(2, "0")}:00`;
}

/**
 * Splits a box into the smallest, middle and largest third of what you have logged.
 * Relative rather than absolute, so it needs no configuration — but it stays silent
 * until there are enough boxes for thirds to mean anything.
 */
function boxBucketOf(size: number | null, sorted: number[] | undefined, unit: string) {
  if (size == null || !sorted || sorted.length < 6) return null;
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const lo = at(1 / 3);
  const hi = at(2 / 3);
  if (lo >= hi) return null;
  // The threshold goes in the name so advice arrives with a number attached.
  if (size <= lo) return `${unit}${lo} or less`;
  if (size >= hi) return `${unit}${hi} or more`;
  return `${unit}${lo}–${hi}`;
}

function rrBucket(rr: number | null) {
  if (rr == null) return null;
  if (rr < 1.5) return "under 1.5R";
  if (rr < 2.5) return "1.5–2.5R";
  return "2.5R or more";
}

/** Sweep depth against the Compass reference: under $11, $11–18, $18–30, over $30. */
export function depthBucket(depth: number | null, doc?: Pick<Rulebook, "sweep">): string | null {
  if (depth == null) return null;
  const s = doc?.sweep ?? { p70: 11, p85: 18, p95: 30 };
  if (depth < s.p70) return `under $${s.p70}`;
  if (depth < s.p85) return `$${s.p70}–${s.p85}`;
  if (depth <= s.p95) return `$${s.p85}–${s.p95}`;
  return `over $${s.p95}`;
}

/** Every factor a trade has, as [dimension, value, human label]. */
function factorsOf(c: TradeContext, doc?: Rulebook): [string, string, string][] {
  const t = c.trade;
  const f: [string, string, string][] = [];
  const add = (dim: string, value: string | null | undefined, label?: string) => {
    if (value) f.push([dim, value, label ?? `${dim}: ${value}`]);
  };

  add("Session", t.session);
  if (c.boxBucket) add("Box size", c.boxBucket, `Box of ${c.boxBucket}`);

  /* The rulebook's journal fields. */
  const htf = topHtf(t.htfReasons);
  if (htf) add("HTF timeframe", htf.tf, `A ${htfTfLabel(htf.tf)} HTF reason`);
  if (t.exitReason) add("Exit reason", t.exitReason, `Exit: ${exitReasonLabel(t.exitReason).toLowerCase()}`);
  if (t.took15mSwing != null) add("15m swing", t.took15mSwing ? "yes" : "no", t.took15mSwing ? "Sweep took a 15m swing" : "Sweep took no 15m swing");
  if (t.poiTests) add("POI", t.poiTests, `POI ${POI_TESTS.find((p) => p.value === t.poiTests)?.label.toLowerCase()}`);
  if (t.levelSweep != null) add("Level sweep", t.levelSweep ? "yes" : "no", t.levelSweep ? "Swept an important level" : "No important-level sweep");
  if (t.biasMatch != null) add("Bias vs briefing", t.biasMatch ? "yes" : "no", t.biasMatch ? "Bias matched the briefing" : "Bias differed from the briefing");
  const depth = depthBucket(t.sweepDepth, doc);
  if (depth) add("Sweep depth", depth, `Sweep depth ${depth}`);
  if (doc && t.news.length) {
    const nd = newsDay(t.date.slice(0, 10), t.news.map(fromTradeNews), doc.news);
    add("Release day", nd.windows.length ? "yes" : "no", nd.windows.length ? "A red release that day" : "No red release that day");
  }
  if (t.releaseAtBe != null) add("Held through release", t.releaseAtBe ? "at BE" : "not at BE", t.releaseAtBe ? "Held through a release at breakeven" : "Held through a release, not at breakeven");
  add("Direction", t.direction === "long" ? "Long" : "Short", t.direction === "long" ? "Long trades" : "Short trades");
  const wd = (new Date(t.date).getDay() + 6) % 7;
  add("Weekday", WEEKDAYS[wd], `${DAY_NAMES[wd]}s`);
  add("Time", hourBucket(t), `Entries ${hourBucket(t)}`);
  add("Grade", t.grade, `Grade ${t.grade}`);
  if (t.emotion) add("State of mind", EMOTIONS[t.emotion - 1], `Feeling ${EMOTIONS[t.emotion - 1].toLowerCase()} in the trade`);
  add("Planned R:R", rrBucket(t.plannedRR), `Planned R:R ${rrBucket(t.plannedRR)}`);

  for (const m of t.mistakes) add("Mistake", m, `Mistake: ${m}`);

  /*
   * The grade factors, read from the trade's frozen snapshot — so any factor, in any
   * version of the rulebook, is compared without this file knowing its name.
   */
  const snap = t.setupSnapshot;
  if (snap) {
    for (const factor of snap.factors) {
      const a = snap.answers[factor.id];
      if (a === undefined) continue;
      const value =
        factor.kind === "number" && typeof a === "number"
          ? withUnit(rangeLabel(factor, rangeIndex(factor, a)), factor.unit)
          : answerLabel(factor, a);
      if (value) add(factor.name, value, `${factor.name}: ${value}`);
    }
  }
  for (const flag of t.flags) add("Flag", flag, FLAG_LABEL[flag]);

  // Sequence & behaviour.
  if (c.prev) {
    const o = classifyOutcome(c.prev.resultR);
    add("Previous trade", o, o === "win" ? "Right after a win" : o === "loss" ? "Right after a loss" : "Right after a breakeven");
    if (brokeRules(c.prev)) add("Previous trade", "rule-break", "Right after a rule break");
  }
  if (c.indexInDay >= 1) add("Trade of day", "2nd+", "2nd+ trade of the day");
  if (c.daysSincePrev != null && c.daysSincePrev >= 5) add("Break", "5+ days", "First trade after 5+ days off");
  // Risk varies by grade on purpose; what is worth knowing is risk above what was allowed.
  if (t.plannedRiskPct != null && t.riskPct > t.plannedRiskPct + 1e-9) {
    add("Risk", "above-plan", "Risked more than the grade allowed");
  }

  // Check-in of that day.
  if (c.checkin) {
    add("Readiness", c.checkin.verdict, `Check-in: ${VERDICTS[c.checkin.verdict].label.toLowerCase()}`);
    for (const q of QUESTIONS) {
      const a = c.checkin.answers[q.id];
      if (a == null || !q.options[a]) continue;
      add(q.short, q.options[a].label, `${q.short}: ${q.options[a].label.toLowerCase()}`);
    }
  }
  return f;
}

/* ── Factor ranking ──────────────────────────────────────────────────── */

export function findInsights(trades: Trade[], checkins: CheckIn[], doc?: Rulebook): Insight[] {
  const ctx = contexts(trades, checkins);
  if (ctx.length < MIN_GROUP * 2) return [];

  const groups = new Map<string, { dim: string; value: string; label: string; idx: Set<number> }>();
  ctx.forEach((c, i) => {
    for (const [dim, value, label] of factorsOf(c, doc)) {
      const key = `${dim}::${value}`;
      if (!groups.has(key)) groups.set(key, { dim, value, label, idx: new Set() });
      groups.get(key)!.idx.add(i);
    }
  });

  const out: Insight[] = [];
  // "Mistake: Oversized" and "Risked more than allowed" can be the very same trades —
  // the same fact said twice. Keep the first group for each exact set of trades.
  const seenSets = new Set<string>();
  for (const [key, g] of groups) {
    const set = [...g.idx].sort((a, b) => a - b).join(",");
    if (seenSets.has(set)) continue;
    seenSets.add(set);
    const inside = ctx.filter((_, i) => g.idx.has(i)).map((c) => c.trade);
    const outside = ctx.filter((_, i) => !g.idx.has(i)).map((c) => c.trade);
    if (inside.length < MIN_GROUP || outside.length < MIN_GROUP) continue;

    const a = inside.map((t) => t.resultR!);
    const b = outside.map((t) => t.resultR!);
    const diff = mean(a) - mean(b);
    const se = Math.sqrt(variance(a) / a.length + variance(b) / b.length) || 1e-9;
    const tStat = Math.abs(diff / se);
    const effect = shrunk(diff, inside.length);
    if (Math.abs(effect) < MIN_EFFECT) continue;

    const outcomes = inside.map((t) => classifyOutcome(t.resultR));
    const wins = outcomes.filter((o) => o === "win").length;
    const decided = wins + outcomes.filter((o) => o === "loss").length;

    out.push({
      key,
      dimension: g.dim,
      label: g.label,
      n: inside.length,
      avgR: mean(a),
      restAvgR: mean(b),
      diff,
      effect,
      winRate: decided ? wins / decided : null,
      netPct: inside.reduce((s, t) => s + tradePct(t), 0),
      /*
       * Around thirty factors are tested against each other, so a few will clear
       * any t-threshold on noise alone. A sample floor is the cheap guard: four
       * trades can never be "likely", however extreme their average looks.
       */
      confidence:
        tStat >= 2 && inside.length >= 8
          ? "strong"
          : tStat >= 1.3 && inside.length >= 6
            ? "likely"
            : "early",
    });
  }
  // A field with only two values (Long/Short, London/New York…) gives the same fact twice,
  // once as an edge and once as a leak. Keep only the positive side.
  const valuesPerDim = new Map<string, number>();
  for (const g of groups.values()) valuesPerDim.set(g.dim, (valuesPerDim.get(g.dim) ?? 0) + 1);
  const deduped = out.filter(
    (i) => !(valuesPerDim.get(i.dimension) === 2 && i.effect < 0 && out.some((o) => o.dimension === i.dimension && o.effect > 0)),
  );

  return deduped.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
}

/*
 * Things the desk will never tell you to do more of, whatever their numbers: a mistake
 * can look profitable only by accident of how it's logged ("Early exit" is only ever
 * tagged on a trade that was already winning), and a broken rule stays broken even
 * when it paid.
 */
const NEVER_AN_EDGE_DIMS = new Set(["Mistake", "Flag", "Risk", "Checklist"]);
const NEVER_AN_EDGE_KEYS = new Set(["Plan::broken", "Previous trade::rule-break"]);
export const isRuleBreak = (i: Pick<Insight, "dimension" | "key">) =>
  NEVER_AN_EDGE_DIMS.has(i.dimension) || NEVER_AN_EDGE_KEYS.has(i.key);

/** Better than the rest, actually profitable — being "less bad" is not an edge — and never a rule break. */
export const edges = (xs: Insight[]) =>
  xs.filter((i) => i.effect > 0 && i.avgR > 0 && !isRuleBreak(i)).sort((a, b) => b.effect - a.effect);
export const leaks = (xs: Insight[]) => xs.filter((i) => i.effect < 0).sort((a, b) => a.effect - b.effect);

/** Leaks solid enough to act on today, rather than every negative wobble. */
export const firmLeaks = (xs: Insight[]) => leaks(xs).filter((i) => i.confidence !== "early");

/* ── Behaviour patterns ──────────────────────────────────────────────── */

export interface Slice {
  n: number;
  avgR: number;
  ruleBreakRate: number;
  avgRisk: number;
}

const slice = (ts: Trade[]): Slice => ({
  n: ts.length,
  avgR: mean(ts.map((t) => t.resultR!)),
  ruleBreakRate: ts.length ? ts.filter(brokeRules).length / ts.length : 0,
  avgRisk: mean(ts.map((t) => t.riskPct)),
});

export interface Behaviour {
  all: Slice;
  afterWin: Slice;
  afterLoss: Slice;
  afterWinStreak: Slice; // trade right after 3+ wins in a row
  afterLossStreak: Slice; // trade right after 2+ losses in a row
  /** Of winning trades with a planned R:R: share of the planned target actually taken. */
  capture: { n: number; ratio: number; hitRate: number } | null;
  grades: { grade: string; n: number; avgR: number }[];
  gradeCalibrated: boolean | null;
  discipline: { recent: number; before: number; nRecent: number; nBefore: number } | null;
}

export function behaviour(trades: Trade[], checkins: CheckIn[]): Behaviour {
  const ctx = contexts(trades, checkins);
  const ts = ctx.map((c) => c.trade);
  const outcomes = ts.map((t) => classifyOutcome(t.resultR));


  const afterWin: Trade[] = [];
  const afterLoss: Trade[] = [];
  const afterWinStreak: Trade[] = [];
  const afterLossStreak: Trade[] = [];
  let run: { o: string; n: number } = { o: "", n: 0 };
  for (let i = 0; i < ts.length; i++) {
    if (i > 0) {
      if (outcomes[i - 1] === "win") afterWin.push(ts[i]);
      if (outcomes[i - 1] === "loss") afterLoss.push(ts[i]);
      if (run.o === "win" && run.n >= 3) afterWinStreak.push(ts[i]);
      if (run.o === "loss" && run.n >= 2) afterLossStreak.push(ts[i]);
    }
    const o = outcomes[i];
    if (o === "win" || o === "loss") run = run.o === o ? { o, n: run.n + 1 } : { o, n: 1 };
  }

  const winners = ts.filter((t, i) => outcomes[i] === "win" && t.plannedRR && t.plannedRR > 0);
  const capture = winners.length
    ? {
        n: winners.length,
        ratio: mean(winners.map((t) => Math.min(t.resultR! / t.plannedRR!, 1.5))),
        hitRate: winners.filter((t) => t.resultR! >= t.plannedRR! * 0.9).length / winners.length,
      }
    : null;

  const grades = ["A+", "A", "B", "C"]
    .map((g) => {
      const g_ = ts.filter((t) => t.grade === g);
      return { grade: g, n: g_.length, avgR: mean(g_.map((t) => t.resultR!)) };
    })
    .filter((g) => g.n >= 3);
  const gradeCalibrated =
    grades.length >= 2 ? grades[0].avgR >= grades[grades.length - 1].avgR : null;

  const recent = ts.slice(-10);
  const before = ts.slice(0, -10);
  const discipline =
    recent.length >= 5 && before.length >= 5
      ? {
          recent: recent.filter(brokeRules).length / recent.length,
          before: before.filter(brokeRules).length / before.length,
          nRecent: recent.length,
          nBefore: before.length,
        }
      : null;

  return {
    all: slice(ts),
    afterWin: slice(afterWin),
    afterLoss: slice(afterLoss),
    afterWinStreak: slice(afterWinStreak),
    afterLossStreak: slice(afterLossStreak),
    capture,
    grades,
    gradeCalibrated,
    discipline,
  };
}

/** Factors that already apply today, before the trade (weekday, check-in, last trade…). */
export function todaysFactors(trades: Trade[], checkins: CheckIn[], now: Date): Set<string> {
  const keys = new Set<string>();
  // The desk's day is New York's, like every date a trade carries.
  const today = dayKey(now);
  keys.add(`Weekday::${WEEKDAYS[(new Date(`${today}T12:00`).getDay() + 6) % 7]}`);

  const closed = trades.filter((t) => isClosed(t) && !t.skipped).sort((a, b) => a.date.localeCompare(b.date));
  const last = closed[closed.length - 1];
  if (last) {
    keys.add(`Previous trade::${classifyOutcome(last.resultR)}`);
    if (brokeRules(last)) keys.add("Previous trade::rule-break");
    if (days(today, dateOf(last)) >= 5) keys.add("Break::5+ days");
  }
  if (closed.some((t) => dateOf(t) === today)) keys.add("Trade of day::2nd+");

  const c = checkins.find((x) => x.date === today);
  if (c) {
    keys.add(`Readiness::${c.verdict}`);
    for (const q of QUESTIONS) {
      const a = c.answers[q.id];
      if (a != null && q.options[a]) keys.add(`${q.short}::${q.options[a].label}`);
    }
  }
  return keys;
}
