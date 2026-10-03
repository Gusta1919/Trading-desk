import { useMemo, useState, type ReactNode } from "react";
import { fmtR, fmtRate, tone } from "@/lib/format";
import { rangeIndex, rangeLabel, withUnit } from "@/lib/grading";
import { depthBucket } from "@/lib/insights";
import { fromTradeNews, newsDay } from "@/lib/newsRules";
import type { Rulebook } from "@/lib/rulebook";
import { releasesHeld } from "@/lib/discipline";
import { WEEKDAYS, classifyOutcome, isClosed, weekdayOf } from "@/lib/stats";
import {
  DESK_AGREED,
  EXIT_REASONS,
  GRADES,
  POI_TESTS,
  SESSIONS,
  isGrade,
  type Factor,
  type Trade,
} from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { Segmented, cx, stagger } from "./ui";

/** Groups with fewer trades than this are shown faded — too few to trust. */
const MIN_SAMPLE = 5;

interface Group {
  key: string;
  label: ReactNode;
  taken: Trade[];
}

function stats(ts: Trade[]) {
  const closed = ts.filter(isClosed);
  const outcomes = closed.map((t) => classifyOutcome(t.resultR));
  const wins = outcomes.filter((o) => o === "win").length;
  const decided = wins + outcomes.filter((o) => o === "loss").length;
  const total = closed.reduce((a, t) => a + (t.resultR ?? 0), 0);
  return {
    n: closed.length,
    winRate: decided ? wins / decided : null,
    // Expectancy in R: what an average trade in this group is worth.
    avgR: closed.length ? total / closed.length : null,
    totalR: total,
  };
}

/** The answer a trade gave to a factor, from its frozen snapshot. */
const answerOf = (t: Trade, f: Factor) => t.setupSnapshot?.answers?.[f.id];

/** Trades split by a key, in a fixed order; keys not in the order come after it. */
function groups(trades: Trade[], keyOf: (t: Trade) => string | null, order: { key: string; label: ReactNode }[]): Group[] {
  const by = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k == null) continue;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const known = order.filter((o) => by.has(o.key)).map((o) => ({ ...o, taken: by.get(o.key)! }));
  const rest = [...by.keys()].filter((k) => !order.some((o) => o.key === k)).map((k) => ({ key: k, label: k, taken: by.get(k)! }));
  return [...known, ...rest];
}

const yesNo = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");
const YES_NO = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

type View = "grade" | "setup" | "trade" | "when";

/**
 * How each grade, each factor answer and each journal field has actually paid — so the
 * thresholds, the ladder and the hypotheses can be checked against evidence rather
 * than feel. Taken trades only; a skipped setup has no result to compare.
 */
