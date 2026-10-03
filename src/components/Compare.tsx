import { useMemo, useState, type ReactNode } from "react";
import { QUESTIONS, VERDICTS, type CheckIn } from "@/lib/checkin";
import { releasesHeld } from "@/lib/discipline";
import { fmtPct, fmtR, fmtRate, tone } from "@/lib/format";
import { rangeIndex, rangeLabel, withUnit } from "@/lib/grading";
import { depthBucket } from "@/lib/insights";
import { fromTradeNews, newsDay } from "@/lib/newsRules";
import type { Rulebook } from "@/lib/rulebook";
import { WEEKDAYS, classifyOutcome, isClosed, tradePct, weekdayOf } from "@/lib/stats";
import { EMOTIONS, EXIT_REASONS, GRADES, HTF_TIMEFRAMES, POI_TESTS, SESSIONS, isGrade, topHtf, type Factor, type Trade } from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { Panel, Segmented, cx, stagger } from "./ui";

/** Groups with fewer trades than this are shown faded — too few to trust. */
export const MIN_SAMPLE = 5;

interface Group {
  key: string;
  label: ReactNode;
  trades: Trade[];
  /** Setups not taken: scored by what they would have made, never by money. */
  paper?: boolean;
}

/** Trades split by a key, in a fixed order; keys outside the order come after it. */
function groups(trades: Trade[], keyOf: (t: Trade) => string | string[] | null, order: { key: string; label: ReactNode }[]): Group[] {
  const by = new Map<string, Trade[]>();
  for (const t of trades) {
    const raw = keyOf(t);
    for (const k of raw == null ? [] : Array.isArray(raw) ? raw : [raw]) by.set(k, [...(by.get(k) ?? []), t]);
  }
  const known = order.filter((o) => by.has(o.key)).map((o) => ({ ...o, trades: by.get(o.key)! }));
  const rest = [...by.keys()].filter((k) => !order.some((o) => o.key === k)).map((k) => ({ key: k, label: k, trades: by.get(k)! }));
  return [...known, ...rest];
}

const yesNo = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");
const YES_NO = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

/** The answer a trade gave to a factor, from its frozen snapshot. */
const answerOf = (t: Trade, f: Factor) => t.setupSnapshot?.answers?.[f.id];

/** A factor's answers as groups, read from each trade's own snapshot so old wording survives. */
function factorGroups(trades: Trade[], f: Factor): Group[] {
  if (f.kind === "number") {
    return groups(
      trades,
      (t) => {
        const a = answerOf(t, f);
        return typeof a === "number" ? String(rangeIndex(f, a)) : null;
      },
      f.caps
        .map((cap, i) => ({
          key: String(i),
          label: (
            <span className="flex items-center gap-2">
              <span className="num">{withUnit(rangeLabel(f, i), f.unit)}</span>
              <GradeBadge grade={cap} size="sm" muted />
            </span>
          ),
        }))
        .reverse(),
    );
  }
  const labelOf = (id: string) => {
    for (const t of trades) {
      const old = t.setupSnapshot?.factors.find((x) => x.id === f.id);
      const o = old?.kind === "choice" ? old.options.find((x) => x.id === id) : null;
      if (o) return o.label;
    }
    return "removed answer";
  };
  return groups(
    trades,
    (t) => {
      const a = answerOf(t, f);
      return typeof a === "string" ? a : null;
    },
    f.options.map((o) => ({
      key: o.id,
      label: (
        <span className="flex items-center gap-2">
          {o.label}
          <GradeBadge grade={o.cap} size="sm" muted />
        </span>
      ),
    })),
  ).map((g) => (typeof g.label === "string" ? { ...g, label: labelOf(g.key) } : g));
}

function hourBucket(t: Trade) {
  const h = Number(t.date.slice(11, 13));
  const from = h - (h % 2);
  return `${String(from).padStart(2, "0")}:00–${String(from + 2).padStart(2, "0")}:00`;
}

