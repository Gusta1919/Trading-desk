import type { DeskStatus } from "@/lib/discipline";
import type { Limits } from "@/lib/types";
import { Tip, cx } from "./ui";

/**
 * Today's loss budget in the top bar: what is left of the daily stop, as a word, a
 * small bar and the number. A read-out only — the lines themselves are changed in the
 * Rulebook, where every change is recorded; the whole day is in the dock below.
 */
export function BudgetMeter({ status, limits }: { status: DeskStatus | null; limits: Limits | null }) {
  if (!limits || !status) return null;
  const day = status.dayBudget;
  const week = status.weekBudget;
  const left = limits.dailyStopPct > 0 ? day.remaining / limits.dailyStopPct : 0;
  // The most serious thing about the budget wins the word.
  const state = week.stopHit
    ? { label: "Weekly stop hit", cls: "text-down" }
    : day.stopHit
      ? { label: "Daily stop hit", cls: "text-down" }
      : left <= 0.5 + 1e-9
        ? { label: "Budget low", cls: "text-warn" }
        : { label: "Daily budget", cls: "text-up" };

  return (
    <Tip
      text={
        <span className="block space-y-0.5">
          <span className="block">
            Today: <b className="num text-ink">{day.remaining.toFixed(2)}%</b> of {limits.dailyStopPct}% left
          </span>
          <span className="block">
            This week: <b className="num text-ink">{week.remaining.toFixed(2)}%</b> of {limits.weeklyStopPct}% left
          </span>
          <span className="block text-faint">Max {limits.maxRiskPct}% per trade · change the lines in the Rulebook</span>
        </span>
      }
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-small"
    >
      <span className={cx("font-medium", state.cls)}>{state.label}</span>
      <span className="hidden h-[5px] w-12 overflow-hidden rounded-full bg-subtle 2xl:block">
        <span
          className={cx("block h-full rounded-full bg-current transition-[width] duration-700", state.cls)}
          style={{ width: `${Math.max(0, Math.min(1, left)) * 100}%`, boxShadow: "0 0 8px currentColor" }}
        />
      </span>
      <span className="num text-faint">
        {day.remaining.toFixed(2)}
        <span className="opacity-50">/{limits.dailyStopPct}%</span>
      </span>
    </Tip>
  );
}
