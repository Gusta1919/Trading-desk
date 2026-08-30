import type {
  DailyPnl,
  SetupPerformance,
  StrategyPerformance,
  Trade,
  TradeStats,
} from "@/types";

function closedTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.status === "closed" && t.pnl != null);
}

export function calculateStats(trades: Trade[]): TradeStats {
  const closed = closedTrades(trades);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const breakeven = closed.filter((t) => (t.pnl ?? 0) === 0);

  const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const grossProfit = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0),
  );

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const lossRate = closed.length ? losses.length / closed.length : 0;
  const expectancy = winRate / 100 * avgWin - lossRate * avgLoss;

  const rMultiples = closed
    .map((t) => t.rMultiple)
    .filter((r): r is number => r != null);
  const avgRMultiple = rMultiples.length
    ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length
    : 0;

  const pnls = closed.map((t) => t.pnl ?? 0);
  const bestTrade = pnls.length ? Math.max(...pnls) : 0;
  const worstTrade = pnls.length ? Math.min(...pnls) : 0;

  const { currentStreak, maxWinStreak, maxLossStreak } = calculateStreaks(
    closed.sort(
      (a, b) =>
        new Date(a.exitDate ?? a.entryDate).getTime() -
        new Date(b.exitDate ?? b.entryDate).getTime(),
    ),
  );

  const holdTimes = closed
    .filter((t) => t.exitDate)
    .map(
      (t) =>
        (new Date(t.exitDate!).getTime() - new Date(t.entryDate).getTime()) /
        60000,
    );
  const avgHoldTimeMinutes = holdTimes.length
    ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
    : 0;

  const withPlan = closed.filter((t) => t.followedPlan != null);
  const planAdherenceRate = withPlan.length
    ? (withPlan.filter((t) => t.followedPlan).length / withPlan.length) * 100
    : 0;

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.filter((t) => t.status === "open").length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    avgRMultiple,
    bestTrade,
    worstTrade,
    currentStreak,
    maxWinStreak,
    maxLossStreak,
    avgHoldTimeMinutes,
    planAdherenceRate,
  };
}

function calculateStreaks(sortedClosed: Trade[]) {
  let currentType: "win" | "loss" | "none" = "none";
  let currentCount = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let winRun = 0;
  let lossRun = 0;

  for (const trade of sortedClosed) {
    const pnl = trade.pnl ?? 0;
    if (pnl > 0) {
      winRun++;
      lossRun = 0;
      maxWinStreak = Math.max(maxWinStreak, winRun);
    } else if (pnl < 0) {
      lossRun++;
      winRun = 0;
      maxLossStreak = Math.max(maxLossStreak, lossRun);
    } else {
      winRun = 0;
      lossRun = 0;
    }
  }

  const last = sortedClosed[sortedClosed.length - 1];
  if (last) {
    const pnl = last.pnl ?? 0;
    if (pnl > 0) {
      currentType = "win";
      currentCount = winRun;
    } else if (pnl < 0) {
      currentType = "loss";
      currentCount = lossRun;
    }
  }

  return {
    currentStreak: { type: currentType, count: currentCount },
    maxWinStreak,
    maxLossStreak,
  };
}

export function calculateDailyPnl(trades: Trade[]): DailyPnl[] {
  const map = new Map<string, { pnl: number; trades: number }>();

  for (const trade of closedTrades(trades)) {
    const date = (trade.exitDate ?? trade.entryDate).slice(0, 10);
    const existing = map.get(date) ?? { pnl: 0, trades: 0 };
    map.set(date, {
      pnl: existing.pnl + (trade.pnl ?? 0),
      trades: existing.trades + 1,
    });
  }

  return Array.from(map.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function calculateStrategyPerformance(
  trades: Trade[],
): StrategyPerformance[] {
  const map = new Map<
    string,
    { wins: number; total: number; pnl: number; rSum: number; rCount: number }
  >();

  for (const trade of closedTrades(trades)) {
    const key = trade.strategy || "Bez strategii";
    const existing = map.get(key) ?? {
      wins: 0,
      total: 0,
      pnl: 0,
      rSum: 0,
      rCount: 0,
    };
    const isWin = (trade.pnl ?? 0) > 0;
    map.set(key, {
      wins: existing.wins + (isWin ? 1 : 0),
      total: existing.total + 1,
      pnl: existing.pnl + (trade.pnl ?? 0),
      rSum: existing.rSum + (trade.rMultiple ?? 0),
      rCount: existing.rCount + (trade.rMultiple != null ? 1 : 0),
    });
  }

  return Array.from(map.entries())
    .map(([strategy, data]) => ({
      strategy,
      trades: data.total,
      winRate: data.total ? (data.wins / data.total) * 100 : 0,
      totalPnl: data.pnl,
      avgR: data.rCount ? data.rSum / data.rCount : 0,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

export function calculateSetupPerformance(trades: Trade[]): SetupPerformance[] {
  const map = new Map<
    string,
    { wins: number; total: number; pnl: number }
  >();

  for (const trade of closedTrades(trades)) {
    const key = trade.setupType || "Bez setupu";
    const existing = map.get(key) ?? { wins: 0, total: 0, pnl: 0 };
    const isWin = (trade.pnl ?? 0) > 0;
    map.set(key, {
      wins: existing.wins + (isWin ? 1 : 0),
      total: existing.total + 1,
      pnl: existing.pnl + (trade.pnl ?? 0),
    });
  }

  return Array.from(map.entries())
    .map(([setup, data]) => ({
      setup,
      trades: data.total,
      winRate: data.total ? (data.wins / data.total) * 100 : 0,
      totalPnl: data.pnl,
    }))
    .sort((a, b) => b.trades - a.trades);
}

export function computeRMultiple(trade: {
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
}): number | null {
  if (trade.exitPrice == null || trade.stopLoss == null) return null;
  const risk = Math.abs(trade.entryPrice - trade.stopLoss);
  if (risk === 0) return null;
  const reward =
    trade.direction === "long"
      ? trade.exitPrice - trade.entryPrice
      : trade.entryPrice - trade.exitPrice;
  return reward / risk;
}

export function computePnl(trade: {
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  fees?: number;
}): number | null {
  if (trade.exitPrice == null) return null;
  const gross =
    trade.direction === "long"
      ? (trade.exitPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - trade.exitPrice) * trade.quantity;
  return gross - (trade.fees ?? 0);
}
