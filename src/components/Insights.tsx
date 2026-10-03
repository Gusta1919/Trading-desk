import { useMemo } from "react";
import type { CheckIn } from "@/lib/checkin";
import { fmtR } from "@/lib/format";
import { behaviour, edges, findInsights, leaks, type Insight, type Slice } from "@/lib/insights";
import type { Rulebook } from "@/lib/rulebook";
import type { Trade } from "@/lib/types";
import { Empty, Panel, cx, stagger } from "./ui";

const CONF: Record<Insight["confidence"], { label: string; cls: string }> = {
  strong: { label: "strong", cls: "text-ink" },
  likely: { label: "likely", cls: "text-soft" },
  early: { label: "early sign", cls: "text-faint" },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "What drives your results": the factors that most help and hurt you. */
export function DriversCard({ trades, checkins, doc, index = 0 }: { trades: Trade[]; checkins: CheckIn[]; doc?: Rulebook; index?: number }) {
  const insights = useMemo(
    () => findInsights(trades, checkins, doc),
    [trades, checkins, doc],
  );
  const good = edges(insights).slice(0, 6);
  const bad = leaks(insights).slice(0, 6);

  return (
    <Panel index={index} id="sec-drivers" title="What drives your results" sub="Every field you log, compared: trades with it against trades without it, in average R per trade.">
      {insights.length === 0 ? (
        <Empty title="Not enough trades yet" body="Patterns start to show after about 15–20 closed trades." className="py-8" />
      ) : (
        <div className="grid gap-8 md:grid-cols-2">
          <List title="Edges — do more of this" items={good} empty="No clear edges yet." />
          <List title="Leaks — do less of this" items={bad} empty="No clear leaks yet." />
        </div>
      )}
    </Panel>
  );
}

function List({ title, items, empty }: { title: string; items: Insight[]; empty: string }) {
  return (
    <div>
      <h3 className="eyebrow mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-body text-soft">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i, n) => (
            <li key={i.key} className="anim-rise flex items-baseline justify-between gap-3 py-2 text-body" style={stagger(n, 50)}>
              <span className="min-w-0">
                <span className="block truncate">{i.label}</span>
                <span className="text-caption text-faint">
                  {i.n} trades · <span className={CONF[i.confidence].cls}>{CONF[i.confidence].label}</span>
                </span>
              </span>
              <span className="num shrink-0 text-right">
                <span className={cx("font-medium", i.avgR >= 0 ? "text-up" : "text-down")}>{fmtR(i.avgR)}</span>
                <span className="block text-caption text-faint">vs {fmtR(i.restAvgR)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Habits": how you behave after wins/losses, how much of your targets you take, whether grades mean anything. */
export function HabitsCard({ trades, checkins, index = 0 }: { trades: Trade[]; checkins: CheckIn[]; index?: number }) {
  const b = useMemo(() => behaviour(trades, checkins), [trades, checkins]);
  if (b.all.n < 8) return null;

  const rows: [string, Slice][] = [
    ["All trades", b.all],
    ["Right after a win", b.afterWin],
    ["Right after a loss", b.afterLoss],
    ["After 3+ wins in a row", b.afterWinStreak],
    ["After 2+ losses in a row", b.afterLossStreak],
  ];

  return (
    <Panel index={index} id="sec-habits" title="How you trade after a win or a loss" sub="Your results, rule breaks and sizing, against what just happened.">
      <div className="-mx-6 overflow-x-auto">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b">
              <th className="px-6 py-2.5 text-left eyebrow">Situation</th>
              <th className="px-3 py-2.5 text-right eyebrow">Trades</th>
              <th className="px-3 py-2.5 text-right eyebrow">Avg R</th>
              <th className="px-3 py-2.5 text-right eyebrow">Rules broken</th>
              <th className="px-6 py-2.5 text-right eyebrow">Avg risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, s], i) => (
              <tr key={label} className={cx("border-b last:border-0", i > 0 && s.n < 4 && "opacity-50")}>
                <td className={cx("px-6 py-2.5", i === 0 ? "text-soft" : "font-medium")}>{label}</td>
                <td className="num px-3 py-2.5 text-right text-soft">{s.n}</td>
                <td className={cx("px-3 py-2.5 text-right", s.n ? (s.avgR >= 0 ? "text-up" : "text-down") : "")}>
                  {s.n ? fmtR(s.avgR) : "—"}
                </td>
                <td className={cx("px-3 py-2.5 text-right", i > 0 && s.n >= 4 && s.ruleBreakRate > b.all.ruleBreakRate + 0.15 && "text-down")}>
                  {s.n ? pct(s.ruleBreakRate) : "—"}
                </td>
                <td className={cx("px-6 py-2.5 text-right", i > 0 && s.n >= 4 && s.avgRisk > b.all.avgRisk * 1.15 && "text-down")}>
                  {s.n ? `${s.avgRisk.toFixed(2)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-3">
        <Fact
          label="Target taken on winners"
          value={b.capture ? pct(b.capture.ratio) : "—"}
          note={b.capture ? `full target hit ${pct(b.capture.hitRate)} of ${b.capture.n} wins` : "needs winners with a planned R:R"}
          warn={!!b.capture && b.capture.n >= 5 && b.capture.ratio < 0.75}
        />
        <Fact
          label="Grades predict results?"
          value={b.gradeCalibrated == null ? "—" : b.gradeCalibrated ? "Yes" : "Not yet"}
          note={b.grades.length ? b.grades.map((g) => `${g.grade} ${fmtR(g.avgR)}`).join(" · ") : "needs 3+ trades per grade"}
          warn={b.gradeCalibrated === false}
        />
        <Fact
          label="Rule breaks, last 10 trades"
          value={b.discipline ? pct(b.discipline.recent) : "—"}
          note={b.discipline ? `before: ${pct(b.discipline.before)}` : "needs 15+ trades"}
          warn={!!b.discipline && b.discipline.recent > b.discipline.before + 0.15}
        />
      </div>
    </Panel>
  );
}

function Fact({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={cx("num text-title font-medium", warn && "text-down")}>{value}</div>
      <div className="num text-caption text-faint">{note}</div>
    </div>
  );
}
