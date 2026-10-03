import { useMemo } from "react";
import { adherence, weekSpan } from "@/lib/discipline";
import { fmtNum, fmtPct, fmtR, fmtRate, fmtUsdSigned, tone } from "@/lib/format";
import { ledger } from "@/lib/limits";
import { summarize } from "@/lib/stats";
import { deskDay } from "@/lib/tz";
import type { Limits, Trade } from "@/lib/types";
import { Stat, stagger, useCountUp } from "./ui";

/** The headline numbers over the journal and the calendar — readable from across the desk. */
export function StatsStrip({ trades, limits }: { trades: Trade[]; limits: Limits }) {
  const s = useMemo(() => summarize(trades), [trades]);
  const total = useMemo(() => ledger(trades, limits).total.pnl, [trades, limits]);
  // Rule adherence this ISO week — reviewed next to the result, target 100%.
  const week = useMemo(() => {
    const span = weekSpan(deskDay());
    return adherence(trades, span.from, span.to);
  }, [trades]);
  const streak = s.currentStreak.outcome ? `${s.currentStreak.count}${s.currentStreak.outcome === "win" ? "W" : "L"}` : "—";

  return (
    <div className="card grid grid-cols-3 gap-x-8 gap-y-4 px-6 py-4 lg:grid-cols-9">
      <Kpi i={0} label="Net return" hint="Every closed trade's result as a % of the account at the time, added up." value={s.netPct} format={fmtPct} cls={tone(s.netPct)} />
      <Kpi
        i={0}
        label="Total P&L"
        hint={`Since the journal started, in dollars: ${[limits.accountName, ...limits.linked.map((a) => a.name)].join(" + ")}.`}
        value={total}
        format={(v) => fmtUsdSigned(v ?? 0)}
        cls={tone(total)}
      />
      <Kpi i={1} label="Win rate" hint="Wins ÷ (wins + losses). Breakevens are left out." value={s.winRate} format={fmtRate} />
      <Kpi i={2} label="Expectancy" hint="The average result per closed trade, in R (1R = what you risked on it)." value={s.expectancyR} format={fmtR} cls={tone(s.expectancyR)} />
      <Kpi
        i={3}
        label="Profit factor"
        hint="Gross wins ÷ gross losses. Above 1, the wins outweigh the losses."
        value={s.profitFactor === Infinity ? null : s.profitFactor}
        format={(v) => (s.profitFactor === Infinity ? "∞" : fmtNum(v))}
      />
      <Kpi i={4} label="Drawdown now" hint="How far below your best equity point you are right now." value={s.currentDrawdownPct} format={fmtPct} cls={tone(s.currentDrawdownPct)} />
      <Kpi i={5} label="Streak" hint="Your current run of wins (W) or losses (L). Breakevens don't break it." text={streak} cls={s.currentStreak.outcome === "loss" ? "text-down" : ""} />
      <Kpi
        i={6}
        label="Rules · this week"
        hint="This week's taken trades that broke no rule. The target is 100%."
        value={week.rate == null ? null : week.rate * 100}
        format={(v) => (week.rate == null ? "—" : `${Math.round(v ?? 0)}%`)}
        cls={week.rate == null ? "" : week.rate >= 1 ? "text-up" : "text-down"}
      />
      <Kpi i={7} label="Trades" hint="Closed trades, plus any still open. Setups not taken aren't counted." text={`${s.closed}${s.open ? ` · ${s.open} open` : ""}`} />
    </div>
  );
}

function Kpi({
  i,
  label,
  hint,
  value,
  text,
  format,
  cls,
}: {
  i: number;
  label: string;
  hint: string;
  /** Numbers count up from zero when the board opens. */
  value?: number | null;
  /** Ready-made text for values that aren't numbers. */
  text?: string;
  format?: (v: number | null) => string;
  cls?: string;
}) {
  const animated = useCountUp(value ?? null);
  return <Stat className="anim-rise" style={stagger(i, 45)} label={label} hint={hint} value={text ?? format?.(animated) ?? "—"} tone={cls} />;
}
