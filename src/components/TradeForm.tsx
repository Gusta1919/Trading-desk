import { ArrowLeft, Check, Pencil, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { impactColour } from "@/lib/calendarView";
import type { CheckIn } from "@/lib/checkin";
import type { CoachCard } from "@/lib/coach";
import { fmtPct, fmtR, nowLocal, tone } from "@/lib/format";
import { computeGrade } from "@/lib/grading";
import { newsForTrade, type CalendarEvent } from "@/lib/news";
import { allowedRisk, dayBudget, flagsFor, gradeCard, gradeRisk, takenTrades } from "@/lib/risk";
import { DESK_LABEL, deskTime } from "@/lib/tz";
import {
  DEFAULT_LIMITS,
  EMOTIONS,
  EMPTY_RULEBOOK_FIELDS,
  FLAG_LABEL,
  GRADES,
  MISTAKES,
  SESSIONS,
  inOrder,
  isGrade,
  type Definition,
  type Direction,
  type Grade,
  type Limits,
  type SetupSnapshot,
  type Strategy,
  type Trade,
  type TradeInput,
  type TradeNews,
  type WeekNote,
} from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { GradePanel, SetupCheck, answerSummary } from "./SetupCheck";
import { Button, Chips, Modal, Segmented, cx, stagger } from "./ui";

const biasTone = (bias: string) =>
  bias === "long" ? "text-up" : bias === "short" ? "text-down" : "text-soft";

interface FormState {
  date: string;
  symbol: string;
  direction: Direction;
  session: string | null;
  setup: string;
  strategyId: string | null;
  /** Legacy fields, carried through untouched on older trades. */
  htf: string;
  entryModel: string;
  riskPct: string;
  plannedRR: string;
  boxSize: string;
  pnlUsd: string;
  followedPlan: boolean | null;
  /** Picked by hand only when there is no strategy definition to compute it from. */
  manualGrade: string | null;
  emotion: number | null;
  mistakes: string[];
  /** Hand-ticked base rules. */
  checklist: string[];
  answers: Record<string, string | number>;
  news: TradeNews[];
  skipped: boolean;
  hypotheticalR: string;
  expectedMinutes: string;
  flagNote: string;
  notes: string;
  screenshot: string;
}

function toForm(t: Trade | null): FormState {
  return {
    date: t?.date ?? nowLocal(),
    symbol: t?.symbol ?? "",
    direction: t?.direction ?? "long",
    session: t?.session || null,
    setup: t?.setup ?? "",
    strategyId: t?.strategyId ?? null,
    htf: t?.htf ?? "",
    entryModel: t?.entryModel ?? "",
    riskPct: t && !t.skipped ? String(t.riskPct) : "",
    plannedRR: t?.plannedRR != null ? String(t.plannedRR) : "",
    pnlUsd: t?.pnlUsd != null ? String(t.pnlUsd) : "",
    followedPlan: t?.followedPlan ?? null,
    manualGrade: t && !t.setupSnapshot ? t.grade || null : null,
    emotion: t?.emotion ?? null,
    boxSize: t?.boxSize != null ? String(t.boxSize) : "",
    mistakes: t?.mistakes ?? [],
    checklist: t?.setupSnapshot?.ticked ?? t?.checklist ?? [],
    answers: t?.setupSnapshot?.answers ?? {},
    news: t?.news ?? [],
    skipped: t?.skipped ?? false,
    hypotheticalR: t?.hypotheticalR != null ? String(t.hypotheticalR) : "",
    expectedMinutes: t?.expectedMinutes != null ? String(t.expectedMinutes) : "",
    flagNote: t?.flagNote ?? "",
    notes: t?.notes ?? "",
    screenshot: t?.screenshot ?? "",
  };
}

/** A calendar release, copied into the shape a trade keeps for good. */
const toTradeNews = (e: CalendarEvent): TradeNews => ({
  title: e.title,
  currency: e.currency,
  impact: e.impact,
  time: e.at ? deskTime(e.at) : "",
});

const parseNum = (s: string) => {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Says whether the box you measured is inside the size range this strategy trades. */
function BoxHint({ strategy, size }: { strategy: Strategy; size: number | null }) {
  if (size == null) {
    return (
      <p className="max-w-xs text-[12px] text-faint">
        Log it even when you don't know the ideal range yet — that's how the range gets found.
      </p>
    );
  }
  const { boxMin, boxMax, boxUnit, boxLabel } = strategy;
  const below = boxMin != null && size < boxMin;
  const above = boxMax != null && size > boxMax;
  if (!below && !above) {
    return boxMin != null || boxMax != null ? (
      <p className="max-w-xs text-[12px] text-up">Inside your tradeable range.</p>
    ) : null;
  }
  return (
    <p className="max-w-xs text-[12px] text-warn">
      {size} {boxUnit || "pts"} is {below ? "smaller" : "bigger"} than the{" "}
      {below ? `${boxMin}` : `${boxMax}`} {boxUnit || "pts"} you set for a tradeable{" "}
      {boxLabel.toLowerCase()}. {below
        ? "Tight boxes get run through from both sides."
        : "Wide boxes mean a distant stop or a sweep that never reverses."}
    </p>
  );
}

export function TradeForm({
  open,
  trade,
  trades,
  strategies,
  week,
  nudge,
  limits,
  calendar,
  onClose,
  onSaved,
}: {
  open: boolean;
  trade: Trade | null;
  trades: Trade[];
  strategies: Strategy[];
  checkins: CheckIn[];
  /** Your risk lines and the account's starting balance. */
  limits: Limits | null;
  /** The whole news calendar, so the trade can record what was out on its day. */
  calendar: CalendarEvent[];
  /** This week's reasoning, so the trade can be checked against it. */
  week?: WeekNote | null;
  nudge?: CoachCard | null;
  /** Kept for callers; strategies are now only created in the Strategies tab. */
  onStrategySaved?: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const L = limits ?? DEFAULT_LIMITS;
  const [f, setF] = useState<FormState>(() => toForm(trade));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * A new trade is three steps: which strategy, that strategy's setup check, then the
   * form — so the rules you tick are never swapped for another strategy's halfway
   * through. Editing goes straight to the form.
   */
  const [step, setStep] = useState<"strategy" | "setup" | "form">("form");

  useEffect(() => {
    if (!open) return;
    setF(toForm(trade));
    setError(null);
    setConfirmDelete(false);
    setStep(trade ? "form" : "strategy");
  }, [open, trade]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  // Suggestions from what you've typed before.
  const symbols = useMemo(() => unique(trades.map((t) => t.symbol)), [trades]);
  const strategy = strategies.find((s) => s.id === f.strategyId) ?? null;

  /*
   * What the setup is graded against: an existing trade keeps the definition it was
   * logged with, so editing a strategy later never regrades history.
   */
  const snapshot = trade?.setupSnapshot && trade.strategyId === f.strategyId ? trade.setupSnapshot : null;
  const definition: Definition | null = snapshot ?? (strategy ? strategy : null);

  /* ── The day's budget, the grade, and what it may risk ─────────────── */

  const day = f.date.slice(0, 10);
  const budget = dayBudget(trades, day, L, { excludeId: trade?.id, before: f.date });
  const autoIds = definition?.baseRules.filter((r) => r.auto === "daily-budget").map((r) => r.id) ?? [];
  const ticked = [
    ...f.checklist.filter((id) => !autoIds.includes(id)),
    ...(budget.stopHit ? [] : autoIds),
  ];
  const result = definition ? computeGrade(definition, { ticked, answers: f.answers }) : null;
  const grade: Grade | null = result?.grade ?? (isGrade(f.manualGrade) ? f.manualGrade : null);
  const card = gradeCard(definition, grade);
  const gRisk = gradeRisk(definition, grade);
  const allowed = allowedRisk(gRisk, budget, L);

  const risk = parseNum(f.riskPct);
  const flags = f.skipped
    ? []
    : flagsFor({ riskPct: risk ?? 0, allowed, card, budget, limits: L });

  /*
   * What was out on this trade's New York day — always included, never switched off.
   * A new trade takes it straight from the calendar; a logged trade keeps its own copy,
   * because the calendar forgets after a couple of weeks.
   */
  const dayNews = useMemo(
    () => newsForTrade(calendar, f.symbol, day).map(toTradeNews),
    [calendar, f.symbol, day],
  );
  useEffect(() => {
    if (trade) return;
    setF((p) => ({ ...p, news: dayNews }));
  }, [trade, dayNews]);


  /** Adopts a strategy's plan: its target, sessions and instrument. */
  function pickStrategy(picked: Strategy | null) {
    if ((picked?.id ?? null) === f.strategyId) return; // same one — keep what you answered
    setF((prev) => ({
      ...prev,
      strategyId: picked?.id ?? null,
      checklist: [],
      answers: {},
      manualGrade: null,
      symbol: prev.symbol || picked?.instrument?.toUpperCase() || "",
      plannedRR: picked?.rrFrom != null ? String(picked.rrFrom) : prev.plannedRR,
      session: prev.session ?? (inOrder(picked?.sessions, SESSIONS)[0] || null),
    }));
  }


  /*
   * The live preview of what this trade did to the account. The balance shown is
   * the one this trade is measured against: the starting balance plus everything
   * logged before it, which is how the server will work it out on save.
   */
  const pnl = parseNum(f.pnlUsd);
  const balanceBefore = useMemo(
    () =>
      takenTrades(trades)
        .filter((t) => t.id !== trade?.id && t.date <= f.date && t.pnlUsd != null)
        .reduce((a, t) => a + (t.pnlUsd ?? 0), L.startBalance),
    [trades, trade?.id, f.date, L.startBalance],
  );
  const resultPct = pnl != null && balanceBefore > 0 ? (pnl / balanceBefore) * 100 : null;
  const resultR = resultPct != null && risk ? resultPct / risk : null;

  function toInput(): TradeInput {
    const snap: SetupSnapshot | null = definition
      ? {
          strategyName: snapshot?.strategyName ?? strategy?.name ?? "",
          baseRules: definition.baseRules,
          factors: definition.factors,
          grades: definition.grades,
          ticked,
          answers: f.answers,
          grade,
        }
      : null;
    return {
      // The rulebook's journal fields are carried through untouched until the form asks for them.
      ...Object.fromEntries(
        Object.keys(EMPTY_RULEBOOK_FIELDS).map((k) => [k, trade ? trade[k as keyof typeof EMPTY_RULEBOOK_FIELDS] : EMPTY_RULEBOOK_FIELDS[k as keyof typeof EMPTY_RULEBOOK_FIELDS]]),
      ) as Pick<TradeInput, keyof typeof EMPTY_RULEBOOK_FIELDS>,
      date: f.date,
      symbol: f.symbol,
      direction: f.direction,
      session: f.session ?? "",
      setup: f.setup,
      strategyId: f.strategyId,
      htf: f.htf,
      entryModel: f.entryModel,
      riskPct: f.skipped ? 0 : (risk ?? 0),
      plannedRiskPct: f.skipped ? null : allowed,
      plannedRR: parseNum(f.plannedRR),
      // Derived on the server from the dollars and the balance at the time.
      resultR: trade?.resultR ?? null,
      followedPlan: f.followedPlan,
      grade: grade ?? "",
      emotion: f.emotion,
      mistakes: f.mistakes,
      checklist: ticked,
      checklistTotal: definition?.baseRules.length ?? 0,
      setupSnapshot: snap,
      flags,
      flagNote: flags.length ? f.flagNote.trim() : "",
      skipped: f.skipped,
      hypotheticalR: f.skipped ? parseNum(f.hypotheticalR) : null,
      expectedMinutes: parseNum(f.expectedMinutes),
      // Costs come from a broker import; editing a trade by hand must not erase them.
      costPct: trade?.costPct ?? null,
      boxSize: parseNum(f.boxSize),
      pnlUsd: f.skipped ? null : pnl,
      news: f.news,
      notes: f.notes,
      screenshot: f.screenshot,
    };
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = toInput();
      if (trade) await api.update(trade.id, input);
      else await api.create(input);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!trade) return;
    if (!confirmDelete) return setConfirmDelete(true);
    await api.remove(trade.id);
    onSaved();
    onClose();
  }

  const setupCheck = definition && (
    <SetupCheck
      definition={definition}
      ticked={f.checklist}
      answers={f.answers}
      budgetOk={!budget.stopHit}
      side={step === "setup"}
      onToggle={(id) =>
        setF((p) => ({
          ...p,
          checklist: p.checklist.includes(id) ? p.checklist.filter((x) => x !== id) : [...p.checklist, id],
        }))
      }
      onAnswer={(id, v) =>
        setF((p) => {
          const answers = { ...p.answers };
          if (v == null) delete answers[id];
          else answers[id] = v;
          return { ...p, answers };
        })
      }
    />
  );
  const gradePanel = result && (
    <GradePanel
      result={result}
      card={card}
      gradeRiskPct={gRisk}
      allowed={allowed}
      budget={budget}
      limits={L}
    />
  );

  /* ── Step 1: which strategy ────────────────────────────────────────── */

  if (step === "strategy" && !trade) {
    return (
      <Modal open={open} onClose={onClose} width="max-w-2xl">
        <div className="px-10 py-9">
          <StepHeader step={1} title="Which strategy are you entering?">
            The rules, grade factors and sizing that follow are that strategy's own.
          </StepHeader>

          {budget.stopHit && (
            <p className="mx-auto mt-6 max-w-xl rounded-lg bg-down/10 px-4 py-2.5 text-center text-[13px] font-medium text-down">
              Daily stop hit — no more trades today.
            </p>
          )}

          <div
            className={cx(
              "mx-auto mt-8 grid gap-3",
              strategies.length > 1 ? "max-w-xl sm:grid-cols-2" : "max-w-sm",
            )}
          >
            {strategies.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => {
                  pickStrategy(x);
                  setStep("setup");
                }}
                className={cx(
                  "rounded-xl border px-4 py-3.5 text-left transition-colors duration-200 hover:border-soft hover:bg-subtle",
                  f.strategyId === x.id && "border-soft bg-subtle",
                )}
              >
                <span className="block text-[14px] font-semibold">{x.name}</span>
                <span className="mt-1 block text-[12px] text-faint">
                  {[
                    x.instrument,
                    inOrder(x.sessions, SESSIONS).join(" / "),
                    x.hoursFrom && x.hoursTo && `${x.hoursFrom}–${x.hoursTo}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="num mt-1.5 block text-[11px] text-soft">
                  {x.grades.map((g) => `${g.grade} ${g.traded ? `${g.riskPct}%` : "—"}`).join(" · ")}
                </span>
              </button>
            ))}
          </div>

          {strategies.length === 0 && (
            <p className="mx-auto mt-8 max-w-sm text-center text-[13px] text-soft">
              No strategies yet. Create one in the Strategies tab — every trade is graded against one.
            </p>
          )}

          <div className="mt-8 flex items-center justify-center">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  /* ── Step 2: that strategy's setup check ───────────────────────────── */

  if (step === "setup" && !trade && definition) {
    return (
      <Modal open={open} onClose={onClose} width="max-w-7xl">
        {/*
          Three parts, all in view at once: the title, the rules and factors side by side,
          and the grade with the buttons. Only a very short window ever needs to scroll.
        */}
        <div className="flex max-h-[calc(100vh-3rem)] flex-col">
          <div className="shrink-0 px-10 pb-4 pt-6">
            <StepHeader step={2} title={`${strategy?.name ?? "Setup"} — grade the setup`}>
              Tick the base rules and answer each factor. The grade decides what you may risk.
            </StepHeader>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-5">{setupCheck}</div>

          <div className="shrink-0 space-y-3 border-t bg-raised px-10 pb-5 pt-4">
            {gradePanel}
            <div className="flex items-center justify-center gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep("strategy")}>
              <ArrowLeft size={14} /> Strategy
            </Button>
            <Button
              type="button"
              variant={result?.complete && allowed > 0 ? "accent" : "primary"}
              onClick={() => {
                // Start the size at what is allowed; you can still change it.
                if (allowed > 0 && !f.riskPct) set("riskPct", String(allowed));
                setStep("form");
              }}
            >
              {grade ? `Grade ${grade}${allowed > 0 ? ` · ${allowed}%` : ""} — log the trade` : "Continue"}
            </Button>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  /* ── Step 3: the trade ─────────────────────────────────────────────── */

  const flagLines: { text: string; fix?: ReactNode }[] = flags.map((fl) => {
    if (fl === "over_risk") {
      return {
        text:
          risk != null && risk > L.maxRiskPct
            ? `${risk}% is over your ${L.maxRiskPct}% maximum per trade.`
            : `${risk}% is more than the ${allowed}% allowed for ${grade ?? "this trade"} today.`,
        fix:
          allowed > 0 ? (
            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set("riskPct", String(allowed))}>
              use {allowed}%
            </button>
          ) : undefined,
      };
    }
    if (fl === "non_traded_grade") {
      return {
        text: `${grade} is marked Don't${strategy ? ` for ${strategy.name}` : ""} — the rules say not to trade it.`,
      };
    }
    return { text: "Daily stop hit — no more trades today." };
  });

  const summary = definition ? answerSummary(definition, f.answers) : "";
  const title = trade ? "Edit trade" : "Log the trade";

  return (
    <Modal open={open} onClose={onClose} width="max-w-6xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
        className="flex max-h-[calc(100vh-3rem)] flex-col"
      >
        {/* ── Header: the title and the setup it was graded as ─────────── */}
        <header className="shrink-0 border-b px-7 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <div>
              {!trade && (
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Step 3 of 3</p>
              )}
              <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-subtle hover:text-ink">
              <X size={18} />
            </button>
          </div>

          {/* One line, fixed slots: the grade, what it rests on, what it may risk, and a way back. */}
          {definition && !trade && (
            <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-stretch overflow-hidden rounded-xl border">
              <div className="flex items-center px-4 py-3">
                {grade && (
                  <span key={grade} className="anim-stamp">
                    <GradeBadge grade={grade} size="lg" />
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-col justify-center py-3 pr-4">
                <span className="text-[14px] font-medium">{strategy?.name}</span>
                <span className="truncate text-[12px] text-soft">
                  {ticked.length}/{definition.baseRules.length} base rules
                  {summary && ` · ${summary}`}
                </span>
              </div>
              <div className="flex min-w-[124px] flex-col justify-center border-l px-5 py-3">
                <span className="text-[10px] uppercase tracking-[0.1em] text-faint">Allowed today</span>
                <span className={cx("num text-[18px] font-semibold leading-tight", allowed > 0 ? "text-ink" : "text-down")}>
                  {allowed}%
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStep("setup")}
                className="flex items-center gap-1.5 border-l px-5 text-[12px] text-soft transition-colors duration-300 hover:bg-subtle hover:text-ink"
              >
                <Pencil size={13} /> Edit setup
              </button>
            </div>
          )}
        </header>

        {/* ── Body: the trade on the left, its context on the right ────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-5">
              {definition && trade && (
                <Card index={0} title={snapshot ? `Setup — as graded against ${snapshot.strategyName || "the strategy"} then` : "Setup"}>
                  <div className="space-y-4">
                    {setupCheck}
                    {gradePanel}
                  </div>
                </Card>
              )}

              {trade && !snapshot && (f.entryModel || f.htf) && (
                <p className="text-[12px] text-faint">
                  Legacy: {[f.entryModel && `entry ${f.entryModel}`, f.htf && `${f.htf} reason`].filter(Boolean).join(" · ")} —
                  logged before grade factors existed.
                </p>
              )}

              <Card index={1} title="The trade">
                <div className={cx("grid gap-4", trade ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                  <Field label={`Date & time · ${DESK_LABEL}`}>
                    <input
                      type="datetime-local"
                      className="field"
                      value={f.date}
                      onChange={(e) => set("date", e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Symbol">
                    <input
                      className="field uppercase"
                      placeholder="EURUSD"
                      list="symbols"
                      value={f.symbol}
                      onChange={(e) => set("symbol", e.target.value)}
                      autoFocus={!trade && !f.symbol}
                      required
                    />
                    <datalist id="symbols">
                      {symbols.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </Field>
                  {trade && (
                    <Field label="Strategy">
                      <select
                        className="field"
                        value={f.strategyId ?? ""}
                        onChange={(e) => pickStrategy(strategies.find((x) => x.id === e.target.value) ?? null)}
                      >
                        <option value="">— none —</option>
                        {strategies.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                            {x.instrument ? ` · ${x.instrument}` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </div>
                <div className={cx("mt-4 grid gap-4", trade ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                  <Field label="Direction">
                    <ToneToggle
                      value={f.direction}
                      onChange={(v) => v && set("direction", v)}
                      options={[
                        { value: "long", label: "Long", icon: <TrendingUp size={15} />, colour: "var(--color-up)" },
                        { value: "short", label: "Short", icon: <TrendingDown size={15} />, colour: "var(--color-down)" },
                      ]}
                    />
                  </Field>
                  <Field label="Session">
                    <ToneToggle
                      allowNone
                      value={f.session}
                      onChange={(v) => set("session", v)}
                      options={(strategy?.sessions?.length ? inOrder(strategy.sessions, SESSIONS) : SESSIONS).map((x) => ({
                        value: x,
                        label: x,
                        colour: "var(--color-ink)",
                      }))}
                    />
                  </Field>
                  {strategy?.boxLabel && (
                    <>
                      <Field label={`${strategy.boxLabel} size`}>
                        <NumberInput
                          value={f.boxSize}
                          onChange={(v) => set("boxSize", v)}
                          placeholder="—"
                          suffix={strategy.boxUnit || "pts"}
                        />
                      </Field>
                      <div className="flex items-end pb-2">
                        <BoxHint strategy={strategy} size={parseNum(f.boxSize)} />
                      </div>
                    </>
                  )}
                </div>
              </Card>

              <Card index={2} title="Outcome">
                {!definition && (
                  <div className="mb-4">
                    <Field label="Setup grade">
                      <Segmented
                        allowNone
                        value={f.manualGrade}
                        onChange={(v) => set("manualGrade", v)}
                        options={GRADES.map((g) => ({ value: g, label: g }))}
                      />
                    </Field>
                  </div>
                )}

                {(
                  <div className="anim-rise">
                    <div className="grid gap-4 sm:grid-cols-4">
                      <Field label="Risk">
                        <NumberInput
                          value={f.riskPct}
                          onChange={(v) => set("riskPct", v)}
                          placeholder={String(allowed || "0.5")}
                          suffix="%"
                        />
                      </Field>
                      <Field label="Planned R:R">
                        <NumberInput value={f.plannedRR} onChange={(v) => set("plannedRR", v)} placeholder="2" suffix="R" />
                      </Field>
                      <Field label="Result">
                        <NumberInput value={f.pnlUsd} onChange={(v) => set("pnlUsd", v)} placeholder="empty = open" suffix="$" />
                      </Field>
                      {/* The result as the account sees it — the same height as the fields beside it, and a stamp each time it changes. */}
                      <Field label="On the account">
                        <div className="flex h-[38px] items-center justify-between rounded-xl bg-subtle px-3.5">
                          <span
                            key={resultPct == null ? "open" : resultPct.toFixed(3)}
                            className={cx("anim-stamp num text-[15px] font-semibold", tone(resultPct))}
                          >
                            {resultPct == null ? <span className="font-normal text-faint">open</span> : fmtPct(resultPct)}
                          </span>
                          <span className="num text-[12px] text-faint">{resultR != null ? fmtR(resultR) : ""}</span>
                        </div>
                      </Field>
                    </div>

                    <div className="mt-4 space-y-1.5">
                      {flagLines.map((l, i) => (
                        <div
                          key={l.text}
                          className="anim-rise flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warn/[0.08] px-3.5 py-2 text-[12px] text-warn"
                          style={stagger(i, 60)}
                        >
                          <span>⚠ {l.text}</span>
                          {l.fix}
                        </div>
                      ))}
                      {!flags.length && (
                        <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-subtle px-3.5 py-2 text-[12px] text-soft">
                          <span>
                            ✓ Allowed {allowed}%
                            {grade && gRisk != null && ` — ${grade} ${gRisk}%`} · budget left {budget.remaining}% · cap{" "}
                            {L.maxRiskPct}%
                          </span>
                          {risk == null && allowed > 0 && (
                            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set("riskPct", String(allowed))}>
                              use {allowed}%
                            </button>
                          )}
                        </div>
                      )}
                      {flags.length > 0 && (
                        <input
                          className="field anim-rise text-[13px]"
                          placeholder={`Why? (optional) — saved with the flag${flags.length > 1 ? "s" : ""}: ${flags.map((x) => FLAG_LABEL[x].toLowerCase()).join(", ")}`}
                          value={f.flagNote}
                          onChange={(e) => set("flagNote", e.target.value)}
                        />
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-faint">
                      Type the broker's dollar result; the percentage and R are worked out for you. Leave it empty while the
                      trade is open.
                    </p>
                  </div>
                )}
              </Card>

              <Card index={3} title="Review">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                  <Field label="Followed the plan?">
                    <ToneToggle
                      allowNone
                      value={f.followedPlan}
                      onChange={(v) => set("followedPlan", v)}
                      options={[
                        { value: true, label: "Yes", icon: <Check size={14} />, colour: "var(--color-up)" },
                        { value: false, label: "No", icon: <X size={14} />, colour: "var(--color-down)" },
                      ]}
                    />
                  </Field>
                  <Field label="State of mind">
                    <Segmented
                      allowNone
                      value={f.emotion}
                      onChange={(v) => set("emotion", v)}
                      options={EMOTIONS.map((e, i) => ({ value: i + 1, label: e }))}
                    />
                  </Field>
                </div>
                <div className="mt-4">
                  <Field label="Mistakes">
                    <Chips options={MISTAKES} value={f.mistakes} onChange={(v) => set("mistakes", v)} />
                  </Field>
                </div>
              </Card>

            </div>

            {/* ── Context and notes, so the two columns end together ───────── */}
            {/* A column that fills the row: the notes card takes whatever height is left. */}
            <aside className="flex flex-col gap-5">
              {!trade && nudge && (
                <Side index={1} title="Coach" bar={nudge.tone === "alert" ? "var(--color-down)" : "var(--color-warn)"}>
                  <p className="text-[13px] font-medium">{nudge.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-soft">{nudge.body}</p>
                </Side>
              )}

              <Side index={2} title={`News that day · ${day}`}>
                <NewsList news={f.news} />
                <p className="mt-2 text-[11px] text-faint">Saved with the trade automatically.</p>
              </Side>

              {week && (week.bias || week.reasoning) && (
                <Side index={3} title="This week">
                  {week.bias && <p className={cx("text-[13px] font-medium capitalize", biasTone(week.bias))}>{week.bias} bias</p>}
                  {week.reasoning && <p className="mt-1 text-[12px] leading-relaxed text-soft">{week.reasoning}</p>}
                  {week.bias && week.bias !== "neutral" && week.bias !== f.direction && (
                    <p className="mt-2 text-[12px] font-medium text-warn">⚠ A {f.direction} trade against your {week.bias} bias.</p>
                  )}
                </Side>
              )}

              {strategy && (
                <Side index={4} title={strategy.name}>
                  <StrategyHint strategy={strategy} date={f.date} />
                </Side>
              )}

              <Side index={5} title="Notes" grow>
                <textarea
                  className="field min-h-[132px] flex-1 resize-none text-[13px]"
                  placeholder="Why did you take it? What did you see? What would you do differently?"
                  value={f.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
                <input
                  className="field mt-3 text-[13px]"
                  placeholder="Chart link (TradingView snapshot URL)"
                  value={f.screenshot}
                  onChange={(e) => set("screenshot", e.target.value)}
                />
              </Side>
            </aside>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <footer className="flex shrink-0 items-center gap-2 border-t bg-raised px-7 py-4">
          {trade && (
            <Button type="button" variant="danger" onClick={remove}>
              <Trash2 size={14} /> {confirmDelete ? "Click again to delete" : "Delete"}
            </Button>
          )}
          {!trade && (
            <Button type="button" variant="ghost" onClick={() => setStep(definition ? "setup" : "strategy")}>
              <ArrowLeft size={14} /> Back
            </Button>
          )}
          {error && <span className="text-[13px] text-down">{error}</span>}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[12px] text-faint sm:inline">⌘↵ to save</span>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="accent" disabled={saving} className="px-5">
              <Check size={15} />
              {trade ? "Save changes" : "Add trade"}
            </Button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}

/** A section of the trade: a card that rises into place after the one above it. */
function Card({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="anim-rise rounded-2xl border bg-surface/40 px-5 py-4" style={stagger(index, 80)}>
      <h3 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

/** A context card in the right column, optionally with the accent bar the Coach cards use. */
function Side({
  index,
  title,
  bar,
  grow = false,
  children,
}: {
  index: number;
  title: string;
  bar?: string;
  /** Stretch to fill what is left of the column, so both columns end on one line. */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(
        "anim-rise relative overflow-hidden rounded-2xl border bg-surface/40 px-5 py-4",
        grow && "flex flex-1 flex-col",
      )}
      style={stagger(index, 90)}
    >
      {bar && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: bar }} />}
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A row of choices with a thumb that glides to the one picked — Long and Short, London
 * and New York, Yes and No. Quiet by design: the picked option gets a
 * raised background like the tabs in the top bar, and colour is only a hint — the icon and
 * a thin line under the thumb. The motion carries the change, not the paint.
 */
function ToneToggle<T extends string | boolean>({
  value,
  onChange,
  options,
  allowNone = false,
}: {
  value: T | null;
  onChange: (v: T | null) => void;
  options: { value: T; label: string; hint?: string; icon?: ReactNode; colour: string }[];
  allowNone?: boolean;
}) {
  const index = options.findIndex((o) => o.value === value);
  const picked = index >= 0 ? options[index] : null;
  const width = 100 / options.length;

  return (
    <div className="relative grid rounded-xl bg-subtle p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {/* The thumb: slides between options, and fades out when nothing is picked. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-raised shadow-[inset_0_0_0_1px_var(--color-line),0_6px_20px_rgb(0_0_0/0.35)]"
        style={{
          width: `calc(${width}% - ${8 / options.length}px)`,
          // A percentage of its own width: one step moves exactly one option along.
          transform: `translateX(${Math.max(index, 0) * 100}%)`,
          opacity: picked ? 1 : 0,
          scale: picked ? "1" : "0.94",
          transition:
            "transform 520ms var(--ease-slow), opacity 320ms var(--ease-slow), scale 320ms var(--ease-slow)",
        }}
      >
        <span
          className="absolute bottom-[3px] left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full"
          style={{
            backgroundColor: picked?.colour ?? "transparent",
            boxShadow: picked ? `0 0 8px ${picked.colour}` : undefined,
            transition: "background-color 520ms var(--ease-slow), box-shadow 520ms var(--ease-slow)",
          }}
        />
      </span>

      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(on && allowNone ? null : o.value)}
            className={cx(
              "relative z-10 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium",
              "transition-[color,transform] duration-300 active:scale-[0.97]",
              on ? "text-ink" : "text-soft hover:text-ink",
            )}
          >
            {o.icon && (
              <span
                className="flex transition-colors duration-500"
                style={{ color: on ? o.colour : "var(--color-faint)" }}
              >
                {o.icon}
              </span>
            )}
            <span>
              {o.label}
              {o.hint && <span className="ml-1.5 text-[11px] font-normal text-faint">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The releases on the trade's day, as saved with it — always included, never switched off. */
function NewsList({ news }: { news: TradeNews[] }) {
  if (!news.length) {
    return <p className="text-[12px] text-soft">No red or orange news for this symbol on this day.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {news.map((n, i) => (
        <li key={`${n.currency}|${n.time}|${n.title}`} className="anim-rise flex items-center gap-2.5 text-[12px]" style={stagger(i, 40)}>
          <span className="num w-10 shrink-0 text-soft">{n.time || "—"}</span>
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              backgroundColor: n.impact === "Manual" ? "var(--color-soft)" : impactColour(n.impact),
              boxShadow: n.impact === "High" ? `0 0 8px ${impactColour(n.impact)}` : undefined,
            }}
          />
          <span className="num w-8 shrink-0 font-medium">{n.currency}</span>
          <span className="min-w-0 flex-1 truncate text-soft" title={n.title}>
            {n.title}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Reminds you of the strategy's window, and flags off-hours entries. */
function StrategyHint({ strategy: s, date }: { strategy: Strategy; date: string }) {
  const time = date.slice(11, 16);
  const outsideHours = s.hoursFrom && s.hoursTo && time ? time < s.hoursFrom || time > s.hoursTo : false;

  return (
    <div className="text-[12px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-faint">
        {s.instrument && <span className="num">{s.instrument}</span>}
        {s.sessions?.length > 0 && <span>{inOrder(s.sessions, SESSIONS).join(" / ")}</span>}
        {s.hoursFrom && s.hoursTo && (
          <span className={cx("num", outsideHours && "font-medium text-down")}>
            {s.hoursFrom}–{s.hoursTo}
            {outsideHours && ` · this trade is at ${time}, outside your window`}
          </span>
        )}
        {s.rrFrom != null && (
          <span className="num">
            target {s.rrFrom}
            {s.rrTo && s.rrTo !== s.rrFrom ? `–${s.rrTo}` : ""}R
          </span>
        )}
      </div>
      {s.invalidation && (
        <p className="mt-1.5 text-soft">
          <span className="text-faint">Invalidated when: </span>
          {s.invalidation}
        </p>
      )}
    </div>
  );
}

const StepHeader = ({ step, title, children }: { step: number; title: string; children: ReactNode }) => (
  <header className="text-center">
    <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Step {step} of 3</p>
    <h2 className="mt-2 text-[22px] font-semibold tracking-tight">{title}</h2>
    <p className="mx-auto mt-1.5 max-w-md text-[13px] text-soft">{children}</p>
  </header>
);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  placeholder,
  suffix,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix: string;
}) {
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        className="field num pr-10"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">
        {suffix}
      </span>
    </div>
  );
}

const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
