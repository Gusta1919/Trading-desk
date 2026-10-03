/**
 * The Coach — turns your own history into a pre-session briefing.
 *
 * Every message is grounded in YOUR numbers: it compares what is happening now
 * with what is statistically normal for your trading, so you can tell variance
 * ("this happens") from a real problem ("something changed") — and in the rulebook:
 * what today allows, what is running from yesterday, and what is ready to decide.
 */
import { VERDICTS, type CheckIn } from "./checkin";
import { dayKey, fmtPct, fmtR } from "./format";
import { classifyOutcome, groupBy, isClosed, summarize, tradePct } from "./stats";
import { accountState } from "./limits";
import { adherence, daysOffText, deskStatus, weekSpan } from "./discipline";
import { hypothesisResults } from "./hypotheses";
import type { NewsDay } from "./newsRules";
import { dayBudget } from "./risk";
import { tokenValues, type Rulebook } from "./rulebook";
import { minutesOf } from "./rules";
import { deskDateLabel, deskNow } from "./tz";
import { defaultRulebook } from "./goldModel";
import { FLAG_LABEL, type Trade, type TradeFlag } from "./types";
import {
  behaviour,
  brokeRules as breaksRules,
  edges,
  findInsights,
  firmLeaks,
  todaysFactors,
  type Insight,
} from "./insights";

export type Tone = "good" | "info" | "warn" | "alert";

export interface CoachCard {
  id: string;
  tone: Tone;
  title: string;
  body: string;
  /** The numbers behind the message. */
  stat?: string;
  /** The psychology principle — why this matters. */
  why?: string;
  priority: number;
}

export interface Briefing {
  headline: string;
  tone: Tone;
  cards: CoachCard[];
  principle: string;
  reflection: string;
  sample: number; // closed trades the analysis is based on
}

/* ── Probability helpers ─────────────────────────────────────────────── */

/** Chance of at least one run of ≥k losses in n trades, with loss chance q. */
export function probRunAtLeast(k: number, n: number, q: number) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let state = new Array(k).fill(0); // state[r] = P(current run is r, no k-run yet)
  state[0] = 1;
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const next = new Array(k).fill(0);
    for (let r = 0; r < k; r++) {
      if (!state[r]) continue;
      next[0] += state[r] * (1 - q);
      if (r + 1 >= k) hit += state[r] * q;
      else next[r + 1] += state[r] * q;
    }
    state = next;
  }
  return hit;
}

/** Expected longest losing run in n trades (exact, via the sum of tail probabilities). */
export function expectedLongestRun(n: number, q: number) {
  let e = 0;
  for (let k = 1; k <= n; k++) {
    const p = probRunAtLeast(k, n, q);
    e += p;
    if (p < 0.0005) break;
  }
  return e;
}

/** Small deterministic random generator, so the same data gives the same answer. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Re-shuffles your own trade results many times (bootstrap). */
function simulate<T>(samples: number[], runs: number, horizon: number, measure: (path: number[]) => T) {
  const rand = rng(samples.length * 7919 + Math.round(samples.reduce((a, b) => a + b, 0) * 100));
  const out: T[] = [];
  for (let s = 0; s < runs; s++) {
    const path = Array.from({ length: horizon }, () => samples[Math.floor(rand() * samples.length)]);
    out.push(measure(path));
  }
  return out;
}

const maxDrawdown = (path: number[]) => {
  let cum = 0;
  let peak = 0;
  let dd = 0;
  for (const x of path) {
    cum += x;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
  }
  return dd;
};

const pct0 = (x: number) =>
  x > 0.99 && x < 1 ? "over 99%" : x < 0.01 && x > 0 ? "under 1%" : `${Math.round(x * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* ── Words ───────────────────────────────────────────────────────────── */

/** If-then plans for each mistake — decided in advance, so you don't decide in the moment. */
const IF_THEN: Record<string, string> = {
  "FOMO entry": "If price runs without you, then you let it go and write “missed” in your notes. Another setup will come.",
  "Late entry": "If your entry model already triggered and price left, then you wait for the next one — no chasing.",
  "Moved stop": "If you feel the urge to move your stop, then you take your hand off the mouse for 60 seconds and re-read your invalidation.",
  "Early exit": "If you want to close early, then ask: has my invalidation happened? If not, the trade stays.",
  Oversized: "Before you click, read the allowed risk the trade form shows for this grade — and enter exactly that. Not a rounded-up version of it.",
  "Revenge trade": "If you just took a loss, then the charts close for 30 minutes. No exceptions.",
  "No setup": "If you can't tick every base rule and answer every grade factor, then there is no trade.",
  "Ignored news": "Before the session starts, you check the calendar for red news and write the times down.",
};

const PRINCIPLES = [
  "Anything can happen on a single trade. Your edge only shows up over many.",
  "You don't need to know what happens next to make money. You need to follow your plan.",
  "A loss that followed the plan is a good trade. A win that broke it is a bad one.",
  "The market doesn't know your P&L, your streak, or what you need today.",
  "Your job is to execute the edge — the outcome of any one trade isn't yours to control.",
  "Every setup is unique. What happened last time doesn't decide what happens now.",
  "Protecting your capital on a bad day is a skill, not a lack of courage.",
  "Boredom is the price of consistency. Pay it.",
  "Think in samples of 20 trades, not in single trades.",
  "The best traders are not the ones who win most — they're the ones who lose best.",
  "Missing a trade costs nothing. Forcing one costs money and confidence.",
  "Your emotions are information about you, not about the market.",
];

const REFLECTIONS = {
  afterLoss: [
    "If you had known your last trade would lose, would you still have taken it? Why?",
    "What did your last loss cost you emotionally — and is that bigger than what it cost in %?",
    "What would you tell a friend who just had the same loss?",
  ],
  afterRuleBreak: [
    "What was happening in your head right before you broke the rule?",
    "What small thing could you change today so that moment doesn't repeat?",
    "Which rule do you find hardest to follow — and why do you think that is?",
  ],
  afterWins: [
    "Are you trading today to execute your edge — or to keep the streak alive?",
    "What would make today's trade a mistake, even if it wins?",
  ],
  general: [
    "What does an A+ setup look like today? Describe it before you look at the chart.",
    "What will you do if the setup never comes today?",
    "What are you most likely to do wrong today — and how will you catch it?",
    "How will you know you traded well today, regardless of the result?",
    "What feeling usually comes right before your worst trades?",
    "What is one thing you did well in your last trade that you want to repeat?",
  ],
};

/** Keeps the briefing readable. */
const MAX_CARDS = 8;

/** Treats 0.30000000000000004 as 0.3. */
const EPS = 1e-9;
const pctStr = (x: number) => `${+x.toFixed(2)}%`;

const CONFIDENCE_WORD = { strong: "strong", likely: "likely", early: "early sign" } as const;

/** "Entry: IFVG — +1.10R vs +0.20R (7 trades, strong)" */
function describe(i: Insight) {
  return `${i.label}: ${fmtR(i.avgR)} vs ${fmtR(i.restAvgR)} otherwise (${plural(i.n, "trade")}, ${CONFIDENCE_WORD[i.confidence]})`;
}

const dayOfYear = (d: Date) =>
  Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86_400_000);

/* ── The briefing ────────────────────────────────────────────────────── */

/** The desk the Coach reads besides your trades: the rulebook and today's news. */
export interface CoachDesk {
  doc: Rulebook;
  rulebookOf: (version: string | null) => Rulebook;
  /** Today as the news rules see it; null when the calendar doesn't cover today. */
  news?: NewsDay | null;
}

const money = (x: number) => `${x < 0 ? "−" : ""}$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
/** "Wednesday 30 Sept" for a New York day. */
const dayLabel = (day: string) => deskDateLabel(`${day}T12:00:00Z`);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** What the days off cost, in the rulebook's own number: "the next trading day", "the next two trading days". */
function daysOffBody(doc: Rulebook | null, from: string): string {
  const n = doc?.daysOff ?? 1;
  const days = doc ? tokenValues(doc)["consequence.days"] : "the next trading day";
  return n === 1
    ? `Any rule break costs ${days}. This one follows the break on ${dayLabel(from)}. Use it to review the journal, not to watch the chart.`
    : `Any rule break costs ${days}. They started after ${dayLabel(from)}. Use them to review the journal, not to watch the chart.`;
}

