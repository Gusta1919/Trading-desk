export type Direction = "long" | "short";
export type Outcome = "win" | "loss" | "be" | "open";

export interface Trade {
  id: string;
  date: string; // New York wall clock, "YYYY-MM-DDTHH:mm"
  symbol: string;
  direction: Direction;
  session: string;
  /** Legacy free text from older trades; graded trades use the rulebook instead. */
  setup: string;
  /** Legacy: the rulebook asks for the HTF reason as a grade factor instead. */
  htf: string;
  /** Legacy: the rulebook asks for the entry model as a grade factor instead. */
  entryModel: string;
  /** The risk actually taken, % of the account. 0 on a skipped setup. */
  riskPct: number;
  /** What the rules allowed for this grade at the time — compare with riskPct. */
  plannedRiskPct: number | null;
  plannedRR: number | null;
  resultR: number | null; // null = still open (or skipped)
  followedPlan: boolean | null;
  /** The setup's grade: computed from the rulebook's rules and factors, or picked by hand. */
  grade: string;
  emotion: number | null; // 1 calm … 5 tilted
  mistakes: string[];
  checklist: string[]; // ids of the base rules ticked
  checklistTotal: number; // how many base rules there were at the time
  /**
   * The rules and your answers, frozen when the trade was logged — so editing the
   * rulebook later never rewrites the history measured against it.
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
  /** Commission + swap as a % of the account. Null = never measured, not zero. */
  costPct: number | null;
  /** How wide the CRT box was, in $ (its high minus its low). */
  boxSize: number | null;
  /** Profit or loss in account currency. The percentage and R are derived from it. */
  pnlUsd: number | null;
  /** The news on the trade's New York day, copied in — the calendar only keeps a couple of weeks. */
  news: TradeNews[];
  notes: string;
  screenshot: string;
  /** The rulebook version this trade was graded under; null for trades from before the rulebook. */
  rulebookVersion: string | null;

  /* ── Setup (the journal fields of the rulebook) ── */
  /** The CRT box's high and low, wicks included. Its size stays in `boxSize`. */
  boxHigh: number | null;
  boxLow: number | null;
  /** The furthest price the sweep reached beyond the box. */
  sweepExtreme: number | null;
  /** $ beyond the box edge — from the sweep extreme, or typed. */
  sweepDepth: number | null;
  took15mSwing: boolean | null;
  /** The type of the HTF reason that counts: the one on the highest timeframe. */
  htfReasonType: HtfReasonType | "";
  /** Every HTF reason behind the trade, each with its timeframe; the highest one counts. */
  htfReasons: HtfReason[];
  poiTests: PoiTests | "";
  /** The sweep took an important level (logged, not a rule yet). */
  levelSweep: boolean | null;
  /** Whether your daily bias matched the Daily Bias briefing's ("none": logged before, with no briefing). */
  deskAgreed: DeskAgreed | "";

  /* ── Entry ── */
  /** No longer asked; trades logged before keep theirs. */
  entryType: EntryType | "";
  entryPrice: number | null;
  /** The initial stop — never the trailed one, so R stays measurable. */
  stopPrice: number | null;
  targetPrice: number | null;
  lots: number | null;
  /** The risk in account currency: the balance before the trade × its risk %. Derived. */
  riskUsd: number | null;
  /** 5m ATR(14) on the MSS candle, and how far that candle closed beyond the swing ($). */
  atr: number | null;
  mssBeyond: number | null;

  /* ── Exit ── */
  /** "YYYY-MM-DDTHH:mm", New York. */
  exitTime: string;
  exitPrice: number | null;
  exitReason: ExitReason | "";
  /** The stop was moved before price covered half the way to the target. */
  earlyStopMove: boolean | null;
  /** When a red release fell inside the trade: was the stop at breakeven or better? */
  releaseAtBe: boolean | null;
  /** The best and worst prices between entry and exit; R comes from the initial stop. */
  mfePrice: number | null;
  maePrice: number | null;
  /** For early exits: would the target have been hit before the stop by the time stop? */
  targetBeforeStop: "yes" | "no" | "unknown" | "";
  /** For target exits: the furthest favourable price until the time stop. */
  maxFavPrice: number | null;
  /**
   * Since 2.0 the excursions are logged in R, no prices needed: how far the trade went
   * your way (MFE) and against you (MAE, positive), and for a target exit how far it
   * would have gone by the time stop. Older trades work these out from their prices.
   */
  mfeR: number | null;
  maeR: number | null;
  maxFavR: number | null;
  screenshotAfter: string;

  createdAt: string;
  updatedAt: string;
}

