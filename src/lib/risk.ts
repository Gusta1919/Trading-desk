/**
 * How much a trade may risk, and which lines it crossed.
 *
 * Two of your own limits apply to every strategy: the most one trade may risk, and
 * the most one New York day may lose. A trade's allowed risk is the smallest of its
 * grade's risk, what is left of today's loss budget, and the per-trade cap:
 *
 *   allowed = min(grade risk, remaining daily budget, max risk per trade)
 *
 * The budget is the daily stop minus today's net loss so far, minus the risk still
 * sitting in any open trade — money already at stake is money already spent from
 * the budget. These are notices, never blocks: crossing a line is recorded as a
 * flag on the trade, and the saving goes ahead.
 */
import { isClosed, tradePct } from "./stats";
import type { Definition, Grade, GradeCard, Limits, Strategy, Trade, TradeFlag } from "./types";

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

export const gradeCard = (def: Pick<Definition, "grades"> | null, grade: Grade | string | null): GradeCard | null =>
  (def && grade && def.grades.find((g) => g.grade === grade)) || null;

/** What a grade may risk on its own: its card's risk, or 0 when it is not traded. */
export function gradeRisk(def: Pick<Definition, "grades"> | null, grade: Grade | string | null): number | null {
  const card = gradeCard(def, grade);
  if (!card) return null;
  return card.traded ? card.riskPct : 0;
}

/** min(grade risk, remaining daily budget, max risk per trade). */
export function allowedRisk(
  gradeRiskPct: number | null,
  budget: Pick<DayBudget, "remaining">,
  limits: Pick<Limits, "maxRiskPct">,
): number {
  const grade = gradeRiskPct ?? limits.maxRiskPct;
  return tidy(Math.max(0, Math.min(grade, budget.remaining, limits.maxRiskPct)));
}

/**
 * The lines a trade crosses. Only the most specific flag is raised for one cause:
 * a trade after the daily stop is not also "over risk" just because its allowance
 * was zero — unless it also went past the per-trade cap.
 */
export function flagsFor({
  riskPct,
  allowed,
  card,
  budget,
  limits,
}: {
  riskPct: number;
  allowed: number;
  card: GradeCard | null;
  budget: Pick<DayBudget, "stopHit">;
  limits: Pick<Limits, "maxRiskPct">;
}): TradeFlag[] {
  const flags: TradeFlag[] = [];
  if (budget.stopHit) flags.push("after_daily_stop");
  if (card && !card.traded) flags.push("non_traded_grade");
  const overCap = riskPct > limits.maxRiskPct + EPS;
  const overAllowance = riskPct > allowed + EPS && !budget.stopHit && !(card && !card.traded);
  if (overCap || overAllowance) flags.push("over_risk");
  return flags;
}

/* ── Replaying history under today's rules (the Risk lab) ────────────── */

/**
 * What one historical day would have returned under the current rules: each trade in
 * order, sized at min(its grade's risk now, what is left of the day, the cap), and
 * nothing more once the daily stop is hit. Trades without a grade keep the risk they
 * were taken at, still inside the cap and the budget.
 */
export function replayDay(
  day: Trade[],
  riskOf: (t: Trade) => number,
  limits: Pick<Limits, "maxRiskPct" | "dailyStopPct">,
): number {
  return replayDayDetailed(day, riskOf, limits).net;
}

/** The same replay, keeping the size each trade was given — 0 when the rules would not take it. */
export function replayDayDetailed(
  day: Trade[],
  riskOf: (t: Trade) => number,
  limits: Pick<Limits, "maxRiskPct" | "dailyStopPct">,
): { net: number; sized: { trade: Trade; risk: number; stopHit: boolean }[] } {
  let net = 0;
  const sized: { trade: Trade; risk: number; stopHit: boolean }[] = [];
  for (const t of [...day].sort((a, b) => a.date.localeCompare(b.date))) {
    const remaining = Math.max(0, limits.dailyStopPct - Math.max(0, -net));
    const risk = Math.max(0, Math.min(riskOf(t), remaining, limits.maxRiskPct));
    sized.push({ trade: t, risk: risk <= EPS ? 0 : tidy(risk), stopHit: remaining <= EPS });
    if (risk <= EPS) continue;
    net += (t.resultR ?? 0) * risk;
  }
  return { net: tidy(net), sized };
}

/**
 * The risk a past trade would carry under the current rules: its strategy's card for
 * its grade today (0 for a grade now marked Don't), or — with no strategy or grade to
 * go on — the risk it was actually taken at.
 */
export function rulesRisk(strategies: Pick<Strategy, "id" | "grades">[]) {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  return (t: Trade) => {
    const g = gradeRisk(t.strategyId ? (byId.get(t.strategyId) ?? null) : null, t.grade || null);
    return g ?? t.riskPct;
  };
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
