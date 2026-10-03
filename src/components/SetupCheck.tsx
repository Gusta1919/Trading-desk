import type { GradeResult } from "@/lib/grading";
import { answerLabel, factorCap, rangeIndex, rangeLabel, rangeValue, withUnit } from "@/lib/grading";
import type { DayBudget } from "@/lib/risk";
import { Check, X } from "lucide-react";
import type { Verdict } from "@/lib/checkin";
import { daysOffText, type DayOff } from "@/lib/discipline";
import type { BaseRule, Definition, Factor, Grade, GradeCard, Limits } from "@/lib/types";
import { GRADE_COLOUR, GradeBadge } from "./GradeBadge";
import { Glossed } from "./Glossed";
import { DecimalInput, cx, stagger } from "./ui";

/**
 * What the desk knows about an automatic rule: true or false, with the reason shown
 * under it — or null when the data is missing and the rule is ticked by hand.
 */
export interface AutoState {
  holds: boolean | null;
  note: string;
}

/** The two raw inputs the displacement multiple is worked out from. */
export interface DisplacementInputs {
  mssBeyond: number | null;
  atr: number | null;
  onChange: (patch: { mssBeyond?: number | null; atr?: number | null }) => void;
}

/**
 * The rulebook's base rules and grade factors — and the grade they add up to, with
 * what it may risk right now. Rules the desk can check answer themselves; factors
 * the desk can fill in (Compass, displacement) do too.
 */
