export type Direction = "long" | "short";
export type Outcome = "win" | "loss" | "be" | "open";

export interface Trade {
  id: string;
  /** New York wall clock, "YYYY-MM-DDTHH:mm". */
  date: string;
  /** Always the rulebook's instrument. */
  symbol: string;
  direction: Direction;
  /** Asia, London or New York — set from the entry time. */
  session: string;
  /** The risk taken, % of the account. 0 on a setup that wasn't taken. */
  riskPct: number;
  /** What the rules allowed it to risk. Derived on the server. */
  plannedRiskPct: number | null;
  plannedRR: number | null;
  /** In R, derived from the dollar result and the balance before it; null while open. */
  resultR: number | null;
  /** The broker's result in account currency, costs included. Null while open. */
  pnlUsd: number | null;
  /** The balance before the trade × its risk %. Derived. */
  riskUsd: number | null;
  /** The setup's grade, worked out from the rules and factors it was graded against. */
  grade: Grade | "";
  /**
   * The rules and your answers, frozen when the trade was logged — so editing the
   * rulebook later never rewrites the history measured against it.
   */
  setupSnapshot: SetupSnapshot | null;
  /** The rulebook version it was graded under. */
  rulebookVersion: string;
  /** Rules this trade broke. Saving is never blocked; it is recorded. Derived on the server. */
  flags: TradeFlag[];
  /** Your reason, when a flag was raised. */
  flagNote: string;
  /** A setup logged but not taken — a B, or a pass. It never touches the account. */
  skipped: boolean;
  /** For a setup not taken: what it would have made, in R. */
  hypotheticalR: number | null;

  /* ── The setup ── */
  /** The CRT box, high minus low, in $. */
  boxSize: number | null;
  /** How far the sweep reached beyond the box edge, in $. */
  sweepDepth: number | null;
  took15mSwing: boolean | null;
  /** The sweep took an important level (logged, not a rule yet). */
  levelSweep: boolean | null;
  /** Every HTF reason behind the trade, each with its timeframe; the highest one counts. */
  htfReasons: HtfReason[];
  poiTests: PoiTests | "";
  /** Your daily bias matched the Daily Bias briefing's. */
  biasMatch: boolean | null;

  /* ── The exit ── */
  /** "YYYY-MM-DDTHH:mm", New York. */
  exitTime: string;
  exitReason: ExitReason | "";
  /** The stop was moved before price covered the trail distance. */
  earlyStopMove: boolean | null;
  /** When a red release fell inside the trade: was the stop at breakeven or better? */
  releaseAtBe: boolean | null;
  /** How far it went your way (MFE) and against you (MAE, positive), in R. */
  mfeR: number | null;
  maeR: number | null;
  /** For a target exit: how far it would have run by the time stop, in R. */
  maxFavR: number | null;
  /** For an early exit: would the target have been hit before the stop by the time stop? */
  targetBeforeStop: "yes" | "no" | "unknown" | "";

  /* ── Review ── */
  /** 1 calm … 5 tilted. */
  emotion: number | null;
  mistakes: string[];
  notes: string;
  /** TradingView snapshot links. */
  screenshot: string;
  screenshotAfter: string;
  /** The news on the trade's New York day, copied in — the calendar only keeps a couple of weeks. */
  news: TradeNews[];

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

/** What the form sends; the server derives the rest (R, risk $, flags, what was allowed). */
export type TradeInput = Omit<Trade, "id" | "createdAt" | "updatedAt" | "resultR" | "riskUsd" | "flags" | "plannedRiskPct">;

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
  skip_day: "Traded on a skip day",
  in_release_window: "Entered inside a release window",
  held_risk_through_release: "Held through a release without breakeven",
  past_time_stop: "Held past the time stop",
  discretionary_exit: "Closed on a discretionary exit",
  early_stop_move: "Moved the stop too early",
  during_day_off: "Traded on a day off",
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
  /** The account you log trades in, e.g. "FTMO 200K". */
  accountName: string;
  /** What the prop account was opened with; the firm's lines are measured from here. */
  startBalance: number;
  /**
   * The account's balance when this journal starts. Compounding starts here: the
   * account had already moved before the first trade logged in the desk.
   */
  openingBalance: number;
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
  /** The challenge's profit target for the phase being traded. */
  targetPct: number;
  /**
   * Accounts that take every trade at the same %. You log only the main account's $;
   * theirs is worked out from it, so the desk can show each one and the total.
   */
  linked: LinkedAccount[];
}

export interface LinkedAccount {
  name: string;
  /** Its balance when the journal started. */
  opening: number;
}

export const SESSIONS = ["Asia", "London", "New York"];

/* ── Grades ──────────────────────────────────────────────────────────── */

export type Grade = "A+" | "A" | "B" | "C";
/** Best first. What earns each rung is the rulebook's own. */
export const GRADES: Grade[] = ["A+", "A", "B", "C"];
/** 0 for A+ … 3 for C — a higher number is a lower grade. */
export const gradeRank = (g: Grade) => GRADES.indexOf(g);
export const isGrade = (g: unknown): g is Grade => GRADES.includes(g as Grade);

/**
 * What went wrong in how you traded it — the things no rule can see. A broken rule
 * (risk, the stop, the news, the exit) is flagged by the desk on its own.
 */
export const MISTAKES = ["FOMO entry", "Late entry", "Hesitated", "Revenge trade", "Distracted"];
export const EMOTIONS = ["Calm", "Focused", "Neutral", "Anxious", "Tilted"];

/* ── The rulebook's grading definition ───────────────────────────────── */

/**
 * A base rule the desk answers itself, because it knows:
 *  - `daily-budget`: the day's loss budget is left and no trade was taken yet today
 *  - `news`: not a skip day and not inside a release window, at the entry time
 * When the data to decide is missing (no calendar for the day), it falls back to a hand tick.
 */
export type AutoRule = "daily-budget" | "news";
export const AUTO_RULES: AutoRule[] = ["daily-budget", "news"];

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
  /** The base rules that held — ticked by hand, or held by the desk's own check. */
  ticked: string[];
  answers: Record<string, string | number>;
  grade: Grade | null;
}

/** Base rules as every checklist shows them: the ones you tick first, the desk's own (auto) ones last. */
export const autoLast = <R extends Pick<BaseRule, "auto">>(rules: R[]): R[] => [...rules.filter((r) => !r.auto), ...rules.filter((r) => r.auto)];

/** How many of its base rules a trade held, from its own frozen copy of them. */
export function rulesHeld(t: Pick<Trade, "setupSnapshot">): { held: number; of: number } | null {
  const snap = t.setupSnapshot;
  if (!snap) return null;
  const ids = new Set(snap.baseRules.map((r) => r.id));
  return { held: snap.ticked.filter((id) => ids.has(id)).length, of: snap.baseRules.length };
}

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