type View = "grade" | "setup" | "trade" | "when" | "you";

const VIEWS: { value: View; label: string }[] = [
  { value: "grade", label: "Grade & factors" },
  { value: "setup", label: "Setup" },
  { value: "trade", label: "Entry & exit" },
  { value: "when", label: "When" },
  { value: "you", label: "You" },
];

/**
 * How every grade, every factor answer and every journal field has actually paid — so
 * the thresholds, the ladder and the hypotheses can be checked against evidence rather
 * than feel. Taken, closed trades; B setups not taken show what they would have made.
 */
export function Compare({ trades, checkins, doc, index = 0 }: { trades: Trade[]; checkins: CheckIn[]; doc: Rulebook; index?: number }) {
  const [view, setView] = useState<View>("grade");
  const taken = useMemo(() => trades.filter((t) => !t.skipped && isClosed(t)), [trades]);
  const passed = useMemo(() => trades.filter((t) => t.skipped && t.hypotheticalR != null), [trades]);
  const byDate = useMemo(() => new Map(checkins.map((c) => [c.date, c])), [checkins]);

  const sections: { title: string; note: string; groups: Group[] }[] = [];
  if (view === "grade") {
    sections.push({
      title: "Grades",
      note: "Does A+ earn its place above A — and would the B setups you passed on have paid?",
      groups: [
        ...groups(taken, (t) => (isGrade(t.grade) ? t.grade : null), GRADES.map((g) => ({ key: g, label: <GradeBadge grade={g} size="sm" /> }))),
        ...groups(passed, (t) => (isGrade(t.grade) ? `${t.grade}·paper` : null), GRADES.map((g) => ({ key: `${g}·paper`, label: <span className="flex items-center gap-2"><GradeBadge grade={g} size="sm" muted /> <span className="text-soft">not taken</span></span> }))).map((g) => ({ ...g, paper: true })),
      ],
    });
    for (const f of doc.factors) {
      sections.push({
        title: f.name,
        note: f.kind === "number" ? "Each range with the grade it caps at — do the boundaries sit where results change?" : "Each answer with the grade it caps at.",
        groups: factorGroups(taken, f),
      });
    }
  }
  if (view === "setup") {
    sections.push(
      {
        title: "Sweep depth",
        note: "Beyond the box edge, against the reference depths.",
        groups: groups(
          taken,
          (t) => depthBucket(t.sweepDepth, doc),
          [`under $${doc.sweep.p70}`, `$${doc.sweep.p70}–${doc.sweep.p85}`, `$${doc.sweep.p85}–${doc.sweep.p95}`, `over $${doc.sweep.p95}`].map((k) => ({ key: k, label: k })),
        ),
      },
      { title: "HTF reason timeframe", note: "The highest one logged — the one that counts.", groups: groups(taken, (t) => topHtf(t.htfReasons)?.tf ?? null, HTF_TIMEFRAMES.map((x) => ({ key: x.value, label: x.label }))) },
      { title: "Sweep took a 15m swing", note: "Logged, not a rule yet.", groups: groups(taken, (t) => yesNo(t.took15mSwing), YES_NO) },
      { title: "POI", note: "Fresh against retested.", groups: groups(taken, (t) => t.poiTests || null, POI_TESTS.map((p) => ({ key: p.value, label: p.label }))) },
      { title: "Important-level sweep", note: "Logged, not a rule yet.", groups: groups(taken, (t) => yesNo(t.levelSweep), YES_NO) },
      { title: "Bias against the briefing", note: "Did your daily bias match the Daily Bias briefing's?", groups: groups(taken, (t) => yesNo(t.biasMatch), [{ key: "yes", label: "Matched" }, { key: "no", label: "Differed" }]) },
    );
  }
  if (view === "trade") {
    sections.push(
      {
        title: "Planned R:R",
        note: "What the trade was aiming for.",
        groups: groups(taken, (t) => (t.plannedRR == null ? null : t.plannedRR < 1.5 ? "a" : t.plannedRR < 2 ? "b" : "c"), [
          { key: "a", label: "1–1.5R" },
          { key: "b", label: "1.5–2R" },
          { key: "c", label: "2R+" },
        ]),
      },
      { title: "Exit reason", note: "Target, stop, breakeven, trail, the time stop and the release rule are allowed; “other” is a broken rule.", groups: groups(taken, (t) => t.exitReason || null, EXIT_REASONS.map((e) => ({ key: e.value, label: e.label }))) },
      {
        title: "Held through a release",
        note: "A red release fell inside the trade.",
        groups: groups(taken, (t) => (releasesHeld(t, doc).length ? (t.releaseAtBe ? "be" : "not") : null), [
          { key: "be", label: "Stop at breakeven" },
          { key: "not", label: "Not at breakeven" },
        ]),
      },
    );
  }
  if (view === "when") {
    sections.push(
      { title: "Weekday", note: "Monday to Friday.", groups: groups(taken, weekdayOf, WEEKDAYS.slice(0, 5).map((d) => ({ key: d, label: d }))) },
      { title: "Session", note: "Set from the entry time.", groups: groups(taken, (t) => t.session || null, SESSIONS.map((s) => ({ key: s, label: s }))) },
      { title: "Time of day", note: "New York, in two-hour steps.", groups: groups(taken, hourBucket, []) },
      { title: "Direction", note: "Long after the low is swept, short after the high.", groups: groups(taken, (t) => t.direction, [{ key: "long", label: "Long" }, { key: "short", label: "Short" }]) },
      {
        title: "Release day",
        note: "A red release opened a window that day.",
        groups: groups(taken, (t) => (t.news.length ? (newsDay(t.date.slice(0, 10), t.news.map(fromTradeNews), doc.news).windows.length ? "yes" : "no") : null), YES_NO),
      },
    );
  }
  if (view === "you") {
    sections.push(
      {
        title: "The morning check-in",
        note: "The day's verdict — a trade on a stand-down day is a broken rule.",
        groups: groups(taken, (t) => {
          const c = byDate.get(t.date.slice(0, 10));
          return c ? VERDICTS[c.verdict].label : "No check-in";
        }, [...Object.values(VERDICTS).map((v) => ({ key: v.label, label: v.label })), { key: "No check-in", label: "No check-in" }]),
      },
      { title: "State of mind", note: "As you logged it on the trade.", groups: groups(taken, (t) => (t.emotion ? EMOTIONS[t.emotion - 1] : null), EMOTIONS.map((e) => ({ key: e, label: e }))) },
      { title: "Mistakes", note: "A trade with two mistakes counts in both.", groups: groups(taken, (t) => (t.mistakes.length ? t.mistakes : "No mistakes"), [{ key: "No mistakes", label: "No mistakes" }]) },
      ...QUESTIONS.map((q) => ({
        title: q.title,
        note: "From that morning's check-in.",
        groups: groups(taken, (t) => {
          const a = byDate.get(t.date.slice(0, 10))?.answers[q.id];
          return a == null ? null : (q.options[a]?.label ?? null);
        }, q.options.map((o) => ({ key: o.label, label: o.label }))),
      })),
    );
  }

  return (
    <Panel
      index={index}
      id="sec-compare"
      title="Compare"
      sub="How each grade, answer and journal field has actually paid — check the rules against evidence, not feel."
      action={<Segmented size="sm" value={view} onChange={(v) => v && setView(v)} options={VIEWS} />}
      flush
    >
      <div key={view} className="anim-fade">
        {sections.map((s, i) => (
          <div key={s.title} className={cx("border-t px-6 pb-4 pt-4", i === 0 && "border-t")}>
            <h3 className="text-body font-medium">{s.title}</h3>
            <p className="mb-2 text-small text-faint">{s.note}</p>
            <GroupTable groups={s.groups} empty={`Nothing logged for “${s.title}” yet.`} />
          </div>
        ))}
        <p className="border-t px-6 py-3 text-caption text-faint">
          Faded rows have fewer than {MIN_SAMPLE} trades — too few to trust. Expectancy is the average R per trade; win rate leaves breakevens out.
        </p>
      </div>
    </Panel>
  );
}

