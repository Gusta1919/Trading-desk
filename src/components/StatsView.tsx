import { useMemo, useState, type ReactNode } from "react";
import { fmtNum, fmtPct, fmtR, fmtRate, tone } from "@/lib/format";
import { WEEKDAYS, groupBy, summarize, weekdayOf, type GroupRow } from "@/lib/stats";
import {
  EMOTIONS,
  ENTRY_MODELS,
  GRADES,
  HTFS,
  SESSIONS,
  checklistComplete,
  checklistRecorded,
  type Strategy,
  type Trade,
} from "@/lib/types";
import { QUESTIONS, VERDICTS, type CheckIn } from "@/lib/checkin";
import { EquityChart } from "./EquityChart";
import { DriversCard, HabitsCard } from "./Insights";
import { StrategyCompare } from "./StrategyCompare";
import { Segmented, cx } from "./ui";

type Range = "30" | "90" | "ytd" | "all";

/** Groups with fewer trades than this are shown faded — too few to trust. */
const MIN_SAMPLE = 5;

const DIMENSIONS: {
  id: string;
  label: string;
  key: (t: Trade) => string | string[] | null;
  order?: string[];
}[] = [
  {
    id: "checklist",
    label: "Checklist",
    key: (t) =>
      !checklistRecorded(t)
        ? "Checklist not recorded"
        : checklistComplete(t)
          ? "Checklist complete"
          : "Checklist incomplete",
    order: ["Checklist complete", "Checklist incomplete"],
  },
  // Legacy fields: only offered while some trade in the period still has them.
  { id: "entry", label: "Entry (legacy)", key: (t) => t.entryModel || null, order: ENTRY_MODELS },
  { id: "htf", label: "HTF (legacy)", key: (t) => t.htf || null, order: HTFS },
  { id: "setup", label: "Setup (legacy)", key: (t) => t.setup || null },
  { id: "session", label: "Session", key: (t) => t.session || null, order: SESSIONS },
  { id: "weekday", label: "Weekday", key: weekdayOf, order: WEEKDAYS },
  { id: "symbol", label: "Symbol", key: (t) => t.symbol },
  {
    id: "direction",
    label: "Long / Short",
    key: (t) => (t.direction === "long" ? "Long" : "Short"),
    order: ["Long", "Short"],
  },
  {
    id: "plan",
    label: "Plan",
    key: (t) => (t.followedPlan == null ? null : t.followedPlan ? "Followed plan" : "Broke plan"),
    order: ["Followed plan", "Broke plan"],
  },
  { id: "grade", label: "Grade", key: (t) => t.grade || null, order: GRADES },
  {
    id: "emotion",
    label: "State of mind",
    key: (t) => (t.emotion ? EMOTIONS[t.emotion - 1] : null),
    order: EMOTIONS,
  },
];

function inRange(t: Trade, range: Range) {
  if (range === "all") return true;
  const d = new Date(t.date);
  const now = new Date();
  if (range === "ytd") return d.getFullYear() === now.getFullYear();
  return now.getTime() - d.getTime() <= Number(range) * 86_400_000;
}

