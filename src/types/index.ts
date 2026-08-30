export type TradeDirection = "long" | "short";
export type TradeStatus = "open" | "closed" | "cancelled";
export type TradeSession = "premarket" | "regular" | "afterhours";
export type JournalEntryType =
  | "pre_trade"
  | "during"
  | "post_trade"
  | "reflection"
  | "general";

export interface Trade {
  id: string;
  symbol: string;
  market: string;
  direction: TradeDirection;
  status: TradeStatus;
  session: TradeSession;
  timeframe: string;
  setupType: string;
  strategy: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  stopLoss: number | null;
  takeProfit: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  rMultiple: number | null;
  fees: number;
  emotionalState: number | null;
  executionGrade: string | null;
  followedPlan: boolean | null;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  id: string;
  tradeId: string | null;
  title: string;
  content: string;
  entryType: JournalEntryType;
  mood: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TradeInput {
  symbol: string;
  market?: string;
  direction: TradeDirection;
  status?: TradeStatus;
  session?: TradeSession;
  timeframe?: string;
  setupType?: string;
  strategy?: string;
  entryDate: string;
  exitDate?: string | null;
  entryPrice: number;
  exitPrice?: number | null;
  quantity: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  pnl?: number | null;
  fees?: number;
  emotionalState?: number | null;
  executionGrade?: string | null;
  followedPlan?: boolean | null;
  notes?: string;
  tags?: string[];
}

export interface JournalInput {
  tradeId?: string | null;
  title: string;
  content: string;
  entryType?: JournalEntryType;
  mood?: number | null;
  tags?: string[];
}

export interface TradeStats {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRMultiple: number;
  bestTrade: number;
  worstTrade: number;
  currentStreak: { type: "win" | "loss" | "none"; count: number };
  maxWinStreak: number;
  maxLossStreak: number;
  avgHoldTimeMinutes: number;
  planAdherenceRate: number;
}

export interface DailyPnl {
  date: string;
  pnl: number;
  trades: number;
}

export interface StrategyPerformance {
  strategy: string;
  trades: number;
  winRate: number;
  totalPnl: number;
  avgR: number;
}

export interface SetupPerformance {
  setup: string;
  trades: number;
  winRate: number;
  totalPnl: number;
}

export type ViewId =
  | "dashboard"
  | "trades"
  | "journal"
  | "stats"
  | "insights";
