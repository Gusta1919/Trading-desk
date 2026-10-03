/**
 * How much a trade may risk.
 *
 * Three of your own limits apply: the most one trade may risk, and the most one New
 * York day and one ISO week may lose. A trade's allowed risk is the smallest of its
 * grade's risk, what is left of the day's and the week's loss budgets, and the
 * per-trade cap — times the consequence multiplier (½ in a half-risk week):
 *
 *   allowed = min(grade risk, day left, week left, max risk per trade) × multiplier
 *
 * A budget is its stop minus the net loss so far, minus the risk still sitting in
 * any open trade — money already at stake is money already spent from the budget.
 * These are notices, never blocks: crossing a line is recorded as a flag on the
 * trade (see discipline.ts), and the saving goes ahead.
 */
import { isClosed, tradePct } from "./stats";
import { weekKey, type Definition, type Grade, type GradeCard, type Limits, type Trade } from "./types";

/** Treats 0.30000000000000004 as 0.3 so a spent budget reads as exactly spent. */
const EPS = 1e-9;
const tidy = (x: number) => (Math.abs(x) < EPS ? 0 : Number(x.toFixed(6)));

export interface DayBudget {
  /** Today's net loss, positive; 0 on a flat or green day. */
  lossToday: number;
  /** Risk still at stake in today's open trades. */
  openRisk: number;
  /** What may still be lost today. */
  remaining: number;
  stopHit: boolean;
}

/** Trades that happened — skipped setups are logged for study, not traded. */
export const takenTrades = (trades: Trade[]) => trades.filter((t) => !t.skipped);

/**
 * The loss budget of a New York day ("YYYY-MM-DD"). When a trade is logged after the
 * fact, `before` limits it to what had happened by that trade's own time — a loss later
 * that afternoon cannot have used up the morning's budget.
 */
export function dayBudget(
  trades: Trade[],
  day: string,
  limits: Pick<Limits, "dailyStopPct">,
  opts: { excludeId?: string; before?: string } = {},
): DayBudget {
  const mine = takenTrades(trades).filter(
    (t) =>
      t.id !== opts.excludeId &&
      t.date.slice(0, 10) === day &&
      (opts.before == null || t.date <= opts.before),
  );
  const net = mine.filter(isClosed).reduce((a, t) => a + tradePct(t), 0);
  const lossToday = tidy(Math.max(0, -net));
  const openRisk = tidy(mine.filter((t) => !isClosed(t)).reduce((a, t) => a + t.riskPct, 0));
  const remaining = tidy(Math.max(0, limits.dailyStopPct - lossToday - openRisk));
  return { lossToday, openRisk, remaining, stopHit: remaining <= 0 };
}

/** The ISO week ("2026-W41") of a New York day, read from the date string itself. */
export function weekOfDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return weekKey(new Date(y, m - 1, d));
}

/**
 * The loss budget of an ISO week — Monday to Friday on New York days — built the same
 * way as the day's: the weekly stop, minus the week's net loss, minus open risk.
 */
export function weekBudget(
  trades: Trade[],
  day: string,
  limits: Pick<Limits, "weeklyStopPct">,
  opts: { excludeId?: string; before?: string } = {},
): DayBudget {
  const week = weekOfDay(day);
  const mine = takenTrades(trades).filter(
    (t) =>
      t.id !== opts.excludeId &&
      weekOfDay(t.date.slice(0, 10)) === week &&
      (opts.before == null || t.date <= opts.before),
  );
  const net = mine.filter(isClosed).reduce((a, t) => a + tradePct(t), 0);
  const lossToday = tidy(Math.max(0, -net));
  const openRisk = tidy(mine.filter((t) => !isClosed(t)).reduce((a, t) => a + t.riskPct, 0));
  const remaining = tidy(Math.max(0, limits.weeklyStopPct - lossToday - openRisk));
  return { lossToday, openRisk, remaining, stopHit: remaining <= 0 };
}

export const gradeCard = (def: Pick<Definition, "grades"> | null, grade: Grade | string | null): GradeCard | null =>
  (def && grade && def.grades.find((g) => g.grade === grade)) || null;

