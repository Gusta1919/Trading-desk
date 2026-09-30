import { Copy, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { fmtPct, fmtR } from "@/lib/format";
import { gradeOneLiner } from "@/lib/grading";
import { allowedRisk, dayBudget, gradeRisk, takenTrades } from "@/lib/risk";
import { classifyOutcome, isClosed, tradePct } from "@/lib/stats";
import { duplicateStrategy } from "@/lib/strategyTemplate";
import { deskDay } from "@/lib/tz";
import {
  DEFAULT_LIMITS,
  SESSIONS,
  inOrder,
  type Limits,
  type Strategy,
  type StrategyInput,
  type Trade,
} from "@/lib/types";
import { GRADE_COLOUR, GradeBadge } from "./GradeBadge";
import { StrategyForm } from "./StrategyForm";
import { Button, cx, stagger } from "./ui";

/** Performance of one strategy, taken from the trades linked to it. */
function performanceOf(strategy: Strategy, trades: Trade[]) {
  const mine = takenTrades(trades).filter((t) => t.strategyId === strategy.id && isClosed(t));
  if (!mine.length) return null;
  const outcomes = mine.map((t) => classifyOutcome(t.resultR));
  const wins = outcomes.filter((o) => o === "win").length;
  const decided = wins + outcomes.filter((o) => o === "loss").length;
  return {
    trades: mine.length,
    winRate: decided ? wins / decided : null,
    avgR: mine.reduce((a, t) => a + (t.resultR ?? 0), 0) / mine.length,
    netPct: mine.reduce((a, t) => a + tradePct(t), 0),
  };
}

export function StrategiesView({
  strategies,
  trades,
  limits,
  onSaved,
}: {
  strategies: Strategy[];
  trades: Trade[];
  limits: Limits | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [draft, setDraft] = useState<StrategyInput | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const open = (s: Strategy | null, copy: StrategyInput | null = null) => {
    setEditing(s);
    setDraft(copy);
    setFormOpen(true);
  };

  const L = limits ?? DEFAULT_LIMITS;
  const budget = dayBudget(trades, deskDay(), L);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Playbook</h2>
          <p className="text-[12px] text-faint">
            Each strategy defines its own base rules, the factors that grade a setup, and what each
            grade may risk. Every trade is graded against them.
          </p>
        </div>
        <Button onClick={() => open(null)}>
          <Plus size={15} /> New strategy
        </Button>
      </div>

      {strategies.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <p className="text-[15px] font-medium">Your playbook is empty</p>
          <p className="max-w-md text-soft">
            Write down the rules you actually trade — the conditions every trade needs, the
            questions that separate an A+ from a B, and what each grade may risk.
          </p>
          <Button onClick={() => open(null)} className="mt-2">
            Describe your first strategy
          </Button>
        </div>
      ) : (
        // One strategy gets the whole row, laid out in two columns; several share it.
        <div className={cx("grid gap-3", strategies.length > 1 && "xl:grid-cols-2")}>
          {strategies.map((s, i) => (
            <Card
              key={s.id}
              index={i}
              wide={strategies.length === 1}
              strategy={s}
              performance={performanceOf(s, trades)}
              allowed={(g) => allowedRisk(gradeRisk(s, g), budget, L)}
              stopHit={budget.stopHit}
              onEdit={() => open(s)}
              onDuplicate={() => open(null, duplicateStrategy(s))}
            />
          ))}
        </div>
      )}

      <StrategyForm
        open={formOpen}
        strategy={editing}
        draft={draft}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
        onDuplicate={(copy) => open(null, copy)}
      />
    </div>
  );
}