export function StatsView({
  trades,
  checkins,
  strategies = [],
}: {
  trades: Trade[];
  checkins: CheckIn[];
  strategies?: Strategy[];
}) {
  const [range, setRange] = useState<Range>("all");
  const [dim, setDim] = useState("checklist");
  const [wellDim, setWellDim] = useState("readiness");

  // Skipped setups are kept aside: only the per-strategy breakdown reads them.
  const inPeriod = useMemo(() => trades.filter((t) => inRange(t, range)), [trades, range]);
  const filtered = useMemo(() => inPeriod.filter((t) => !t.skipped), [inPeriod]);
  const s = useMemo(() => summarize(filtered), [filtered]);

  // Well-being: each trade is joined to the check-in you did that same day.
  const wellDimensions = useMemo(() => {
    const byDate = new Map(checkins.map((c) => [c.date, c]));
    const checkinOf = (t: Trade) => byDate.get(t.date.slice(0, 10));
    return [
      {
        id: "readiness",
        label: "Readiness",
        key: (t: Trade) => {
          const c = checkinOf(t);
          return c ? VERDICTS[c.verdict].label : "No check-in";
        },
        order: [...Object.values(VERDICTS).map((v) => v.label), "No check-in"],
      },
      ...QUESTIONS.map((q) => ({
        id: q.id,
        label: q.short,
        key: (t: Trade) => {
          const answer = checkinOf(t)?.answers[q.id];
          return answer == null ? null : q.options[answer]?.label ?? null;
        },
        order: q.options.map((o) => o.label),
      })),
    ];
  }, [checkins]);

  const wellDimension = wellDimensions.find((d) => d.id === wellDim)!;
  const wellRows = useMemo(
    () => groupBy(filtered, wellDimension.key, wellDimension.order),
    [filtered, wellDimension],
  );

  /*
   * Box size is a number, so it only means something next to your other boxes.
   * It is split into thirds of what you have actually logged, with the real
   * figures in the labels so the table answers "how big is too big" directly.
   */
  const boxDimension = useMemo(() => {
    const sizes = trades
      .map((t) => t.boxSize)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (sizes.length < 6) return null;

    const at = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor(p * sizes.length))];
    const lo = at(1 / 3);
    const hi = at(2 / 3);
    if (lo >= hi) return null; // every box the same size — nothing to compare

    const withBox = strategies.find((s) => s.boxLabel);
    const unit = withBox?.boxUnit || "pts";
    const small = `Small · ${lo} ${unit} or less`;
    const mid = `Medium · ${lo}–${hi} ${unit}`;
    const large = `Large · ${hi} ${unit} or more`;

    return {
      id: "box",
      label: `${withBox?.boxLabel || "Box"} size`,
      key: (t: Trade) =>
        t.boxSize == null ? null : t.boxSize <= lo ? small : t.boxSize >= hi ? large : mid,
      order: [small, mid, large],
    };
  }, [trades, strategies]);

  // Strategy sits first: it's the thing you actually choose before a trade.
  const dimensions = useMemo(() => {
    const names = new Map(strategies.map((s) => [s.id, s.name]));
    const strategyDim: (typeof DIMENSIONS)[number] = {
      id: "strategy",
      label: "Strategy",
      key: (t: Trade) => (t.strategyId ? (names.get(t.strategyId) ?? null) : t.setup || null),
    };
    const withData = DIMENSIONS.filter(
      (d) => !["entry", "htf", "setup"].includes(d.id) || filtered.some((t) => d.key(t)),
    );
    const base = strategies.length ? [strategyDim, ...withData] : withData;
    return boxDimension ? [...base, boxDimension] : base;
  }, [strategies, boxDimension, filtered]);

  const dimension = dimensions.find((d) => d.id === dim) ?? dimensions[0];
  const rows = useMemo(
    () => groupBy(filtered, dimension.key, dimension.order),
    [filtered, dimension],
  );
  const mistakeRows = useMemo(() => {
    const clean = groupBy(filtered, (t) => (t.mistakes.length ? null : "No mistakes"));
    return [...clean, ...groupBy(filtered, (t) => t.mistakes)];
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Segmented
          size="sm"
          value={range}
          onChange={(v) => v && setRange(v)}
          options={[
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "ytd", label: "This year" },
            { value: "all", label: "All time" },
          ]}
        />
        <span className="num text-[12px] text-faint">
          {s.closed} closed trade{s.closed === 1 ? "" : "s"}
        </span>
      </div>

      {s.closed === 0 ? (
        <div className="card px-6 py-20 text-center text-soft">
          No closed trades in this period yet.
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Net return" value={fmtPct(s.netPct)} cls={tone(s.netPct)} sub={`${fmtR(s.totalR)} total`} />
            <Kpi
              label="Win rate"
              value={fmtRate(s.winRate)}
              sub={`${s.wins}W · ${s.losses}L${s.breakeven ? ` · ${s.breakeven} BE` : ""}`}
            />
            <Kpi
              label="Profit factor"
              value={s.profitFactor === Infinity ? "∞" : fmtNum(s.profitFactor)}
              sub="gross win ÷ gross loss"
            />
            <Kpi
              label="Expectancy"
              value={fmtR(s.expectancyR)}
              cls={tone(s.expectancyR)}
              sub={`${fmtPct(s.expectancyPct)} per trade`}
            />
          </div>

          <Card id="sec-equity" title="Equity curve" note="Cumulative % return, trade by trade">
            <EquityChart points={s.equity} />
          </Card>

          {/* Secondary numbers */}
          <div className="card grid grid-cols-2 gap-x-8 gap-y-4 px-6 py-5 sm:grid-cols-3 lg:grid-cols-4">
            <Mini label="Avg win" value={fmtR(s.avgWinR)} cls={tone(s.avgWinR)} />
            <Mini label="Avg loss" value={fmtR(s.avgLossR)} cls={tone(s.avgLossR)} />
            <Mini label="Avg planned R:R" value={s.avgPlannedRR == null ? "—" : `${fmtNum(s.avgPlannedRR)}R`} />
            <Mini label="Avg risk" value={s.avgRiskPct == null ? "—" : `${fmtNum(s.avgRiskPct)}%`} />
            <Mini label="Max drawdown" value={fmtPct(s.maxDrawdownPct)} cls={tone(s.maxDrawdownPct)} />
            <Mini label="Current drawdown" value={fmtPct(s.currentDrawdownPct)} cls={tone(s.currentDrawdownPct)} />
            <Mini label="Best trade" value={fmtPct(s.bestPct)} cls={tone(s.bestPct)} />
            <Mini label="Worst trade" value={fmtPct(s.worstPct)} cls={tone(s.worstPct)} />
            <Mini label="Longest win streak" value={String(s.maxWinStreak)} />
            <Mini label="Longest loss streak" value={String(s.maxLossStreak)} />
            <Mini
              label="Current streak"
              value={s.currentStreak.outcome ? `${s.currentStreak.count} ${s.currentStreak.outcome === "win" ? "W" : "L"}` : "—"}
            />
            <Mini label="Followed plan" value={fmtRate(s.planAdherence)} />
          </div>

          <DriversCard trades={filtered} checkins={checkins} strategies={strategies} />
          <HabitsCard trades={filtered} checkins={checkins} />

          {/* Comparison */}
          <Card
            id="sec-compare"
            title="Compare"
            note="Which conditions make you money — and which cost you"
            action={
              <Segmented
                size="sm"
                value={dim}
                onChange={(v) => v && setDim(v)}
                options={dimensions.map((d) => ({ value: d.id, label: d.label }))}
              />
            }
          >
            <GroupTable rows={rows} empty={`No ${dimension.label.toLowerCase()} recorded yet.`} />
          </Card>

          <StrategyCompare trades={inPeriod} strategies={strategies} />

          <Card
            id="sec-wellbeing"
            title="Well-being"
            note="How your daily check-in answers relate to that day's trades"
            action={
              <Segmented
                size="sm"
                value={wellDim}
                onChange={(v) => v && setWellDim(v)}
                options={wellDimensions.map((d) => ({ value: d.id, label: d.label }))}
              />
            }
          >
            <GroupTable rows={wellRows} empty="No check-ins on your trading days yet." />
          </Card>

          <Card id="sec-mistakes" title="Cost of mistakes" note="Trades with a mistake vs. clean trades">
            <GroupTable rows={mistakeRows} empty="No mistakes tagged yet." />
          </Card>

          <p className="text-[12px] text-faint">
            Faded rows have fewer than {MIN_SAMPLE} trades — too few to draw conclusions.
            Win rate excludes breakeven trades. Returns are summed, not compounded.
          </p>
        </>
      )}
    </div>
  );
}