export function SetupCheck({
  definition,
  ticked,
  answers,
  onToggle,
  onAnswer,
  auto,
  autoAnswers = {},
  displacement,
  fill = (t) => t,
  side = false,
}: {
  definition: Pick<Definition, "baseRules" | "factors">;
  /** Hand-ticked rule ids. */
  ticked: string[];
  /** Every answer, the desk's own included. */
  answers: Record<string, string | number>;
  /** Flips one rule. The parent applies it to its latest list, so fast clicks never undo each other. */
  onToggle: (id: string) => void;
  onAnswer: (factorId: string, value: string | number | null) => void;
  /** The state of each automatic rule, by rule id. */
  auto: Record<string, AutoState>;
  /** Factors the desk answered, by factor id, with what it read them from. */
  autoAnswers?: Record<string, { note: string; locked: boolean }>;
  displacement?: DisplacementInputs;
  /** Fills the rulebook's {{tokens}} in rule texts and hints. */
  fill?: (text: string) => string;
  /** Rules and factors side by side, so the whole check fits without scrolling. */
  side?: boolean;
}) {
  const toggle = onToggle;
  const autoOf = (r: BaseRule) => (r.auto ? auto[r.id] : undefined);
  const isAuto = (r: BaseRule) => autoOf(r)?.holds != null;
  const holds = (r: BaseRule) => (isAuto(r) ? Boolean(autoOf(r)!.holds) : ticked.includes(r.id));
  const rules = definition.baseRules;
  const done = rules.filter(holds).length;
  const answered = definition.factors.filter((f) => factorCap(f, answers[f.id]) != null).length;

  return (
    <div className={cx(side ? "grid items-start gap-4 lg:grid-cols-2" : "space-y-4")}>
      {rules.length > 0 && (
        <Panel
          title="Base rules"
          note="all must hold — one missing makes it a C"
          progress={{ done, total: rules.length }}
        >
          <ol className="divide-y">
            {rules.map((r, i) => {
              const auto = isAuto(r);
              const state = autoOf(r);
              const on = holds(r);
              return (
                <li key={r.id} className="anim-rise" style={stagger(i, 45)}>
                  <button
                    type="button"
                    disabled={auto}
                    onClick={() => toggle(r.id)}
                    className={cx(
                      "group flex w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors duration-200",
                      auto ? "cursor-default" : "hover:bg-subtle",
                    )}
                  >
                    <span className="num w-4 shrink-0 text-right text-[12px] text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block text-[13px] leading-snug transition-colors", on ? "text-ink" : "text-soft")}>
                        <Glossed text={fill(r.text)} />
                      </span>
                      {(r.hint || state) && (
                        <span className="mt-0.5 block text-[11px] text-faint">
                          {state ? state.note : fill(r.hint)}
                        </span>
                      )}
                    </span>
                    {auto && (
                      <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-faint">
                        auto
                      </span>
                    )}
                    <span
                      className={cx(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,color,transform] duration-200",
                        !on && !auto && "border-faint text-transparent group-hover:border-soft group-hover:text-faint group-active:scale-90",
                      )}
                      style={
                        on
                          ? {
                              color: "var(--color-up)",
                              borderColor: "color-mix(in oklab, var(--color-up) 60%, transparent)",
                              backgroundColor: "color-mix(in oklab, var(--color-up) 16%, transparent)",
                            }
                          : auto
                            ? {
                                color: "var(--color-down)",
                                borderColor: "color-mix(in oklab, var(--color-down) 60%, transparent)",
                                backgroundColor: "color-mix(in oklab, var(--color-down) 14%, transparent)",
                              }
                            : undefined
                      }
                    >
                      {/* Keyed on the state, so each tick lands with a stamp. */}
                      <span key={String(on)} className={cx("flex", (on || auto) && "anim-stamp")}>
                        {on ? <Check size={13} strokeWidth={3} /> : auto ? <X size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p
            className={cx(
              "border-t px-4 py-2 text-[12px]",
              done === rules.length ? "text-up" : "text-faint",
            )}
          >
            {done === rules.length
              ? "✓ All base rules hold"
              : `${rules.length - done} still to confirm: ${rules
                  .filter((r) => !holds(r))
                  .map((r) => rules.indexOf(r) + 1)
                  .join(", ")}`}
          </p>
        </Panel>
      )}

      {definition.factors.length > 0 && (
        <Panel
          title="Grade factors"
          note="each answer caps the best grade"
          progress={{ done: answered, total: definition.factors.length }}
        >
          <div className="divide-y">
            {definition.factors.map((f, i) => (
              <div key={f.id} className="anim-rise px-4 py-2.5" style={stagger(rules.length + i, 45)}>
                <FactorInput
                  factor={f}
                  value={answers[f.id]}
                  onChange={(v) => onAnswer(f.id, v)}
                  auto={autoAnswers[f.id]}
                  displacement={f.auto === "displacement" ? displacement : undefined}
                />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {rules.length === 0 && definition.factors.length === 0 && (
        <p className="text-[13px] text-soft">
          The rulebook has no base rules or grade factors yet, so every setup grades A+. Add them in
          the Rulebook tab to make the grade mean something.
        </p>
      )}
    </div>
  );
}

const RANK: Record<Grade, number> = { "A+": 0, A: 1, B: 2, C: 3 };
const LADDER: Grade[] = ["A+", "A", "B", "C"];

/** A bordered section with a title and a small progress bar. */
function Panel({
  title,
  note,
  progress,
  children,
}: {
  title: string;
  note: string;
  progress: { done: number; total: number };
  children: React.ReactNode;
}) {
  const complete = progress.done === progress.total;
  return (
    <section className="overflow-hidden rounded-2xl border bg-surface/40">
      <header className="flex items-center gap-3 border-b bg-subtle px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-soft">{title}</h3>
        <span className="text-[11px] text-faint">{note}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                transitionTimingFunction: "var(--ease-slow)",
                backgroundColor: complete ? "var(--color-up)" : "var(--color-soft)",
              }}
            />
          </span>
          <span className={cx("num text-[12px]", complete ? "text-up" : "text-soft")}>
            {progress.done}/{progress.total}
          </span>
        </span>
      </header>
      {children}
    </section>
  );
}

function FactorInput({
  factor: f,
  value,
  onChange,
  auto,
  displacement,
}: {
  factor: Factor;
  value: string | number | undefined;
  onChange: (v: string | number | null) => void;
  /** Answered by the desk: locked (Compass from the snapshot) or a suggestion (bias from the plan). */
  auto?: { note: string; locked: boolean };
  displacement?: DisplacementInputs;
}) {
  // Every factor reads the same way: the answer allowing the best grade on the left, the
  // worst on the right. A number factor whose best range is its highest (e.g. ≥65%) is
  // therefore shown high-to-low; ties keep their natural order.
  const best = <T,>(xs: T[], cap: (x: T) => Grade) =>
    xs.map((x, i) => ({ x, i })).sort((a, b) => RANK[cap(a.x)] - RANK[cap(b.x)] || a.i - b.i);
  const picked = f.kind === "number" && typeof value === "number" ? rangeIndex(f, value) : null;
  const cap = factorCap(f, value);
  const label = (
    <div>
      <p className="text-[13px] font-medium">
        <Glossed text={f.name} />
      </p>
      {(auto?.note || f.hint) && <p className="text-[11px] text-faint">{auto?.note || f.hint}</p>}
    </div>
  );

  // Worked out from two numbers you read off the MSS candle; the multiple sets the cap.
  if (displacement) {
    return (
      <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[8.5rem_1fr]">
        {label}
        <div className="flex flex-wrap items-center gap-2">
          <DecimalInput
            className="w-28"
            value={displacement.mssBeyond}
            onChange={(v) => displacement.onChange({ mssBeyond: v })}
            placeholder="beyond"
            suffix="$"
          />
          <span className="text-[12px] text-faint">÷</span>
          <DecimalInput
            className="w-28"
            value={displacement.atr}
            onChange={(v) => displacement.onChange({ atr: v })}
            placeholder="ATR"
            suffix="$"
          />
          <span className="text-[12px] text-faint">=</span>
          {typeof value === "number" && cap ? (
            <AnswerButton label={withUnit(value.toFixed(2), f.kind === "number" ? f.unit : "")} cap={cap} on mono onClick={() => {}} />
          ) : (
            <span className="text-[12px] text-faint">both numbers give the multiple</span>
          )}
        </div>
      </div>
    );
  }

  // Read from the frozen snapshot: shown, not chosen. Changing it means editing the rulebook.
  if (auto?.locked && f.kind === "number" && typeof value === "number" && cap) {
    return (
      <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[8.5rem_1fr]">
        {label}
        <div className="flex flex-wrap items-center gap-2">
          <AnswerButton label={withUnit(String(value), f.unit)} cap={cap} on mono onClick={() => {}} />
          <span className="text-[11px] text-faint">{rangeLabel(f, rangeIndex(f, value))}{f.unit}</span>
        </div>
      </div>
    );
  }

  // A fixed label column: long answer lists wrap inside their own column, never under the name.
  return (
    <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[8.5rem_1fr]">
      {label}
      <div className="flex flex-wrap gap-1.5">
        {f.kind === "choice"
          ? best(f.options, (o) => o.cap).map(({ x: o }) => (
              <AnswerButton
                key={o.id}
                label={o.label}
                cap={o.cap}
                on={value === o.id}
                onClick={() => onChange(value === o.id ? null : o.id)}
              />
            ))
          : best(f.caps, (c) => c).map(({ x: cap, i }) => (
              <AnswerButton
                key={i}
                label={withUnit(rangeLabel(f, i), f.unit)}
                cap={cap}
                on={picked === i}
                mono
                onClick={() => onChange(picked === i ? null : rangeValue(f, i))}
              />
            ))}
      </div>
    </div>
  );
}

/** One answer: its label, and the best grade it still allows. Lit in that grade's colour when picked. */
function AnswerButton({
  label,
  cap,
  on,
  mono = false,
  onClick,
}: {
  label: string;
  cap: Grade;
  on: boolean;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[12.5px] transition-[color,background-color,border-color,transform] duration-200 active:scale-[0.97]",
        mono && "num",
        on ? "border-transparent text-ink" : "text-soft hover:border-soft hover:text-ink",
      )}
      style={
        on
          ? {
              backgroundColor: `color-mix(in oklab, ${GRADE_COLOUR[cap]} 14%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${GRADE_COLOUR[cap]} 45%, transparent)`,
            }
          : undefined
      }
    >
      {label}
      <span className="num text-[10px] font-semibold" style={{ color: GRADE_COLOUR[cap] }}>
        {cap}
      </span>
    </button>
  );
}

/**
 * The grade, what it may risk today, and why — the capping answers, what the next
 * rung up would need, and anything that takes today's allowance away: a grade the
 * desk doesn't trade, the check-in, a day off, a half-risk week, a spent budget.
 */
export function GradePanel({
  result,
  card,
  gradeRiskPct,
  allowed,
  budget,
  week,
  limits,
  verdict,
  dayOff,
  halfRisk,
  doneToday,
  cautionClosesDay = false,
  day,
}: {
  result: GradeResult;
  card: GradeCard | null;
  gradeRiskPct: number | null;
  allowed: number;
  budget: DayBudget;
  week: DayBudget;
  limits: Pick<Limits, "maxRiskPct" | "dailyStopPct" | "weeklyStopPct">;
  verdict?: Verdict;
  dayOff?: DayOff | null;
  halfRisk?: boolean;
  /** Today's one trade is already taken. */
  doneToday?: boolean;
  /** A "Trade restricted" check-in leaves nothing tradable (since 2.2), not just A+. */
  cautionClosesDay?: boolean;
  /** The trade's day, so a run of days off reads right on it. */
  day?: string;
}) {
  const grade: Grade = result.grade;
  const colour = GRADE_COLOUR[grade];
  /*
   * Missing base rules are counted, not spelled out — they are listed right above, and
   * repeating each one in both lines buried the answers that actually decide the grade.
   */
  const missing = result.missingRules.length;
  const rulesPart = missing ? [`${missing} base rule${missing > 1 ? "s" : ""} missing`] : [];
  const capLine = [...rulesPart, ...result.cappedBy.filter((c) => c.source === "factor").map((c) => c.label)];
  const ruleTexts = new Set(result.missingRules.map((r) => r.text));
  const nextLine = result.next
    ? [...(missing ? ["all base rules"] : []), ...result.next.needs.filter((n) => !ruleTexts.has(n))]
    : [];
  const notTraded = Boolean(card && !card.traded);
  const checkinBlocks =
    !notTraded && ((verdict === "caution" && (cautionClosesDay || grade !== "A+")) || verdict === "sit-out");

  /** Why today's allowance is 0 or reduced, most serious first. */
  const reasons: { text: string; tone: "down" | "warn" }[] = [];
  if (notTraded) reasons.push({ text: `Not tradable — don't take it. ${capLine.length ? `Capped by ${capLine.join(" · ")}.` : ""}`, tone: "down" });
  if (verdict === "sit-out") reasons.push({ text: "Check-in says sit out — nothing is tradable today.", tone: "down" });
  else if (checkinBlocks) {
    reasons.push({
      text: cautionClosesDay ? "Check-in says trade restricted — nothing is tradable today." : "Check-in says caution — only A+ is tradable today.",
      tone: "down",
    });
  }
  if (dayOff) {
    reasons.push({
      text:
        dayOff.reason === "rule-break"
          ? "Day off — a rule was broken today."
          : `${daysOffText(dayOff, day ?? "")} — after a rule break on ${dayOff.from}.`,
      tone: "down",
    });
  }
  if (doneToday) reasons.push({ text: "Done for today — the day's one trade is taken.", tone: "down" });
  if (budget.stopHit) reasons.push({ text: "Daily stop hit — no more trades today.", tone: "down" });
  if (week.stopHit) reasons.push({ text: "Weekly stop hit — no more trades this week.", tone: "down" });
  if (halfRisk && !reasons.length) reasons.push({ text: "Half-risk week — two rule breaks last week.", tone: "warn" });

  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-surface py-4 pl-6 pr-5 transition-[background-image] duration-500"
      style={{ backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${colour} 12%, transparent), transparent 55%)` }}
    >
      {/* The grade's colour lives on the left edge only — the same accent the Coach cards use. */}
      <span className="absolute inset-y-0 left-0 w-[3px] transition-colors duration-300" style={{ backgroundColor: colour }} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          {/* Keyed on the grade: a new grade lands with a stamp. */}
          <span key={grade} className="anim-stamp">
            <GradeBadge grade={grade} size="lg" />
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-faint">
              {result.complete ? "Grade" : "Grade so far"}
            </p>
            <p className={cx("text-[13px]", notTraded ? "font-medium text-down" : "text-soft")}>
              {notTraded ? "Not tradable" : `${gradeRiskPct ?? limits.maxRiskPct}% for this grade`}
            </p>
          </div>
        </div>
        {/* Where this grade sits on the ladder: the current rung lit in its colour. */}
        <div className="flex items-center gap-1" aria-label={`Grade ${grade} of A+, A, B, C`}>
          {LADDER.map((g) => (
            <span
              key={g}
              className={cx(
                "num flex h-7 w-9 items-center justify-center rounded-md text-[11px] font-semibold transition-all duration-300",
                g === grade ? "scale-110" : "bg-subtle text-faint",
              )}
              style={
                g === grade
                  ? {
                      color: GRADE_COLOUR[g],
                      backgroundColor: `color-mix(in oklab, ${GRADE_COLOUR[g]} 16%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${GRADE_COLOUR[g]} 55%, transparent), 0 0 18px color-mix(in oklab, ${GRADE_COLOUR[g]} 25%, transparent)`,
                    }
                  : undefined
              }
            >
              {g}
            </span>
          ))}
        </div>
        <div className="ml-auto text-right">
          <p className="text-[11px] uppercase tracking-[0.08em] text-faint">Allowed today</p>
          <p
            key={allowed}
            className={cx("anim-fade num text-[26px] font-semibold leading-tight", allowed > 0 ? "text-ink" : "text-down")}
          >
            {allowed}%
          </p>
          <p className="num text-[11px] text-faint">
            day {+budget.remaining.toFixed(2)}% of {limits.dailyStopPct}% · week {+week.remaining.toFixed(2)}% of {limits.weeklyStopPct}% · cap{" "}
            {limits.maxRiskPct}%{halfRisk ? " · ×½" : ""}
          </p>
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {reasons.map((r) => (
            <p
              key={r.text}
              className={cx(
                "rounded-lg px-3 py-2 text-[13px] font-medium",
                r.tone === "down" ? "bg-down/10 text-down" : "bg-warn/10 text-warn",
              )}
            >
              {r.text}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-1 text-[12px]">
        {capLine.length > 0 && !notTraded && (
          <p className="text-soft">
            <span className="text-faint">Capped at {grade} by: </span>
            {capLine.join(" · ")}
          </p>
        )}
        {nextLine.length > 0 && (
          <p className="text-soft">
            <span className="text-faint">For {result.next!.grade}: </span>
            {nextLine.join(" · ")}
          </p>
        )}
        {!result.complete && (
          <p className="text-warn">
            Still to answer: {result.missingFactors.map((f) => f.name).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

/** The answers, in words, for a compact summary line. */
export function answerSummary(definition: Pick<Definition, "factors">, answers: Record<string, string | number>) {
  return definition.factors
    .map((f) => answerLabel(f, answers[f.id]))
    .filter(Boolean)
    .join(" · ");
}
