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
