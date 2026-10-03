import { ChevronDown, Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDate, fmtNum, fmtPct } from "@/lib/format";
import {
  PROJECTION_MONTHS,
  RUNS,
  project,
  quantile,
  simulate,
  tradesPerMonth,
  type Sim,
} from "@/lib/montecarlo";
import { exitLab } from "@/lib/exitLab";
import { gradeCard, replayDayDetailed, rulesRisk, tradingDays, weekOfDay } from "@/lib/risk";
import type { Rulebook } from "@/lib/rulebook";
import { classifyOutcome, isClosed, tradePct } from "@/lib/stats";
import { deskDay } from "@/lib/tz";
import { GRADES, SESSIONS, isGrade, type Limits, type Trade } from "@/lib/types";
import { SimChart, type PathStats } from "./SimChart";
import { PageHeader, Panel, Segmented, cx, stagger, useCountUp } from "./ui";

/** Below this, a simulation of your own results would mostly be noise. */
const MIN_TRADES = 15;

/** How far ahead to look, in trading days. */
const LOOK_AHEAD = [
  { label: "1 month", days: 21 },
  { label: "3 months", days: 63 },
  { label: "6 months", days: 126 },
  { label: "1 year", days: 252 },
];

/**
 * Two ways to size the same history. The trades and their results in R never change —
 * only how much each one risked: what you actually put on, or what your rules say.
 */
type Mode = "rules" | "traded";
type Period = "all" | "90" | "30";

/** Which of your trades the futures are built from. */
interface Filters {
  grades: string[];
  sessions: string[];
  period: Period;
}
const NO_FILTERS: Filters = { grades: [...GRADES, "none"], sessions: [...SESSIONS, "none"], period: "all" };

/** One way of replaying your history: which trades, sized how, called what. */
interface Scenario {
  filters: Filters;
  sizing: Mode;
  /** How the answer names it: "without B", "London", "as you actually traded". */
  label: string;
}

/**
 * The questions the lab answers. Each one is a pair of scenarios — what you are asking
 * about against what you have now — and the plain answer for each outcome, so the
 * result reads as a sentence rather than a set of numbers to interpret.
 */
interface Question {
  id: string;
  chip: string;
  ask: string;
  now: Scenario;
  base: Scenario | null;
  answer: { better: string; worse: string; mixed: string; none: string };
  available: (trades: Trade[]) => boolean;
}

const EVERYTHING: Scenario = { filters: NO_FILTERS, sizing: "rules", label: "all your setups" };
const has = (trades: Trade[], p: (t: Trade) => boolean) => trades.some(p);

const QUESTIONS: Question[] = [
  {
    id: "future",
    chip: "My future",
    ask: "Where is my trading likely to take me?",
    now: EVERYTHING,
    base: null,
    answer: { better: "", worse: "", mixed: "", none: "" },
    available: () => true,
  },
  {
    id: "a-plus",
    chip: "Only A+?",
    ask: "What if I only took textbook A+ setups?",
    now: { filters: { ...NO_FILTERS, grades: ["A+"] }, sizing: "rules", label: "only A+" },
    base: { ...EVERYTHING, label: "all setups" },
    answer: {
      better: "Yes — being pickier would pay. Your A setups cost more than they add.",
      worse: "No — your A setups add more than they cost. Don't narrow down to A+ only.",
      mixed: "Unclear — fewer trades, some numbers better, some worse. Not a clear case to change.",
      none: "It makes little difference. No reason to become pickier yet.",
    },
    available: (ts) => has(ts, (t) => t.grade === "A+") && has(ts, (t) => t.grade !== "A+"),
  },
  {
    id: "recent",
    chip: "Better lately?",
    ask: "Am I trading better or worse than usual lately?",
    now: { filters: { ...NO_FILTERS, period: "30" }, sizing: "rules", label: "last 30 days" },
    base: { ...EVERYTHING, label: "whole history" },
    answer: {
      better: "Better lately — your last 30 days beat your usual. Keep doing what you're doing.",
      worse: "Worse lately — your last 30 days are below your usual. Worth a review in Stats.",
      mixed: "Different, not clearly better or worse. Keep an eye on it.",
      none: "About the same as usual — your recent trading matches your history.",
    },
    available: (ts) => ts.length > 0,
  },
  {
    id: "rules",
    chip: "Cost of rule-breaks",
    ask: "What did breaking my own rules cost me?",
    now: { filters: NO_FILTERS, sizing: "traded", label: "as you actually traded" },
    base: { filters: NO_FILTERS, sizing: "rules", label: "by your rules" },
    answer: {
      better: "Your rule-breaks happened to pay so far — that's luck, not edge. Stick to your rules.",
      worse: "Breaking your rules cost you. Sticking to them would have done better.",
      mixed: "Mixed — your rule-breaks helped in some ways and hurt in others.",
      none: "You follow your rules closely — sticking to them makes no real difference.",
    },
    available: (ts) => has(ts, (t) => t.flags.length > 0 || (t.plannedRiskPct != null && Math.abs(t.riskPct - t.plannedRiskPct) > 1e-9)),
  },
  {
    id: "session",
    chip: "London or New York?",
    ask: "Which session is better for me?",
    now: { filters: { ...NO_FILTERS, sessions: ["London"] }, sizing: "rules", label: "London only" },
    base: { filters: { ...NO_FILTERS, sessions: ["New York"] }, sizing: "rules", label: "New York only" },
    answer: {
      better: "London is the better session for you.",
      worse: "New York is the better session for you.",
      mixed: "Neither session is clearly better — each wins on different numbers.",
      none: "Both sessions perform about the same for you.",
    },
    available: (ts) => has(ts, (t) => t.session === "London") && has(ts, (t) => t.session === "New York"),
  },
];