/** What a grade may risk on its own: its card's risk, or 0 when it is not traded. */
export function gradeRisk(def: Pick<Definition, "grades"> | null, grade: Grade | string | null): number | null {
  const card = gradeCard(def, grade);
  if (!card) return null;
  return card.traded ? card.riskPct : 0;
}

/** min(grade risk, remaining daily budget, remaining weekly budget, max risk per trade) × multiplier. */
export function allowedRisk(
  gradeRiskPct: number | null,
  budget: Pick<DayBudget, "remaining">,
  limits: Pick<Limits, "maxRiskPct">,
  extra: { week?: Pick<DayBudget, "remaining">; multiplier?: number } = {},
): number {
  const grade = gradeRiskPct ?? limits.maxRiskPct;
  const week = extra.week?.remaining ?? Infinity;
  const base = Math.max(0, Math.min(grade, budget.remaining, week, limits.maxRiskPct));
  return tidy(base * (extra.multiplier ?? 1));
}

/* ── Replaying history under today's rules (the Risk lab) ────────────── */

/** The rulebook's caps a replay applies on top of the daily stop. */
export interface ReplayCaps {
  /** The week's net result before this day, in % — a loss so far eats into the weekly stop. */
  weekNetBefore?: number;
  /** Only this many trades a day are taken; the rest would not have been. */
  maxTrades?: number;
}

/**
 * What one historical day would have returned under the current rules: each trade in
 * order, sized at min(its grade's risk now, what is left of the day and the week, the
 * cap), the day's later trades past the one-trade rule left out, and nothing more once
 * a stop is hit. Trades without a grade keep the risk they were taken at, still inside
 * the cap and the budgets.
 */
export function replayDay(
  day: Trade[],
  riskOf: (t: Trade) => number,
  limits: Pick<Limits, "maxRiskPct" | "dailyStopPct"> & Partial<Pick<Limits, "weeklyStopPct">>,
  caps: ReplayCaps = {},
): number {
  return replayDayDetailed(day, riskOf, limits, caps).net;
}

/** The same replay, keeping the size each trade was given — 0 when the rules would not take it. */
export function replayDayDetailed(
  day: Trade[],
  riskOf: (t: Trade) => number,
  limits: Pick<Limits, "maxRiskPct" | "dailyStopPct"> & Partial<Pick<Limits, "weeklyStopPct">>,
  caps: ReplayCaps = {},
): { net: number; sized: { trade: Trade; risk: number; stopHit: boolean; overTrades: boolean }[] } {
  let net = 0;
  let taken = 0;
  const weekBefore = caps.weekNetBefore ?? 0;
  const sized: { trade: Trade; risk: number; stopHit: boolean; overTrades: boolean }[] = [];
  for (const t of [...day].sort((a, b) => a.date.localeCompare(b.date))) {
    const dayLeft = limits.dailyStopPct - Math.max(0, -net);
    const weekLeft = (limits.weeklyStopPct ?? Infinity) - Math.max(0, -(weekBefore + net));
    const remaining = Math.max(0, Math.min(dayLeft, weekLeft));
    const overTrades = taken >= (caps.maxTrades ?? Infinity);
    const risk = overTrades ? 0 : Math.max(0, Math.min(riskOf(t), remaining, limits.maxRiskPct));
    sized.push({ trade: t, risk: risk <= EPS ? 0 : tidy(risk), stopHit: remaining <= EPS, overTrades });
    if (risk <= EPS) continue;
    taken++;
    net += (t.resultR ?? 0) * risk;
  }
  return { net: tidy(net), sized };
}

/**
 * The risk a past trade would carry under the current rules: the ladder's card for its
 * grade today (0 for a grade that isn't tradable), or — with no grade to go on — the
 * risk it was actually taken at.
 */
export function rulesRisk(def: Pick<Definition, "grades">) {
  return (t: Trade) => gradeRisk(def, t.grade || null) ?? t.riskPct;
}

/** Every closed, taken trade grouped by its New York day, in date order. */
export function tradingDays(trades: Trade[]): Trade[][] {
  const byDay = new Map<string, Trade[]>();
  for (const t of takenTrades(trades).filter(isClosed)) {
    const d = t.date.slice(0, 10);
    const list = byDay.get(d);
    if (list) list.push(t);
    else byDay.set(d, [t]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => list);
}
