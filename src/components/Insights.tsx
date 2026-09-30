import { useMemo } from "react";
import type { CheckIn } from "@/lib/checkin";
import { fmtR } from "@/lib/format";
import { behaviour, edges, findInsights, leaks, type Insight, type Slice } from "@/lib/insights";
import type { Strategy, Trade } from "@/lib/types";
import { cx } from "./ui";

const CONF: Record<Insight["confidence"], { label: string; cls: string }> = {
  strong: { label: "strong", cls: "text-ink" },
  likely: { label: "likely", cls: "text-soft" },
  early: { label: "early sign", cls: "text-faint" },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "What drives your results": the factors that most help and hurt you. */
export function DriversCard({
  trades,
  checkins,
  strategies = [],
}: {
  trades: Trade[];
  checkins: CheckIn[];
  strategies?: Strategy[];
}) {
  const insights = useMemo(
    () => findInsights(trades, checkins, strategies),
    [trades, checkins, strategies],
  );
  const good = edges(insights).slice(0, 6);
  const bad = leaks(insights).slice(0, 6);

  return (
    <section id="sec-drivers" className="card scroll-mt-24 px-6 py-5">
      <h2 className="text-[15px] font-semibold">Edge attribution</h2>
      <p className="text-[12px] text-faint">
        Every field you log, compared: trades <i>with</i> it vs. trades <i>without</i> it (avg R per trade).
      </p>
      {insights.length === 0 ? (
        <p className="py-6 text-center text-soft">
          Needs about 15–20 closed trades before patterns become visible.
        </p>
      ) : (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <List title="Edges — do more of this" items={good} empty="No clear edges yet." />
          <List title="Leaks — do less of this" items={bad} empty="No clear leaks yet." />
        </div>
      )}
    </section>
  );
}

function List({ title, items, empty }: { title: string; items: Insight[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{title}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-soft">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i) => (
            <li key={i.key} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate">{i.label}</span>
                <span className="text-[11px] text-faint">
                  {i.n} trades · <span className={CONF[i.confidence].cls}>{CONF[i.confidence].label}</span>
                </span>
              </span>
              <span className="num shrink-0 text-right">
                <span className={cx("font-medium", i.avgR >= 0 ? "text-up" : "text-down")}>{fmtR(i.avgR)}</span>
                <span className="block text-[11px] text-faint">vs {fmtR(i.restAvgR)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Habits": how you behave after wins/losses, how much of your targets you take, whether grades mean anything. */
export function HabitsCard({ trades, checkins }: { trades: Trade[]; checkins: CheckIn[] }) {
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
    <section id="sec-habits" className="card scroll-mt-24 px-6 py-5">
      <h2 className="text-[15px] font-semibold">Behavioural profile</h2>
      <p className="text-[12px] text-faint">How your results, discipline and sizing change with what just happened.</p>

      <div className="-mx-6 mt-4 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-[0.06em] text-faint">
              <th className="px-6 py-2.5 text-left font-medium">Situation</th>
              <th className="px-3 py-2.5 text-right font-medium">Trades</th>
              <th className="px-3 py-2.5 text-right font-medium">Avg R</th>
              <th className="px-3 py-2.5 text-right font-medium">Rules broken</th>
              <th className="px-6 py-2.5 text-right font-medium">Avg risk</th>
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
    </section>
  );
}

function Fact({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[12px] text-faint">{label}</div>
      <div className={cx("num text-[15px] font-medium", warn && "text-down")}>{value}</div>
      <div className="num text-[11px] text-faint">{note}</div>
    </div>
  );
}