export function Compare({ trades, doc }: { trades: Trade[]; doc: Rulebook }) {
  const [view, setView] = useState<View>("grade");
  const taken = useMemo(() => trades.filter((t) => !t.skipped && isClosed(t)), [trades]);

  const sections: { title: string; note: string; groups: Group[] }[] = [];
  if (view === "grade") {
    sections.push({
      title: "Grades",
      note: "Does A+ earn its place above A?",
      groups: groups(taken, (t) => (isGrade(t.grade) ? t.grade : null), GRADES.map((g) => ({ key: g, label: <GradeBadge grade={g} size="sm" /> }))),
    });
    for (const f of doc.factors) sections.push({ title: f.name, note: factorNote(f), groups: factorGroups(taken, f) });
    // The displacement factor's own ranges (<0.25 · 0.25–1 · ≥1) are the brief's buckets.
  }
  if (view === "setup") {
    sections.push(
      {
        title: "Sweep depth",
        note: "Beyond the box edge, in the Compass reference's buckets.",
        groups: groups(
          taken,
          (t) => depthBucket(t.sweepDepth, doc),
          [`under $${doc.sweep.p70}`, `$${doc.sweep.p70}–${doc.sweep.p85}`, `$${doc.sweep.p85}–${doc.sweep.p95}`, `over $${doc.sweep.p95}`].map((k) => ({ key: k, label: k })),
        ),
      },
      { title: "Sweep took a 15m swing", note: "Logged, not a rule yet.", groups: groups(taken, (t) => yesNo(t.took15mSwing), YES_NO) },
      {
        title: "POI",
        note: "Fresh against retested.",
        groups: groups(taken, (t) => t.poiTests || null, POI_TESTS.map((p) => ({ key: p.value, label: p.label }))),
      },
      { title: "Important-level sweep", note: "Logged, not a rule yet.", groups: groups(taken, (t) => yesNo(t.levelSweep), YES_NO) },
      {
        title: "Desk agreed",
        note: "Did the Daily Bias briefing agree with your bias?",
        groups: groups(taken, (t) => t.deskAgreed || null, DESK_AGREED.map((d) => ({ key: d.value, label: d.label }))),
      },
    );
  }
  if (view === "trade") {
    sections.push(
      {
        title: "Entry type",
        note: "Market at the MSS close, or the one FVG limit.",
        groups: groups(taken, (t) => t.entryType || null, [
          { key: "market", label: "Market" },
          { key: "limit", label: "Limit" },
        ]),
      },
      {
        title: "Planned R:R",
        note: "Gross, from entry, stop and target.",
        groups: groups(
          taken,
          (t) => (t.plannedRR == null ? null : t.plannedRR < 1.5 ? "a" : t.plannedRR < 2 ? "b" : "c"),
          [
            { key: "a", label: "1–1.5R" },
            { key: "b", label: "1.5–2R" },
            { key: "c", label: "2R+" },
          ],
        ),
      },
      {
        title: "Exit reason",
        note: "Only the stop, the target, the trail, the time stop and the release rule are allowed.",
        groups: groups(taken, (t) => t.exitReason || null, EXIT_REASONS.map((e) => ({ key: e.value, label: e.label }))),
      },
      {
        title: "Held through a release",
        note: "A red release fell inside the trade.",
        groups: groups(
          taken,
          (t) => (releasesHeld(t, doc).length ? (t.releaseAtBe ? "be" : "not") : null),
          [
            { key: "be", label: "Stop at breakeven" },
            { key: "not", label: "Not at breakeven" },
          ],
        ),
      },
    );
  }
  if (view === "when") {
    sections.push(
      { title: "Weekday", note: "Compass reads the weekday too.", groups: groups(taken, weekdayOf, WEEKDAYS.map((d) => ({ key: d, label: d }))) },
      {
        title: "Direction",
        note: "Pilot: 1 win in 8 shorts.",
        groups: groups(taken, (t) => t.direction, [
          { key: "long", label: "Long" },
          { key: "short", label: "Short" },
        ]),
      },
      { title: "Session", note: "London or New York.", groups: groups(taken, (t) => t.session || null, SESSIONS.map((s) => ({ key: s, label: s }))) },
      {
        title: "Release day",
        note: "A red release that opened a window that day.",
        groups: groups(
          taken,
          (t) => (t.news.length ? (newsDay(t.date.slice(0, 10), t.news.map(fromTradeNews), doc.news).windows.length ? "yes" : "no") : null),
          YES_NO,
        ),
      },
    );
  }

  return (
    <section id="sec-rulebook" className="card scroll-mt-24 px-6 py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold">By the rulebook</h2>
          <p className="text-[12px] text-faint">How each grade, answer and journal field has actually paid.</p>
        </div>
        <Segmented
          size="sm"
          value={view}
          onChange={(v) => v && setView(v)}
          options={[
            { value: "grade", label: "Grade & factors" },
            { value: "setup", label: "Setup" },
            { value: "trade", label: "Entry & exit" },
            { value: "when", label: "When" },
          ]}
        />
      </div>

      {sections.map((s) => (
        <Sub key={s.title} title={s.title} note={s.note}>
          <RTable groups={s.groups} empty={`No trades logged with “${s.title}” yet.`} />
        </Sub>
      ))}

      <p className="mt-4 text-[12px] text-faint">
        Faded rows have fewer than {MIN_SAMPLE} trades. Expectancy is the average R per trade.
      </p>
    </section>
  );
}

const factorNote = (f: Factor) =>
  f.kind === "number"
    ? "Each range with the grade it caps at — check the boundaries sit where results actually change."
    : "Each answer with the grade it caps at.";

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
    const option = f.options.find((o) => o.id === id);
    if (option) return option.label;
    // An option removed since keeps its old label via the trades' snapshots.
    for (const t of trades) {
      const old = t.setupSnapshot?.factors.find((x) => x.id === f.id);
      const o = old?.kind === "choice" ? old.options.find((x) => x.id === id) : null;
      if (o) return o.label;
    }
    return "removed option";
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

function Sub({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <h3 className="text-[13px] font-medium">{title}</h3>
      <p className="mb-2 text-[12px] text-faint">{note}</p>
      {children}
    </div>
  );
}

function RTable({ groups, empty }: { groups: Group[]; empty: string }) {
  if (!groups.length) return <p className="py-3 text-[12px] text-soft">{empty}</p>;
  return (
    <div className="-mx-6 overflow-x-auto">
      <table className="w-full table-fixed text-[13px]">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[14%]" />
          <col className="w-[15%]" />
          <col className="w-[16%]" />
          <col className="w-[15%]" />
        </colgroup>
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-[0.06em] text-faint">
            <th className="px-6 py-2 text-left font-medium">Group</th>
            <th className="px-3 py-2 text-right font-medium">Trades</th>
            <th className="px-3 py-2 text-right font-medium">Win rate</th>
            <th className="px-3 py-2 text-right font-medium">Expectancy</th>
            <th className="px-3 py-2 text-right font-medium">Total R</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, gi) => {
            const s = stats(g.taken);
            return (
              <tr
                key={g.key}
                className={cx("anim-rise border-b last:border-0", s.n < MIN_SAMPLE && "[&>td:not(:last-child)]:opacity-50")}
                style={stagger(gi, 50)}
              >
                <td className="px-6 py-2 font-medium">{g.label}</td>
                <td className="num px-3 py-2 text-right text-soft">{s.n}</td>
                <td className="num px-3 py-2 text-right">{fmtRate(s.winRate)}</td>
                <td className={cx("num px-3 py-2 text-right font-medium", tone(s.avgR))}>{fmtR(s.avgR)}</td>
                <td className={cx("num px-3 py-2 text-right", tone(s.totalR))}>{s.n ? fmtR(s.totalR) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
