/**
 * Discipline: which rules each trade broke, and what that costs the days after it.
 *
 * Everything is derived, never stored as a decision. The history is walked in date
 * order; each trade is judged against what had happened before it — the day's and the
 * week's loss budgets, a day off still running, the morning's check-in — and its flags
 * in turn set the days off that follow. The server re-runs this after every write, so
 * deleting a mistaken first trade also clears the "second trade today" on the one after
 * it, and the day off that came with it.
 *
 * One consequence, as the rulebook a trade was graded under sets it: any broken rule
 * costs the rest of that New York day and the next `daysOff` trading days (weekdays).
 *
 * Setups logged as not taken count toward nothing here.
 */
import type { CheckIn, Verdict } from "./checkin";
import { fromTradeNews, inSkipRange, newsDay, releaseWindowAt, type NewsDay, type NewsItem } from "./newsRules";
import { allowedRisk, dayBudget, gradeCard, takenTrades, weekBudget, weekOfDay, type DayBudget } from "./risk";
import type { Rulebook } from "./rulebook";
import { dayOf, minutesOf, pastTimeStop, timeOf } from "./rules";
import { isClosed } from "./stats";
import { deskDateLabel, deskNow } from "./tz";
import { ALL_FLAGS, type AutoRule, type Grade, type Trade, type TradeFlag } from "./types";

const EPS = 1e-9;

export interface DisciplineInput {
  trades: Trade[];
  checkins: Pick<CheckIn, "date" | "verdict">[];
  /** The rulebook a trade was graded under; the current one for null or an unknown version. */
  rulebookOf: (version: string | null) => Rulebook;
  now?: Date;
}

/** What one taken trade was judged as. */
export interface TradeJudgement {
  flags: TradeFlag[];
  /** What the rules allowed it to risk, the check-in and any day off included. */
  allowed: number;
}

/** Why a day is off. */
export interface DayOff {
  reason: "rule-break" | "days-off";
  /** The day of the trade that broke the rule. */
  from: string;
  /** For the days off after it: the last one. */
  until?: string;
}

/** "Wednesday 30 Sept" for a New York day. */
const dayLabel = (day: string) => deskDateLabel(`${day}T12:00:00Z`);

/**
 * A run of days off in words, as read on `day`: "Day off today" on its last day, "Days off
 * until Thursday 8 Oct" before that. With one day off, that day is always the last.
 */
export function daysOffText(off: DayOff, day: string): string {
  return !off.until || off.until <= day ? "Day off today" : `Days off until ${dayLabel(off.until)}`;
}

/** The whole line, the same on every screen that shows it. */
export function dayOffLine(off: DayOff, day: string): string {
  return off.reason === "rule-break"
    ? "Day off — a rule was broken today."
    : `${daysOffText(off, day)} — after a rule break on ${dayLabel(off.from)}.`;
}

