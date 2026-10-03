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

/** One account's money since the journal started. */
export interface AccountMoney {
  name: string;
  opening: number;
  balance: number;
  /** Profit or loss since the journal started, in $ and %. */
  pnl: number;
  pnlPct: number;
  /** Today's result in $. */
  today: number;
}

export interface Ledger {
  /** The main account first, then the linked ones. */
  accounts: AccountMoney[];
  /** All of them together. */
  total: AccountMoney;
  /** Each closed trade's result in $, per account (main first). */
  byTrade: Map<string, number[]>;
}

/**
 * Your money across every account, counted from the journal's start — the drawdown
 * before it is never shown. You log the main account's dollars; each linked account
 * takes the same % of its own balance on every trade.
 */
export function ledger(trades: Trade[], limits: Limits, now = new Date()): Ledger {
  const closed = takenTrades(trades)
    .filter(isClosed)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const today = deskDay(now);
  const linked = limits.linked ?? [];
  const names = [limits.accountName || "Main account", ...linked.map((a) => a.name)];
  const opening = [limits.openingBalance, ...linked.map((a) => a.opening)];
  const balance = [...opening];
  const todays = opening.map(() => 0);
  const byTrade = new Map<string, number[]>();

  for (const t of closed) {
    const main = t.pnlUsd ?? 0;
    const share = balance[0] > 0 ? main / balance[0] : 0;
    const dollars = balance.map((b, i) => (i === 0 ? main : b * share));
    dollars.forEach((d, i) => {
      balance[i] += d;
      if (t.date.slice(0, 10) === today) todays[i] += d;
    });
    byTrade.set(t.id, dollars);
  }

  const money = (name: string, open: number, bal: number, day: number): AccountMoney => ({
    name,
    opening: open,
    balance: bal,
    pnl: bal - open,
    pnlPct: open > 0 ? ((bal - open) / open) * 100 : 0,
    today: day,
  });
  const accounts = names.map((n, i) => money(n, opening[i], balance[i], todays[i]));
  const sum = (k: "opening" | "balance" | "today") => accounts.reduce((a, x) => a + x[k], 0);
  return { accounts, total: money("All accounts", sum("opening"), sum("balance"), sum("today")), byTrade };
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