function GroupTable({ rows, empty }: { rows: GroupRow[]; empty: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-soft">{empty}</p>;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.netPct)), 0.0001);

  return (
    <div className="-mx-6 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b text-[11px] uppercase tracking-[0.06em] text-faint">
            <th className="px-6 py-2.5 text-left font-medium">Group</th>
            <th className="px-3 py-2.5 text-right font-medium">Trades</th>
            <th className="px-3 py-2.5 text-right font-medium">Win rate</th>
            <th className="px-3 py-2.5 text-right font-medium">Avg R</th>
            <th className="px-3 py-2.5 text-right font-medium">Net</th>
            <th className="w-[32%] px-6 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cx("border-b last:border-0", r.count < MIN_SAMPLE && "opacity-50")}>
              <td className="px-6 py-2.5 font-medium">{r.key}</td>
              <td className="num px-3 py-2.5 text-right text-soft">{r.count}</td>
              <td className="num px-3 py-2.5 text-right">{fmtRate(r.winRate)}</td>
              <td className={cx("num px-3 py-2.5 text-right", tone(r.avgR))}>{fmtR(r.avgR)}</td>
              <td className={cx("num px-3 py-2.5 text-right font-medium", tone(r.netPct))}>
                {fmtPct(r.netPct)}
              </td>
              <td className="px-6 py-2.5">
                <DivergingBar value={r.netPct} max={maxAbs} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bar growing right (gain) or left (loss) from a centre line. */
function DivergingBar({ value, max }: { value: number; max: number }) {
  const w = (Math.abs(value) / max) * 50;
  return (
    <div className="relative h-2">
      <div className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-line" />
      <div
        className={cx("absolute top-0 h-2", value >= 0 ? "rounded-r bg-up" : "rounded-l bg-down")}
        style={value >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
      />
    </div>
  );
}

function Card({
  id,
  title,
  note,
  action,
  children,
}: {
  id?: string;
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-24 px-6 py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {note && <p className="text-[12px] text-faint">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-[12px] text-soft">{label}</div>
      <div className={cx("num mt-1 text-[26px] font-semibold tracking-tight", cls)}>{value}</div>
      {sub && <div className="num text-[12px] text-faint">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[12px] text-faint">{label}</div>
      <div className={cx("num text-[15px] font-medium", cls)}>{value}</div>
    </div>
  );
}