/** A day's result both ways, with every trade the rules would have sized differently. */
interface DayCompare {
  day: string;
  actual: number;
  rules: number;
  /** Nothing left to trade on this day once the filters are applied: a flat day. */
  flat: boolean;
  /** Trades kept on this day. */
  count: number;
  changes: { trade: Trade; actualRisk: number; rulesRisk: number; why: string }[];
}

/**
 * Every trading day in the period, replayed both ways. A trade the filters leave out
 * is a trade you would not have taken — so a day left with nothing is a flat day at 0,
 * not a day that never happened. (Dropping it would quietly make the history look better.)
 */
function replayDays(closed: Trade[], filters: Filters, doc: Rulebook, L: Limits): DayCompare[] {
  const cutoff = filters.period === "all" ? null : deskDay(new Date(Date.now() - Number(filters.period) * 86_400_000));
  const inPeriod = closed.filter((t) => cutoff == null || t.date.slice(0, 10) >= cutoff);
  const keep = (t: Trade) =>
    filters.grades.includes(isGrade(t.grade) ? t.grade : "none") &&
    filters.sessions.includes(SESSIONS.includes(t.session) ? t.session : "none");
  const riskOf = rulesRisk(doc);
  // The weekly stop carries across days: each week's result so far, under the rules.
  const weekNet = new Map<string, number>();

  return tradingDays(inPeriod).map((all) => {
    const list = all.filter(keep);
    const day = all[0].date.slice(0, 10);
    if (!list.length) return { day, actual: 0, rules: 0, flat: true, count: 0, changes: [] };
    const week = weekOfDay(day);
    const replay = replayDayDetailed(list, riskOf, L, { weekNetBefore: weekNet.get(week) ?? 0, maxTrades: doc.maxTradesPerDay });
    weekNet.set(week, (weekNet.get(week) ?? 0) + replay.net);
    const changes = replay.sized
      .filter(({ trade, risk }) => Math.abs(risk - trade.riskPct) > 1e-9)
      .map(({ trade, risk, stopHit, overTrades }) => {
        const card = gradeCard(doc, trade.grade);
        const why =
          risk === 0 && overTrades
            ? "a second trade that day — the rules take one"
            : risk === 0 && stopHit
            ? "taken after the daily or weekly stop — the rules skip it"
            : risk === 0 && card && !card.traded
              ? `${trade.grade} is not tradable — the rules skip it`
              : risk < trade.riskPct
                ? `${trade.grade || "trade"} at ${+trade.riskPct.toFixed(2)}% — the rules allow ${risk}%`
                : `${trade.grade || "trade"} at ${+trade.riskPct.toFixed(2)}% — the rules would use ${risk}%`;
        return { trade, actualRisk: trade.riskPct, rulesRisk: risk, why };
      });
    const actual = Number(list.reduce((a, t) => a + tradePct(t), 0).toFixed(6));
    return { day, actual, rules: replay.net, flat: false, count: list.length, changes };
  });
}



/** Too few trades behind an answer to act on it. */
const THIN = 20;

/** One finished answer: the question it was for, its futures, and what they were built from. */
interface Result {
  id: number;
  q: Question;
  sim: Sim;
  base: Sim | null;
  look: number;
  samples: number[];
  trades: number;
}

