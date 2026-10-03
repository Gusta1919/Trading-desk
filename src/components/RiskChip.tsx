import { useEffect, useRef, useState } from "react";
import type { DeskStatus } from "@/lib/discipline";
import type { Limits } from "@/lib/types";
import { Button, cx } from "./ui";

/**
 * Your risk lines, as one small label in the top bar: how much of today's stop is
 * left, and anything that takes it away. Click it to see the week too, or to change a
 * line — a change to a limit is a rule change, so it goes in the rulebook's changelog.
 */
export function RiskChip({
  status,
  limits,
  evidence,
  onSave,
}: {
  status: DeskStatus | null;
  limits: Limits | null;
  /** Trades of evidence a riskier change needs, from the rulebook's guidance. */
  evidence: number;
  onSave: (next: Limits, reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Limits | null>(limits);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(limits);
      setReason("");
      setError(null);
    }
  }, [open, limits]);

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

  if (!limits || !status) return null;
  const day = status.dayBudget;
  const week = status.weekBudget;
  const left = limits.dailyStopPct > 0 ? day.remaining / limits.dailyStopPct : 0;
  // The most serious thing about today wins the label.
  const state = status.dayOff
    ? { label: status.dayOff.reason === "rule-break" ? "Day off" : "Days off", cls: "text-down" }
    : week.stopHit
      ? { label: "Weekly stop hit", cls: "text-down" }
      : day.stopHit
        ? { label: "Stop hit", cls: "text-down" }
        : status.doneForToday
          ? { label: "Done for today", cls: "text-soft" }
          : status.halfRisk
            ? { label: "Half-risk week", cls: "text-warn" }
            : left <= 0.5 + 1e-9
              ? { label: "Budget low", cls: "text-warn" }
              : { label: "Daily budget", cls: "text-up" };

  const changed = draft && JSON.stringify(draft) !== JSON.stringify(limits);
  async function save() {
    if (!draft || !changed) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft, reason.trim() || "Changed the risk limits");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Built like the readiness read-out beside it: the state, a small line, the number. */}
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Today: ${day.remaining.toFixed(2)}% of ${limits.dailyStopPct}% left · this week: ${week.remaining.toFixed(2)}% of ${limits.weeklyStopPct}% · max ${limits.maxRiskPct}% per trade — click for more`}
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
          {day.remaining.toFixed(2)}
          <span className="opacity-50">/{limits.dailyStopPct}%</span>
        </span>
      </button>

      {open && draft && (
        <div className="anim-pop absolute right-0 top-full z-40 mt-2 w-80 whitespace-normal rounded-xl border bg-raised p-4 shadow-[var(--shadow-lift)]">
          <p className="text-[12px] font-medium">Your risk lines</p>
          <div className="mt-2 space-y-1 text-[11px] text-soft">
            <Budget label="Today" left={day.remaining} of={limits.dailyStopPct} />
            <Budget label="This week" left={week.remaining} of={limits.weeklyStopPct} />
            {status.halfRisk && <p className="text-warn">Half-risk week: every allowance × {status.multiplier}.</p>}
            {status.dayOff && (
              <p className="text-down">
                {status.dayOff.reason === "rule-break" ? "Day off — a rule was broken today." : `Days off until ${status.dayOff.until}.`}
              </p>
            )}
          </div>

          {/* What a trade taken now may risk, and why when it's nothing. */}
          <div className="mt-3 border-t pt-3 text-[11px] text-soft">
            <p className="flex items-center justify-between gap-3">
              <span>A new trade may risk</span>
              {status.blocked ? (
                <b className="num text-down">0%</b>
              ) : (
                <span className="num">
                  {(["A+", "A"] as const).map((g, i) => (
                    <span key={g}>
                      {i > 0 && <span className="text-faint"> · </span>}
                      <span className="text-faint">{g} </span>
                      <b className={status.allowedByGrade[g] > 0 ? "text-ink" : "text-down"}>{status.allowedByGrade[g]}%</b>
                    </span>
                  ))}
                </span>
              )}
            </p>
            <p className="mt-1 text-faint">
              {status.blocked
                ? `Nothing today — ${status.blocked}.`
                : status.verdict === "caution"
                  ? "Caution check-in: A+ only today."
                  : "The smallest of the grade's risk, what's left today and this week, and the max per trade."}
            </p>
          </div>

          <div className="mt-3 space-y-2 border-t pt-3">
            <Row label="Max risk per trade" value={draft.maxRiskPct} onChange={(v) => setDraft({ ...draft, maxRiskPct: v })} />
            <Row label="Daily stop" value={draft.dailyStopPct} onChange={(v) => setDraft({ ...draft, dailyStopPct: v })} />
            <Row label="Weekly stop" value={draft.weeklyStopPct} onChange={(v) => setDraft({ ...draft, weeklyStopPct: v })} />
          </div>
          {changed && (
            <div className="anim-rise mt-3 space-y-2">
              <input
                autoFocus
                className="field py-1.5 text-[12px]"
                placeholder="Why? Optional — saved in the changelog"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <p className="text-[11px] text-faint">
                Lowering risk needs no evidence; raising it needs {evidence}+ trades from data that didn't create the idea.
              </p>
              {error && <p className="text-[11px] text-down">{error}</p>}
              <div className="flex justify-end">
                <Button variant="accent" onClick={save} disabled={saving} className="px-3 py-1.5 text-[12px]">
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Budget({ label, left, of }: { label: string; left: number; of: number }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={cx("num", left <= 0 ? "text-down" : left <= of / 2 + 1e-9 ? "text-warn" : "text-ink")}>
        {left.toFixed(2)}% <span className="text-faint">of {of}% left</span>
      </span>
    </p>
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
