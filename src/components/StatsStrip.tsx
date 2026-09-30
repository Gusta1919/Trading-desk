import { useMemo } from "react";
import { fmtNum, fmtPct, fmtR, fmtRate, tone } from "@/lib/format";
import { summarize } from "@/lib/stats";
import type { Trade } from "@/lib/types";
import { cx, useCountUp } from "./ui";

/** One row of headline numbers — the top of the board, readable from across the desk. */
export function StatsStrip({ trades }: { trades: Trade[] }) {
  const s = useMemo(() => summarize(trades), [trades]);
  const streak = s.currentStreak.outcome
    ? `${s.currentStreak.count}${s.currentStreak.outcome === "win" ? "W" : "L"}`
    : "—";

  return (
    <div className="card grid grid-cols-2 gap-x-8 gap-y-4 px-6 py-4 sm:grid-cols-4 lg:grid-cols-7">
      <Kpi i={0} label="Net return" value={s.netPct} format={fmtPct} cls={tone(s.netPct)} />
      <Kpi i={1} label="Win rate" value={s.winRate} format={fmtRate} />
      <Kpi i={2} label="Expectancy" value={s.expectancyR} format={fmtR} cls={tone(s.expectancyR)} />
      <Kpi
        i={3}
        label="Profit factor"
        value={s.profitFactor === Infinity ? null : s.profitFactor}
        format={(v) => (s.profitFactor === Infinity ? "∞" : fmtNum(v))}
      />
      <Kpi
        i={4}
        label="Drawdown"
        value={s.currentDrawdownPct}
        format={fmtPct}
        cls={tone(s.currentDrawdownPct)}
      />
      <Kpi
        i={5}
        label="Streak"
        text={streak}
        cls={s.currentStreak.outcome === "loss" ? "text-down" : ""}
      />
      <Kpi i={6} label="Trades" text={`${s.closed}${s.open ? ` · ${s.open} open` : ""}`} />
    </div>
  );
}

function Kpi({
  i,
  label,
  value,
  text,
  format,
  cls,
}: {
  i: number;
  label: string;
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
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
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
