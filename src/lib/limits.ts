/**
 * The account against the prop firm's lines.
 *
 * Everything else in the desk measures how well you trade. This measures how close you
 * are to not being allowed to trade at all — a different question, and the only one
 * with a cliff at the end of it. The firm states both lines against the starting
 * balance: the daily one resets every day, the overall one never does. Your own daily
 * stop sits well inside the firm's, so while you keep it the firm's daily line is out
 * of reach.
 */
import { dayBudget, takenTrades, weekBudget } from "./risk";
import { isClosed } from "./stats";
import { deskDay } from "./tz";
import type { Limits, Trade } from "./types";

export interface AccountState {
  /** The opening balance plus every closed trade's dollar result. */
  balance: number;
  /** The firm's floor: the start balance less its max loss. */
  floor: number;
  /** The challenge target in dollars. */
  goal: number;
  /** Dollars above the floor, and still to make for the target. */
  room: number;
  need: number;
  /** Share of the way from the opening balance to the target, 0–1 (below 0 when under the opening balance). */
  progress: number;
  /** Today's dollar result so far. */
  today: number;
  /** Share of the firm's daily line today's loss has used, 0–1. */
  dailyUsed: number;
  /**
   * The most the next trade may risk, in %: your cap, what is left of your daily and
   * weekly stops, and what a full stop-out could take before either firm line.
   */
  safeRisk: number;
}

export function accountState(trades: Trade[], limits: Limits, now = new Date()): AccountState {
  const taken = takenTrades(trades);
  const closed = taken.filter(isClosed);
  const today = deskDay(now);
  const balance = closed.reduce((a, t) => a + (t.pnlUsd ?? 0), limits.openingBalance);
  const todayPnl = closed.filter((t) => t.date.slice(0, 10) === today).reduce((a, t) => a + (t.pnlUsd ?? 0), 0);

  const floor = limits.startBalance * (1 - limits.maxLossPct / 100);
  const goal = limits.startBalance * (1 + limits.targetPct / 100);
  const dailyLine = (limits.startBalance * limits.dailyLossPct) / 100;
  const dailyLeftPct = balance > 0 ? (Math.max(0, dailyLine + Math.min(0, todayPnl)) / balance) * 100 : 0;
  const floorLeftPct = balance > 0 ? (Math.max(0, balance - floor) / balance) * 100 : 0;

  return {
    balance,
    floor,
    goal,
    room: balance - floor,
    need: goal - balance,
    progress: goal > limits.openingBalance ? (balance - limits.openingBalance) / (goal - limits.openingBalance) : 1,
    today: todayPnl,
    dailyUsed: dailyLine > 0 ? Math.min(1, Math.max(0, -todayPnl) / dailyLine) : 0,
    safeRisk: Math.max(
      0,
      Math.min(
        limits.maxRiskPct,
        dayBudget(taken, today, limits).remaining,
        weekBudget(taken, today, limits).remaining,
        dailyLeftPct,
        floorLeftPct,
      ),
    ),
  };
}