/** One comparison: each group's trades, win rate, expectancy and net — with a bar from the centre line. */
export function GroupTable({ groups, empty }: { groups: Group[]; empty: string }) {
  if (!groups.length) return <p className="py-2 text-small text-soft">{empty}</p>;
  const stats = groups.map((g) => {
    const rs = g.trades.map((t) => (g.paper ? (t.hypotheticalR ?? 0) : (t.resultR ?? 0)));
    const outcomes = rs.map((r) => classifyOutcome(r));
    const wins = outcomes.filter((o) => o === "win").length;
    const decided = wins + outcomes.filter((o) => o === "loss").length;
    return {
      n: g.trades.length,
      winRate: decided ? wins / decided : null,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      net: g.paper ? null : g.trades.reduce((a, t) => a + tradePct(t), 0),
    };
  });
  const maxAbs = Math.max(...stats.map((s) => Math.abs(s.avgR ?? 0)), 0.0001);
  return (
    <div className="-mx-6 overflow-x-auto">
      <table className="w-full table-fixed text-body">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
          <col className="w-[13%]" />
          <col className="w-[12%]" />
          <col className="w-[19%]" />
        </colgroup>
        <thead>
          <tr className="border-b">
            <th className="eyebrow px-6 py-2 text-left">Group</th>
            <th className="eyebrow px-3 py-2 text-right">Trades</th>
            <th className="eyebrow px-3 py-2 text-right">Win rate</th>
            <th className="eyebrow px-3 py-2 text-right">Expectancy</th>
            <th className="eyebrow px-3 py-2 text-right">Net</th>
            <th className="px-6 py-2" />
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => {
            const s = stats[i];
            return (
              <tr key={g.key} className={cx("anim-rise border-b last:border-0", s.n < MIN_SAMPLE && "[&>td:not(:last-child)]:opacity-50")} style={stagger(i, 45)}>
                <td className="px-6 py-2 font-medium">{g.label}</td>
                <td className="num px-3 py-2 text-right text-soft">{s.n}</td>
                <td className="num px-3 py-2 text-right">{fmtRate(s.winRate)}</td>
                <td className={cx("num px-3 py-2 text-right font-medium", tone(s.avgR))}>{g.paper && s.avgR != null ? `(${fmtR(s.avgR)})` : fmtR(s.avgR)}</td>
                <td className={cx("num px-3 py-2 text-right", tone(s.net))}>{s.net == null ? <span className="text-faint">—</span> : fmtPct(s.net)}</td>
                <td className="px-6 py-2">
                  <Diverging value={s.avgR ?? 0} max={maxAbs} paper={g.paper} index={i} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A bar growing right (a gain) or left (a loss) from a centre line. */
function Diverging({ value, max, paper, index }: { value: number; max: number; paper?: boolean; index: number }) {
  const w = (Math.abs(value) / max) * 50;
  return (
    <div className="relative h-2">
      <div className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-line" />
      <div
        className={cx("anim-grow absolute top-0 h-2", value >= 0 ? "rounded-r bg-up" : "rounded-l bg-down", paper && "opacity-40")}
        style={{
          ...(value >= 0 ? { left: "50%", width: `${w}%`, transformOrigin: "left" } : { right: "50%", width: `${w}%`, transformOrigin: "right" }),
          animationDelay: `${120 + index * 45}ms`,
        }}
      />
    </div>
  );
}
