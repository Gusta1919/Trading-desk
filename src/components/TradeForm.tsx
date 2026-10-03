import { ArrowLeft, Check, Pencil, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { impactColour } from "@/lib/calendarView";
import type { CheckIn } from "@/lib/checkin";
import type { CoachCard } from "@/lib/coach";
import { autoRuleState, evaluateHistory, judgeDraft, releasesHeld } from "@/lib/discipline";
import { fmtPct, fmtR, nowLocal, tone } from "@/lib/format";
import { BIAS_OPTION } from "@/lib/goldModel";
import { computeGrade } from "@/lib/grading";
import { newsForTrade, ruleCurrencies, type CalendarEvent } from "@/lib/news";
import { coveredDays, fromEvent, fromTradeNews, newsDay, releaseWindowAt, type NewsItem } from "@/lib/newsRules";
import { dayBudget, gradeCard, gradeRisk, takenTrades, weekBudget } from "@/lib/risk";
import { fill as fillText, tokenValues, type Rulebook } from "@/lib/rulebook";
import { dayOf, minutesOf, sessionAt, timeOf } from "@/lib/rules";
import { DESK_LABEL, deskDay, deskTime } from "@/lib/tz";
import {
  EMOTIONS,
  EXIT_REASONS,
  FLAG_LABEL,
  HTF_REASON_TYPES,
  HTF_TIMEFRAMES,
  MISTAKES,
  POI_TESTS,
  SESSIONS,
  htfTfLabel,
  topHtf,
  type Direction,
  type ExitReason,
  type Grade,
  type HtfReason,
  type HtfReasonType,
  type PoiTests,
  type SetupSnapshot,
  type Trade,
  type TradeFlag,
  type TradeInput,
  type TradeNews,
} from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { GlossaryContext, Glossed } from "./Glossed";
import { GradePanel, SetupCheck, answerSummary, type AutoState } from "./SetupCheck";
import { Button, Chips, Field, Modal, Segmented, YesNo, cx, stagger } from "./ui";

/** Everything typed into the form. Numbers stay text while you type them. */
interface FormState {
  date: string;
  direction: Direction;
  /** A setup logged but not taken: no risk, no money, only what it would have made. */
  skipped: boolean;
  hypotheticalR: string;
  riskPct: string;
  plannedRR: string;
  pnlUsd: string;
  /** Hand-ticked base rules. */
  checklist: string[];
  /** Your answers to the grade factors. */
  answers: Record<string, string | number>;
  news: TradeNews[];

  boxSize: string;
  sweepDepth: string;
  took15mSwing: boolean | null;
  levelSweep: boolean | null;
  htfReasons: HtfReason[];
  poiTests: PoiTests | "";
  biasMatch: boolean | null;
  /** The bias match is pre-filled from today's briefing until you answer it yourself. */
  biasTouched: boolean;

  /** "HH:mm" — always the trade's own day. */
  exitTime: string;
  exitReason: ExitReason | "";
  earlyStopMove: boolean | null;
  releaseAtBe: boolean | null;
  mfeR: string;
  maeR: string;
  targetBeforeStop: Trade["targetBeforeStop"];
  maxFavR: string;

  emotion: number | null;
  mistakes: string[];
  flagNote: string;
  notes: string;
  screenshot: string;
  screenshotAfter: string;
}

const str = (v: number | null | undefined) => (v != null ? String(v) : "");

function toForm(t: Trade | null): FormState {
  return {
    date: t?.date ?? nowLocal(),
    direction: t?.direction ?? "long",
    skipped: t?.skipped ?? false,
    hypotheticalR: str(t?.hypotheticalR),
    riskPct: t && !t.skipped ? String(t.riskPct) : "",
    plannedRR: str(t?.plannedRR),
    pnlUsd: str(t?.pnlUsd),
    checklist: t?.setupSnapshot?.ticked ?? [],
    answers: t?.setupSnapshot?.answers ?? {},
    news: t?.news ?? [],
    boxSize: str(t?.boxSize),
    sweepDepth: str(t?.sweepDepth),
    took15mSwing: t?.took15mSwing ?? null,
    levelSweep: t?.levelSweep ?? null,
    htfReasons: t?.htfReasons ?? [],
    poiTests: t?.poiTests ?? "",
    biasMatch: t?.biasMatch ?? null,
    biasTouched: Boolean(t),
    exitTime: t?.exitTime ? timeOf(t.exitTime) : "",
    exitReason: t?.exitReason ?? "",
    earlyStopMove: t?.earlyStopMove ?? null,
    releaseAtBe: t?.releaseAtBe ?? null,
    mfeR: str(t?.mfeR),
    maeR: str(t?.maeR),
    targetBeforeStop: t?.targetBeforeStop ?? "",
    maxFavR: str(t?.maxFavR),
    emotion: t?.emotion ?? null,
    mistakes: t?.mistakes ?? [],
    flagNote: t?.flagNote ?? "",
    notes: t?.notes ?? "",
    screenshot: t?.screenshot ?? "",
    screenshotAfter: t?.screenshotAfter ?? "",
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

/** Exits that came before the target: the ones where "would the target have been hit?" is worth asking. */
const EARLY_EXITS: ExitReason[] = ["breakeven", "trail", "time", "release"];

const fmtUsd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

/**
 * Logging a trade: first the setup check, so every trade is graded before it is logged;
 * then the trade itself. A setup that isn't tradable — a B, or any setup on a day the
 * rules close — is logged as not taken: it never touches the account and breaks no rule,
 * and the journal still learns whether it would have paid.
 */
export function TradeForm({
  open,
  trade,
  trades,
  checkins,
  lean = null,
  nudge,
  doc,
  rulebookOf,
  calendar,
  onClose,
  onSaved,
}: {
  open: boolean;
  trade: Trade | null;
  trades: Trade[];
  checkins: CheckIn[];
  /** Which way today's Daily Bias briefing leans — pre-fills "my bias matches the briefing". */
  lean?: "bullish" | "bearish" | "unclear" | null;
  /** The rulebook in force — what a new trade is graded under. */
  doc: Rulebook;
  /** Any version, for a trade graded under an older one. */
  rulebookOf: (version: string | null) => Rulebook;
  /** The whole news calendar, so the trade can record what was out on its day. */
  calendar: CalendarEvent[];
  nudge?: CoachCard | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(trade));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** A new trade is two steps: the setup check, then the trade. Editing goes straight to the trade. */
  const [step, setStep] = useState<"setup" | "form">("form");

  useEffect(() => {
    if (!open) return;
    setF(toForm(trade));
    setError(null);
    setConfirmDelete(false);
    setStep(trade ? "form" : "setup");
  }, [open, trade]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  /* ── The rulebook this trade is graded under ── */

  // A new trade is graded under the rulebook in force; a logged one keeps its own version.
  const rb = trade ? rulebookOf(trade.rulebookVersion) : doc;
  const version = trade ? trade.rulebookVersion : doc.version;
  const L = rb.limits;
  // A logged trade keeps the definition it was graded with, so editing the rulebook never regrades history.
  const definition: Pick<SetupSnapshot, "baseRules" | "factors" | "grades"> = trade?.setupSnapshot ?? rb;
  const values = useMemo(() => tokenValues(rb), [rb]);
  const fill = (t: string) => fillText(t, values);

  const day = dayOf(f.date);
  const time = timeOf(f.date);
  const session = sessionAt(time);
  const others = useMemo(() => trades.filter((t) => t.id !== trade?.id), [trades, trade?.id]);
  const verdict = checkins.find((c) => c.date === day)?.verdict;

  /* ── The day's news: the live calendar when it covers the day, else the trade's own copy ── */

  const currencies = useMemo(() => ruleCurrencies(rb.news), [rb.news]);
  const dayNews = useMemo(() => newsForTrade(calendar, rb.instrument, day, currencies).map(toTradeNews), [calendar, rb.instrument, day, currencies]);
  const covered = useMemo(() => coveredDays(calendar), [calendar]);
  const feedCovers = covered != null && day >= covered.from && day <= covered.to;
  useEffect(() => {
    if (trade) return;
    setF((p) => ({ ...p, news: dayNews }));
  }, [trade, dayNews]);
  const newsItems: NewsItem[] | null = feedCovers
    ? newsForTrade(calendar, rb.instrument, day, currencies).map(fromEvent)
    : f.news.length
      ? f.news.map(fromTradeNews)
      : null;

  /* ── Your bias against today's briefing ── */

  const myBias = biasOf(f.answers, f.direction);
  const briefing = day === deskDay() && lean ? lean : null;
  const biasFromLean = myBias && briefing ? myBias === briefing : null;
  useEffect(() => {
    if (f.biasTouched || trade || biasFromLean == null) return;
    if (biasFromLean !== f.biasMatch) setF((p) => ({ ...p, biasMatch: biasFromLean }));
  }, [biasFromLean, f.biasTouched, f.biasMatch, trade]);

  /* ── The base rules the desk answers itself ── */

  const budget = dayBudget(others, day, L, { before: f.date });
  const weekB = weekBudget(others, day, L, { before: f.date });
  const takenEarlier = takenTrades(others).filter((t) => dayOf(t.date) === day && t.date <= f.date).length;
  const autoStates: Record<string, AutoState> = {};
  for (const r of definition.baseRules) {
    if (!r.auto) continue;
    const holds = autoRuleState(r.auto, { doc: rb, date: f.date, trades: others, news: newsItems });
    autoStates[r.id] = { holds, note: autoNote(r.auto, holds) };
  }
  function autoNote(auto: string, holds: boolean | null): string {
    if (auto === "daily-budget") {
      if (budget.stopHit) return "checked by the desk — the daily stop is hit";
      if (takenEarlier >= rb.maxTradesPerDay) return "checked by the desk — today's trade is already taken";
      return `checked by the desk — ${+budget.remaining.toFixed(2)}% of the day's budget left, no trade yet`;
    }
    if (holds == null) return "no calendar data for this day — tick it yourself";
    const nd = newsDay(day, newsItems ?? [], rb.news);
    if (nd.skip.length) return `checked by the desk — skip day: ${nd.skip.join(", ")}`;
    const m = minutesOf(time);
    const w = m != null ? releaseWindowAt(m, nd) : null;
    if (w) return `checked by the desk — inside the window of ${w.currency} ${w.title}`;
    return `checked by the desk — no skip day${nd.windows.length ? `, outside ${nd.windows.length} release window${nd.windows.length > 1 ? "s" : ""}` : ""}`;
  }
  const ticked = definition.baseRules
    .filter((r) => {
      const a = autoStates[r.id];
      return a && a.holds != null ? a.holds : f.checklist.includes(r.id);
    })
    .map((r) => r.id);

  /* ── The grade, and what it may risk ── */

  const result = computeGrade(definition, { ticked, answers: f.answers });
  const grade: Grade = result.grade;
  const card = gradeCard(definition, grade);
  const gRisk = gradeRisk(definition, grade);
  const prior = useMemo(() => evaluateHistory({ trades: others, checkins, rulebookOf }).timeline, [others, checkins, rulebookOf]);
  const dayOff = prior.dayOff.get(day) ?? null;

  /* ── The result, as the account sees it ── */

  const pnl = parseNum(f.pnlUsd);
  const risk = parseNum(f.riskPct);
  // The balance this trade is measured against: the opening balance plus everything closed before it.
  const balanceBefore = useMemo(
    () => takenTrades(others).filter((t) => t.date <= f.date && t.pnlUsd != null).reduce((a, t) => a + (t.pnlUsd ?? 0), L.openingBalance),
    [others, f.date, L.openingBalance],
  );
  const resultPct = pnl != null && balanceBefore > 0 ? (pnl / balanceBefore) * 100 : null;
  const resultR = resultPct != null && risk ? resultPct / risk : null;
  const riskUsd = risk != null ? Number(((balanceBefore * risk) / 100).toFixed(2)) : null;
  const exitStamp = f.exitTime ? `${day}T${f.exitTime}` : "";
  const held = releasesHeld({ date: f.date, exitTime: exitStamp, news: f.news }, rb);

  /** The trade as it will be saved. */
  function toInput(): TradeInput {
    const snap: SetupSnapshot = {
      baseRules: definition.baseRules,
      factors: definition.factors,
      grades: definition.grades,
      ticked,
      answers: f.answers,
      grade: result.complete ? grade : null,
    };
    return {
      date: f.date,
      symbol: rb.instrument,
      direction: f.direction,
      session: session ?? "",
      riskPct: f.skipped ? 0 : (risk ?? 0),
      plannedRR: parseNum(f.plannedRR),
      pnlUsd: f.skipped ? null : pnl,
      grade: result.complete ? grade : "",
      setupSnapshot: snap,
      rulebookVersion: version,
      flagNote: f.flagNote.trim(),
      skipped: f.skipped,
      hypotheticalR: f.skipped ? parseNum(f.hypotheticalR) : null,
      boxSize: parseNum(f.boxSize),
      sweepDepth: parseNum(f.sweepDepth),
      took15mSwing: f.took15mSwing,
      levelSweep: f.levelSweep,
      htfReasons: f.htfReasons,
      poiTests: f.poiTests,
      biasMatch: f.biasMatch,
      exitTime: exitStamp,
      exitReason: f.exitReason,
      earlyStopMove: f.skipped ? null : f.earlyStopMove,
      releaseAtBe: !f.skipped && held.length ? f.releaseAtBe : null,
      mfeR: parseNum(f.mfeR),
      maeR: parseNum(f.maeR),
      maxFavR: f.exitReason === "target" ? parseNum(f.maxFavR) : null,
      targetBeforeStop: f.exitReason && EARLY_EXITS.includes(f.exitReason) ? f.targetBeforeStop : "",
      emotion: f.emotion,
      mistakes: f.mistakes,
      notes: f.notes,
      screenshot: f.screenshot.trim(),
      screenshotAfter: f.screenshotAfter.trim(),
      news: f.news,
    };
  }

  /*
   * Every flag judged the way the server will judge it on save — against the whole
   * history and the check-ins — so what you see before saving is what is recorded.
   */
  const judgement = f.skipped
    ? { flags: [] as TradeFlag[], allowed: 0 }
    : judgeDraft(
        {
          ...toInput(),
          id: trade?.id ?? "draft",
          resultR,
          riskUsd,
          flags: [],
          plannedRiskPct: null,
          createdAt: trade?.createdAt ?? "9999",
          updatedAt: "",
        },
        { trades, checkins, rulebookOf },
      );
  const flags = judgement.flags;
  const allowed = f.skipped
    ? 0
    : judgeDraft(
        {
          ...toInput(),
          id: trade?.id ?? "draft",
          riskPct: 0,
          resultR: null,
          riskUsd: null,
          flags: [],
          plannedRiskPct: null,
          createdAt: trade?.createdAt ?? "9999",
          updatedAt: "",
        },
        { trades, checkins, rulebookOf },
      ).allowed;
  const doneToday = takenEarlier >= rb.maxTradesPerDay;
  const tradable = Boolean(card?.traded) && allowed > 0;

  async function save() {
    setError(null);
    if (!result.complete) {
      setStep("setup");
      return setError(`Grade the setup first — still to answer: ${result.missingFactors.map((x) => x.name).join(", ")}`);
    }
    setSaving(true);
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

  const setupCheck = (
    <SetupCheck
      definition={definition}
      ticked={f.checklist}
      answers={f.answers}
      auto={autoStates}
      fill={fill}
      side={step === "setup"}
      onToggle={(id) => setF((p) => ({ ...p, checklist: p.checklist.includes(id) ? p.checklist.filter((x) => x !== id) : [...p.checklist, id] }))}
      onAnswer={(id, v) =>
        setF((p) => {
          const next = { ...p.answers };
          if (v == null) delete next[id];
          else next[id] = v;
          return { ...p, answers: next };
        })
      }
    />
  );
  const gradePanel = (
    <GradePanel
      result={result}
      card={card}
      gradeRiskPct={gRisk}
      allowed={allowed}
      budget={budget}
      week={weekB}
      limits={L}
      verdict={verdict}
      dayOff={dayOff}
      doneToday={doneToday}
      day={day}
    />
  );

  /** Date, time and direction: what the automatic rules read. */
  const whenAndWhich = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={`Entry · ${DESK_LABEL}`}>
        <input type="datetime-local" className="field num" value={f.date} onChange={(e) => set("date", e.target.value)} required />
      </Field>
      <Field label="Direction">
        <Segmented
          fill
          value={f.direction}
          onChange={(v) => v && set("direction", v)}
          options={[
            { value: "long", label: "Long", hint: "low swept", icon: <TrendingUp size={15} />, colour: "var(--color-up)" },
            { value: "short", label: "Short", hint: "high swept", icon: <TrendingDown size={15} />, colour: "var(--color-down)" },
          ]}
        />
      </Field>
    </div>
  );

  /* ── Step 1: the setup check ───────────────────────────────────────── */

  if (step === "setup" && !trade) {
    const go = (skipped: boolean) => {
      setError(null);
      setF((p) => ({ ...p, skipped, riskPct: !skipped && allowed > 0 && !p.riskPct ? String(allowed) : p.riskPct }));
      setStep("form");
    };
    return (
      <GlossaryContext.Provider value={rb.glossary}>
        <Modal open={open} onClose={onClose} width="max-w-7xl">
          <div className="flex max-h-[calc(100vh-3rem)] flex-col">
            <div className="shrink-0 space-y-5 px-10 pb-5 pt-7">
              <StepHeader step={1} title="Grade the setup">
                The desk checks what it can; you answer the rest. The grade decides what you may risk.
              </StepHeader>
              <div className="mx-auto max-w-2xl">{whenAndWhich}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-5">{setupCheck}</div>

            {error && <p className="shrink-0 px-10 pb-2 text-center text-body text-down">{error}</p>}
            <div className="shrink-0 space-y-3 border-t bg-raised px-10 pb-5 pt-4">
              {gradePanel}
              <div className="flex items-center justify-center gap-3">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                {!result.complete ? (
                  <Button type="button" variant="primary" disabled title="Answer every grade factor first">
                    Answer every factor to go on
                  </Button>
                ) : tradable ? (
                  <>
                    <Button type="button" variant="ghost" onClick={() => go(true)} title="A setup you saw but passed on: logged for the record, never counted">
                      Log as not taken
                    </Button>
                    <Button type="button" variant="accent" onClick={() => go(false)}>
                      Grade {grade} · {allowed}% — log the trade
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="ghost" onClick={() => go(false)} title="It was taken anyway: logged as a broken rule">
                      I took it anyway
                    </Button>
                    <Button type="button" variant="accent" onClick={() => go(true)}>
                      Grade {grade} · log it as not taken
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      </GlossaryContext.Provider>
    );
  }

  /* ── Step 2: the trade ─────────────────────────────────────────────── */

  const summary = answerSummary(definition, f.answers);
  const htfTop = topHtf(f.htfReasons);
  const htfFactor = definition.factors.find((x) => x.id === "htf-tf");
  const htfAnswer = htfFactor?.kind === "choice" ? htfFactor.options.find((o) => o.id === f.answers[htfFactor.id]) : undefined;
  // The grid and the grade should tell the same story: a 1H reason can't be graded "4H, Daily or Weekly".
  const htfMismatch = htfTop && htfAnswer && !htfAnswer.label.includes(htfTfLabel(htfTop.tf)) ? htfAnswer.label : null;
  const flagLines: { text: string; fix?: ReactNode }[] = flags.map((fl) =>
    fl === "over_risk"
      ? {
          text: risk != null && risk > L.maxRiskPct ? `${risk}% is over your ${L.maxRiskPct}% maximum per trade.` : `${risk}% is more than the ${allowed}% allowed for ${grade} today.`,
          fix:
            allowed > 0 ? (
              <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set("riskPct", String(allowed))}>
                use {allowed}%
              </button>
            ) : undefined,
        }
      : fl === "non_traded_grade"
        ? {
            text: `${grade} is not tradable — the rules say not to take it.`,
            fix: (
              <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set("skipped", true)}>
                log it as not taken
              </button>
            ),
          }
        : { text: `${FLAG_LABEL[fl]}.` },
  );

  return (
    <GlossaryContext.Provider value={rb.glossary}>
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
          {/* ── Header: what this is, taken or not, and the setup it was graded as ── */}
          <header className="shrink-0 border-b px-7 pb-4 pt-5">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                {!trade && <p className="eyebrow">Step 2 of 2</p>}
                <h2 className="text-heading font-semibold">{trade ? (f.skipped ? "Setup not taken" : "Edit trade") : f.skipped ? "Log the setup" : "Log the trade"}</h2>
              </div>
              <Segmented
                size="sm"
                value={f.skipped}
                onChange={(v) => v != null && set("skipped", v)}
                options={[
                  { value: false, label: "Taken", colour: "var(--color-up)" },
                  { value: true, label: "Not taken", colour: "var(--color-soft)" },
                ]}
              />
              <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-faint transition-colors hover:bg-subtle hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* One line, fixed slots: the grade, what it rests on, what it may risk, and a way back. */}
            <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-stretch overflow-hidden rounded-xl border">
              <div className="flex items-center px-4 py-3">
                <span key={grade} className="anim-stamp">
                  <GradeBadge grade={grade} size="lg" />
                </span>
              </div>
              <div className="flex min-w-0 flex-col justify-center py-3 pr-4">
                <span className="text-body font-medium">{rb.name}</span>
                <span className="truncate text-small text-soft">
                  {ticked.length}/{definition.baseRules.length} base rules{summary && ` · ${summary}`}
                </span>
              </div>
              <div className="flex min-w-[132px] flex-col justify-center border-l px-5 py-3">
                <span className="eyebrow">{f.skipped ? "Not taken" : "Allowed"}</span>
                <span className={cx("num text-title font-semibold", f.skipped ? "text-soft" : allowed > 0 ? "text-ink" : "text-down")}>
                  {f.skipped ? "—" : `${allowed}%`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStep("setup")}
                disabled={Boolean(trade)}
                className={cx(
                  "flex items-center gap-1.5 border-l px-5 text-small text-soft transition-colors duration-300",
                  trade ? "hidden" : "hover:bg-subtle hover:text-ink",
                )}
              >
                <Pencil size={13} /> Edit setup
              </button>
            </div>
          </header>

          {/* ── Body: the trade on the left, its context on the right ── */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-5">
                {trade && (
                  <Card index={0} title="Setup — as graded when it was logged">
                    <div className="space-y-4">
                      {setupCheck}
                      {gradePanel}
                    </div>
                  </Card>
                )}

                <Card index={1} title="The trade">
                  {whenAndWhich}
                  <div className="mt-4">
                    <Field label="Session · from the entry time">
                      <SessionStrip session={session} />
                    </Field>
                  </div>
                </Card>

                <Card index={2} title="Setup">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Field label="Box size">
                      <NumberInput value={f.boxSize} onChange={(v) => set("boxSize", v)} placeholder="high − low" suffix="$" />
                    </Field>
                    <Field label="Sweep depth" hint={parseNum(f.sweepDepth) != null ? depthHint(parseNum(f.sweepDepth)!, rb) : undefined}>
                      <NumberInput value={f.sweepDepth} onChange={(v) => set("sweepDepth", v)} placeholder="beyond the edge" suffix="$" />
                    </Field>
                    <Field label="Took a 15m swing">
                      <YesNo value={f.took15mSwing} onChange={(v) => set("took15mSwing", v)} />
                    </Field>
                    <Field label="Level sweep">
                      <YesNo value={f.levelSweep} onChange={(v) => set("levelSweep", v)} />
                    </Field>
                  </div>
                  <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                    <Field label="HTF reason · the highest timeframe counts">
                      <HtfPicker value={f.htfReasons} onChange={(v) => set("htfReasons", v)} />
                      {htfMismatch && (
                        <p className="anim-fade mt-1.5 text-caption text-warn">
                          Graded as “{htfMismatch}” — the highest reason here is {htfTfLabel(htfTop!.tf)}.
                        </p>
                      )}
                    </Field>
                    <div className="flex flex-col gap-4">
                      <Field label="POI">
                        <Segmented size="sm" allowNone value={f.poiTests || null} onChange={(v) => set("poiTests", v ?? "")} options={POI_TESTS} />
                      </Field>
                      <Field
                        label="My bias matches the briefing"
                        hint={
                          !trade
                            ? briefing
                              ? `Briefing ${briefing}${myBias ? ` · yours ${myBias}` : " · answer the bias in the setup check"}`
                              : "No briefing for this day — answer it yourself."
                            : undefined
                        }
                      >
                        <div className="max-w-[260px]">
                          <YesNo value={f.biasMatch} onChange={(v) => setF((p) => ({ ...p, biasMatch: v, biasTouched: true }))} />
                        </div>
                      </Field>
                    </div>
                  </div>
                </Card>

                {f.skipped ? (
                  <Card index={3} title="What it would have made">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Result if taken" hint="From the chart: target, stop or the time stop, in R. Never counted.">
                        <NumberInput value={f.hypotheticalR} onChange={(v) => set("hypotheticalR", v)} placeholder="e.g. 2 or −1" suffix="R" />
                      </Field>
                      <Field label="Best it got (MFE)">
                        <NumberInput value={f.mfeR} onChange={(v) => set("mfeR", v)} placeholder="optional" suffix="R" />
                      </Field>
                      <Field label="Worst it got (MAE)">
                        <NumberInput value={f.maeR} onChange={(v) => set("maeR", v)} placeholder="optional" suffix="R" />
                      </Field>
                    </div>
                  </Card>
                ) : (
                  <>
                    <Card index={3} title="Risk and result">
                      <div className="grid gap-4 sm:grid-cols-4">
                        <Field label="Risk">
                          <NumberInput value={f.riskPct} onChange={(v) => set("riskPct", v)} placeholder={String(allowed || L.maxRiskPct)} suffix="%" />
                        </Field>
                        <Field label="Planned R:R">
                          <NumberInput value={f.plannedRR} onChange={(v) => set("plannedRR", v)} placeholder="2" suffix="R" />
                        </Field>
                        <Field label={`Result · ${L.accountName}`}>
                          <NumberInput value={f.pnlUsd} onChange={(v) => set("pnlUsd", v)} placeholder="empty = open" suffix="$" />
                        </Field>
                        {/* The result as the account sees it — the same height as the fields beside it, and a stamp each time it changes. */}
                        <Field label="On the account">
                          <div className="flex h-[42px] items-center justify-between rounded-xl bg-subtle px-3.5">
                            <span key={resultPct == null ? "open" : resultPct.toFixed(3)} className={cx("anim-stamp num text-title font-semibold", tone(resultPct))}>
                              {resultPct == null ? <span className="font-normal text-faint">open</span> : fmtPct(resultPct)}
                            </span>
                            <span className="num text-small text-faint">{resultR != null ? fmtR(resultR) : ""}</span>
                          </div>
                        </Field>
                      </div>
                      <p className="mt-2 text-caption text-faint">
                        {riskUsd != null && (
                          <>
                            <span className="num text-soft">{fmtUsd(riskUsd)}</span> at risk of {fmtUsd(balanceBefore)} ·{" "}
                          </>
                        )}
                        The {L.accountName}'s dollar result, costs already in it. The % and R are worked out for you
                        {L.linked.length > 0 && <>, and {L.linked.map((x) => x.name).join(" and ")} take the same %</>}. Leave it empty while the trade is open.
                      </p>
                    </Card>

                    <Card index={4} title="Exit">
                      <Field label="Exit reason">
                        <Segmented size="sm" allowNone value={f.exitReason || null} onChange={(v) => set("exitReason", v ?? "")} options={EXIT_REASONS} />
                      </Field>
                      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
                        <Field label={`Exit time · ${DESK_LABEL}`}>
                          <input type="time" className="field num" value={f.exitTime} onChange={(e) => set("exitTime", e.target.value)} />
                        </Field>
                        <Field label={`Stop moved before ${values.trailAfter}?`}>
                          <YesNo value={f.earlyStopMove} onChange={(v) => set("earlyStopMove", v)} />
                        </Field>
                        {held.length > 0 && (
                          <Field label={`At breakeven through ${held[0].currency} ${held[0].title}?`}>
                            <YesNo value={f.releaseAtBe} onChange={(v) => set("releaseAtBe", v)} />
                          </Field>
                        )}
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-3">
                        <Field label="Best it got (MFE)">
                          <NumberInput value={f.mfeR} onChange={(v) => set("mfeR", v)} placeholder="in your favour" suffix="R" />
                        </Field>
                        <Field label="Worst it got (MAE)">
                          <NumberInput value={f.maeR} onChange={(v) => set("maeR", v)} placeholder="against you" suffix="R" />
                        </Field>
                        {f.exitReason === "target" ? (
                          <Field label={`Furthest by ${rb.timeStop}`}>
                            <NumberInput value={f.maxFavR} onChange={(v) => set("maxFavR", v)} placeholder="optional" suffix="R" />
                          </Field>
                        ) : f.exitReason && EARLY_EXITS.includes(f.exitReason) ? (
                          <Field label={`Target before stop by ${rb.timeStop}?`}>
                            <Segmented
                              size="sm"
                              allowNone
                              value={f.targetBeforeStop || null}
                              onChange={(v) => set("targetBeforeStop", v ?? "")}
                              options={[
                                { value: "yes", label: "Yes" },
                                { value: "no", label: "No" },
                                { value: "unknown", label: "?" },
                              ]}
                            />
                          </Field>
                        ) : null}
                      </div>
                      <p className="mt-2 text-caption text-faint">In R from your stop: how far it went your way and against you before the exit. They feed the Exit lab.</p>
                    </Card>
                  </>
                )}

                <Card index={5} title="Review">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Field label="State of mind">
                      <Segmented allowNone size="sm" value={f.emotion} onChange={(v) => set("emotion", v)} options={EMOTIONS.map((e, i) => ({ value: i + 1, label: e }))} />
                    </Field>
                    <Field label="Mistakes" hint="What no rule can see. A broken rule is flagged by the desk on its own.">
                      <Chips options={MISTAKES} value={f.mistakes} onChange={(v) => set("mistakes", v)} />
                    </Field>
                  </div>

                  {!f.skipped && (
                    <div className="mt-4 space-y-1.5">
                      {flagLines.map((l, i) => (
                        <div
                          key={l.text}
                          className="anim-rise flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-down/[0.08] px-3.5 py-2 text-small text-down"
                          style={stagger(i, 60)}
                        >
                          <span>⚑ {l.text}</span>
                          {l.fix}
                        </div>
                      ))}
                      {!flags.length && (
                        <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-subtle px-3.5 py-2 text-small text-soft">
                          <span>
                            <span className="text-up">✓</span> No rule broken · allowed {allowed}% · day {+budget.remaining.toFixed(2)}% · week {+weekB.remaining.toFixed(2)}% left
                          </span>
                          {risk == null && allowed > 0 && (
                            <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set("riskPct", String(allowed))}>
                              use {allowed}%
                            </button>
                          )}
                        </div>
                      )}
                      {flags.length > 0 && (
                        <>
                          <p className="px-1 text-caption text-faint">
                            Saved either way — a broken rule is recorded, and costs the rest of the day and {values["consequence.days"]}.
                          </p>
                          <input
                            className="field anim-rise text-small"
                            placeholder={`Why? (optional) — saved with the flag${flags.length > 1 ? "s" : ""}`}
                            value={f.flagNote}
                            onChange={(e) => set("flagNote", e.target.value)}
                          />
                        </>
                      )}
                    </div>
                  )}
                </Card>
              </div>

              {/* ── Context and notes; the notes card takes whatever height is left ── */}
              <aside className="flex flex-col gap-5">
                {!trade && nudge && (
                  <Side index={1} title="Coach">
                    <p className="text-body font-medium">{nudge.title}</p>
                    <p className="mt-1 text-small leading-relaxed text-soft">{nudge.body}</p>
                  </Side>
                )}

                <Side index={2} title={`News that day · ${day}`}>
                  <NewsList news={f.news} />
                  <p className="mt-2 text-caption text-faint">Saved with the trade automatically.</p>
                </Side>

                <Side index={3} title="Rulebook">
                  <RulebookHint rb={rb} values={values} />
                </Side>

                <Side index={4} title="Notes" grow>
                  <textarea
                    className="field min-h-[132px] flex-1 resize-none text-body"
                    placeholder={f.skipped ? "Why did you pass? What would have made it a trade?" : "Why did you take it? What did you see? What would you do differently?"}
                    value={f.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input className="field text-small" placeholder="Chart before" title="A TradingView snapshot link" value={f.screenshot} onChange={(e) => set("screenshot", e.target.value)} />
                    <input className="field text-small" placeholder="Chart after" title="A TradingView snapshot link" value={f.screenshotAfter} onChange={(e) => set("screenshotAfter", e.target.value)} />
                  </div>
                </Side>
              </aside>
            </div>
          </div>

          {/* ── Footer ── */}
          <footer className="flex shrink-0 items-center gap-2 border-t bg-raised px-7 py-4">
            {trade && (
              <Button type="button" variant="danger" onClick={remove}>
                <Trash2 size={14} /> {confirmDelete ? "Click again to delete" : "Delete"}
              </Button>
            )}
            {!trade && (
              <Button type="button" variant="ghost" onClick={() => setStep("setup")}>
                <ArrowLeft size={14} /> Back
              </Button>
            )}
            {error && <span className="text-body text-down">{error}</span>}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-small text-faint">⌘↵ to save</span>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="accent" disabled={saving} className="px-5">
                <Check size={15} />
                {trade ? "Save changes" : f.skipped ? "Log as not taken" : "Add trade"}
              </Button>
            </div>
          </footer>
        </form>
      </Modal>
    </GlossaryContext.Provider>
  );
}

/** Where a sweep's depth sits against the reference depths. */
function depthHint(depth: number, rb: Rulebook) {
  if (depth <= rb.sweep.p70) return `within $${rb.sweep.p70}, like ~70% of sweeps`;
  if (depth <= rb.sweep.p85) return `within $${rb.sweep.p85}, like ~85%`;
  if (depth <= rb.sweep.p95) return `deep — beyond $${rb.sweep.p85}`;
  return `very deep — beyond $${rb.sweep.p95}`;
}

/** Your daily bias, read back from the bias answer and the direction of the trade. */
function biasOf(answers: Record<string, string | number>, direction: Direction): "bullish" | "bearish" | "unclear" | null {
  const a = Object.values(answers).find((v) => v === BIAS_OPTION.matches || v === BIAS_OPTION.against || v === BIAS_OPTION.unclear);
  if (!a) return null;
  if (a === BIAS_OPTION.unclear) return "unclear";
  return (direction === "long") === (a === BIAS_OPTION.matches) ? "bullish" : "bearish";
}

/** Each session's colour (the same as the News day map) and its hours in New York. */
const SESSION_LOOK: Record<string, { colour: string; hours: string }> = {
  Asia: { colour: "var(--color-low)", hours: "18:00–03:00" },
  London: { colour: "var(--color-cyan)", hours: "03:00–08:00" },
  "New York": { colour: "var(--color-accent)", hours: "08:00–17:00" },
};

/** The session, set by the entry time: all three in a row, the one the entry falls in lit in its colour. */
function SessionStrip({ session }: { session: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1">
      {SESSIONS.map((name) => {
        const look = SESSION_LOOK[name];
        const on = name === session;
        return (
          <div
            key={name}
            className={cx(
              "relative flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-body font-medium transition-[background-color,color,box-shadow] duration-500",
              on ? "text-ink" : "text-faint",
            )}
            style={
              on
                ? {
                    backgroundColor: `color-mix(in oklab, ${look.colour} 14%, var(--color-raised))`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${look.colour} 40%, transparent), 0 6px 20px rgb(0 0 0 / 0.3)`,
                  }
                : undefined
            }
            title={`${name} · ${look.hours} New York`}
          >
            <span
              className="size-1.5 rounded-full transition-[background-color,box-shadow] duration-500"
              style={{ backgroundColor: on ? look.colour : "var(--color-line)", boxShadow: on ? `0 0 8px ${look.colour}` : undefined }}
            />
            <span key={on ? `${name}-on` : name} className={on ? "anim-stamp" : undefined}>
              {name}
            </span>
          </div>
        );
      })}
      {!session && <p className="col-span-3 px-2 pb-0.5 pt-1 text-center text-caption text-faint">17:00–18:00 — the daily break, between sessions.</p>}
    </div>
  );
}

/**
 * The HTF reasons as a small grid: a row per type, a column per timeframe, as many cells
 * as apply. The highest timeframe takes over: its cell lights up and is the one that
 * counts; a lower one stays picked, but dimmed.
 */
function HtfPicker({ value, onChange }: { value: HtfReason[]; onChange: (v: HtfReason[]) => void }) {
  const top = topHtf(value);
  const has = (type: HtfReasonType, tf: string) => value.some((r) => r.type === type && r.tf === tf);
  const toggle = (r: HtfReason) => onChange(has(r.type, r.tf) ? value.filter((x) => !(x.type === r.type && x.tf === r.tf)) : [...value, r]);
  const covered = value.filter((r) => r !== top);

  return (
    <div>
      <div className="inline-grid grid-cols-[auto_repeat(4,58px)] gap-1 rounded-xl bg-subtle p-1">
        <span />
        {HTF_TIMEFRAMES.map((tf) => (
          <span key={tf.value} className="eyebrow pb-0.5 pt-1 text-center">
            {tf.label}
          </span>
        ))}
        {HTF_REASON_TYPES.map((type, row) => (
          <Fragment key={type}>
            <span className="flex items-center pl-2.5 pr-3 text-small font-semibold text-soft">{type}</span>
            {HTF_TIMEFRAMES.map((tf, col) => {
              const on = has(type, tf.value);
              const counts = on && top?.type === type && top.tf === tf.value;
              return (
                <button
                  key={tf.value}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${tf.label} ${type}`}
                  title={counts ? `${tf.label} ${type} — counts` : on ? `${tf.label} ${type} — a higher one takes over` : `${tf.label} ${type}`}
                  onClick={() => toggle({ type, tf: tf.value })}
                  className={cx(
                    "anim-pop relative flex h-8 items-center justify-center rounded-lg text-small font-medium",
                    "transition-[background-color,color,box-shadow,transform] duration-300 active:scale-[0.94]",
                    counts ? "text-accent-2" : on ? "bg-raised text-soft shadow-[inset_0_0_0_1px_var(--color-line)]" : "bg-raised/25 text-transparent hover:bg-raised/70 hover:text-faint",
                  )}
                  style={{
                    ...stagger(row * 4 + col, 18),
                    ...(counts
                      ? {
                          backgroundColor: "color-mix(in oklab, var(--color-accent) 15%, var(--color-raised))",
                          boxShadow:
                            "inset 0 0 0 1px color-mix(in oklab, var(--color-accent) 45%, transparent), 0 0 18px color-mix(in oklab, var(--color-accent) 22%, transparent)",
                        }
                      : {}),
                  }}
                >
                  {counts ? (
                    <span key={`${type}${tf.value}`} className="anim-stamp flex items-center gap-1">
                      <Check size={12} strokeWidth={2.75} />
                      {tf.value}
                    </span>
                  ) : on ? (
                    <span className="opacity-70">{tf.value}</span>
                  ) : (
                    "+"
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="mt-1.5 text-caption text-faint">
        {top ? (
          <>
            <span className="text-soft">
              {htfTfLabel(top.tf)} {top.type}
            </span>{" "}
            counts
            {covered.length > 0 && <> · takes over {covered.map((r) => `${htfTfLabel(r.tf)} ${r.type}`).join(", ")}</>}
          </>
        ) : (
          "Pick every one that applies."
        )}
      </p>
    </div>
  );
}

/** The day's frame from the rulebook: windows, time stop, target. */
function RulebookHint({ rb, values }: { rb: Rulebook; values: Record<string, string | null> }) {
  return (
    <div className="space-y-1.5 text-small">
      <p className="text-soft">
        <span className="text-faint">Entries </span>
        <span className="num">{values.windows}</span>
        <span className="text-faint"> · out by </span>
        <span className="num">{rb.timeStop}</span>
      </p>
      <p className="text-soft">
        <span className="text-faint">Target </span>the opposite box edge<span className="text-faint"> · R:R </span>
        <span className="num">{values["rr.range"]}</span>
      </p>
      <p className="text-soft">
        <span className="text-faint">Invalidated when </span>
        <Glossed text="price trades through the stop at the external swing" />
      </p>
    </div>
  );
}

/** A section of the trade: a card that rises into place after the one above it. */
function Card({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="anim-rise rounded-2xl border bg-surface/50 px-5 py-4" style={stagger(index, 80)}>
      <h3 className="eyebrow mb-3.5 text-soft">{title}</h3>
      {children}
    </section>
  );
}

/** A context card in the right column. */
function Side({ index, title, grow = false, children }: { index: number; title: string; grow?: boolean; children: ReactNode }) {
  return (
    <section className={cx("anim-rise rounded-2xl border bg-surface/50 px-5 py-4", grow && "flex flex-1 flex-col")} style={stagger(index, 90)}>
      <h3 className="eyebrow mb-3 text-soft">{title}</h3>
      {children}
    </section>
  );
}

/** The releases on the trade's day, as saved with it — always included, never switched off. */
function NewsList({ news }: { news: TradeNews[] }) {
  if (!news.length) return <p className="text-small text-soft">No red or orange news on this day.</p>;
  return (
    <ul className="space-y-1.5">
      {news.map((n, i) => (
        <li key={`${n.currency}|${n.time}|${n.title}`} className="anim-rise flex items-center gap-2.5 text-small" style={stagger(i, 40)}>
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

const StepHeader = ({ step, title, children }: { step: number; title: string; children: ReactNode }) => (
  <header className="text-center">
    <p className="eyebrow tracking-[0.22em]">Step {step} of 2</p>
    <h2 className="mt-2 text-stat font-semibold tracking-tight">{title}</h2>
    <p className="mx-auto mt-1.5 max-w-md text-body text-soft">{children}</p>
  </header>
);

function NumberInput({ value, onChange, placeholder, suffix }: { value: string; onChange: (v: string) => void; placeholder?: string; suffix: string }) {
  return (
    <div className="relative">
      <input inputMode="decimal" className="field num pr-10" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-small text-faint">{suffix}</span>
    </div>
  );
}
