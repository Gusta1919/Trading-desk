/**
 * Discipline: which rules each trade broke, and what that costs the days after it.
 *
 * Everything is derived, never stored as a decision. The history is walked in date
 * order; each trade is judged against what had happened before it — the day's and
 * the week's budgets, the consequences already running, the plan, the check-in — and
 * its flags in turn set the consequences for what follows. The server re-runs this
 * after every write, so deleting a mistaken first trade also clears the "second trade
 * today" on the one after it, and the two days off that came with it.
 *
 * The consequence ladder (rulebook, Discipline and enforcement):
 *  - any flagged taken trade → the rest of that New York day off
 *  - N flagged taken trades in one ISO week → the next ISO week at reduced risk
 *  - a second trade, or trading after the daily or weekly stop → the next N trading
 *    days off (weekdays; skip days count as days)
 *
 * Skipped setups — logged, never taken — count toward nothing here.
 */
import type { CheckIn, Verdict } from "./checkin";
import { fromTradeNews, newsDay, releaseWindowAt, type NewsDay, type NewsItem, inSkipRange } from "./newsRules";
import { planStatus, type Plan, type PlanStatus } from "./plans";
import { allowedRisk, dayBudget, gradeCard, takenTrades, weekBudget, weekOfDay, type DayBudget } from "./risk";
import { atLeast, type Rulebook } from "./rulebook";
import { FIRST_VERSION } from "./rulebookText";
import { dayOf, inEntryWindow, minutesOf, pastTimeStop, timeOf } from "./rules";
import { isClosed } from "./stats";
import { deskNow } from "./tz";
import { ALL_FLAGS, type AutoRule, type Grade, type GradeCard, type Trade, type TradeFlag } from "./types";

const EPS = 1e-9;

/** Flags that cost the next trading days, not only the rest of today. */
export const LIMIT_FLAGS: TradeFlag[] = ["second_trade_today", "after_daily_stop", "after_weekly_stop"];

export interface DisciplineInput {
  trades: Trade[];
  plans: Plan[];
  checkins: Pick<CheckIn, "date" | "verdict">[];
  /** The rulebook a trade was graded under; null = the current one. */
  rulebookOf: (version: string | null) => Rulebook;
  now?: Date;
}

/** What one taken trade was judged as. */
export interface TradeJudgement {
  flags: TradeFlag[];
  /** What the rules allowed it to risk, consequences and check-in included. */
  allowed: number;
  /** Graded under the rulebook, so every rule was checked; older trades keep their own flags. */
  ruled: boolean;
}

/** Why a day is off. */
export interface DayOff {
  reason: "rule-break" | "days-off";
  /** The trade's day that caused it. */
  from: string;
  /** For a run of days off: the last day of it. */
  until?: string;
}

export interface Timeline {
  dayOff: Map<string, DayOff>;
  /** ISO weeks at reduced risk, with the week that caused it. */
  halfWeeks: Map<string, string>;
  /** Flagged taken trades per ISO week. */
  breaksByWeek: Map<string, number>;
}

/* ── Calendar helpers on "YYYY-MM-DD" strings ────────────────────────── */

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const isWeekend = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
};

/** The next n weekdays after a day. */
export function nextTradingDays(day: string, n: number): string[] {
  const out: string[] = [];
  for (let d = addDays(day, 1); out.length < n; d = addDays(d, 1)) if (!isWeekend(d)) out.push(d);
  return out;
}

export const nextWeek = (day: string) => weekOfDay(addDays(day, 7));

/* ── What a check-in allows ──────────────────────────────────────────── */

/**
 * Whether a grade may be traded on a day with this check-in: Ready keeps the ladder,
 * Caution leaves A+ only, Sit out leaves nothing.
 */
export function tradableToday(card: GradeCard | null, verdict: Verdict | undefined): boolean {
  if (!card?.traded) return false;
  if (verdict === "sit-out") return false;
  if (verdict === "caution") return card.grade === "A+";
  return true;
}

/* ── One trade's news ────────────────────────────────────────────────── */

/** The news rules applied to the releases a trade saved with itself. */
export const tradeNewsDay = (t: Pick<Trade, "date" | "news">, doc: Rulebook): NewsDay =>
  newsDay(dayOf(t.date), t.news.map(fromTradeNews), doc.news);

/** The window releases a trade sat through: entered before it, still open 5 minutes before it. */
export function releasesHeld(t: Pick<Trade, "date" | "exitTime" | "news">, doc: Rulebook) {
  if (!t.exitTime) return [];
  const entry = minutesOf(timeOf(t.date))!;
  const exitDayLater = dayOf(t.exitTime) > dayOf(t.date);
  const exit = exitDayLater ? Infinity : minutesOf(timeOf(t.exitTime)) ?? -Infinity;
  return tradeNewsDay(t, doc).windows.filter((w) => entry < w.at && exit > w.at - doc.news.beforeMin);
}

/* ── The walk ────────────────────────────────────────────────────────── */

