import type { Outcome, Trade } from "./types";

/** Result of a trade as % of the account: R-multiple × risk %. */
export const tradePct = (t: Trade) => (t.resultR ?? 0) * t.riskPct;

/** Results this close to 0R count as breakeven ("scratched"), not as a win or a loss. */
export const BE_BAND = 0.1;

/**
 * Decides whether a closed trade counts as a win, loss or breakeven.
 * Every stat (win rate, streaks, compare tables, the coach) is built on this.
 */
export function classifyOutcome(resultR: number | null): Outcome {
  if (resultR == null) return "open";
  if (Math.abs(resultR) <= BE_BAND) return "be";
  return resultR > 0 ? "win" : "loss";
}

export const isClosed = (t: Trade) => t.resultR != null;

const byDateAsc = (a: Trade, b: Trade) => a.date.localeCompare(b.date);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

export interface EquityPoint {
  n: number;
  date: string;
  symbol: string;
  pct: number; // this trade
  cum: number; // running total
  dd: number; // distance below the peak (≤ 0)
}

export interface Summary {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null; // wins / (wins + losses), breakevens excluded
  netPct: number;
  totalR: number;
  expectancyR: number | null;
  expectancyPct: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number;
  currentDrawdownPct: number;
  bestPct: number | null;
  worstPct: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: { outcome: "win" | "loss" | null; count: number };
  /** Share of closed trades that broke no rule. */
  ruleAdherence: number | null;
  avgRiskPct: number | null;
  avgPlannedRR: number | null;
  equity: EquityPoint[];
}

export function summarize(all: Trade[]): Summary {
  const trades = all.filter(isClosed).sort(byDateAsc);
  const outcomes = trades.map((t) => classifyOutcome(t.resultR));
  const pcts = trades.map(tradePct);
  const rs = trades.map((t) => t.resultR!);

  const winsR = rs.filter((_, i) => outcomes[i] === "win");
  const lossesR = rs.filter((_, i) => outcomes[i] === "loss");
  const grossWin = sum(pcts.filter((p) => p > 0));
  const grossLoss = Math.abs(sum(pcts.filter((p) => p < 0)));

  // Equity curve + drawdown (additive %, i.e. not compounded).
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  const equity: EquityPoint[] = trades.map((t, i) => {
    cum += pcts[i];
    peak = Math.max(peak, cum);
    const dd = cum - peak;
    maxDD = Math.min(maxDD, dd);
    return { n: i + 1, date: t.date, symbol: t.symbol, pct: pcts[i], cum, dd };
  });

  // Streaks — breakevens don't break or extend a streak.
  let maxWin = 0;
  let maxLoss = 0;
  let run: { outcome: "win" | "loss" | null; count: number } = {
    outcome: null,
    count: 0,
  };
  for (const o of outcomes) {
    if (o !== "win" && o !== "loss") continue;
    run = run.outcome === o ? { outcome: o, count: run.count + 1 } : { outcome: o, count: 1 };
    if (o === "win") maxWin = Math.max(maxWin, run.count);
    else maxLoss = Math.max(maxLoss, run.count);
  }

  const planned = trades.map((t) => t.plannedRR).filter((v): v is number => v != null);
  const decided = winsR.length + lossesR.length;

  return {
    closed: trades.length,
    open: all.length - trades.length,
    wins: winsR.length,
    losses: lossesR.length,
    breakeven: outcomes.filter((o) => o === "be").length,
    winRate: decided ? winsR.length / decided : null,
    netPct: sum(pcts),
    totalR: sum(rs),
    expectancyR: mean(rs),
    expectancyPct: mean(pcts),
    avgWinR: mean(winsR),
    avgLossR: mean(lossesR),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    maxDrawdownPct: maxDD,
    currentDrawdownPct: equity.length ? equity[equity.length - 1].dd : 0,
    bestPct: pcts.length ? Math.max(...pcts) : null,
    worstPct: pcts.length ? Math.min(...pcts) : null,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    currentStreak: run,
    ruleAdherence: trades.length ? trades.filter((t) => !t.flags.length).length / trades.length : null,
    avgRiskPct: mean(trades.map((t) => t.riskPct)),
    avgPlannedRR: mean(planned),
    equity,
  };
}

export interface GroupRow {
  key: string;
  count: number;
  winRate: number | null;
  avgR: number | null;
  netPct: number;
}

/**
 * Splits closed trades into groups and compares them.
 * `keyOf` may return several keys (a trade with two mistakes counts in both).
 */
export function groupBy(
  all: Trade[],
  keyOf: (t: Trade) => string | string[] | null,
  order?: string[],
): GroupRow[] {
  const groups = new Map<string, Trade[]>();
  for (const t of all.filter(isClosed)) {
    const raw = keyOf(t);
    const keys = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    for (const k of keys) {
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
  }

  const rows = [...groups].map(([key, ts]) => {
    const outcomes = ts.map((t) => classifyOutcome(t.resultR));
    const wins = outcomes.filter((o) => o === "win").length;
    const decided = wins + outcomes.filter((o) => o === "loss").length;
    return {
      key,
      count: ts.length,
      winRate: decided ? wins / decided : null,
      avgR: mean(ts.map((t) => t.resultR!)),
      netPct: sum(ts.map(tradePct)),
    };
  });

  if (order) {
    return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  return rows.sort((a, b) => b.netPct - a.netPct);
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekdayOf = (t: Trade) => WEEKDAYS[(new Date(t.date).getDay() + 6) % 7];
