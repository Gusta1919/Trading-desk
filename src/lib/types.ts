export type Direction = "long" | "short";
export type Outcome = "win" | "loss" | "be" | "open";

export interface Trade {
  id: string;
  date: string; // New York wall clock, "YYYY-MM-DDTHH:mm"
  symbol: string;
  direction: Direction;
  session: string;
  setup: string; // free text kept from older trades; new ones use strategyId
  strategyId: string | null;
  /** Legacy: newer strategies ask for the HTF reason as a grade factor instead. */
  htf: string;
  /** Legacy: newer strategies ask for the entry model as a grade factor instead. */
  entryModel: string;
  /** The risk actually taken, % of the account. 0 on a skipped setup. */
  riskPct: number;
  /** What the rules allowed for this grade at the time — compare with riskPct. */
  plannedRiskPct: number | null;
  plannedRR: number | null;
  resultR: number | null; // null = still open (or skipped)
  followedPlan: boolean | null;
  /** The setup's grade: computed from the strategy's rules and factors, or picked by hand. */
  grade: string;
  emotion: number | null; // 1 calm … 5 tilted
  mistakes: string[];
  checklist: string[]; // ids of the base rules ticked
  checklistTotal: number; // how many base rules there were at the time
  /**
   * The strategy's definition and your answers, frozen when the trade was logged —
   * so editing a strategy later never rewrites the history measured against it.
   */
  setupSnapshot: SetupSnapshot | null;
  /** Lines this trade crossed when it was saved. Saving is never blocked; it is recorded. */
  flags: TradeFlag[];
  /** Your reason, when a flag was raised. */
  flagNote: string;
  /** A setup you logged but did not take. Kept out of every result, only used in Compare. */
  skipped: boolean;
  /** For a skipped setup: what it would have made, in R, if you know. */
  hypotheticalR: number | null;
  /** How long you expect to be in the trade, for the news-in-window warning. */
  expectedMinutes: number | null;
  /** Commission + swap as a % of the account. Null = never measured, not zero. */
  costPct: number | null;
  /** How wide the strategy's box was, in that strategy's unit. */
  boxSize: number | null;
  /** Profit or loss in account currency. The percentage and R are derived from it. */
  pnlUsd: number | null;
  /** The news on the trade's New York day, copied in — the calendar only keeps a couple of weeks. */
  news: TradeNews[];
  notes: string;
  screenshot: string;
  createdAt: string;
  updatedAt: string;
}

export type TradeInput = Omit<Trade, "id" | "createdAt" | "updatedAt">;

export type TradeFlag = "over_risk" | "non_traded_grade" | "after_daily_stop";

export const FLAG_LABEL: Record<TradeFlag, string> = {
  over_risk: "Risked more than allowed",
  non_traded_grade: "Took a grade marked Don't",
  after_daily_stop: "Traded after the daily stop",
};

/** One release on a trade's day. "Manual" is something you typed in that the feed didn't have. */
export interface TradeNews {
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday" | "Manual";
  /** "HH:mm" New York, or "" when unknown. */
  time: string;
}

/**
 * The account's lines, all as % of the starting balance.
 *
 * Two are yours and apply to every strategy — the most one trade may risk, and the
 * most a day may lose. Two are the prop firm's — the lines that end the account.
 */
export interface Limits {
  enabled: boolean;
  /** What the prop account was opened with; every percentage is measured from here. */
  startBalance: number;
  /** Your hard cap per trade. */
  maxRiskPct: number;
  /** Your daily stop: once the day has lost this much, the desk is closed. */
  dailyStopPct: number;
  /** The prop firm's daily line. */
  dailyLossPct: number;
  /** The prop firm's overall line. */
  maxLossPct: number;
}

/** What a missing limits row falls back to: your rules, and FTMO's standard account. */
export const DEFAULT_LIMITS: Limits = {
  enabled: true,
  startBalance: 200_000,
  maxRiskPct: 1,
  dailyStopPct: 1,
  dailyLossPct: 5,
  maxLossPct: 10,
};

export const SESSIONS = ["Asia", "London", "New York"];

/* ── Grades ──────────────────────────────────────────────────────────── */

export type Grade = "A+" | "A" | "B" | "C";
/** Best first. Every strategy uses this ladder; what earns each rung is the strategy's own. */
export const GRADES: Grade[] = ["A+", "A", "B", "C"];
/** 0 for A+ … 3 for C — a higher number is a lower grade. */
export const gradeRank = (g: Grade) => GRADES.indexOf(g);
export const isGrade = (g: unknown): g is Grade => GRADES.includes(g as Grade);

/** Legacy fixed lists, kept only to order and label trades logged before grade factors. */
export const HTFS = ["1H", "4H", "Daily", "Weekly"];
export const ENTRY_MODELS = ["BOS", "MSS 1m", "MSS 5m"];

export const MISTAKES = [
  "FOMO entry",
  "Late entry",
  "Moved stop",
  "Early exit",
  "Oversized",
  "Revenge trade",
  "No setup",
  "Ignored news",
];
export const EMOTIONS = ["Calm", "Focused", "Neutral", "Anxious", "Tilted"];

/**
 * A strategy's picks in the standard order — Asia → London → New York — rather than
 * the order they happened to be clicked in.
 */