export type HtfReasonType = "FVG" | "OB" | "VIMB";
export const HTF_REASON_TYPES: HtfReasonType[] = ["FVG", "OB", "VIMB"];
/** Lowest to highest: a higher one takes over a lower one. */
export type HtfTimeframe = "1H" | "4H" | "D" | "W";
export const HTF_TIMEFRAMES: { value: HtfTimeframe; label: string }[] = [
  { value: "1H", label: "1H" },
  { value: "4H", label: "4H" },
  { value: "D", label: "Daily" },
  { value: "W", label: "Weekly" },
];
export interface HtfReason {
  type: HtfReasonType;
  tf: HtfTimeframe;
}
export const htfRank = (tf: HtfTimeframe) => HTF_TIMEFRAMES.findIndex((x) => x.value === tf);
export const htfTfLabel = (tf: HtfTimeframe) => HTF_TIMEFRAMES.find((x) => x.value === tf)?.label ?? tf;
/** The reason that counts: the highest timeframe wins; on a tie, FVG before OB before VIMB. */
export function topHtf(reasons: HtfReason[] | undefined): HtfReason | null {
  let top: HtfReason | null = null;
  for (const r of reasons ?? []) {
    const better =
      !top ||
      htfRank(r.tf) > htfRank(top.tf) ||
      (htfRank(r.tf) === htfRank(top.tf) && HTF_REASON_TYPES.indexOf(r.type) < HTF_REASON_TYPES.indexOf(top.type));
    if (better) top = r;
  }
  return top;
}
export type PoiTests = "fresh" | "once" | "2+";
export const POI_TESTS: { value: PoiTests; label: string }[] = [
  { value: "fresh", label: "Fresh" },
  { value: "once", label: "Tested once" },
  { value: "2+", label: "Tested 2+" },
];
export type DeskAgreed = "yes" | "no" | "none";
/** Did your daily bias match the briefing's? "none" stays only on trades logged with no briefing. */
export const DESK_AGREED: { value: DeskAgreed; label: string }[] = [
  { value: "yes", label: "Matched" },
  { value: "no", label: "Differed" },
  { value: "none", label: "No briefing" },
];
export type EntryType = "market" | "limit";
export type ExitReason = "target" | "stop" | "breakeven" | "trail" | "time" | "release" | "other";
export const EXIT_REASONS: { value: ExitReason; label: string }[] = [
  { value: "target", label: "Target" },
  { value: "stop", label: "Stop" },
  { value: "breakeven", label: "Breakeven" },
  { value: "trail", label: "Trailing stop" },
  { value: "time", label: "Time stop" },
  { value: "release", label: "Release rule" },
  { value: "other", label: "Other" },
];
export const exitReasonLabel = (r: string) => EXIT_REASONS.find((x) => x.value === r)?.label ?? "";

/** Every rulebook field a trade carries, empty — what an older or blank trade starts with. */
export const EMPTY_RULEBOOK_FIELDS = {
  rulebookVersion: null,
  boxHigh: null,
  boxLow: null,
  sweepExtreme: null,
  sweepDepth: null,
  took15mSwing: null,
  htfReasonType: "",
  htfReasons: [] as HtfReason[],
  poiTests: "",
  levelSweep: null,
  deskAgreed: "",
  entryType: "",
  entryPrice: null,
  stopPrice: null,
  targetPrice: null,
  lots: null,
  riskUsd: null,
  atr: null,
  mssBeyond: null,
  exitTime: "",
  exitPrice: null,
  exitReason: "",
  earlyStopMove: null,
  releaseAtBe: null,
  mfePrice: null,
  maePrice: null,
  targetBeforeStop: "",
  maxFavPrice: null,
  mfeR: null,
  maeR: null,
  maxFavR: null,
  screenshotAfter: "",
} satisfies Partial<Trade>;

export type TradeInput = Omit<Trade, "id" | "createdAt" | "updatedAt">;

/**
 * A rule a trade broke. Saving is never blocked by one; it is recorded, and every
 * flag on a taken trade feeds the consequence ladder.
 */
export type TradeFlag =
  | "over_risk"
  | "non_traded_grade"
  | "after_daily_stop"
  | "after_weekly_stop"
  | "second_trade_today"
  | "outside_entry_window"
  | "skip_day"
  | "in_release_window"
  | "held_risk_through_release"
  | "past_time_stop"
  | "discretionary_exit"
  | "early_stop_move"
  | "during_day_off";

export const FLAG_LABEL: Record<TradeFlag, string> = {
  over_risk: "Risked more than allowed",
  non_traded_grade: "Took a grade that isn't tradable",
  after_daily_stop: "Traded after the daily stop",
  after_weekly_stop: "Traded after the weekly stop",
  second_trade_today: "A second trade the same day",
  outside_entry_window: "Entered outside the entry window",
  skip_day: "Traded on a skip day",
  in_release_window: "Entered inside a release window",
  held_risk_through_release: "Held through a release without breakeven",
  past_time_stop: "Held past the time stop",
  discretionary_exit: "Closed on a discretionary exit",
  early_stop_move: "Moved the stop before halfway",
  during_day_off: "Traded on a day off, or above half risk",
};

export const ALL_FLAGS = Object.keys(FLAG_LABEL) as TradeFlag[];