/** `allTrades` may include setups logged as not taken; they are never counted. */

export function buildBriefing(
  allTrades: Trade[],
  checkins: CheckIn[],
  now = new Date(),
  desk?: CoachDesk | null,
): Briefing {
  const doc = desk?.doc ?? null;
  const limits = doc?.limits ?? null;
  const trades = allTrades.filter((t) => !t.skipped);
  const today = dayKey(now);
  const closed = trades.filter(isClosed).sort((a, b) => a.date.localeCompare(b.date));
  const s = summarize(trades);
  const cards: CoachCard[] = [];
  const add = (c: CoachCard) => cards.push(c);

  const decided = s.wins + s.losses;
  const enoughData = decided >= 10;
  const p = enoughData && s.winRate != null ? s.winRate : null; // your win rate
  const checkinToday = checkins.find((c) => c.date === today);
  const byDate = new Map(checkins.map((c) => [c.date, c]));
  const allAvgR = mean(closed.map((t) => t.resultR!));
  const brokeRules = breaksRules;
  const insights = findInsights(trades, checkins, doc ?? undefined);
  const beh = behaviour(trades, checkins);

  /*
   * Today, as the rulebook sees it: one trade a day, a daily and a weekly stop, the
   * consequences still running and the news.
   */
  const L = limits ?? defaultRulebook().limits;
  const budget = dayBudget(trades, today, L);
  const todays = trades.filter((t) => t.date.slice(0, 10) === today);
  const open = trades.filter((t) => !isClosed(t));
  const dayPct = todays.filter(isClosed).reduce((a, t) => a + tradePct(t), 0);
  const afterStop = todays.filter((t) => t.flags.includes("after_daily_stop"));
  const brokenToday = todays.filter((t) => t.flags.some((f) => f !== "after_daily_stop"));
  const status = desk
    ? deskStatus({ trades: allTrades, checkins, rulebookOf: desk.rulebookOf, doc: desk.doc, now, news: desk.news })
    : null;
  const nowTime = deskNow(now).slice(11, 16);
  const nowMin = minutesOf(nowTime)!;

  if (afterStop.length) {
    const r = afterStop.filter(isClosed).reduce((a, t) => a + tradePct(t), 0);
    add({
      id: "after-stop",
      tone: "alert",
      priority: 101,
      title: `You traded after your daily stop — ${plural(afterStop.length, "trade")}`,
      body:
        `The day had already lost your ${pctStr(L.dailyStopPct)} when ${afterStop.length === 1 ? "this trade was" : "these trades were"} taken` +
        (afterStop.some(isClosed) ? `, and ${afterStop.length === 1 ? "it" : "they"} made ${fmtPct(r)}` : "") +
        ". Close the charts now. Write down what you felt in the minute before the entry — that feeling is the one to catch next time.",
      why: "A daily stop only works if it is the last decision of the day. Every trade past it is an attempt to change how the day feels, and that is the exact state in which accounts are lost.",
    });
  } else if (budget.stopHit && todays.length && !open.length) {
    add({
      id: "stop-hit",
      tone: "warn",
      priority: 100,
      title: `Daily stop hit — ${fmtPct(dayPct)} today`,
      body: `Today used your full ${pctStr(L.dailyStopPct)} budget. The desk is closed until tomorrow — the stop resets, a breach does not. Stopping here is the rule working, not you failing.`,
      why: "The trade that 'wins it back' is taken to repair a feeling, not because the market offered a setup. The daily stop exists to make that decision for you in advance.",
    });
  } else if (open.length) {
    const t = open[0];
    const stopAt = doc?.timeStop ?? "12:00";
    const nearStop = t.date.slice(0, 10) === today && nowMin >= minutesOf(stopAt)! - 30;
    add({
      id: nearStop ? "time-stop" : "open",
      tone: nearStop ? "alert" : "warn",
      priority: nearStop ? 102 : 99,
      title: nearStop ? `Close ${t.symbol} by ${stopAt} — the time stop` : `You have an open trade on ${t.symbol}`,
      body: nearStop
        ? `Positions are closed by ${stopAt}, never held overnight. Whatever price is doing, the plan made this decision before the trade.`
        : `Manage it by the plan you made before entry — hands off until ${doc ? tokenValues(doc)["trailAfter.word"] : "halfway"}, then trail. Its ${pctStr(
            open.reduce((a, x) => a + x.riskPct, 0),
          )} risk is already counted against today's and this week's budgets.`,
      why: "Once in a trade, the brain starts managing feelings instead of the position. The plan you made calm is better than the one you make under pressure.",
    });
    // A red release about to print while the trade is open: close before it, unless the stop is at breakeven.
    const coming = desk?.news?.windows.find((w) => w.at > nowMin && w.at - nowMin <= 30);
    if (coming && t.date.slice(0, 10) === today && doc) {
      add({
        id: "release-coming",
        tone: "alert",
        priority: 101,
        title: `${coming.currency} ${coming.title} at ${hhmm(coming.at)}`,
        body: `Close by ${hhmm(coming.at - doc.news.beforeMin)} — unless the stop is already at breakeven or better. Then it may stay through.`,
        why: "In the pilot, trades that rode a release with a breakeven stop could only gain from the spike; the ones without one were exposed to it.",
      });
    }
  } else if (todays.length) {
    add({
      id: "done-today",
      tone: dayPct >= 0 ? "good" : "info",
      priority: 100,
      title: `Done for today — ${fmtPct(dayPct)}`,
      body: "One box, one thesis, one trade. Win, lose or breakeven, the desk is closed until tomorrow — close the charts.",
      why: "After a win confidence rises faster than skill (the house-money effect); after a loss the next setup always looks better than it is. The one-trade rule makes both decisions in advance.",
    });
  }

  /* What the rules say about today, before any trade. */
  if (status && !todays.length) {
    if (status.dayOff) {
      add({
        id: "day-off",
        tone: "alert",
        priority: 100,
        title: status.dayOff.reason === "rule-break" ? "Day off — a rule was broken today" : daysOffText(status.dayOff, today),
        body:
          status.dayOff.reason === "rule-break"
            ? "Any rule break ends the day. The trade is recorded; there is no next one today."
            : daysOffBody(doc, status.dayOff.from),
        why: "A consequence decided in advance is not a punishment, it is a circuit breaker: it takes the decision away from the state that broke the rule.",
      });
    }
    if (status.skipDay) {
      add({
        id: "skip-day",
        tone: "alert",
        priority: 97,
        title: "Skip day — no trading",
        body: `${desk?.news?.skip.length ? desk.news.skip.join(", ") : "The year-end break"}. The rulebook doesn't trade this day at all, however clean a setup looks.`,
      });
    }
  }
  if (status?.weekBudget.stopHit) {
    add({
      id: "week-stop",
      tone: "alert",
      priority: 99,
      title: "Weekly stop hit — no more trades this week",
      body: `This week has lost ${pctStr(status.weekBudget.lossToday)}. Stop for the rest of the week and review the journal before Monday.`,
      why: "Four losses in a week at half a percent is not bad luck to trade through; it is the moment to look at what changed.",
    });
  } else if (status && status.weekBudget.lossToday >= L.weeklyStopPct / 2) {
    add({
      id: "week-budget",
      tone: "warn",
      priority: 82,
      title: `${fmtPct(-status.weekBudget.lossToday)} this week — ${pctStr(status.weekBudget.remaining)} left before the weekly stop`,
      body: "Same rules, same size. The weekly stop is there so that a bad week stays a bad week.",
    });
  }
  if (brokenToday.length) {
    const flags = [...new Set(brokenToday.flatMap((t) => t.flags).filter((f) => f !== "after_daily_stop"))];
    add({
      id: "flags-today",
      tone: "alert",
      priority: 96,
      title: `Today's trade crossed a line you set: ${flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}`,
      body:
        "It is saved, and it counts. Before the next one, read the allowed risk and the grade in the trade form out loud — the rule is only a rule if it holds on the days it is inconvenient." +
        (brokenToday.some((t) => t.flagNote) ? ` Your note: “${brokenToday.find((t) => t.flagNote)!.flagNote}”.` : ""),
      why: "Rules decided in advance are cheap to keep. Rules renegotiated in the moment end up renegotiated every time.",
    });
  }

  if (checkinToday?.verdict === "sit-out") {
    const same = closed.filter((t) => byDate.get(t.date.slice(0, 10))?.verdict === "sit-out");
    add({
      id: "sit-out",
      tone: "alert",
      priority: 98,
      title: "Check-in says: stand down",
      body:
        "The best thing you can do today is nothing — and the rulebook agrees: on a sit-out day nothing is tradable, and any trade is logged as a rule break.",
      stat:
        same.length >= 2
          ? `On past sit-out days you averaged ${fmtR(mean(same.map((t) => t.resultR!)))} over ${plural(same.length, "trade")} (overall ${fmtR(allAvgR)}).`
          : undefined,
      why: "Tired or stressed brains take more risk to feel relief. The check-in is your calm self giving advice to your trading self.",
    });
  }

  /*
   * Is there an edge at all? Every other card measures a streak, a drawdown or a
   * habit AGAINST your own average — none of them ever asks whether that average
   * is positive. A trader with a negative edge can be told "this is normal, keep
   * executing" forever, which is the most expensive thing this app could do.
   */
  const rsAll = closed.map((t) => t.resultR!);
  const expR = mean(rsAll);
  const sdR =
    rsAll.length > 1
      ? Math.sqrt(rsAll.reduce((a, x) => a + (x - expR) ** 2, 0) / (rsAll.length - 1))
      : 0;
  const seR = sdR / Math.sqrt(Math.max(rsAll.length, 1));
  const ciLo = expR - 1.96 * seR;
  const ciHi = expR + 1.96 * seR;
  const edgeState: "negative" | "unproven" | "positive" | "unknown" =
    decided < 20 ? "unknown" : ciHi < 0 ? "negative" : ciLo > 0 ? "positive" : expR < 0 ? "unproven" : "unknown";

  if (decided >= 20) {
    const rrs = closed.map((t) => t.plannedRR).filter((v): v is number => v != null && v > 0);
    const rr = rrs.length ? mean(rrs) : null;
    const needRate = rr ? 1 / (1 + rr) : null;
    const rateLine =
      needRate != null && p != null
        ? ` You win ${pct0(p)} of the time; at your ~1:${rr!.toFixed(1)} target you need ${pct0(needRate)} to break even.`
        : "";
    // How many trades before the average could separate itself from zero.
    const needed = seR > 0 && expR !== 0 ? Math.ceil((1.96 * sdR / Math.abs(expR)) ** 2) : null;

    if (edgeState === "negative") {
      add({
        id: "edge-negative",
        tone: "alert",
        priority: 95,
        title: `Your edge is negative over ${plural(decided, "trade")}`,
        body:
          "This is not a losing streak — it is your average. Repeating it with more discipline only loses the money faster. Stop adding live trades until something changes: the setup, the exit or the session — and test that change in Forex Tester first.",
        stat: `${fmtR(expR)} per trade, and the whole 95% range (${fmtR(ciLo)} to ${fmtR(ciHi)}) sits below zero.${rateLine}`,
        why: "Streak and drawdown cards can only tell you whether a run is normal for your numbers. They cannot tell you whether your numbers are worth repeating. That is a separate question, and it is the more important one.",
      });
    } else if (edgeState === "unproven") {
      add({
        id: "edge-unproven",
        tone: "warn",
        priority: 70,
        title: "Below breakeven so far — but not proven either way",
        body: `You are averaging ${fmtR(expR)} per trade. The spread in your results is still wide enough that this could be bad luck rather than a bad edge. Don't scrap the strategy, and don't size it up either — keep risk where it is and keep logging.`,
        stat: `95% range ${fmtR(ciLo)} to ${fmtR(ciHi)}, which still includes zero.${
          needed ? ` About ${plural(needed, "trade")} at this rate would settle it.` : ""
        }${rateLine}`,
        why: "Abandoning a good strategy during normal variance and clinging to a bad one both come from reading too much into too few trades. The honest answer here is 'not yet known'.",
      });
    } else if (edgeState === "positive") {
      add({
        id: "edge-proven",
        tone: "good",
        priority: 44,
        title: "Your edge is real",
        body: "Over this many trades your average is above zero by more than chance explains. Your job now is not to improve it — it is to not break it. Same ladder, same filters, same patience.",
        stat: `${fmtR(expR)} per trade, 95% range ${fmtR(ciLo)} to ${fmtR(ciHi)} — entirely above zero.${rateLine}`,
        why: "Most traders lose a proven edge by changing it: sizing up after wins, loosening filters when bored, or chasing a better one. Boring repetition is the whole job.",
      });
    }
  }

  /*
   * The prop firm's lines. This is the only failure in the journal that is not
   * recoverable by trading better tomorrow, so it outranks everything else.
   */
  if (limits) {
    const A = accountState(trades, limits, now);
    const floorUsed = limits.maxLossPct > 0 ? 1 - A.room / ((limits.startBalance * limits.maxLossPct) / 100) : 0;
    if (A.dailyUsed >= 0.5 || floorUsed >= 0.5) {
      const dailyCritical = A.dailyUsed >= 0.8;
      add({
        id: "limits",
        tone: dailyCritical || floorUsed >= 0.8 ? "alert" : "warn",
        priority: 97,
        title: dailyCritical
          ? `Today has used ${pct0(A.dailyUsed)} of the firm's daily line`
          : `You have used ${pct0(Math.max(A.dailyUsed, floorUsed))} of a firm limit`,
        body: dailyCritical
          ? "Stop for today. One more trade at normal size could end the account, and no setup is worth that. The daily line resets tomorrow; a breach does not."
          : `Room above the firm's floor: ${money(A.room)}. Size the next trade so a full stop-out still leaves you inside both lines.`,
        stat: `Balance ${money(A.balance)} · floor ${money(A.floor)} · safe risk now ${A.safeRisk.toFixed(2)}%.`,
        why: "Every other mistake in this journal costs you money you can win back. This one costs you the account, and the pressure of being near the line is exactly what makes traders size up to escape it.",
      });
    }
  }

  /* Streaks — is this normal for me? */
  const streak = s.currentStreak;
  if (streak.outcome === "loss" && streak.count >= 2) {
    const n = streak.count;
    const q = 1 - (p ?? 0.5);
    const chance100 = probRunAtLeast(n, 100, q);
    const expected = expectedLongestRun(100, q);
    const lastLosses = closed.slice(-n);
    const broken = lastLosses.filter(brokeRules).length;
    const normal = n <= Math.ceil(expected);

    add({
      id: "loss-streak",
      tone: normal ? "info" : "warn",
      priority: 90,
      title: `${n} losses in a row — ${normal ? "this is normal" : "longer than usual"}`,
      body: normal
        ? edgeState === "negative"
          ? `A run this long is normal at your win rate — but your average trade is negative over ${plural(decided, "trade")}, so "normal" here means normally losing. Read the edge card before your next entry.`
          : `A streak like this is part of trading with your numbers. It doesn't mean your strategy stopped working. Same risk, same checklist, same patience.`
        : `This is longer than your numbers usually produce. Don't trade to fix it — review it. ${
            broken
              ? `${broken} of these ${n} losses broke a rule, so start there.`
              : "All of them followed your rules, so look at market conditions rather than at yourself."
          }`,
      stat: `${p != null ? `At your ${pct0(p)} win rate` : "Even at a 50% win rate"}, any ${n} trades in a row all lose ${pct0(q ** n)} of the time, and a streak of ${n}+ shows up in ${pct0(chance100)} of 100-trade stretches. Your expected worst losing streak over 100 trades: about ${expected.toFixed(1)}.${p == null ? " (Based on a 50% example — your own win rate needs 10+ trades.)" : ""}`,
      why: "After losses the brain plays two tricks: “a win is due” (it isn't — each trade is independent) and “the edge is gone” (usually it's variance). Both push you to change size or rules at the worst time.",
    });
  }

  if (streak.outcome === "win" && streak.count >= 3) {
    const n = streak.count;
    const run = closed.slice(-n);
    const oversized = run.filter((t) => t.flags.includes("over_risk")).length;
    const moodAnswer = checkinToday?.answers.mood;
    const urgeAnswer = checkinToday?.answers.urge;

    // Warning signs that the streak is changing how you trade.
    const signs: string[] = [];
    // "Dialed in" on a long win streak is the classic house-money moment.
    if (moodAnswer === 2 && n >= 4) signs.push("you came in feeling dialed in on a long win streak");
    if (urgeAnswer != null && urgeAnswer >= 1) signs.push("you feel pressure to make money today");
    if (oversized) signs.push(`${plural(oversized, "trade")} in the streak risked more than the grade allowed`);
    const streakMistakes = run.filter(breaksRules).length;
    if (streakMistakes) signs.push(`${plural(streakMistakes, "trade")} in the streak broke a rule — winning anyway teaches the wrong lesson`);
    if (run.some((t) => (t.emotion ?? 0) >= 4)) signs.push("you logged feeling anxious or tilted during the streak");
    const history = beh.afterWinStreak;
    const badHistory = history.n >= 3 && history.avgR < beh.all.avgR - 0.3;
    if (badHistory) signs.push(`after past win streaks your next trade averaged ${fmtR(history.avgR)}`);

    const badState = checkinToday?.verdict === "sit-out" || signs.length >= 2;
    const winChance = p ?? 0.5;

    add({
      id: "win-streak",
      tone: badState ? "warn" : "info",
      priority: badState ? 87 : 72,
      title: `${n} wins in a row — ${badState ? "time to protect it" : "stay exactly the same"}`,
      body: badState
        ? `The streak is starting to affect you: ${signs.join("; ")}. Raise the bar for the next trade: A+ only. The ladder already sizes it — what changes is how picky you are, not how big.`
        : `Well executed. Keep letting the grade set the size — nothing on top of it — and the same filters. ${
            signs.length ? `One thing to watch: ${signs[0]}.` : "The next trade is a fresh coin flip weighted by your edge, nothing more."
          }`,
      stat: `Chance of ${n} wins in a row at your ${pct0(winChance)} win rate: ${pct0(winChance ** n)}. ${
        history.n >= 3
          ? `After your past 3+ win streaks, the next trade averaged ${fmtR(history.avgR)} (overall ${fmtR(beh.all.avgR)}), with rules broken ${pct0(history.ruleBreakRate)} of the time.`
          : "I'll learn how you trade after streaks as more data comes in."
      }`,
      why: "Winning streaks feel like skill and play money at the same time (“house money effect”). That's when traders size up, loosen filters and give a big part back. Staying boringly the same is the edge.",
    });
  }

  /* Right after a win or a loss — how do YOU usually trade? */
  const lastClosed0 = closed[closed.length - 1];
  if (lastClosed0 && !todays.length) {
    const lastOutcome = classifyOutcome(lastClosed0.resultR);
    const after = lastOutcome === "loss" ? beh.afterLoss : lastOutcome === "win" ? beh.afterWin : null;
    if (after && after.n >= 4) {
      const worseR = after.avgR < beh.all.avgR - 0.3;
      const moreBreaks = after.ruleBreakRate > beh.all.ruleBreakRate + 0.15;
      const biggerRisk = after.avgRisk > beh.all.avgRisk * 1.15;
      if (worseR || moreBreaks || biggerRisk) {
        const what = lastOutcome === "loss" ? "a loss" : "a win";
        const parts = [
          worseR ? `your next trade averages ${fmtR(after.avgR)} (overall ${fmtR(beh.all.avgR)})` : "",
          moreBreaks ? `you break a rule ${pct0(after.ruleBreakRate)} of the time (normally ${pct0(beh.all.ruleBreakRate)})` : "",
          biggerRisk ? `your risk goes up to ${after.avgRisk.toFixed(2)}% (normally ${beh.all.avgRisk.toFixed(2)}%)` : "",
        ].filter(Boolean);
        add({
          id: "after-last",
          tone: "warn",
          priority: 83,
          title: `Your pattern after ${what}`,
          body: `Your last trade was ${what}. In your history, right after ${what} ${parts.join(", ")}. Knowing this is half the fix — slow down the next entry on purpose.`,
          stat: `Based on ${plural(after.n, "trade")} that followed ${what}.`,
          why:
            lastOutcome === "loss"
              ? "After a loss the brain wants relief — it looks for the next trade faster and accepts weaker setups (revenge / tilt)."
              : "After a win confidence rises faster than skill — setups start to look better than they are.",
        });
      }
    }
  }

  /*
   * Risk against plan. Risk now varies by design — the grade sets it — so "above your
   * usual" means nothing. What matters is risk above what the rules allowed at the time.
   */
  const planned = trades.filter((t) => t.plannedRiskPct != null).slice(-10);
  const over = planned.filter((t) => t.riskPct > t.plannedRiskPct! + EPS);
  if (planned.length >= 4 && over.length >= 2) {
    const by = mean(over.map((t) => t.riskPct - t.plannedRiskPct!));
    add({
      id: "risk-vs-plan",
      tone: "warn",
      priority: 76,
      title: `You sized above the allowed risk on ${over.length} of your last ${planned.length} trades`,
      body: `On average ${pctStr(by)} more than the grade and the budget allowed. Was each of those a decision you made calmly — or did the size drift trade by trade?`,
      why: "Size creep is invisible from the inside: each step feels small. It turns a normal losing streak into a real drawdown — which is exactly what the ladder is there to prevent.",
    });
  }

  /* Lines crossed recently, and what they cost. */
  const recentClosed = closed.slice(-20);
  const flagged = recentClosed.filter((t) => t.flags.length);
  const clean = recentClosed.filter((t) => !t.flags.length);
  if (flagged.length >= 2 && !brokenToday.length && !afterStop.length) {
    const kinds = new Map<TradeFlag, number>();
    for (const t of flagged) for (const f of t.flags) kinds.set(f, (kinds.get(f) ?? 0) + 1);
    const cost = flagged.length >= 3 && clean.length >= 3;
    add({
      id: "flags",
      tone: "warn",
      priority: 84,
      title: `${plural(flagged.length, "trade")} crossed your own lines lately`,
      body: `${[...kinds]
        .map(([f, n], i) => `${i ? FLAG_LABEL[f].toLowerCase() : FLAG_LABEL[f]} ×${n}`)
        .join(", ")}. Each one was saved with a flag — the pattern, not any single one, is what to look at.`,
      stat: cost
        ? `Flagged trades averaged ${fmtR(mean(flagged.map((t) => t.resultR!)))} vs ${fmtR(mean(clean.map((t) => t.resultR!)))} for clean ones, over your last ${recentClosed.length}.`
        : undefined,
      why: "Breaking a rule and winning is the most dangerous outcome of all: it teaches that the rule was optional.",
    });
  }

  /*
   * The ladder: does A+ earn its place above A — and has it earned its way back to a
   * bigger risk? Only A+ and A are traded, so those are the only rungs to judge.
   */
  // Grades the ladder card already calls out, so the leak card doesn't repeat them.
  const ladderGrades = new Set<string>();
  if (doc) {
    const top = closed.filter((t) => t.grade === "A+");
    const a = closed.filter((t) => t.grade === "A");
    const avg = (ts: Trade[]) => mean(ts.map((t) => t.resultR!));
    if (a.length >= 10 && avg(a) < 0) {
      ladderGrades.add("A");
      add({
        id: "ladder-a",
        tone: "warn",
        priority: 66,
        title: "A setups are losing money",
        body: `A averages ${fmtR(avg(a))} over ${plural(a.length, "trade")}. A rung with a negative expectancy costs money every time it is taken — lowering its risk needs no evidence; the Rulebook takes the change with a reason.`,
        stat: `A+: ${fmtR(avg(top))} (${top.length}) · A: ${fmtR(avg(a))} (${a.length})`,
        why: "A grade is a prediction. When a prediction keeps failing, the cheapest fix is to stop paying for it.",
      });
    } else if (top.length >= 8 && a.length >= 8 && avg(a) > avg(top) + 0.2) {
      add({
        id: "ladder-flip",
        tone: "info",
        priority: 48,
        title: "A is outperforming A+",
        body: "Some factor that separates A+ from A may be measuring the wrong thing — check each factor in Stats → Compare before changing anything.",
        stat: `A+: ${fmtR(avg(top))} (${top.length}) · A: ${fmtR(avg(a))} (${a.length})`,
        why: "Full size belongs where the edge is strongest. If the ladder is upside down, the sizing multiplies the wrong trades.",
      });
    }

    // A+ back to a bigger risk: only after enough graded trades show it beats A by enough.
    const card = doc.grades.find((g) => g.grade === "A+");
    const graded = top.length + a.length;
    if (card && card.riskPct < doc.aPlus.riskPct && graded >= doc.aPlus.trades && top.length >= 4 && a.length >= 4) {
      const edge = avg(top) - avg(a);
      add({
        id: "a-plus-risk",
        tone: edge >= doc.aPlus.edgeR ? "good" : "info",
        priority: edge >= doc.aPlus.edgeR ? 52 : 41,
        title: edge >= doc.aPlus.edgeR ? `A+ has earned ${pctStr(doc.aPlus.riskPct)}` : `A+ stays at ${pctStr(card.riskPct)}`,
        body:
          edge >= doc.aPlus.edgeR
            ? `Over ${plural(graded, "graded trade")} A+ beats A by ${fmtR(edge)} per trade — the rulebook's bar is ${fmtR(doc.aPlus.edgeR)}. Raising it is your call, in the Rulebook, with this as the reason.`
            : `Over ${plural(graded, "graded trade")} A+ beats A by ${fmtR(edge)}; the rulebook asks for ${fmtR(doc.aPlus.edgeR)} before A+ goes back to ${pctStr(doc.aPlus.riskPct)}.`,
        stat: `A+: ${fmtR(avg(top))} (${top.length}) · A: ${fmtR(avg(a))} (${a.length})`,
      });
    }

    // Hypotheses with enough data behind them.
    const ready = hypothesisResults(doc, allTrades).filter((h) => h.status === "ready");
    if (ready.length) {
      const values = tokenValues(doc);
      add({
        id: "hypotheses",
        tone: "info",
        priority: 43,
        title: `${ready.length} ${ready.length === 1 ? "hypothesis" : "hypotheses"} ready to decide`,
        body: "Enough trades are logged to decide these. Decide in the Rulebook, with a reason — a change that adds risk needs data that didn't create the idea.",
        stat: ready.map((h) => `${h.hypothesis.text.replace(/\{\{[^}]+\}\}/g, (m) => values[m.slice(2, -2).trim()] ?? m)} (${h.n})`).join(" · "),
      });
    }
  }

  /* Rule adherence, week by week — reviewed next to P&L, target 100%. */
  if (doc) {
    const weeks = [0, 1, 2, 3].map((k) => {
      const d = new Date(now.getTime() - k * 7 * 86_400_000);
      return weekSpan(deskNow(d).slice(0, 10));
    });
    const rates = weeks.map((w) => adherence(trades, w.from, w.to));
    const thisWeek = rates[0];
    const before = rates.slice(1).filter((r) => r.rate != null);
    if (thisWeek.rate != null && thisWeek.rate < 1) {
      add({
        id: "adherence",
        tone: "warn",
        priority: 73,
        title: `Rule adherence this week: ${pct0(thisWeek.rate)}`,
        body: `${thisWeek.n - thisWeek.clean} of this week's ${plural(thisWeek.n, "trade")} broke a rule. The target is 100% — results follow adherence, not the other way round.`,
        stat: before.length ? `Previous weeks: ${before.map((r) => pct0(r.rate!)).join(" · ")}` : undefined,
      });
    } else if (thisWeek.rate === 1 && before.some((r) => r.rate! < 1)) {
      add({
        id: "adherence",
        tone: "good",
        priority: 47,
        title: "100% rule adherence this week",
        body: "Every trade this week followed the rulebook. That is the part you control — keep stacking it.",
        stat: `Previous weeks: ${before.map((r) => pct0(r.rate!)).join(" · ")}`,
      });
    }
  }

  /* Last session */
  const lastDay = [...new Set(closed.map((t) => t.date.slice(0, 10)))].filter((d) => d < today).pop();
  if (lastDay) {
    const dayTrades = closed.filter((t) => t.date.slice(0, 10) === lastDay);
    const dayPct = dayTrades.reduce((a, t) => a + tradePct(t), 0);
    const broken = dayTrades.filter(brokeRules);
    const when = new Date(`${lastDay}T00:00`).toLocaleDateString("en-GB", { weekday: "long" });
    const daysAgo = Math.round((new Date(`${today}T00:00`).getTime() - new Date(`${lastDay}T00:00`).getTime()) / 86_400_000);

    if (broken.length) {
      const mistakes = [...new Set(broken.flatMap((t) => t.mistakes))];
      const flags = [...new Set(broken.flatMap((t) => t.flags))];
      add({
        id: "last-rules",
        tone: "warn",
        priority: 85,
        title: `Last session (${when}) you broke a rule`,
        body: [
          flags.length ? `Broken: ${flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}.` : "",
          mistakes.length ? `Mistakes: ${mistakes.join(", ")}.` : "",
          "Name what triggered it in today's reflection — awareness is what breaks the loop.",
        ]
          .filter(Boolean)
          .join(" "),
        why: "Rule breaks rarely come from not knowing the rule. They come from a feeling in the moment. Naming the feeling makes it easier to spot next time.",
      });
    } else if (dayPct < 0) {
      add({
        id: "last-loss",
        tone: "info",
        priority: 80,
        title: `Last session (${when}) ended ${fmtPct(dayPct)}`,
        body:
          "You followed your rules — that loss was the cost of doing business. It's already paid. Today's job isn't to win it back; it's to take the next good setup, or none.",
        why: "Loss aversion: losses feel about twice as strong as equal gains. That pain pushes traders to “get it back” with bigger size or weaker setups.",
      });
    } else if (dayPct > 0) {
      add({
        id: "last-win",
        tone: "good",
        priority: 40,
        title: `Last session (${when}) ended ${fmtPct(dayPct)} with rules followed`,
        body: "That's the process working. Today starts from zero — same standards, no need to “keep it going”.",
      });
    }

    if (daysAgo >= 7 && !todays.length) {
      add({
        id: "rusty",
        tone: "info",
        priority: 60,
        title: `${daysAgo} days since your last trade`,
        body: "Your timing and read of the market may be a bit rusty. Take only an A+ on your first trade back — the ladder sizes it — and don't add size to make up for lost time.",
      });
    }
  }

  /* Drawdown — normal for my strategy? (bootstrap of your own results) */
  const pcts = closed.map(tradePct);
  if (closed.length >= 15 && s.currentDrawdownPct < -0.001) {
    const sims = simulate(pcts, 2000, 50, maxDrawdown);
    const deeper = sims.filter((dd) => dd <= s.currentDrawdownPct).length / sims.length;
    const tone: Tone = deeper >= 0.2 ? "info" : deeper >= 0.05 ? "warn" : "alert";
    add({
      id: "drawdown",
      tone,
      priority: 75,
      title: `You're ${fmtPct(s.currentDrawdownPct)} from your peak — ${
        tone === "info" ? "within normal range" : tone === "warn" ? "deeper than usual" : "unusually deep"
      }`,
      body:
        tone === "info"
          ? edgeState === "negative"
            ? "The depth is normal for your numbers — but with a negative average, a normal drawdown is simply the edge working against you. Depth is not the problem here; direction is."
            : "Drawdowns like this are built into your strategy. Nothing needs fixing — keep executing."
          : tone === "warn"
            ? "Still possible with your edge, but on the deep side. Keep the ladder as it is — no sizing up to get back — and review your last trades in Compare."
            : "This is deeper than your own history suggests. Trade only A+ setups until you find the cause — market conditions, rule breaks, or a setup that stopped working. If you want smaller size too, lower the ladder's risks in the Rulebook deliberately, not trade by trade.",
      stat: `I re-shuffled your ${closed.length} results into 2,000 simulated runs of 50 trades: ${pct0(deeper)} of them went at least this deep. Your deepest so far: ${fmtPct(s.maxDrawdownPct)}.`,
      why: "Drawdowns feel personal, but they're a statistical certainty. Knowing your normal range lets you stay calm inside it — and act fast outside it.",
    });
  }

  /* Recent form — last 10 trades vs. your own distribution */
  if (closed.length >= 20) {
    const rs = closed.map((t) => t.resultR!);
    const last10 = rs.slice(-10).reduce((a, b) => a + b, 0);
    const sims = simulate(rs, 2000, 10, (path) => path.reduce((a, b) => a + b, 0));
    const worse = sims.filter((x) => x <= last10).length / sims.length;
    if (worse < 0.1) {
      add({
        id: "form-cold",
        tone: worse < 0.05 ? "warn" : "info",
        priority: 65,
        title: `Last 10 trades: ${fmtR(last10)} — ${worse < 0.05 ? "unusually weak" : "a cold patch"}`,
        body:
          worse < 0.05
            ? "This is weaker than 95% of random 10-trade stretches from your own history. Something may have changed — check Stats → Compare for the last few weeks."
            : "Weaker than normal, but within what your strategy produces sometimes. Stay with the process.",
        stat: `Only ${pct0(worse)} of simulated 10-trade stretches were this bad or worse.`,
        why: "Separating variance from real change is the core skill: overreact to variance and you abandon a good strategy; ignore real change and you keep trading a broken one.",
      });
    } else if (worse > 0.9) {
      add({
        id: "form-hot",
        tone: "info",
        priority: 55,
        title: `Last 10 trades: ${fmtR(last10)} — a hot patch`,
        body: "Better than 90% of your normal stretches. Enjoy it, but expect it to cool down — that's regression to the mean, not failure.",
        why: "Hot patches invite bigger size and looser filters. Your average will pull results back toward normal either way.",
      });
    }
  }

  /* What your own data says about today's conditions */
  const today_ = todaysFactors(trades, checkins, now);
  const watchOuts = firmLeaks(insights).filter((i) => today_.has(i.key)).slice(0, 3);
  const tailwinds = edges(insights)
    .filter((i) => today_.has(i.key) && i.dimension !== "Previous trade")
    .slice(0, 2);
  if (watchOuts.length && !todays.length) {
    add({
      id: "watch-today",
      tone: "warn",
      priority: 79,
      title: "Your data flags today's conditions",
      body: "These things are true today, and historically they've gone with worse results. Be more selective than usual.",
      stat: watchOuts.map(describe).join(" · "),
      why: "This isn't a generic rule — it's your own history. Patterns you can't feel in the moment become obvious over 20–50 trades.",
    });
  }
  if (tailwinds.length && !todays.length) {
    add({
      id: "tailwind-today",
      tone: "good",
      priority: 46,
      title: "Today's conditions have gone well for you",
      body: "Good backdrop — but conditions don't replace the setup. Wait for your entry.",
      stat: tailwinds.map(describe).join(" · "),
    });
  }

  /* Movement before trading */
  if (checkinToday && checkinToday.answers.walk === 2 && !todays.length) {
    const walked = closed.filter((t) => (byDate.get(t.date.slice(0, 10))?.answers.walk ?? 2) < 2);
    const notWalked = closed.filter((t) => byDate.get(t.date.slice(0, 10))?.answers.walk === 2);
    add({
      id: "walk",
      tone: "info",
      priority: 50,
      title: "Take a 10-minute walk before the session",
      body: "No phone, no charts. Come back and then open the chart.",
      stat:
        walked.length >= 3 && notWalked.length >= 3
          ? `With movement: ${fmtR(mean(walked.map((t) => t.resultR!)))} avg (${walked.length} trades) · without: ${fmtR(mean(notWalked.map((t) => t.resultR!)))} (${notWalked.length} trades).`
          : undefined,
      why: "A short walk lowers stress hormones and resets attention. It also puts a gap between the rest of your day and the market.",
    });
  }

  /* Most expensive habit, with an if-then plan */
  const mistakeRows = groupBy(closed, (t) => t.mistakes).filter((r) => r.count >= 2 && r.netPct < 0);
  if (mistakeRows.length) {
    const worst = mistakeRows.sort((a, b) => a.netPct - b.netPct)[0];
    add({
      id: "habit",
      tone: "warn",
      priority: 62,
      title: `Your most expensive habit: ${worst.key}`,
      body: `Your plan for today: ${IF_THEN[worst.key] ?? "decide now, calmly, what you'll do when this urge shows up."}`,
      stat: `It has cost you ${fmtPct(worst.netPct)} over ${plural(worst.count, "trade")} (${fmtR(worst.avgR)} avg).`,
      why: "If-then plans (“implementation intentions”) work because the decision is already made — when the trigger shows up, you follow the script instead of the feeling.",
    });
  }

  /* Where your edge is — the setups and conditions that pay you */
  // The rulebook's own grade factors count as structure too — whatever they are called.
  const STRUCTURE = new Set([
    "Session", "Direction", "Weekday", "Time", "Planned R:R", "Box size", "Exit reason", "15m swing", "POI",
    "Level sweep", "Bias vs briefing", "HTF timeframe", "Sweep depth", "Release day",
    ...(doc?.factors.map((f) => f.name) ?? []),
  ]);
  const bestEdges = edges(insights)
    .filter((i) => STRUCTURE.has(i.dimension) && i.confidence !== "early")
    .slice(0, 3);
  if (bestEdges.length && !todays.length) {
    add({
      id: "edges",
      tone: "good",
      priority: 53,
      title: "Where your edge is",
      body: "These are the conditions where you perform clearly better than your average. If today's trade doesn't match any of them, it needs a very good reason.",
      stat: bestEdges.map(describe).join(" · "),
    });
  }

  /* Biggest leak in discipline or behaviour (mistakes have their own card) */
  const DISCIPLINE = new Set(["Checklist", "Plan", "Trade of day", "Risk", "State of mind", "Grade", "Break", "Previous trade"]);
  const leak = firmLeaks(insights).find(
    (i) =>
      DISCIPLINE.has(i.dimension) &&
      !today_.has(i.key) &&
      // Already said by the ladder card ("B setups … are losing money") — pick the next leak.
      !(i.dimension === "Grade" && ladderGrades.has(i.key.split("::")[1])),
  );
  if (leak) {
    add({
      id: "leak",
      tone: "warn",
      priority: 57,
      title: `Your biggest leak — ${leak.label}`,
      body: "Of everything you log, this costs you the most per trade. Fixing one leak is worth more than finding a new setup.",
      stat: describe(leak),
    });
  }

  /* Cutting winners? */
  if (beh.capture && beh.capture.n >= 5 && beh.capture.ratio < 0.75) {
    add({
      id: "capture",
      tone: "warn",
      priority: 56,
      title: `You're taking ${pct0(beh.capture.ratio)} of your planned targets`,
      body: `On winning trades you reach your full target only ${pct0(beh.capture.hitRate)} of the time. Either your targets are too ambitious, or you're closing early — check which with your charts.`,
      stat: `Based on ${beh.capture.n} winning trades with a planned R:R.`,
      why: "Cutting winners early is loss aversion in reverse: locking in a small gain feels better than risking it. Over time it quietly breaks the maths of your R:R.",
    });
  }

  /* Do your grades mean anything? */
  if (beh.gradeCalibrated === false) {
    add({
      id: "grades",
      tone: "info",
      priority: 42,
      title: "Your grades don't match your results yet",
      body: "Your lower-graded trades are doing as well as or better than your top-graded ones. Some factor in your ladder may be rewarding the wrong answers — Stats → Compare shows each factor's results, so you can see which one before changing anything.",
      stat: beh.grades.map((g) => `${g.grade}: ${fmtR(g.avgR)} (${g.n})`).join(" · "),
    });
  }

  /* Discipline trend */
  if (beh.discipline) {
    const d = beh.discipline;
    if (d.recent >= d.before + 0.15) {
      add({
        id: "discipline-down",
        tone: "warn",
        priority: 74,
        title: "Your discipline is slipping",
        body: "You're breaking rules more often recently than before. This usually shows up in results a few weeks later — catch it now.",
        stat: `Rule breaks: ${pct0(d.recent)} of your last ${d.nRecent} trades vs. ${pct0(d.before)} before.`,
      });
    } else if (d.recent <= d.before - 0.15) {
      add({
        id: "discipline-up",
        tone: "good",
        priority: 47,
        title: "Your discipline is improving",
        body: "You're following your rules more often than before. That's the part you control — keep stacking it.",
        stat: `Rule breaks: ${pct0(d.recent)} of your last ${d.nRecent} trades vs. ${pct0(d.before)} before.`,
      });
    }
  }

  /* Early days: teach the probability baseline */
  if (!enoughData) {
    const rrs = trades.map((t) => t.plannedRR).filter((v): v is number => v != null && v > 0);
    const rr = rrs.length ? mean(rrs) : 2;
    const breakeven = 1 / (1 + rr);
    add({
      id: "baseline",
      tone: "info",
      priority: 30,
      title: "Building your baseline",
      body: `After 10+ trades I'll tell you what's normal for you. Until then, the maths: with your ~1:${rr.toFixed(1)} R:R you break even at a ${pct0(breakeven)} win rate. Even at 50%, 3 losses in a row happen in ${pct0(probRunAtLeast(3, 20, 0.5))} of 20-trade stretches.`,
      why: "Knowing the numbers in advance takes the surprise — and the panic — out of normal losing streaks.",
    });
  }

  cards.sort((a, b) => b.priority - a.priority);
  cards.splice(MAX_CARDS);

  /* Headline + tone */
  const top = cards[0];
  const greenDay = todays.length >= 1 && !open.length && !budget.stopHit && dayPct >= 0 && !brokenToday.length;
  const closedToday = todays.length >= 1 && !open.length;
  const tone: Tone = greenDay
    ? "good"
    : cards.some((c) => c.tone === "alert")
    ? "alert"
    : cards.some((c) => c.tone === "warn")
      ? "warn"
      : top?.tone === "good"
        ? "good"
        : "info";
  const headline =
    afterStop.length
      ? "Past your daily stop. Close the desk now."
      : budget.stopHit && todays.length && !open.length
        ? "Daily stop hit. The desk reopens tomorrow."
      : closedToday
        ? greenDay
          ? "Done for today. A green day, left alone."
          : "Done for today. One trade, one thesis."
      : status?.dayOff
        ? "Day off. The desk is closed today."
      : tone === "alert"
        ? "Slow down. Read this before the session opens."
        : tone === "warn"
          ? "Trade with care today. Note the flags below."
          : checkinToday?.verdict === "ready"
            ? "Cleared to trade. Hold your rules and wait for structure."
            : "Desk status before the session opens.";

  /* Reflection question, chosen by context */
  const doy = dayOfYear(now);
  const lastClosed = closed[closed.length - 1];
  const pool =
    lastClosed && brokeRules(lastClosed)
      ? REFLECTIONS.afterRuleBreak
      : lastClosed && classifyOutcome(lastClosed.resultR) === "loss"
        ? REFLECTIONS.afterLoss
        : streak.outcome === "win" && streak.count >= 2
          ? REFLECTIONS.afterWins
          : REFLECTIONS.general;

  return {
    headline,
    tone,
    cards,
    principle: PRINCIPLES[doy % PRINCIPLES.length],
    reflection: pool[doy % pool.length],
    sample: closed.length,
  };
}

/** One short line for the New trade form. */
export function nudge(b: Briefing): CoachCard | null {
  return b.cards.find((c) => c.tone === "alert" || c.tone === "warn") ?? null;
}

export { VERDICTS };
