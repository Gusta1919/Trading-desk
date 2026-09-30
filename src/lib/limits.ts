/**
 * The account's lines: your own daily stop, and the prop firm's two hard lines.
 *
 * Everything else in this journal measures how well you trade. This measures how
 * close you are to not being allowed to trade at all — a different question, and
 * the only one with a cliff at the end of it. Your 1% daily stop sits well inside
 * the firm's 5%, so while you keep it the firm's daily line is out of reach.
 *
 * FTMO states both limits against the starting balance: the daily line resets every
 * day, the overall line never does. Because the journal is percentage-based and
 * starts at zero, "10% max loss" is simply the cumulative return reaching −10%.
 */
import { dayKey } from "./format";
import { dayBudget } from "./risk";
import { isClosed, tradePct } from "./stats";
import type { Limits, Trade } from "./types";

export interface LimitState {
  /** Today's loss so far as a positive number; 0 on a green or flat day. */
  todayLoss: number;
  /** How far below the running peak you are, as a positive number. */
  drawdown: number;
  /** Share of each allowance already spent, 0–1. */
  dailyUsed: number;
  maxUsed: number;
  /** What you may still lose before breaching. */
  dailyLeft: number;
  maxLeft: number;
  /** Your own daily stop: how much of it today has used, and what is left. */
  stopUsed: number;
  stopLeft: number;
  /**
   * The largest risk the next trade may carry: your per-trade cap, what is left of
   * your daily stop, and what a full stop-out could take before either firm line.
   */
  safeRisk: number;
}

export function limitState(trades: Trade[], limits: Limits, now = new Date()): LimitState {
  const closed = trades.filter(isClosed);
  const today = dayKey(now);

  const todayPct = closed
    .filter((t) => t.date.slice(0, 10) === today)
    .reduce((a, t) => a + tradePct(t), 0);
  const todayLoss = Math.max(0, -todayPct);

  // Drawdown from the running peak of the cumulative curve.
  let cum = 0;
  let peak = 0;
  for (const t of [...closed].sort((a, b) => a.date.localeCompare(b.date))) {
    cum += tradePct(t);
    peak = Math.max(peak, cum);
  }
  // FTMO's overall line is measured from the starting balance, not from the peak,
  // so what matters is how far below zero you are — never a gain given back.
  const drawdown = Math.max(0, -cum);

  const dailyLeft = Math.max(0, limits.dailyLossPct - todayLoss);
  const maxLeft = Math.max(0, limits.maxLossPct - drawdown);
  const budget = dayBudget(trades, today, limits);

  return {
    todayLoss,
    drawdown,
    dailyUsed: limits.dailyLossPct > 0 ? Math.min(1, todayLoss / limits.dailyLossPct) : 0,
    maxUsed: limits.maxLossPct > 0 ? Math.min(1, drawdown / limits.maxLossPct) : 0,
    dailyLeft,
    maxLeft,
    stopUsed: limits.dailyStopPct > 0 ? Math.min(1, (limits.dailyStopPct - budget.remaining) / limits.dailyStopPct) : 0,
    stopLeft: budget.remaining,
    safeRisk: Math.min(limits.maxRiskPct, budget.remaining, dailyLeft, maxLeft),
  };
}

/** Commission and swap, summed over the trades that actually measured them. */
export function costDrag(trades: Trade[]) {
  const measured = trades.filter((t) => isClosed(t) && t.costPct != null);
  if (!measured.length) return null;

  const cost = measured.reduce((a, t) => a + (t.costPct ?? 0), 0);
  const net = measured.reduce((a, t) => a + tradePct(t), 0);
  const gross = net + cost;

  return {
    n: measured.length,
    cost,
    net,
    gross,
    /** What share of the gross result the broker took. Only meaningful when gross > 0. */
    share: gross > 0 ? cost / gross : null,
    perTrade: cost / measured.length,
    /** How many trades were logged without cost data, so the figure is honest. */
    unmeasured: trades.filter((t) => isClosed(t) && t.costPct == null).length,
  };
}