const byTime = (a: Trade, b: Trade) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export function evaluateHistory(input: DisciplineInput): { byId: Map<string, TradeJudgement>; timeline: Timeline } {
  const now = input.now ?? new Date();
  const nowStamp = deskNow(now);
  const plans = new Map(input.plans.map((p) => [p.date, p]));
  const verdicts = new Map(input.checkins.map((c) => [c.date, c.verdict]));
  const taken = takenTrades(input.trades).sort(byTime);

  const byId = new Map<string, TradeJudgement>();
  const timeline: Timeline = { dayOff: new Map(), halfWeeks: new Map(), breaksByWeek: new Map() };
  const earlier: Trade[] = [];

  for (const t of taken) {
    const doc = input.rulebookOf(t.rulebookVersion);
    const day = dayOf(t.date);
    const week = weekOfDay(day);
    const ruled = atLeast(t.rulebookVersion, FIRST_VERSION);

    const dayB = dayBudget(earlier, day, doc.limits, { before: t.date });
    const weekB = weekBudget(earlier, day, doc.limits, { before: t.date });
    const off = timeline.dayOff.get(day);
    const half = timeline.halfWeeks.has(week);
    const card = gradeCard(t.setupSnapshot ?? doc, t.grade || null);
    const tradable = tradableToday(card, verdicts.get(day));
    const gRisk = card ? (card.traded ? card.riskPct : 0) : null;
    const base = allowedRisk(gRisk, dayB, doc.limits, { week: weekB });
    const allowed = off || (card && !tradable) ? 0 : allowedRisk(gRisk, dayB, doc.limits, { week: weekB, multiplier: half ? doc.consequences.factor : 1 });

    let flags: TradeFlag[];
    if (!ruled) {
      flags = t.flags.filter((f) => (ALL_FLAGS as string[]).includes(f));
    } else {
      const set = new Set<TradeFlag>();
      const sameDay = earlier.filter((x) => dayOf(x.date) === day).length;
      if (dayB.stopHit) set.add("after_daily_stop");
      if (weekB.stopHit) set.add("after_weekly_stop");
      if (sameDay >= doc.maxTradesPerDay) set.add("second_trade_today");
      if (card && !tradable) set.add("non_traded_grade");
      if (off) set.add("during_day_off");
      else if (half && t.riskPct > allowed + EPS && tradable) set.add("during_day_off");

      const stopped = dayB.stopHit || weekB.stopHit;
      const overCap = t.riskPct > doc.limits.maxRiskPct + EPS;
      const overAllowance = t.riskPct > base + EPS && !stopped && !(card && !tradable) && !off;
      if (overCap || overAllowance) set.add("over_risk");

      if (!inEntryWindow(timeOf(t.date), doc.entryWindows)) set.add("outside_entry_window");
      const news = tradeNewsDay(t, doc);
      if (news.skip.length) set.add("skip_day");
      if (releaseWindowAt(minutesOf(timeOf(t.date))!, news)) set.add("in_release_window");
      if (t.releaseAtBe !== true && releasesHeld(t, doc).length) set.add("held_risk_through_release");

      const stillOpenPastStop = !isClosed(t) && !t.exitTime && nowStamp > `${day}T${doc.timeStop}`;
      if (pastTimeStop(t.date, t.exitTime, doc.timeStop) || stillOpenPastStop) set.add("past_time_stop");
      if (t.exitReason === "other") set.add("discretionary_exit");
      if (t.earlyStopMove === true) set.add("early_stop_move");
      if (planStatus(plans.get(day), doc.planBy) !== "on-time") set.add("no_plan");
      flags = ALL_FLAGS.filter((f) => set.has(f));
    }

    byId.set(t.id, { flags, allowed, ruled });
    earlier.push(t);

    if (!flags.length) continue;
    // Any rule break: the rest of the day off.
    if (!timeline.dayOff.has(day)) timeline.dayOff.set(day, { reason: "rule-break", from: day });
    // Enough breaks in one week: the next week at reduced risk.
    const n = (timeline.breaksByWeek.get(week) ?? 0) + 1;
    timeline.breaksByWeek.set(week, n);
    if (n >= doc.consequences.breaks && !timeline.halfWeeks.has(nextWeek(day))) timeline.halfWeeks.set(nextWeek(day), week);
    // The one-trade rule or a loss limit: the next trading days off.
    if (flags.some((f) => LIMIT_FLAGS.includes(f))) {
      const days = nextTradingDays(day, doc.consequences.daysOff);
      const until = days[days.length - 1];
      for (const d of days) {
        const had = timeline.dayOff.get(d);
        if (!had || had.reason !== "days-off" || (had.until ?? "") < until) {
          timeline.dayOff.set(d, { reason: "days-off", from: day, until });
        }
      }
    }
  }
  return { byId, timeline };
}

