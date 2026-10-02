import { useEffect, useRef, useState } from "react";
import { dayBudget } from "@/lib/risk";
import { deskDay } from "@/lib/tz";
import type { Limits, Trade } from "@/lib/types";
import { cx } from "./ui";

/**
 * Your two risk lines, as one small label in the top bar: the most a trade may risk,
 * and how much of today's daily stop is used. Click it to change either.
 */
export function RiskChip({
  trades,
  limits,
  onChange,
}: {
  trades: Trade[];
  limits: Limits | null;
  onChange: (l: Limits) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Closes on a click outside or on Escape, like any small menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!limits) return null;
  const budget = dayBudget(trades, deskDay(), limits);
  const used = Math.max(0, limits.dailyStopPct - budget.remaining);
  const left = limits.dailyStopPct > 0 ? budget.remaining / limits.dailyStopPct : 0;
  // Green while more than half of the day's budget is there, amber from half down
  // (0.50 of a 1% stop is already amber), red once it is gone.
  const state = budget.stopHit
    ? { label: "Stop hit", cls: "text-down" }
    : left <= 0.5 + 1e-9
      ? { label: "Budget low", cls: "text-warn" }
      : { label: "Daily budget", cls: "text-up" };

  return (
    <div ref={ref} className="relative">
      {/* Built like the readiness read-out beside it: the state, a small line, the number. */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Today's loss budget: ${budget.remaining.toFixed(2)}% of ${limits.dailyStopPct}% left · max ${limits.maxRiskPct}% per trade — click to change`}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors hover:bg-subtle"
      >
        <span className={cx("font-medium", state.cls)}>{state.label}</span>
        <span className="hidden h-[5px] w-12 overflow-hidden rounded-full bg-subtle 2xl:block">
          <span
            className={cx("block h-full rounded-full bg-current transition-[width] duration-700", state.cls)}
            style={{ width: `${Math.max(0, Math.min(1, left)) * 100}%`, boxShadow: "0 0 8px currentColor" }}
          />
        </span>
        <span className="num text-faint">
          {budget.remaining.toFixed(2)}
          <span className="opacity-50">/{limits.dailyStopPct}%</span>
        </span>
      </button>

      {open && (
        <div className="anim-pop absolute right-0 top-full z-40 mt-2 w-72 whitespace-normal rounded-xl border bg-raised p-4 shadow-[var(--shadow-lift)]">
          <p className="text-[12px] font-medium">Your risk lines</p>
          <p className="mt-0.5 text-[11px] text-faint">Shared by every strategy.</p>
          <div className="mt-3 space-y-2.5">
            <Row label="Max risk per trade" value={limits.maxRiskPct} onChange={(v) => onChange({ ...limits, maxRiskPct: v })} />
            <Row label="Daily stop" value={limits.dailyStopPct} onChange={(v) => onChange({ ...limits, dailyStopPct: v })} />
          </div>
          <p className="mt-3 border-t pt-2.5 text-[11px] text-soft">
            {budget.stopHit ? (
              <span className="text-down">Daily stop hit — no more trades today.</span>
            ) : (
              <>
                Today: {used.toFixed(2)}% used, {budget.remaining.toFixed(2)}% left. The next trade may risk up to{" "}
                <b className="num text-ink">{+Math.min(limits.maxRiskPct, budget.remaining).toFixed(2)}%</b>.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[12px] text-soft">
      {label}
      <span className="relative">
        <input
          type="number"
          step={0.25}
          min={0.25}
          max={100}
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n) && n > 0 && n <= 100) onChange(n);
          }}
          className={cx("field num w-20 py-1 pr-6 text-right text-[12px]")}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-faint">%</span>
      </span>
    </label>
  );
}