export interface Timeline {
  dayOff: Map<string, DayOff>;
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

/** Monday and Friday of the ISO week a New York day falls in. */
export function weekSpan(day: string): { from: string; to: string } {
  const [y, m, d] = day.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Monday
  return { from: addDays(day, -wd), to: addDays(day, 4 - wd) };
}

/* ── One trade's news ────────────────────────────────────────────────── */

/** The news rules applied to the releases a trade saved with itself. */
export const tradeNewsDay = (t: Pick<Trade, "date" | "news">, doc: Rulebook): NewsDay =>
  newsDay(dayOf(t.date), t.news.map(fromTradeNews), doc.news);

/** The window releases a trade sat through: entered before it, still open when it hit. */
export function releasesHeld(t: Pick<Trade, "date" | "exitTime" | "news">, doc: Rulebook) {
  if (!t.exitTime) return [];
  const entry = minutesOf(timeOf(t.date))!;
  const exitDayLater = dayOf(t.exitTime) > dayOf(t.date);
  const exit = exitDayLater ? Infinity : (minutesOf(timeOf(t.exitTime)) ?? -Infinity);
  return tradeNewsDay(t, doc).windows.filter((w) => entry < w.at && exit > w.at - doc.news.beforeMin);
}

/* ── The walk ────────────────────────────────────────────────────────── */

const byTime = (a: Trade, b: Trade) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

export function evaluateHistory(input: DisciplineInput): { byId: Map<string, TradeJudgement>; timeline: Timeline } {
  const nowStamp = deskNow(input.now ?? new Date());
  const taken = takenTrades(input.trades).sort(byTime);

  const byId = new Map<string, TradeJudgement>();
  const timeline: Timeline = { dayOff: new Map() };
  const earlier: Trade[] = [];

  for (const t of taken) {
    const doc = input.rulebookOf(t.rulebookVersion);
    const day = dayOf(t.date);
    const dayB = dayBudget(earlier, day, doc.limits, { before: t.date });
    const weekB = weekBudget(earlier, day, doc.limits, { before: t.date });
    const off = timeline.dayOff.get(day);
    const card = gradeCard(t.setupSnapshot ?? doc, t.grade || null);
    const gradeOk = Boolean(card?.traded);
    const base = allowedRisk(card?.traded ? card.riskPct : 0, dayB, doc.limits, { week: weekB });
    const allowed = off || !gradeOk ? 0 : base;

    const set = new Set<TradeFlag>();
    const sameDay = earlier.filter((x) => dayOf(x.date) === day).length;
    if (dayB.stopHit) set.add("after_daily_stop");
    if (weekB.stopHit) set.add("after_weekly_stop");
    if (sameDay >= doc.maxTradesPerDay) set.add("second_trade_today");
    if (!gradeOk) set.add("non_traded_grade");
    if (off) set.add("during_day_off");

    const stopped = dayB.stopHit || weekB.stopHit;
    const overCap = t.riskPct > doc.limits.maxRiskPct + EPS;
    const overAllowance = t.riskPct > base + EPS && !stopped && gradeOk && !off;
    if (overCap || overAllowance) set.add("over_risk");

    const news = tradeNewsDay(t, doc);
    if (news.skip.length || inSkipRange(day, doc.news)) set.add("skip_day");
    if (releaseWindowAt(minutesOf(timeOf(t.date))!, news)) set.add("in_release_window");
    if (t.releaseAtBe !== true && releasesHeld(t, doc).length) set.add("held_risk_through_release");

    const stillOpenPastStop = !isClosed(t) && !t.exitTime && nowStamp > `${day}T${doc.timeStop}`;
    if (pastTimeStop(t.date, t.exitTime, doc.timeStop) || stillOpenPastStop) set.add("past_time_stop");
    if (t.exitReason === "other") set.add("discretionary_exit");
    if (t.earlyStopMove === true) set.add("early_stop_move");

    const flags = ALL_FLAGS.filter((f) => set.has(f));
    byId.set(t.id, { flags, allowed });
    earlier.push(t);

    if (!flags.length) continue;
    // A broken rule: the rest of the day off, then the next trading days.
    if (!timeline.dayOff.has(day)) timeline.dayOff.set(day, { reason: "rule-break", from: day });
    const days = nextTradingDays(day, doc.daysOff);
    const until = days[days.length - 1];
    for (const d of days) {
      const had = timeline.dayOff.get(d);
      if (!had || had.reason !== "days-off" || (had.until ?? "") < until) timeline.dayOff.set(d, { reason: "days-off", from: day, until });
    }
  }
  return { byId, timeline };
}

/** One draft trade judged against the rest of the history, as the form shows it before saving. */
export function judgeDraft(draft: Trade, input: DisciplineInput): TradeJudgement {
  const trades = [...input.trades.filter((t) => t.id !== draft.id), draft];
  return evaluateHistory({ ...input, trades }).byId.get(draft.id) ?? { flags: [], allowed: 0 };
}

/* ── Today ───────────────────────────────────────────────────────────── */

export interface DeskStatus {
  day: string;
  week: string;
  dayOff: DayOff | null;
  dayBudget: DayBudget;
  weekBudget: DayBudget;
  /** Today's taken trades, and whether today's one trade is done with. */
  takenToday: Trade[];
  open: Trade[];
  doneForToday: boolean;
  /** Today is a skip day — from today's news, or the fixed year-end range. */
  skipDay: boolean;
  verdict: Verdict | undefined;
  /** What each grade may risk right now, after everything above. */
  allowedByGrade: Record<Grade, number>;
  /** Why nothing may be traded today, in a few words; null when the day is open. */
  blocked: string | null;
}

/**
 * Today as the rules see it. `news` is today's calendar under the news rules (null when
 * the calendar has nothing for today): a skip day leaves nothing tradable.
 */
export function deskStatus(input: DisciplineInput & { doc: Rulebook; news?: NewsDay | null }): DeskStatus {
  const stamp = deskNow(input.now ?? new Date());
  const day = stamp.slice(0, 10);
  const { timeline } = evaluateHistory(input);
  const doc = input.doc;
  const taken = takenTrades(input.trades);
  const takenToday = taken.filter((t) => dayOf(t.date) === day);
  const open = taken.filter((t) => !isClosed(t));
  const dayB = dayBudget(taken, day, doc.limits);
  const weekB = weekBudget(taken, day, doc.limits);
  const dayOff = timeline.dayOff.get(day) ?? null;
  const verdict = input.checkins.find((c) => c.date === day)?.verdict;
  const doneForToday = takenToday.filter(isClosed).length >= doc.maxTradesPerDay || dayB.stopHit;
  const skipDay = Boolean(input.news?.skip.length) || inSkipRange(day, doc.news);

  // The first thing that closes the whole day, most serious first.
  const blocked = isWeekend(day)
    ? "it's the weekend"
    : dayOff
      ? dayOff.reason === "rule-break"
        ? "a rule was broken today"
        : "a day off after a broken rule"
      : weekB.stopHit
        ? "the weekly stop is hit"
        : dayB.stopHit
          ? "the daily stop is hit"
          : skipDay
            ? "it's a skip day"
            : takenToday.length >= doc.maxTradesPerDay
              ? "today's trade is taken"
              : null;
  const allowedByGrade = {} as Record<Grade, number>;
  for (const card of doc.grades) {
    allowedByGrade[card.grade] =
      blocked || doneForToday || !card.traded ? 0 : allowedRisk(card.riskPct, dayB, doc.limits, { week: weekB });
  }
  return { day, week: weekOfDay(day), dayOff, dayBudget: dayB, weekBudget: weekB, takenToday, open, doneForToday, skipDay, verdict, allowedByGrade, blocked };
}

/* ── The base rules the desk answers itself ──────────────────────────── */

export interface AutoContext {
  doc: Rulebook;
  /** The trade's "YYYY-MM-DDTHH:mm". */
  date: string;
  /** Taken trades other than this one. */
  trades: Trade[];
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
    case "news": {
      if (inSkipRange(day, doc.news)) return false;
      if (ctx.news == null) return null;
      const nd = newsDay(day, ctx.news, doc.news);
      const m = minutesOf(time);
      return !nd.skip.length && (m == null || !releaseWindowAt(m, nd));
    }
  }
}

/* ── Adherence ───────────────────────────────────────────────────────── */

/**
 * Rule adherence: the share of taken trades that broke no rule, over New York days from
 * `from` to `to` (inclusive). The target is 100% — reviewed weekly next to the result.
 */
export function adherence(trades: Trade[], from?: string, to?: string): { n: number; clean: number; rate: number | null } {
  const mine = takenTrades(trades).filter((t) => {
    const d = dayOf(t.date);
    return (from == null || d >= from) && (to == null || d <= to);
  });
  const clean = mine.filter((t) => !t.flags.length).length;
  return { n: mine.length, clean, rate: mine.length ? clean / mine.length : null };
}
