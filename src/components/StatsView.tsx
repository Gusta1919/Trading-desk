import { useMemo, useState } from "react";
import type { CheckIn } from "@/lib/checkin";
import { fmtNum, fmtPct, fmtR, fmtRate, tone } from "@/lib/format";
import { accountState, ledger } from "@/lib/limits";
import type { Rulebook } from "@/lib/rulebook";
import { summarize } from "@/lib/stats";
import type { Trade } from "@/lib/types";
import { Compare } from "./Compare";
import { EquityChart } from "./EquityChart";
import { DriversCard, HabitsCard } from "./Insights";
import { Empty, PageHeader, Panel, Segmented, Stat, cx, stagger, useCountUp } from "./ui";

type Range = "30" | "90" | "ytd" | "all";

function inRange(t: Trade, range: Range) {
  if (range === "all") return true;
  const d = new Date(t.date);
  const now = new Date();
  if (range === "ytd") return d.getFullYear() === now.getFullYear();
  return now.getTime() - d.getTime() <= Number(range) * 86_400_000;
}


/**
 * The review: how the account is doing, how you trade, and how every rule and every
 * logged field has paid. One period selector drives the whole page.
 */
export function StatsView({ trades, checkins, doc }: { trades: Trade[]; checkins: CheckIn[]; doc: Rulebook }) {
  const [range, setRange] = useState<Range>("all");
  const inPeriod = useMemo(() => trades.filter((t) => inRange(t, range)), [trades, range]);
  // Setups not taken are kept aside: they were never traded.
  const taken = useMemo(() => inPeriod.filter((t) => !t.skipped), [inPeriod]);
  const s = useMemo(() => summarize(taken), [taken]);
  const account = useMemo(() => accountState(trades, doc.limits), [trades, doc.limits]);
  const money$ = useMemo(() => ledger(trades, doc.limits), [trades, doc.limits]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stats"
        sub="How your accounts are doing, how you trade, and how every rule and logged field has actually paid."
        actions={
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
        }
      />

      {s.closed === 0 ? (
        <div className="card">
          <Empty title="No closed trades in this period" body="Results, edges and comparisons appear as soon as trades close." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Headline i={0} label="Net return" value={s.netPct} format={fmtPct} tone={tone(s.netPct)} sub={`${fmtR(s.totalR)} in total`} />
            <Headline i={1} label="Win rate" value={s.winRate == null ? null : s.winRate * 100} format={(v) => fmtRate(v == null ? null : v / 100)} sub={`${s.wins} won · ${s.losses} lost${s.breakeven ? ` · ${s.breakeven} breakeven` : ""}`} />
            <Headline i={2} label="Expectancy" value={s.expectancyR} format={fmtR} tone={tone(s.expectancyR)} sub={`${fmtPct(s.expectancyPct)} per trade`} />
            <Headline
              i={3}
              label="Profit factor"
              value={s.profitFactor === Infinity ? null : s.profitFactor}
              format={(v) => (s.profitFactor === Infinity ? "∞" : fmtNum(v))}
              sub="gross won ÷ gross lost"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <Panel index={4} title="Equity curve" sub="Cumulative % return, trade by trade">
              <EquityChart points={s.equity} />
            </Panel>
            <Panel index={5} title="Your accounts" sub="Counted from the day the journal started">
              <div className="space-y-5">
                <Stat
                  label="Since you started · all accounts"
                  value={fmtPct(money$.total.pnlPct)}
                  size="display"
                  tone={tone(money$.total.pnlPct)}
                />
                <ul className="divide-y rounded-xl border">
                  {money$.accounts.map((a, i) => (
                    <li key={a.name} className="anim-rise flex items-baseline justify-between gap-4 px-4 py-3" style={stagger(i + 2, 80)}>
                      <span className="min-w-0 text-body font-medium">{a.name}</span>
                      <span className={cx("num text-title font-medium", tone(a.pnlPct))}>{fmtPct(a.pnlPct)}</span>
                    </li>
                  ))}
                </ul>
                <Stat label="Safe risk now" value={`${account.safeRisk.toFixed(2)}%`} size="title" sub="cap, budgets and firm lines" />
              </div>
            </Panel>
          </div>

          <Panel index={6} title="The details">
            <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
              <Stat size="title" label="Avg win" value={fmtR(s.avgWinR)} tone={tone(s.avgWinR)} />
              <Stat size="title" label="Avg loss" value={fmtR(s.avgLossR)} tone={tone(s.avgLossR)} />
              <Stat size="title" label="Avg planned R:R" value={s.avgPlannedRR == null ? "—" : `${fmtNum(s.avgPlannedRR)}R`} />
              <Stat size="title" label="Avg risk" value={s.avgRiskPct == null ? "—" : `${fmtNum(s.avgRiskPct)}%`} />
              <Stat size="title" label="Max drawdown" value={fmtPct(s.maxDrawdownPct)} tone={tone(s.maxDrawdownPct)} />
              <Stat size="title" label="Drawdown now" value={fmtPct(s.currentDrawdownPct)} tone={tone(s.currentDrawdownPct)} />
              <Stat size="title" label="Best trade" value={fmtPct(s.bestPct)} tone={tone(s.bestPct)} />
              <Stat size="title" label="Worst trade" value={fmtPct(s.worstPct)} tone={tone(s.worstPct)} />
              <Stat size="title" label="Longest win run" value={String(s.maxWinStreak)} />
              <Stat size="title" label="Longest loss run" value={String(s.maxLossStreak)} />
              <Stat size="title" label="Rules kept" value={fmtRate(s.ruleAdherence)} tone={s.ruleAdherence == null ? "" : s.ruleAdherence >= 1 ? "text-up" : "text-down"} />
              <Stat size="title" label="Not taken" value={String(inPeriod.length - taken.length)} sub="setups logged, passed on" />
            </div>
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <DriversCard index={7} trades={taken} checkins={checkins} doc={doc} />
            <HabitsCard index={8} trades={taken} checkins={checkins} />
          </div>

          <Compare index={9} trades={inPeriod} checkins={checkins} doc={doc} />
        </>
      )}
    </div>
  );
}

/** One of the four numbers the page is about: a card of its own, counting up when it appears. */
function Headline({ i, label, value, format, tone: cls, sub }: { i: number; label: string; value: number | null; format: (v: number | null) => string; tone?: string; sub: string }) {
  const shown = useCountUp(value);
  return (
    <div className="card anim-rise px-6 py-5" style={stagger(i, 60)}>
      <Stat label={label} value={format(shown)} tone={cls} size="display" sub={sub} />
    </div>
  );
}