export const inOrder = (picked: string[] = [], order: string[]) => [
  ...order.filter((o) => picked.includes(o)),
  ...picked.filter((p) => !order.includes(p)),
];

/* ── Strategy definition ─────────────────────────────────────────────── */

/**
 * A yes/no condition that must hold for any trade. One unticked base rule caps the
 * grade at C. `auto` rules are answered by the app rather than ticked by hand.
 */
export interface BaseRule {
  id: string;
  text: string;
  hint: string;
  auto?: "daily-budget";
}

export interface ChoiceOption {
  id: string;
  label: string;
  /** The best grade a trade can still reach with this answer. */
  cap: Grade;
}

/**
 * A boundary between two number ranges. `lowerGetsIt` says which side owns the exact
 * value: for "55 to 65 → B, <55 → C" the cut at 55 belongs to the upper range.
 */
export interface NumberCut {
  value: number;
  lowerGetsIt: boolean;
}

interface FactorBase {
  id: string;
  name: string;
  hint: string;
}

/** A question answered by picking one option. */
export interface ChoiceFactor extends FactorBase {
  kind: "choice";
  options: ChoiceOption[];
}

/**
 * A question answered with a number. `cuts` split the number line into
 * `cuts.length + 1` ranges, lowest first, and `caps[i]` is the best grade range i
 * allows. Defined by cuts rather than from–to pairs, a gap or an overlap cannot exist.
 */
export interface NumberFactor extends FactorBase {
  kind: "number";
  unit: string;
  cuts: NumberCut[];
  caps: Grade[];
}

export type Factor = ChoiceFactor | NumberFactor;

/** One rung of the ladder: what it may risk, whether it is traded, and what it feels like. */
export interface GradeCard {
  grade: Grade;
  riskPct: number;
  traded: boolean;
  description: string;
}

/** A trading strategy: what you trade, when, and what each grade of setup looks like. */
export interface Strategy {
  id: string;
  name: string;
  instrument: string;
  description: string;
  hoursFrom: string; // "08:00", New York
  hoursTo: string; // "12:00", New York
  sessions: string[]; // e.g. ["London", "New York"]
  invalidation: string;
  rrFrom: number | null; // planned R:R is a range, not one number
  rrTo: number | null;
  baseRules: BaseRule[];
  factors: Factor[];
  /** Always four cards, A+ to C. */
  grades: GradeCard[];
  /** The range this setup is measured against — "Asia range", "opening range", "". */
  boxLabel: string;
  /** What the size is counted in: points, pips, ticks. */
  boxUnit: string;
  /** The size range you consider tradeable. Outside it the form warns you. */
  boxMin: number | null;
  boxMax: number | null;
  createdAt: string;
  updatedAt: string;
}

export type StrategyInput = Omit<Strategy, "id" | "createdAt" | "updatedAt">;

/** The part of a strategy a trade is graded against — and what a trade freezes. */
export type Definition = Pick<Strategy, "baseRules" | "factors" | "grades">;

/**
 * A trade's frozen copy of its strategy's definition, and how it was answered.
 * `answers` holds an option id for a choice factor and a number for a number factor.
 */
export interface SetupSnapshot extends Definition {
  strategyName: string;
  ticked: string[];
  answers: Record<string, string | number>;
  grade: Grade | null;
}

/* ── Checklist (the base rules, as the rest of the app reads them) ───── */

export interface ChecklistItem {
  id: string;
  label: string;
  hint?: string;
}

/**
 * The base rules a trade was measured against — its own frozen copy when it has one,
 * otherwise its strategy's current rules.
 */
export function checklistOf(
  trade: Pick<Trade, "strategyId"> & { setupSnapshot?: SetupSnapshot | null },
  strategies: Strategy[] = [],
): ChecklistItem[] {
  const rules =
    trade.setupSnapshot?.baseRules ??
    strategies.find((x) => x.id === trade.strategyId)?.baseRules ??
    [];
  return rules.map((r) => ({ id: r.id, label: r.text, hint: r.hint || undefined }));
}

/** How many base rules the trade was measured against when it was logged. */
export const totalChecks = (t: Pick<Trade, "checklistTotal">) => t.checklistTotal || 0;

export const checklistComplete = (t: Pick<Trade, "checklist" | "checklistTotal">) =>
  t.checklist.length >= totalChecks(t);

/**
 * Whether the checklist was captured at all. An imported trade carries no checklist
 * because the broker's file has none — that is missing data, not a skipped check,
 * and counting it as a rule break would slander every trade you didn't type by hand.
 */
export const checklistRecorded = (t: Pick<Trade, "checklist" | "checklistTotal">) =>
  t.checklistTotal > 0 || t.checklist.length > 0;

/* ── Weeks ───────────────────────────────────────────────────────────── */

/** Your reasoning for the week — written once, referenced all week. */
export interface WeekNote {
  week: string; // "2026-W39"
  bias: string; // long | short | neutral | ""
  reasoning: string;
  levels: string;
  createdAt: string;
  updatedAt: string;
}

/** ISO week key for a date, e.g. "2026-W39". */
export function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO weeks run Monday–Sunday and belong to the year of their Thursday.
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((t.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
