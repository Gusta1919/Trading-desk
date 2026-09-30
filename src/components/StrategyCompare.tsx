import { useMemo, useState, type ReactNode } from "react";
import { fmtR, fmtRate, tone } from "@/lib/format";
import { rangeIndex, rangeLabel, withUnit } from "@/lib/grading";
import { classifyOutcome, isClosed } from "@/lib/stats";
import { GRADES, isGrade, type Factor, type Strategy, type Trade } from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { Segmented, cx, stagger } from "./ui";

/** Groups with fewer trades than this are shown faded — too few to trust. */
const MIN_SAMPLE = 5;

interface Group {
  key: string;
  label: ReactNode;
  taken: Trade[];
  skipped: Trade[];
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

/**
 * Per strategy: how each grade, each number-factor range and each choice-factor
 * option has actually paid, so the thresholds and
 * the "Don't" rungs can be checked against evidence rather than feel.
 */
export function StrategyCompare({ trades, strategies }: { trades: Trade[]; strategies: Strategy[] }) {
  const used = strategies.filter((s) => trades.some((t) => t.strategyId === s.id));
  const [picked, setPicked] = useState<string | null>(null);
  const strategy = used.find((s) => s.id === picked) ?? used[0] ?? null;

  const mine = useMemo(
    () => (strategy ? trades.filter((t) => t.strategyId === strategy.id) : []),
    [trades, strategy],
  );

  if (!strategy) return null;

  const split = (keyOf: (t: Trade) => string | null) => {
    const by = new Map<string, { taken: Trade[]; skipped: Trade[] }>();
    for (const t of mine) {
      const k = keyOf(t);
      if (k == null) continue;
      const g = by.get(k) ?? { taken: [], skipped: [] };
      (t.skipped ? g.skipped : g.taken).push(t);
      by.set(k, g);
    }
    return by;
  };

  const byGrade = split((t) => (isGrade(t.grade) ? t.grade : null));
  const gradeGroups: Group[] = GRADES.filter((g) => byGrade.has(g)).map((g) => ({
    key: g,
    label: <GradeBadge grade={g} size="sm" />,
    ...byGrade.get(g)!,
  }));

  const factorGroups = strategy.factors.map((f) => {
    if (f.kind === "number") {
      const by = split((t) => {
        const a = answerOf(t, f);
        return typeof a === "number" ? String(rangeIndex(f, a)) : null;
      });
      const groups: Group[] = f.caps
        .map((cap, i) => ({ cap, i }))
        .reverse()
        .filter(({ i }) => by.has(String(i)))
        .map(({ cap, i }) => ({
          key: String(i),
          label: (
            <span className="flex items-center gap-2">
              <span className="num">{withUnit(rangeLabel(f, i), f.unit)}</span>
              <GradeBadge grade={cap} size="sm" muted />
            </span>
          ),
          ...by.get(String(i))!,
        }));
      return { factor: f, groups };
    }
    const by = split((t) => {
      const a = answerOf(t, f);
      return typeof a === "string" ? a : null;
    });
    const groups: Group[] = [...by.keys()].map((id) => {
      const option = f.options.find((o) => o.id === id);
      // An option removed from the strategy since keeps its old label via the trade's snapshot.
      const old = by
        .get(id)!
        .taken.concat(by.get(id)!.skipped)
        .map((t) => t.setupSnapshot?.factors.find((x) => x.id === f.id))
        .find(Boolean);
      const oldLabel = old?.kind === "choice" ? old.options.find((o) => o.id === id)?.label : undefined;
      return {
        key: id,
        label: (
          <span className="flex items-center gap-2">
            {option?.label ?? oldLabel ?? "removed option"}
            {option && <GradeBadge grade={option.cap} size="sm" muted />}
          </span>
        ),
        ...by.get(id)!,
      };
    });
    // In the strategy's own option order.
    groups.sort(
      (a, b) =>
        (f.options.findIndex((o) => o.id === a.key) + 1 || 99) -
        (f.options.findIndex((o) => o.id === b.key) + 1 || 99),
    );
    return { factor: f, groups };
  });

  return (
    <section id="sec-strategy" className="card scroll-mt-24 px-6 py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold">By strategy</h2>
          <p className="text-[12px] text-faint">
            How each grade, range and answer has actually paid.
          </p>
        </div>
        {used.length > 1 && (
          <Segmented
            size="sm"
            value={strategy.id}
            onChange={(v) => v && setPicked(v)}
            options={used.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
      </div>

      <Sub title="Grades" note="Is each rung worth its risk? A negative expectancy says switch it to Don't.">
        <RTable groups={gradeGroups} empty="No graded trades yet." />
      </Sub>

      {factorGroups.map(({ factor, groups }) => (
        <Sub
          key={factor.id}
          title={factor.name}
          note={
            factor.kind === "number"
              ? "Each range with the grade it caps at — check the boundaries sit where results actually change."
              : "Each answer with the grade it caps at."
          }
        >
          <RTable groups={groups} empty={`No trades answered “${factor.name}” yet.`} />
        </Sub>
      ))}

      <p className="mt-4 text-[12px] text-faint">
        Faded rows have fewer than {MIN_SAMPLE} trades. Expectancy is the average R per trade.
      </p>
    </section>
  );
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
          <col className="w-[34%]" />
          <col className="w-[11%]" />
          <col className="w-[13%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
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