/** One draft trade judged against the rest of the history, as the form shows it before saving. */
export function judgeDraft(draft: Trade, input: DisciplineInput): TradeJudgement {
  const trades = [...input.trades.filter((t) => t.id !== draft.id), draft];
  return evaluateHistory({ ...input, trades }).byId.get(draft.id) ?? { flags: [], allowed: 0, ruled: false };
}

/* ── Today, for the banners and the setup check ──────────────────────── */

export interface DeskStatus {
  day: string;
  week: string;
  dayOff: DayOff | null;
  halfRisk: boolean;
  /** 1, or the reduced-risk multiplier in a half-risk week. */
  multiplier: number;
  dayBudget: DayBudget;
  weekBudget: DayBudget;
  /** Today's taken trades, and whether today's one trade is done with. */
  takenToday: Trade[];
  open: Trade[];
  doneForToday: boolean;
  plan: PlanStatus;
  /** Past the plan deadline without a plan written on time. */
  noPlan: boolean;
  /** Today is a skip day — from today's news, or the fixed year-end range. */
  skipDay: boolean;
  verdict: Verdict | undefined;
  /** What each grade may risk right now, after everything above. */
  allowedByGrade: Record<Grade, number>;
}

/**
 * `news` is today as the news rules see it (null when the calendar has nothing for
 * today): a skip day leaves nothing tradable, like a missing plan does — both fail a
 * base rule, and a missing base rule makes any setup a C.
 */
export function deskStatus(input: DisciplineInput & { doc: Rulebook; news?: NewsDay | null }): DeskStatus {
  const now = input.now ?? new Date();
  const stamp = deskNow(now);
  const day = stamp.slice(0, 10);
  const week = weekOfDay(day);
  const { timeline } = evaluateHistory(input);
  const doc = input.doc;
  const taken = takenTrades(input.trades);
  const takenToday = taken.filter((t) => dayOf(t.date) === day);
  const open = taken.filter((t) => !isClosed(t));
  const dayB = dayBudget(taken, day, doc.limits);
  const weekB = weekBudget(taken, day, doc.limits);
  const dayOff = timeline.dayOff.get(day) ?? null;
  const halfRisk = timeline.halfWeeks.has(week);
  const multiplier = halfRisk ? doc.consequences.factor : 1;
  const plan = planStatus(input.plans.find((p) => p.date === day), doc.planBy);
  const verdict = input.checkins.find((c) => c.date === day)?.verdict;
  const doneForToday = takenToday.filter(isClosed).length >= doc.maxTradesPerDay || dayB.stopHit;

  const noPlan = plan !== "on-time" && stamp.slice(11, 16) >= doc.planBy;
  const skipDay = Boolean(input.news?.skip.length) || inSkipRange(day, doc.news);
  const allowedByGrade = {} as Record<Grade, number>;
  for (const card of doc.grades) {
    const gRisk = card.traded ? card.riskPct : 0;
    const blocked =
      dayOff ||
      doneForToday ||
      noPlan ||
      skipDay ||
      takenToday.length >= doc.maxTradesPerDay ||
      !tradableToday(card, verdict);
    allowedByGrade[card.grade] = blocked ? 0 : allowedRisk(gRisk, dayB, doc.limits, { week: weekB, multiplier });
  }
  return {
    day,
    week,
    dayOff,
    halfRisk,
    multiplier,
    dayBudget: dayB,
    weekBudget: weekB,
    takenToday,
    open,
    doneForToday,
    plan,
    noPlan,
    skipDay,
    verdict,
    allowedByGrade,
  };
}

/* ── The base rules the desk answers itself ──────────────────────────── */

export interface AutoContext {
  doc: Rulebook;
  /** The trade's "YYYY-MM-DDTHH:mm". */
  date: string;
  /** Taken trades before this one, excluding itself. */
  trades: Trade[];
  plans: Plan[];
  /** The day's releases, or null when nothing is known about that day. */
  news: NewsItem[] | null;
}

/**
 * The state of an automatic base rule: true or false when the desk can know it, null
 * when the data is missing and the rule falls back to a hand tick.
 */
export function autoRuleState(auto: AutoRule, ctx: AutoContext): boolean | null {
  const day = dayOf(ctx.date);
  const time = timeOf(ctx.date);
  const { doc } = ctx;
  switch (auto) {
    case "daily-budget": {
      const budget = dayBudget(ctx.trades, day, doc.limits, { before: ctx.date });
      const already = takenTrades(ctx.trades).filter((t) => dayOf(t.date) === day && t.date <= ctx.date).length;
      return !budget.stopHit && already < doc.maxTradesPerDay;
    }
    case "entry-window":
      return minutesOf(time) == null ? null : inEntryWindow(time, doc.entryWindows);
    case "plan":
      return planStatus(ctx.plans.find((p) => p.date === day), doc.planBy) === "on-time";
    case "news": {
      if (inSkipRange(day, doc.news)) return false;
      if (ctx.news == null) return null;
      const nd = newsDay(day, ctx.news, doc.news);
      const m = minutesOf(time);
      return !nd.skip.length && (m == null || !releaseWindowAt(m, nd));
    }
  }
}