export function Simulation({ trades, doc }: { trades: Trade[]; doc: Rulebook }) {
  const L = doc.limits;
  const [look, setLook] = useState(63);
  const [qid, setQid] = useState("future");
  const [expanded, setExpanded] = useState(false);
  const [details, setDetails] = useState(false);
  const [picked, setPicked] = useState<PathStats | null>(null);

  const allClosed = useMemo(() => trades.filter(isClosed), [trades]);

  const questions = useMemo(() => QUESTIONS.filter((q) => q.available(allClosed)), [allClosed]);
  const q: Question = useMemo(() => questions.find((x) => x.id === qid) ?? questions[0], [qid, questions]);

  const nowDays = useMemo(() => replayDays(allClosed, q.now.filters, doc, L), [allClosed, q, doc, L]);
  const baseDays = useMemo(
    () => (q.base ? replayDays(allClosed, q.base.filters, doc, L) : null),
    [allClosed, q, doc, L],
  );
  const samples = useMemo(() => nowDays.map((d) => (q.now.sizing === "rules" ? d.rules : d.actual)), [nowDays, q]);
  const baseSamples = useMemo(
    () => (baseDays && q.base ? baseDays.map((d) => (q.base!.sizing === "rules" ? d.rules : d.actual)) : []),
    [baseDays, q],
  );
  const tradeCount = nowDays.reduce((a, d) => a + d.count, 0);

  /*
   * The futures for a question are worked out together and shown together: the chart,
   * the answer and the four numbers always come from the same result, so nothing is ever
   * half-updated. While the next one is being modelled the last one stays on screen,
   * dimmed, instead of blinking out — then the new one sweeps in.
   */
  const [result, setResult] = useState<Result | null>(null);
  const runs = useRef(0);
  useEffect(() => {
    if (samples.length < MIN_TRADES) {
      setResult(null);
      return;
    }
    let cancelled = false;
    // A beat first, so the dimming paints before the main thread gets busy (17–72 ms).
    const id = window.setTimeout(() => {
      const sim = simulate(samples, look);
      const base = q.base && baseSamples.length >= MIN_TRADES ? simulate(baseSamples, look) : null;
      if (!cancelled) setResult({ id: ++runs.current, q, sim, base, look, samples, trades: tradeCount });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [samples, baseSamples, look, q, tradeCount]);
  const pending = !result || result.samples !== samples || result.look !== look;
  const sim = result?.sim ?? null;
  const labelOf = (days: number) => LOOK_AHEAD.find((x) => x.days === days)?.label ?? `${days} days`;
  const lookLabel = labelOf(look);
  const perMonth = useMemo(() => tradesPerMonth(nowDays.map((d) => d.day)), [nowDays]);
  const projections = useMemo(() => (sim && perMonth ? project(samples, perMonth) : null), [sim, samples, perMonth]);

  useEffect(() => setPicked(null), [look, samples]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow">Look ahead</span>
      <Segmented
        size="sm"
        value={look}
        onChange={(v) => v && setLook(v)}
        options={LOOK_AHEAD.map((h) => ({ value: h.days, label: h.label }))}
      />
      <button
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Close (Esc)" : "Expand the chart"}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-small text-soft hover:bg-subtle hover:text-ink"
      >
        {expanded ? <X size={14} /> : <Maximize2 size={13} />}
        {expanded ? "Close" : "Expand"}
      </button>
    </div>
  );

  const enough = samples.length >= MIN_TRADES;
  const chart = (height: number) =>
    !enough ? (
      <p className="py-10 text-center text-soft">
        Needs at least {MIN_TRADES} trading days — you have {samples.length}. Until then any simulation would just be
        noise.
      </p>
    ) : !result ? (
      <div className="relative overflow-hidden rounded-xl" style={{ height }}>
        <div className="anim-skeleton absolute inset-0 bg-subtle" />
        <p className="absolute inset-0 flex items-center justify-center text-body text-faint">
          Modelling {RUNS.toLocaleString("en-GB")} futures…
        </p>
      </div>
    ) : (
      <div className={cx("transition-[opacity,filter] duration-500", pending && "opacity-40 blur-[1px]")}>
        {/* Keyed on the result, so each new answer sweeps in from the left. */}
        <SimChart key={result.id} sim={result.sim} height={height} perMonth={perMonth} selected={picked} onSelect={setPicked} unit="day" />
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk lab"
        sub={`Your own trading days, replayed into ${RUNS.toLocaleString("en-GB")} possible futures. Pick a question; the answer, the chart and the numbers all come from the same run.`}
        actions={controls}
      />

      <Panel index={1} id="sec-simulation">
        {/* One question at a time — each sets up the right trades and the right comparison. */}
        <div className="flex flex-wrap items-center gap-2">
          {questions.map((x) => (
            <button
              key={x.id}
              onClick={() => setQid(x.id)}
              title={x.ask}
              className={cx(
                "rounded-full border px-3.5 py-1.5 text-body transition-[color,background-color,border-color] duration-200",
                q.id === x.id ? "border-ink bg-ink text-bg" : "text-soft hover:border-soft hover:text-ink",
              )}
            >
              {x.chip}
            </button>
          ))}
        </div>

        {enough && result && (
          <div className={cx("transition-opacity duration-500", pending && "opacity-50")}>
            <Answer key={result.id} q={result.q} sim={result.sim} base={result.base} lookLabel={labelOf(result.look)} trades={result.trades} />
          </div>
        )}

        <div className="mt-4">{chart(360)}</div>
        {sim && <ChartLegend picked={picked} onClear={() => setPicked(null)} />}

        {result && (
          <div className={cx("transition-opacity duration-500", pending && "opacity-50")}>
            <KeyNumbers key={result.id} sim={result.sim} base={result.base} />
          </div>
        )}

        <button
          onClick={() => setDetails((v) => !v)}
          className="mt-6 flex items-center gap-1.5 text-small text-faint hover:text-ink"
        >
          <ChevronDown size={13} className={cx("transition-transform duration-200", details && "rotate-180")} />
          {details ? "Less detail" : "More detail — your rules against what you did, projections, raw numbers"}
        </button>
        {details && (
          <div className="anim-rise">
            <SizingGap days={nowDays.filter((d) => !d.flat)} mode={q.now.sizing} />
            {sim && <Stats sim={sim} trades={allClosed} />}
            {projections && perMonth ? (
              <Projections rows={projections} perMonth={perMonth} />
            ) : (
              sim && <PaceNeeded trades={allClosed} />
            )}
          </div>
        )}
      </Panel>

      {expanded && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg px-8 py-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-title font-semibold">Risk lab · {q.chip}</h2>
              <p className="text-small text-faint">
                {RUNS.toLocaleString("en-GB")} futures over the next {lookLabel}
              </p>
            </div>
            {controls}
          </div>
          <div>{chart(Math.max(320, Math.round(window.innerHeight * 0.6)))}</div>
          <ChartLegend picked={picked} onClear={() => setPicked(null)} />
          {result && <KeyNumbers key={result.id} sim={result.sim} base={result.base} />}
        </div>
      )}

      <ExitLabCard trades={trades} doc={doc} />
    </div>
  );
}

/**
 * "Which target would have paid best?" — the trades already taken, replayed with other
 * targets and with breakeven at 1R, from the MFE each one logged. Approximate by
 * nature, so it says so, and it waits for enough trades with MFE before answering.
 */
function ExitLabCard({ trades, doc }: { trades: Trade[]; doc: Rulebook }) {
  const lab = useMemo(() => exitLab(trades, doc.exitLabMin), [trades, doc.exitLabMin]);
  const best = lab.enough
    ? lab.rows.filter((r) => r.id !== "actual" && r.avgR != null && r.n >= doc.exitLabMin).sort((a, b) => b.avgR! - a.avgR!)[0]
    : null;
  const actual = lab.rows.find((r) => r.id === "actual")!;
  return (
    <Panel
      index={2}
      id="sec-exit-lab"
      title="Exit lab"
      sub="Which target would have paid best? Your taken trades, replayed from the MFE each one logged — approximate, since the path inside a trade isn't known."
    >
      {!lab.enough ? (
        <p className="py-6 text-center text-soft">
          Needs at least {doc.exitLabMin} taken trades with MFE logged — you have {lab.n}. Log the MFE (how far it went your way, in R) on every trade and this answers itself.
        </p>
      ) : (
        <>
          {best && actual.avgR != null && (
            <p className="mb-4 text-title">
              {best.avgR! > actual.avgR + 0.05 ? (
                <>
                  <b className="font-semibold">{best.label}</b> would have paid best: {fmtNum(best.avgR, 2)}R a trade against{" "}
                  {fmtNum(actual.avgR, 2)}R as traded, over {best.n} trades. Test it in Forex Tester before it becomes a rule.
                </>
              ) : (
                <>Nothing beats the way you traded by enough to matter — the opposite box edge holds up.</>
              )}
            </p>
          )}
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b eyebrow">
                  <th className="px-6 py-2 text-left font-medium">Exit rule</th>
                  <th className="px-3 py-2 text-right font-medium">Trades</th>
                  <th className="px-3 py-2 text-right font-medium">Unknown</th>
                  <th className="px-3 py-2 text-right font-medium">Expectancy</th>
                  <th className="px-6 py-2 text-right font-medium">Total R</th>
                </tr>
              </thead>
              <tbody>
                {lab.rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className={cx("anim-rise border-b last:border-0", r.n < doc.exitLabMin && "opacity-50", r.id === best?.id && "bg-subtle")}
                    style={stagger(i, 50)}
                  >
                    <td className="px-6 py-2 font-medium">{r.label}</td>
                    <td className="num px-3 py-2 text-right text-soft">{r.n}</td>
                    <td className="num px-3 py-2 text-right text-faint">{r.unknown || "—"}</td>
                    <td className={cx("num px-3 py-2 text-right font-medium", r.avgR == null ? "" : r.avgR >= 0 ? "text-up" : "text-down")}>
                      {r.avgR == null ? "—" : `${fmtNum(r.avgR, 2)}R`}
                    </td>
                    <td className="num px-6 py-2 text-right text-soft">{r.totalR == null ? "—" : `${fmtNum(r.totalR, 1)}R`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-small text-faint">
            A trade reaches X R if its MFE did. A bigger target than the one a trade hit counts only when how far price ran
            by {doc.timeStop} was logged (in R); otherwise it is left out as unknown.
          </p>
        </>
      )}
    </Panel>
  );
}

/* ── The answer ──────────────────────────────────────────────────────── */

/** The four numbers every answer rests on, read from one set of futures. */
function keyNumbers(sim: Sim) {
  return {
    typical: quantile(sim.ends, 0.5),
    bad: quantile(sim.ends, 0.05),
    dip: quantile(sim.drawdowns, 0.5),
    streak: quantile(sim.lossStreaks, 0.5),
    up: sim.ends.filter((e) => e > 0).length / sim.ends.length,
  };
}

/**
 * Whether a change is big enough to matter: a quarter of a full-risk trade for the
 * results, a whole day for the streak. Smaller moves are reshuffling noise.
 * Returns +1 when it improves things, −1 when it makes them worse, 0 when it does neither.
 */
function judge(was: ReturnType<typeof keyNumbers>, now: ReturnType<typeof keyNumbers>) {
  const step = (a: number, b: number, min: number, higherIsBetter = true) => {
    const d = higherIsBetter ? b - a : a - b;
    return Math.abs(d) < min ? 0 : Math.sign(d);
  };
  return {
    typical: step(was.typical, now.typical, 0.25),
    bad: step(was.bad, now.bad, 0.25),
    dip: step(was.dip, now.dip, 0.25),
    streak: step(was.streak, now.streak, 1, false),
  };
}

function Answer({
  q,
  sim,
  base,
  lookLabel,
  trades,
}: {
  q: Question;
  sim: Sim;
  base: Sim | null;
  lookLabel: string;
  trades: number;
}) {
  const now = keyNumbers(sim);
  const thin = trades < THIN;

  let headline: React.ReactNode;
  let tone = "text-ink";
  let bar = "var(--color-accent-2)";
  if (!q.base || !base) {
    headline = (
      <>
        Over the next {lookLabel} you would most likely end around{" "}
        <b className={now.typical >= 0 ? "text-up" : "text-down"}>{fmtPct(now.typical, 1)}</b>. In a bad stretch — 1 in 20
        futures — it is <b className={now.bad >= 0 ? "text-up" : "text-down"}>{fmtPct(now.bad, 1)}</b>, and{" "}
        <b className="text-ink">{Math.round(now.up * 100)}%</b> of futures finish up.
      </>
    );
  } else {
    /*
     * Money first. The typical and the bad-case result decide "better" or "worse"; the
     * dip and the losing streak only describe the ride. A change that leaves the money
     * where it is but smooths the swings is a calmer ride — not a reason to change rules.
     */
    const j = judge(keyNumbers(base), now);
    const money = [j.typical, j.bad];
    const ride = [j.dip, j.streak];
    const up = (xs: number[]) => xs.some((m) => m > 0) && !xs.some((m) => m < 0);
    const down = (xs: number[]) => xs.some((m) => m < 0) && !xs.some((m) => m > 0);
    const flat = (xs: number[]) => xs.every((m) => m === 0);
    const kind =
      up(money) && !down(ride)
        ? "better"
        : down(money) && !up(ride)
          ? "worse"
          : flat(money) && up(ride)
            ? "calmer"
            : flat(money) && down(ride)
              ? "rougher"
              : flat(money) && flat(ride)
                ? "none"
                : "mixed";
    headline =
      kind === "calmer"
        ? `Same result, smoother ride — ${q.now.label} mostly makes the swings smaller, not the profit bigger.`
        : kind === "rougher"
          ? `Same result, bumpier ride — ${q.now.label} brings bigger swings for no extra profit.`
          : q.answer[kind];
    tone = kind === "better" ? "text-up" : kind === "worse" ? "text-down" : "text-soft";
    bar = kind === "better" ? "var(--color-up)" : kind === "worse" ? "var(--color-down)" : "var(--color-soft)";
  }

  return (
    <div
      className="anim-rise mt-4 rounded-xl border px-5 py-4"
      style={{ borderColor: `color-mix(in oklab, ${bar} 32%, transparent)`, backgroundColor: `color-mix(in oklab, ${bar} 6%, transparent)` }}
    >
      <p className="text-small text-faint">{q.ask}</p>
      <p className={cx("mt-1 text-title font-medium leading-snug", tone)}>{headline}</p>
      <p className="mt-1.5 text-small text-faint">
        {q.base ? `Comparing ${q.base.label} → ${q.now.label}` : `All your setups, each sized by your rules`}, over the next{" "}
        {lookLabel} · based on {trades} trade{trades === 1 ? "" : "s"}.
        {thin && (
          <span className="text-warn"> Only {trades} trades behind this — treat it as a hint, not a verdict.</span>
        )}
      </p>
    </div>
  );
}

/** The same four numbers every time, in plain words — as before → after when comparing. */
function KeyNumbers({ sim, base }: { sim: Sim; base: Sim | null }) {
  const now = keyNumbers(sim);
  const was = base ? keyNumbers(base) : null;
  const j = was ? judge(was, now) : null;

  const tiles: {
    key: keyof ReturnType<typeof judge>;
    label: string;
    help: string;
    fmt: (v: number) => string;
  }[] = [
    { key: "typical", label: "Typical result", help: "Half the futures end above this, half below", fmt: (v) => fmtPct(v, 1) },
    { key: "bad", label: "Bad case", help: "1 in 20 futures ends below this", fmt: (v) => fmtPct(v, 1) },
    { key: "dip", label: "Deepest dip", help: "The fall from a high to expect along the way", fmt: (v) => fmtPct(v, 1) },
    {
      key: "streak",
      label: "Losing streak",
      help: "Red days in a row to expect",
      fmt: (v) => `${Math.round(v)} day${Math.round(v) === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t, i) => (
        <Tile
          key={t.key}
          index={i}
          label={t.label}
          help={t.help}
          value={now[t.key]}
          was={was ? was[t.key] : null}
          move={j?.[t.key] ?? 0}
          fmt={t.fmt}
          signed={t.key !== "streak"}
        />
      ))}
    </div>
  );
}

function Tile({
  index,
  label,
  help,
  value,
  was,
  move,
  fmt,
  signed,
}: {
  index: number;
  label: string;
  help: string;
  value: number;
  was: number | null;
  move: number;
  fmt: (v: number) => string;
  signed: boolean;
}) {
  // Counts up to its value, the same way the headline numbers across the app do.
  const shown = useCountUp(value, 900) ?? value;
  return (
    <div className="well anim-rise px-4 py-3.5" style={stagger(index, 70)}>
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 flex items-baseline gap-1.5 text-stat font-semibold tracking-tight">
        {was != null && <span className="text-body font-normal text-faint">{fmt(was)} →</span>}
        <span className={!signed ? "text-ink" : value >= 0 ? "text-up" : "text-down"}>{fmt(shown)}</span>
      </p>
      <p className="mt-0.5 text-small leading-snug text-faint">
        {was != null && (
          <span className={cx("font-medium", move > 0 ? "text-up" : move < 0 ? "text-down" : "text-faint")}>
            {move > 0 ? "better · " : move < 0 ? "worse · " : "no real change · "}
          </span>
        )}
        {help}
      </p>
    </div>
  );
}

/**
 * The same history, summed both ways, and the days where the two differ — so the
 * difference between the two modes is a list of your own trades, not an abstraction.
 */
function SizingGap({ days, mode }: { days: DayCompare[]; mode: Mode }) {
  const actual = days.reduce((a, d) => a + d.actual, 0);
  const rules = days.reduce((a, d) => a + d.rules, 0);
  const gap = rules - actual;
  const differing = days
    .filter((d) => d.changes.length)
    .sort((a, b) => Math.abs(b.rules - b.actual) - Math.abs(a.rules - a.actual));
  const [showAll, setShowAll] = useState(false);
  if (!days.length) return null;

  return (
    <div className="well mt-6 px-5 py-4">
      <p className="text-body font-medium">Your rules against what you actually did</p>
      <p className="text-small text-faint">
        Same trades, same results in R — only the size of each trade differs.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Total label="Sized as you actually did" value={actual} active={mode === "traded"} />
        <Total label="Sized by your rules" value={rules} active={mode === "rules"} />
        <div>
          <p className="eyebrow">What your rules would change</p>
          <p className={cx("num mt-1 text-heading font-semibold", Math.abs(gap) < 0.005 ? "text-soft" : gap > 0 ? "text-up" : "text-down")}>
            {Math.abs(gap) < 0.005 ? "nothing" : fmtPct(gap)}
          </p>
          <p className="text-small text-faint">
            {differing.length
              ? `on ${differing.length} of ${days.length} days`
              : "you followed your sizing on every day"}
          </p>
        </div>
      </div>

      {differing.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-1.5 eyebrow">Where they differ</p>
          {(showAll ? differing : differing.slice(0, 4)).map((d, i) => (
            <div key={d.day} className="anim-rise flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-1.5 text-small" style={stagger(i, 50)}>
              <span className="num w-20 shrink-0 text-soft">{fmtDate(`${d.day}T12:00`)}</span>
              <span className="min-w-0 flex-1 text-soft">{d.changes.map((c) => c.why).join(" · ")}</span>
              <span className="num shrink-0 text-faint">
                <span className={cx("font-medium", d.actual >= 0 ? "text-up" : "text-down")}>{fmtPct(d.actual)}</span>
                {" → "}
                <span className={cx("font-medium", d.rules >= 0 ? "text-up" : "text-down")}>{fmtPct(d.rules)}</span>
              </span>
            </div>
          ))}
          {differing.length > 4 && (
            <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-small text-faint hover:text-ink">
              {showAll ? "show fewer" : `show all ${differing.length} days`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const Total = ({ label, value, active }: { label: string; value: number; active: boolean }) => (
  <div className={cx("transition-opacity duration-300", !active && "opacity-60")}>
    <p className="eyebrow">
      {label}
      {active && <span className="ml-1.5 text-accent-2">· charted</span>}
    </p>
    <p className={cx("num mt-1 text-heading font-semibold", value >= 0 ? "text-up" : "text-down")}>{fmtPct(value)}</p>
    <p className="text-small text-faint">over this history</p>
  </div>
);

function ChartLegend({ picked, onClear }: { picked: PathStats | null; onClear: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-5 text-caption text-faint">
      <span className="flex items-center gap-2">
        <span className="h-[2px] w-5 rounded-full bg-up" /> Best 20% of futures
      </span>
      <span className="flex items-center gap-2">
        <span className="h-[2px] w-5 rounded-full bg-ink" /> Median
      </span>
      <span className="flex items-center gap-2">
        <span className="h-[2px] w-5 rounded-full bg-down" /> Worst 20% of futures
      </span>
      <span>Dashed verticals mark 1M · 3M · 6M · 1Y at your trading pace</span>
      {picked && (
        <button onClick={onClear} className="ml-auto text-soft underline-offset-4 hover:underline">
          Unpin future #{picked.index + 1}
        </button>
      )}
    </div>
  );
}

/* ── Statistics ──────────────────────────────────────────────────────── */

function Stats({ sim, trades }: { sim: Sim; trades: Trade[] }) {
  const outcomes = trades.map((t) => classifyOutcome(t.resultR));
  const wins = outcomes.filter((o) => o === "win").length;
  const losses = outcomes.filter((o) => o === "loss").length;
  const be = outcomes.filter((o) => o === "be").length;
  const expectancyR = trades.reduce((a, t) => a + (t.resultR ?? 0), 0) / (trades.length || 1);

  const chanceUp = sim.ends.filter((e) => e > 0).length / sim.ends.length;
  const ddRisk = (limit: number) =>
    sim.drawdowns.filter((d) => d <= -limit).length / sim.drawdowns.length;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Group title={`Outcome after ${sim.horizon} trading days`} index={0}>
        <Fact label="Typical (P50)" value={fmtPct(quantile(sim.ends, 0.5), 1)} strong />
        <Fact label="Good run (P95)" value={fmtPct(quantile(sim.ends, 0.95), 1)} />
        <Fact label="Bad run (P5)" value={fmtPct(quantile(sim.ends, 0.05), 1)} />
        <Fact
          label="Chance of being up"
          value={pct(chanceUp)}
          cls={chanceUp >= 0.5 ? "text-up" : "text-down"}
        />
      </Group>

      <Group title="Drawdown" index={1}>
        <Fact label="Typical worst (P50)" value={fmtPct(quantile(sim.drawdowns, 0.5), 1)} strong />
        <Fact label="Deepest 5% of runs" value={fmtPct(quantile(sim.drawdowns, 0.05), 1)} />
        <Fact label="Risk of −10%" value={pct(ddRisk(10))} cls={ddRisk(10) > 0.2 ? "text-down" : ""} />
        <Fact label="Risk of −20% / −30%" value={`${pct(ddRisk(20))} / ${pct(ddRisk(30))}`} />
      </Group>

      <Group title="Losing days in a row to expect" index={2}>
        <Fact label="Typical longest (P50)" value={`${quantile(sim.lossStreaks, 0.5)} red days`} strong />
        <Fact label="Unlucky run (P90)" value={`${quantile(sim.lossStreaks, 0.9)} red days`} />
        <Fact label="Worst case (P99)" value={`${quantile(sim.lossStreaks, 0.99)} red days`} />
      </Group>

      <Group title="Your edge, as measured" index={3}>
        <Fact
          label="Expectancy"
          value={`${expectancyR >= 0 ? "+" : "−"}${Math.abs(expectancyR).toFixed(2)}R`}
          cls={expectancyR >= 0 ? "text-up" : "text-down"}
          strong
        />
        <Fact
          label="Win / loss / BE"
          value={`${pct(wins / trades.length)} / ${pct(losses / trades.length)} / ${pct(be / trades.length)}`}
        />
        <Fact label="Based on" value={`${trades.length} closed trades · ${sim.horizon}-day paths`} />
      </Group>
    </div>
  );
}

/* ── Projections over calendar time ──────────────────────────────────── */

/**
 * Projections need a trading pace, and a pace needs more than a few days of history.
 * Say so rather than hiding the section — an empty space reads as a missing feature.
 */
function PaceNeeded({ trades }: { trades: Trade[] }) {
  const dates = trades.map((t) => t.date).sort();
  const days = dates.length
    ? Math.floor(
        (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86_400_000,
      ) + 1
    : 0;
  return (
    <div className="mt-6 border-t pt-5">
      <h3 className="text-body font-medium">If you keep trading exactly like this</h3>
      <p className="mt-1 text-small text-faint">
        The 1 / 3 / 6 / 12-month estimates need to know how often you trade, and your journal
        covers {days} day{days === 1 ? "" : "s"} so far. At least 7 days of trades are needed —
        any pace worked out from less would be guesswork, not a projection.
      </p>
    </div>
  );
}

function Projections({ rows, perMonth }: { rows: ReturnType<typeof project>; perMonth: number }) {
  return (
    <div className="mt-6 border-t pt-5">
      <h3 className="text-body font-semibold">If you keep trading exactly like this</h3>
      <p className="mb-3 text-small text-faint">
        At your current pace of {fmtNum(perMonth, 1)} trading days a month — same edge, same rules,
        same discipline. Only the order of results changes.
      </p>
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b eyebrow">
              <th className="px-6 py-2.5 text-left font-medium">Horizon</th>
              <th className="px-3 py-2.5 text-right font-medium">Days</th>
              <th className="px-3 py-2.5 text-right font-medium">Typical (median)</th>
              <th className="px-3 py-2.5 text-right font-medium">Average</th>
              <th className="px-3 py-2.5 text-right font-medium">Likely range (P5–P95)</th>
              <th className="px-6 py-2.5 text-right font-medium">Chance up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.months} className="border-b last:border-0">
                <td className="px-6 py-2.5 font-medium">{r.label}</td>
                <td className="num px-3 py-2.5 text-right text-soft">{r.trades}</td>
                <td
                  className={cx(
                    "num px-3 py-2.5 text-right font-medium",
                    r.median >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {fmtPct(r.median, 1)}
                </td>
                <td className={cx("num px-3 py-2.5 text-right", r.mean >= 0 ? "text-up" : "text-down")}>
                  {fmtPct(r.mean, 1)}
                </td>
                <td className="num px-3 py-2.5 text-right text-soft">
                  {fmtPct(r.p5, 1)} … {fmtPct(r.p95, 1)}
                </td>
                <td className="num px-6 py-2.5 text-right">{Math.round(r.chanceUp * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-small text-faint">
        Returns are summed, not compounded. The gap between the median and the range is the part
        you don't control — {PROJECTION_MONTHS.length} horizons, one edge, thousands of orders.
      </p>
    </div>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────── */

function Group({ title, index = 0, children }: { title: string; index?: number; children: React.ReactNode }) {
  return (
    <div className="well anim-rise px-5 py-4" style={stagger(index, 90)}>
      <h3 className="mb-3 eyebrow">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Fact({
  label,
  value,
  cls,
  strong,
}: {
  label: string;
  value: string;
  cls?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-small text-soft">{label}</span>
      <span
        className={cx(
          "num",
          strong ? "text-heading font-medium" : "text-body",
          cls,
          strong && cls === "text-up" && "glow-up",
          strong && cls === "text-down" && "glow-down",
        )}
      >
        {value}
      </span>
    </div>
  );
}
