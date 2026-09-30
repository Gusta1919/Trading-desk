import { useMemo } from "react";
import { fmtNum, fmtPct, fmtR, fmtRate, tone } from "@/lib/format";
import { summarize } from "@/lib/stats";
import type { Trade } from "@/lib/types";
import { Tip, cx, useCountUp } from "./ui";

/** One row of headline numbers — the top of the board, readable from across the desk. */
export function StatsStrip({ trades }: { trades: Trade[] }) {
  const s = useMemo(() => summarize(trades), [trades]);
  const streak = s.currentStreak.outcome
    ? `${s.currentStreak.count}${s.currentStreak.outcome === "win" ? "W" : "L"}`
    : "—";

  return (
    <div className="card grid grid-cols-2 gap-x-8 gap-y-4 px-6 py-4 sm:grid-cols-4 lg:grid-cols-7">
      <Kpi
        i={0}
        label="Net return"
        hint="Every closed trade's result as a % of the account at the time, added up (not compounded)."
        value={s.netPct}
        format={fmtPct}
        cls={tone(s.netPct)}
      />
      <Kpi
        i={1}
        label="Win rate"
        hint="Wins ÷ (wins + losses). Breakevens — results within a hair of 0R — are left out."
        value={s.winRate}
        format={fmtRate}
      />
      <Kpi
        i={2}
        label="Expectancy"
        hint="The average result per closed trade, in R (1R = what you risked on it)."
        value={s.expectancyR}
        format={fmtR}
        cls={tone(s.expectancyR)}
      />
      <Kpi
        i={3}
        label="Profit factor"
        hint="Gross wins ÷ gross losses. Above 1 means the wins outweigh the losses."
        value={s.profitFactor === Infinity ? null : s.profitFactor}
        format={(v) => (s.profitFactor === Infinity ? "∞" : fmtNum(v))}
      />
      <Kpi
        i={4}
        label="Drawdown now"
        hint="How far below your best equity point you are right now. The worst it has ever been is on the Stats tab."
        value={s.currentDrawdownPct}
        format={fmtPct}
        cls={tone(s.currentDrawdownPct)}
      />
      <Kpi
        i={5}
        label="Streak"
        hint="Your current run of wins (W) or losses (L). Breakevens don't break or extend it."
        text={streak}
        cls={s.currentStreak.outcome === "loss" ? "text-down" : ""}
      />
      <Kpi
        i={6}
        label="Trades"
        hint="Closed trades in the journal, plus any still open. Skipped setups aren't counted."
        text={`${s.closed}${s.open ? ` · ${s.open} open` : ""}`}
      />
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
  /** What the number means — one hover away, so no label is a guess. */
  hint: string;
  /** Numeric values count up from zero when the board opens. */
  value?: number | null;
  /** Ready-made text for values that aren't numbers (streak, trade count). */
  text?: string;
  format?: (v: number | null) => string;
  cls?: string;
}) {
  const animated = useCountUp(value ?? null);
  return (
    <div className="anim-rise min-w-0" style={{ animationDelay: `${i * 45}ms` }}>
      <Tip text={hint} className="block truncate text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
        {label}
      </Tip>
      <div
        className={cx(
          "num mt-0.5 truncate text-[22px] font-medium leading-tight",
          cls,
          // A whisper of light behind the number, in its own colour.
          cls === "text-up" && "glow-up",
          cls === "text-down" && "glow-down",
        )}
      >
        {text ?? format?.(animated) ?? "—"}
      </div>
    </div>
  );
}