/** One release on a trade's day. "Manual" is something you typed in that the feed didn't have. */
export interface TradeNews {
  title: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday" | "Manual";
  /** "HH:mm" New York, or "" when unknown. */
  time: string;
}

/**
 * The account's lines, all as % of a balance.
 *
 * Three are yours — the most one trade may risk, the most a day and a week may lose.
 * Two are the prop firm's — the lines that end the account — and those are measured
 * against the starting balance, the way FTMO states them.
 */
export interface Limits {
  enabled: boolean;
  /** What the prop account was opened with; the firm's lines are measured from here. */
  startBalance: number;
  /**
   * The account's balance when this journal starts. Compounding starts here: the
   * account had already moved before the first trade logged in the desk.
   */
  openingBalance: number;
  /** The second account, traded at the same % risk but not journaled. */
  secondAccount: number;
  /** Your hard cap per trade. */
  maxRiskPct: number;
  /** Your daily stop: once the day has lost this much, the desk is closed. */
  dailyStopPct: number;
  /** Your weekly stop, per ISO week (Mon–Fri on New York days). */
  weeklyStopPct: number;
  /** The prop firm's daily line. */
  dailyLossPct: number;
  /** The prop firm's overall line. */
  maxLossPct: number;
  /** The challenge's profit targets. */
  phase1TargetPct: number;
  phase2TargetPct: number;
}

/** What a missing rulebook falls back to: your rules, and FTMO's standard account. */
export const DEFAULT_LIMITS: Limits = {
  enabled: true,
  startBalance: 200_000,
  openingBalance: 193_933.27,
  secondAccount: 100_000,
  maxRiskPct: 0.5,
  dailyStopPct: 1,
  weeklyStopPct: 2,
  dailyLossPct: 5,
  maxLossPct: 10,
  phase1TargetPct: 10,
  phase2TargetPct: 5,
};

export const SESSIONS = ["Asia", "London", "New York"];

/* ── Grades ──────────────────────────────────────────────────────────── */

export type Grade = "A+" | "A" | "B" | "C";
/** Best first. What earns each rung is the rulebook's own. */
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

/* ── The rulebook's grading definition ───────────────────────────────── */

/**
 * Who answers a base rule when the desk can know it:
 *  - `daily-budget`: the day's loss budget is left and no trade was taken yet today
 *  - `news`: not a skip day and not inside a release window, at the entry time
 *  - `entry-window`: the entry time is inside the entry window
 *  - `plan`: v1.2 only — a daily plan written on time. Retired in v1.3; an old
 *    snapshot's plan rule now reads as held, so the grades it gave stand.
 * When the data to decide is missing, the rule falls back to a hand tick.
 */
export type AutoRule = "daily-budget" | "news" | "entry-window" | "plan";
/** The auto rules a rule can be given today — `plan` is kept only for v1.2 snapshots. */
export const AUTO_RULES: AutoRule[] = ["daily-budget", "news", "entry-window"];

/**
 * A yes/no condition that must hold for any trade. One unticked base rule caps the
 * grade at C. `auto` rules are answered by the app rather than ticked by hand.
 */
export interface BaseRule {
  id: string;
  text: string;
  hint: string;
  auto?: AutoRule;
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

/**
 * A factor whose answer the desk fills in:
 *  - `compass`: the frozen Compass value for the trade's weekday and direction
 *  - `displacement`: the MSS close beyond the swing ÷ the 5m ATR(14)
 *  - `bias`: v1.2 only — the bias came from the daily plan. Since v1.3 the bias is
 *    answered by hand, and an old snapshot's `bias` factor is a plain choice.
 */
export type AutoFactor = "compass" | "displacement" | "bias";

interface FactorBase {
  id: string;
  name: string;
  hint: string;
  auto?: AutoFactor;
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
  /**
   * What the Forex Tester backtest risks on this grade — null when the backtest skips
   * it. Shown in the rulebook only; the desk journals live trades.
   */
  backtestRiskPct?: number | null;
}

/** What a trade is graded against — and what a trade freezes. */
export interface Definition {
  baseRules: BaseRule[];
  factors: Factor[];
  /** Always four cards, A+ to C. */
  grades: GradeCard[];
}

/**
 * A trade's frozen copy of the rules it was graded against, and how it was answered.
 * `answers` holds an option id for a choice factor and a number for a number factor.
 */
export interface SetupSnapshot extends Definition {
  /** On trades graded before the rulebook: the name of what they were graded against. */
  strategyName?: string;
  /** On trades graded under the rulebook: its version. */
  rulebookVersion?: string;
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

/** The base rules a trade was measured against: its own frozen copy, or none for an ungraded trade. */
export function checklistOf(trade: { setupSnapshot?: SetupSnapshot | null }): ChecklistItem[] {
  return (trade.setupSnapshot?.baseRules ?? []).map((r) => ({ id: r.id, label: r.text, hint: r.hint || undefined }));
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