function Card({
  index,
  wide,
  strategy: s,
  performance: p,
  allowed,
  stopHit,
  onEdit,
  onDuplicate,
}: {
  index: number;
  wide: boolean;
  strategy: Strategy;
  performance: ReturnType<typeof performanceOf>;
  allowed: (grade: string) => number;
  stopHit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
}) {
  const hours = s.hoursFrom && s.hoursTo ? `${s.hoursFrom}–${s.hoursTo} NY` : null;
  const meta = [s.instrument, inOrder(s.sessions, SESSIONS).join(" / "), hours].filter(Boolean);

  return (
    <div className="anim-rise flex" style={stagger(index, 120)}>
    <section className="card card-hover flex w-full flex-col px-5 py-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{s.name}</h3>
          <p className="num text-[12px] text-faint">{meta.join(" · ") || "No details yet"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-faint">
          <button onClick={onDuplicate} className="hover:text-ink" title="Duplicate">
            <Copy size={15} />
          </button>
          <button onClick={onEdit} className="hover:text-ink" title="Edit">
            <Pencil size={15} />
          </button>
        </div>
      </header>

      <div className={cx(wide && "xl:grid xl:grid-cols-[2fr_3fr] xl:gap-10")}>
      <div>
      {s.description && <p className="mt-3 text-[13px] leading-relaxed text-soft">{s.description}</p>}

      {s.baseRules.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            Base rules
          </h4>
          <ol className="space-y-0.5 text-[12px] text-soft">
            {s.baseRules.map((r, i) => (
              <li key={r.id} className="flex gap-2">
                <span className="num w-3 shrink-0 text-right text-faint">{i + 1}</span>
                <span className="min-w-0">
                  {r.text}
                  {r.auto && <span className="text-faint"> · auto</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {s.invalidation && (
        <p className="mt-3 text-[12px] text-soft">
          <span className="text-faint">Invalidated when: </span>
          {s.invalidation}
        </p>
      )}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Grade ladder</h4>
          <span className="text-[11px] text-faint">
            {stopHit ? <span className="text-down">daily stop hit — nothing allowed today</span> : "allowed right now"}
          </span>
        </div>
        <div className="divide-y rounded-xl border">
          {s.grades.map((g, gi) => {
            const now = allowed(g.grade);
            return (
              <div key={g.grade} className="anim-rise" style={stagger(index * 3 + gi + 2, 80)}>
              <div
                className={cx("flex items-center gap-3 px-3 py-2", !g.traded && "opacity-60")}
                style={{ boxShadow: `inset 2px 0 0 ${GRADE_COLOUR[g.grade]}` }}
              >
                <GradeBadge grade={g.grade} size="sm" />
                <span className="num w-12 shrink-0 text-[12px] font-medium">
                  {g.traded ? `${g.riskPct}%` : "Don't"}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-soft" title={gradeOneLiner(s, g.grade)}>
                  {gradeOneLiner(s, g.grade)}
                </span>
                <span
                  className={cx(
                    "num w-14 shrink-0 text-right text-[12px]",
                    !g.traded ? "text-faint" : now < g.riskPct ? "text-warn" : "text-up",
                  )}
                  title="Allowed right now: min(grade risk, today's remaining budget, max per trade)"
                >
                  {g.traded ? `${now}%` : "—"}
                </span>
              </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>

      <div className="num mt-auto flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-[12px]" style={{ marginTop: 16 }}>
        {s.rrFrom != null && (
          <Stat label="Target" value={s.rrTo && s.rrTo !== s.rrFrom ? `${s.rrFrom}–${s.rrTo}R` : `${s.rrFrom}R`} />
        )}
        <Stat label="Rules" value={String(s.baseRules.length)} />
        <Stat label="Factors" value={String(s.factors.length)} />
        {p ? (
          <>
            <Stat label="Trades" value={String(p.trades)} />
            <Stat label="Win rate" value={p.winRate == null ? "—" : `${Math.round(p.winRate * 100)}%`} />
            <Stat label="Avg" value={fmtR(p.avgR)} cls={p.avgR >= 0 ? "text-up" : "text-down"} />
            <Stat label="Net" value={fmtPct(p.netPct)} cls={p.netPct >= 0 ? "text-up" : "text-down"} />
          </>
        ) : (
          <span className="text-faint">No trades logged on this strategy yet</span>
        )}
      </div>
    </section>
    </div>
  );
}

const Stat = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
  <span>
    <span className="text-faint">{label} </span>
    <span className={cx("font-medium", cls)}>{value}</span>
  </span>
);
