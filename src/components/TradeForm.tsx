import { ArrowLeft, Check, Pencil, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { impactColour } from "@/lib/calendarView";
import type { CheckIn } from "@/lib/checkin";
import type { CoachCard } from "@/lib/coach";
import {
  autoRuleState,
  evaluateHistory,
  judgeDraft,
  releasesHeld,
  tradableToday,
} from "@/lib/discipline";
import { fmtPct, fmtR, nowLocal, tone } from "@/lib/format";
import { computeGrade } from "@/lib/grading";
import { coveredDays, fromEvent, fromTradeNews, newsDay, releaseWindowAt, type NewsItem } from "@/lib/newsRules";
import { newsForTrade, ruleCurrencies, type CalendarEvent } from "@/lib/news";
import { dayBudget, gradeCard, gradeRisk, takenTrades, weekBudget, weekOfDay } from "@/lib/risk";
import { autoFactor, fill as fillText, tokenValues, type Rulebook } from "@/lib/rulebook";
import {
  compassFor,
  dayOf,
  displacementMultiple,
  excursions,
  inEntryWindow,
  maxFavROf,
  minutesOf,
  sessionAt,
  timeOf,
} from "@/lib/rules";
import { DESK_LABEL, deskDay, deskTime } from "@/lib/tz";
import {
  DESK_AGREED,
  EMOTIONS,
  EXIT_REASONS,
  FLAG_LABEL,
  GRADES,
  HTF_REASON_TYPES,
  MISTAKES,
  POI_TESTS,
  SESSIONS,
  isGrade,
  type DeskAgreed,
  type Direction,
  type EntryType,
  type ExitReason,
  type Grade,
  type HtfReasonType,
  type PoiTests,
  type SetupSnapshot,
  type Trade,
  type TradeInput,
  type TradeFlag,
  type TradeNews,
} from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { GlossaryContext, Glossed } from "./Glossed";
import { GradePanel, SetupCheck, answerSummary, type AutoState } from "./SetupCheck";
import { Button, Chips, Modal, Segmented, cx, stagger } from "./ui";


/** Everything typed into the form. Numbers stay text while you type them. */
interface FormState {
  date: string;
  symbol: string;
  direction: Direction;
  session: string | null;
  /** Session is filled in from the time until you pick one yourself. */
  sessionTouched: boolean;
  riskPct: string;
  plannedRR: string;
  pnlUsd: string;
  followedPlan: boolean | null;
  /** Picked by hand only on a trade from before graded setups. */
  manualGrade: string | null;
  emotion: number | null;
  mistakes: string[];
  /** Hand-ticked base rules. */
  checklist: string[];
  /** Answers you gave; the desk's own (Compass, displacement, bias) are added on top. */
  answers: Record<string, string | number>;
  news: TradeNews[];
  skipped: boolean;
  hypotheticalR: string;
  flagNote: string;
  notes: string;
  screenshot: string;
  screenshotAfter: string;

  /*
   * No prices: the box size and the sweep depth are typed in $, and the excursions in R.
   * A trade logged before 2.0 keeps the prices it was saved with, untouched.
   */
  boxSize: string;
  sweepDepth: string;
  took15mSwing: boolean | null;
  htfReasonType: HtfReasonType | "";
  poiTests: PoiTests | "";
  levelSweep: boolean | null;
  deskAgreed: DeskAgreed | "";
  deskTouched: boolean;

  entryType: EntryType | "";
  /** Only for a trade graded under a version that worked displacement out from these two. */
  atr: number | null;
  mssBeyond: number | null;

  /** "HH:mm" — always the trade's own day. */
  exitTime: string;
  exitReason: ExitReason | "";
  earlyStopMove: boolean | null;
  releaseAtBe: boolean | null;
  mfeR: string;
  maeR: string;
  targetBeforeStop: Trade["targetBeforeStop"];
  maxFavR: string;
}

const str = (v: number | null | undefined) => (v != null ? String(v) : "");

function toForm(t: Trade | null, instrument: string): FormState {
  return {
    date: t?.date ?? nowLocal(),
    symbol: t?.symbol ?? instrument,
    direction: t?.direction ?? "long",
    session: t?.session || null,
    sessionTouched: Boolean(t),
    riskPct: t && !t.skipped ? String(t.riskPct) : "",
    plannedRR: str(t?.plannedRR),
    pnlUsd: str(t?.pnlUsd),
    followedPlan: t?.followedPlan ?? null,
    manualGrade: t && !t.setupSnapshot ? t.grade || null : null,
    emotion: t?.emotion ?? null,
    mistakes: t?.mistakes ?? [],
    checklist: t?.setupSnapshot?.ticked ?? t?.checklist ?? [],
    answers: t?.setupSnapshot?.answers ?? {},
    news: t?.news ?? [],
    skipped: t?.skipped ?? false,
    hypotheticalR: str(t?.hypotheticalR),
    flagNote: t?.flagNote ?? "",
    notes: t?.notes ?? "",
    screenshot: t?.screenshot ?? "",
    screenshotAfter: t?.screenshotAfter ?? "",

    boxSize: str(t?.boxSize),
    sweepDepth: str(t?.sweepDepth),
    took15mSwing: t?.took15mSwing ?? null,
    htfReasonType: t?.htfReasonType ?? "",
    poiTests: t?.poiTests ?? "",
    levelSweep: t?.levelSweep ?? null,
    deskAgreed: t?.deskAgreed ?? "",
    deskTouched: Boolean(t?.deskAgreed),

    entryType: t?.entryType ?? "",
    atr: t?.atr ?? null,
    mssBeyond: t?.mssBeyond ?? null,

    exitTime: t?.exitTime ? timeOf(t.exitTime) : "",
    exitReason: t?.exitReason ?? "",
    earlyStopMove: t?.earlyStopMove ?? null,
    releaseAtBe: t?.releaseAtBe ?? null,
    // An older trade's excursions, worked out from its prices once, then kept in R.
    mfeR: t ? str(excursions(t).mfeR) : "",
    maeR: t ? str(excursions(t).maeR) : "",
    targetBeforeStop: t?.targetBeforeStop ?? "",
    maxFavR: t ? str(maxFavROf(t)) : "",
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

const round2 = (x: number) => Number(x.toFixed(2));

/** Exits that came before the target: the ones where "would the target have been hit?" is worth asking. */
const EARLY_EXITS: ExitReason[] = ["trail", "time", "release"];

const fmtUsd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

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
  /** Which way today's Daily Bias briefing leans — pre-fills "desk agreed" on a trade from today. */
  lean?: "bullish" | "bearish" | "unclear" | null;
  /** The rulebook in force — what a new trade is graded under. */
  doc: Rulebook;
  /** Any version, for trades graded under an older one. */
  rulebookOf: (version: string | null) => Rulebook;
  /** The whole news calendar, so the trade can record what was out on its day. */
  calendar: CalendarEvent[];
  nudge?: CoachCard | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(trade, doc.instrument));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * A new trade is two steps: the setup check, then the trade — so it is always graded
   * before it is logged. Editing goes straight to the trade.
   */
  const [step, setStep] = useState<"setup" | "form">("form");

  useEffect(() => {
    if (!open) return;
    setF(toForm(trade, doc.instrument));
    setError(null);
    setConfirmDelete(false);
    setStep(trade ? "form" : "setup");
  }, [open, trade, doc.instrument]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  /* ── Which rulebook, and which definition, this trade is graded against ── */

  // A new trade is graded under the rulebook in force; a logged one keeps its own version.
  const version = trade ? trade.rulebookVersion : doc.version;
  const ruled = version != null;
  const rb = version ? rulebookOf(version) : doc;
  const L = rb.limits;
  /*
   * An existing trade keeps the definition it was graded with, so editing the rulebook
   * later never regrades history. A trade from before graded setups has none at all.
   */
  const snapshot = trade?.setupSnapshot ?? null;
  const definition = snapshot ?? (trade ? null : rb);
  const values = useMemo(() => tokenValues(rb), [rb]);
  const fill = (t: string) => fillText(t, values);

  const day = dayOf(f.date);
  const time = timeOf(f.date);
  const others = useMemo(() => trades.filter((t) => t.id !== trade?.id), [trades, trade?.id]);
  const verdict = checkins.find((c) => c.date === day)?.verdict;

  /* ── The day's news: the live calendar when it covers the day, else the trade's own copy ── */

  const currencies = useMemo(() => ruleCurrencies(rb.news), [rb.news]);
  const dayNews = useMemo(
    () => newsForTrade(calendar, f.symbol, day, currencies).map(toTradeNews),
    [calendar, f.symbol, day, currencies],
  );
  const covered = useMemo(() => coveredDays(calendar), [calendar]);
  const feedCovers = covered != null && day >= covered.from && day <= covered.to;
  // A new trade takes the day's news from the calendar; a logged one keeps its own copy.
  useEffect(() => {
    if (trade) return;
    setF((p) => ({ ...p, news: dayNews }));
  }, [trade, dayNews]);
  const newsItems: NewsItem[] | null = feedCovers
    ? newsForTrade(calendar, f.symbol, day, currencies).map(fromEvent)
    : f.news.length
      ? f.news.map(fromTradeNews)
      : null;

  /* ── Session and desk check, filled in until you change them ── */

  useEffect(() => {
    if (f.sessionTouched) return;
    const s = sessionAt(time);
    if (s && s !== f.session) setF((p) => ({ ...p, session: s }));
  }, [time, f.sessionTouched, f.session]);
  // Today's briefing against the trade's direction: leaning the same way is "yes", the other way "no".
  const deskFromLean: DeskAgreed | null =
    day !== deskDay() || !lean || lean === "unclear"
      ? null
      : (lean === "bullish") === (f.direction === "long")
        ? "yes"
        : "no";
  useEffect(() => {
    if (f.deskTouched || trade || !deskFromLean) return;
    if (deskFromLean !== f.deskAgreed) setF((p) => ({ ...p, deskAgreed: deskFromLean }));
  }, [deskFromLean, f.deskTouched, f.deskAgreed, trade]);

  /* ── The desk's own answers ── */

  const compassF = definition ? autoFactor(definition, "compass") : null;
  const dispF = definition ? autoFactor(definition, "displacement") : null;
  const compassValue = ruled && compassF ? compassFor(rb, day, f.direction) : null;
  const dispValue = ruled && dispF ? displacementMultiple(f.mssBeyond, f.atr) : null;

  const answers: Record<string, string | number> = { ...f.answers };
  const autoAnswers: Record<string, { note: string; locked: boolean }> = {};
  if (compassF && compassValue != null) {
    answers[compassF.id] = compassValue;
    autoAnswers[compassF.id] = { note: `${new Date(`${day}T12:00`).toLocaleDateString("en-GB", { weekday: "long" })} · ${f.direction}, from the snapshot`, locked: true };
  }
  if (dispF && dispValue != null) answers[dispF.id] = dispValue;
  if (dispF) autoAnswers[dispF.id] = { note: "close beyond the swing ÷ 5m ATR(14)", locked: true };

  /* ── The base rules the desk answers ── */

  const budget = dayBudget(others, day, L, { before: f.date });
  const weekB = weekBudget(others, day, L, { before: f.date });
  const takenEarlier = takenTrades(others).filter((t) => dayOf(t.date) === day && t.date <= f.date).length;
  const autoStates: Record<string, AutoState> = {};
  for (const r of definition?.baseRules ?? []) {
    if (!r.auto) continue;
    const holds = autoRuleState(r.auto, { doc: rb, date: f.date, trades: others, news: newsItems });
    autoStates[r.id] = { holds, note: autoNote(r.auto, holds) };
  }
  function autoNote(auto: string, holds: boolean | null): string {
    switch (auto) {
      case "daily-budget":
        if (budget.stopHit) return "checked automatically — daily stop hit";
        if (takenEarlier >= rb.maxTradesPerDay) return "checked automatically — today's trade is already taken";
        return `checked automatically — ${+budget.remaining.toFixed(2)}% of the day's budget left, no trade yet`;
      case "entry-window":
        return `checked automatically — ${time} is ${holds ? "inside" : "outside"} ${values.windows}`;
      case "plan":
        return "retired in v1.3 — counts as held";
      case "news": {
        if (holds == null) return "no calendar data for this day — tick it by hand";
        const nd = newsDay(day, newsItems ?? [], rb.news);
        if (nd.skip.length) return `checked automatically — skip day: ${nd.skip.join(", ")}`;
        const m = minutesOf(time);
        const w = m != null ? releaseWindowAt(m, nd) : null;
        if (w) return `checked automatically — inside the window of ${w.currency} ${w.title}`;
        return `checked automatically — no skip day${nd.windows.length ? `, outside ${nd.windows.length} release window${nd.windows.length > 1 ? "s" : ""}` : ", no release windows"}`;
      }
    }
    return "";
  }
  const ticked = (definition?.baseRules ?? [])
    .filter((r) => {
      const a = autoStates[r.id];
      return a && a.holds != null ? a.holds : f.checklist.includes(r.id);
    })
    .map((r) => r.id);

  /* ── The grade, and what it may risk ── */

  const result = definition ? computeGrade(definition, { ticked, answers }) : null;
  const grade: Grade | null = result?.grade ?? (isGrade(f.manualGrade) ? f.manualGrade : null);
  const card = gradeCard(definition ?? rb, grade);
  const gRisk = gradeRisk(definition ?? rb, grade);
  const prior = useMemo(
    () => evaluateHistory({ trades: others, checkins, rulebookOf }).timeline,
    [others, checkins, rulebookOf],
  );
  const dayOff = prior.dayOff.get(day) ?? null;
  const halfRisk = prior.halfWeeks.has(weekOfDay(day));

  /*
   * The live preview of what this trade did to the account. The balance shown is
   * the one this trade is measured against: the opening balance plus everything
   * logged before it, which is how the server will work it out on save.
   */
  const pnl = parseNum(f.pnlUsd);
  const risk = parseNum(f.riskPct);
  const balanceBefore = useMemo(
    () =>
      takenTrades(others)
        .filter((t) => t.date <= f.date && t.pnlUsd != null)
        .reduce((a, t) => a + (t.pnlUsd ?? 0), L.openingBalance),
    [others, f.date, L.openingBalance],
  );
  const resultPct = pnl != null && balanceBefore > 0 ? (pnl / balanceBefore) * 100 : null;
  const resultR = resultPct != null && risk ? resultPct / risk : null;

  /* ── What was measured ── */

  const riskUsd = risk != null ? round2((balanceBefore * risk) / 100) : null;
  const boxSize = parseNum(f.boxSize);
  const sweepDepth = parseNum(f.sweepDepth);
  const exitStamp = f.exitTime ? `${day}T${f.exitTime}` : "";
  const held = releasesHeld({ date: f.date, exitTime: exitStamp, news: f.news }, rb);

  /** The trade as it will be saved, with the flags and allowance it was judged to have. */
  function toInput(j: { flags: TradeFlag[]; allowed: number }): TradeInput {
    const snap: SetupSnapshot | null = definition
      ? {
          ...(snapshot?.strategyName ? { strategyName: snapshot.strategyName } : {}),
          ...(version ? { rulebookVersion: version } : {}),
          baseRules: definition.baseRules,
          factors: definition.factors,
          grades: definition.grades,
          ticked,
          answers,
          grade,
        }
      : null;
    return {
      date: f.date,
      symbol: f.symbol.trim().toUpperCase() || rb.instrument,
      direction: f.direction,
      session: f.session ?? "",
      // The legacy fields are carried through untouched; the form no longer asks for them.
      setup: trade?.setup ?? "",
      htf: trade?.htf ?? "",
      entryModel: trade?.entryModel ?? "",
      riskPct: f.skipped ? 0 : (risk ?? 0),
      plannedRiskPct: f.skipped ? null : j.allowed,
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
      flags: f.skipped ? [] : j.flags,
      flagNote: j.flags.length ? f.flagNote.trim() : "",
      skipped: f.skipped,
      hypotheticalR: f.skipped ? parseNum(f.hypotheticalR) : null,
      // Costs are kept as they were; editing a trade by hand must not erase them.
      costPct: trade?.costPct ?? null,
      boxSize,
      pnlUsd: f.skipped ? null : pnl,
      news: f.news,
      notes: f.notes,
      screenshot: f.screenshot.trim(),
      rulebookVersion: version,
      // The prices a trade from before 2.0 was logged with stay exactly as they were.
      boxHigh: trade?.boxHigh ?? null,
      boxLow: trade?.boxLow ?? null,
      sweepExtreme: trade?.sweepExtreme ?? null,
      sweepDepth,
      took15mSwing: f.took15mSwing,
      htfReasonType: f.htfReasonType,
      poiTests: f.poiTests,
      levelSweep: f.levelSweep,
      deskAgreed: f.deskAgreed,
      entryType: f.entryType,
      entryPrice: trade?.entryPrice ?? null,
      stopPrice: trade?.stopPrice ?? null,
      targetPrice: trade?.targetPrice ?? null,
      lots: trade?.lots ?? null,
      riskUsd,
      atr: f.atr,
      mssBeyond: f.mssBeyond,
      exitTime: exitStamp,
      exitPrice: trade?.exitPrice ?? null,
      exitReason: f.exitReason,
      earlyStopMove: f.earlyStopMove,
      releaseAtBe: held.length ? f.releaseAtBe : null,
      mfePrice: trade?.mfePrice ?? null,
      maePrice: trade?.maePrice ?? null,
      targetBeforeStop: f.exitReason && EARLY_EXITS.includes(f.exitReason) ? f.targetBeforeStop : "",
      maxFavPrice: trade?.maxFavPrice ?? null,
      mfeR: parseNum(f.mfeR),
      maeR: parseNum(f.maeR),
      maxFavR: f.exitReason === "target" ? parseNum(f.maxFavR) : null,
      screenshotAfter: f.screenshotAfter.trim(),
    };
  }

  /*
   * Every flag is judged the way the server will judge it on save — against the whole
   * history and the check-ins — so what you see before saving is what is
   * recorded. A draft carries this trade's own id, so it never counts against itself.
   */
  const judgement =
    !ruled || f.skipped
      ? { flags: [] as TradeFlag[], allowed: 0, ruled: false }
      : judgeDraft(
          {
            ...toInput({ flags: [], allowed: 0 }),
            id: trade?.id ?? "draft",
            createdAt: trade?.createdAt ?? "9999",
            updatedAt: "",
          },
          { trades, checkins, rulebookOf },
        );
  const flags = judgement.flags;
  const allowed = ruled ? judgement.allowed : Math.min(gRisk ?? L.maxRiskPct, budget.remaining, L.maxRiskPct);

  async function save() {
    setError(null);
    if (ruled && !f.skipped) {
      if (result && !result.complete) {
        setStep("setup");
        return setError(`Grade the setup first — still to answer: ${result.missingFactors.map((x) => x.name).join(", ")}`);
      }
    }
    setSaving(true);
    try {
      const input = toInput(judgement);
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

  const doneToday = takenEarlier >= rb.maxTradesPerDay;
  const setupCheck = definition && (
    <SetupCheck
      definition={definition}
      ticked={f.checklist}
      answers={answers}
      auto={autoStates}
      autoAnswers={autoAnswers}
      fill={fill}
      displacement={
        dispF && ruled
          ? {
              mssBeyond: f.mssBeyond,
              atr: f.atr,
              onChange: (patch) => setF((p) => ({ ...p, ...patch })),
            }
          : undefined
      }
      side={step === "setup"}
      onToggle={(id) =>
        setF((p) => ({
          ...p,
          checklist: p.checklist.includes(id) ? p.checklist.filter((x) => x !== id) : [...p.checklist, id],
        }))
      }
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
  const gradePanel = result && (
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
      halfRisk={halfRisk}
      doneToday={doneToday}
    />
  );

  /** Date, time and direction: what the automatic rules and the Compass read. */
  const whenAndWhich = (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Field label={`Entry · ${DESK_LABEL}`}>
        <input type="datetime-local" className="field" value={f.date} onChange={(e) => set("date", e.target.value)} required />
      </Field>
      <Field label="Direction">
        <ToneToggle
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

  if (step === "setup" && !trade && definition) {
    return (
      <GlossaryContext.Provider value={rb.glossary}>
        <Modal open={open} onClose={onClose} width="max-w-7xl">
          {/*
            Three parts, all in view at once: the title, the rules and factors side by side,
            and the grade with the buttons. Only a very short window ever needs to scroll.
          */}
          <div className="flex max-h-[calc(100vh-3rem)] flex-col">
            <div className="shrink-0 space-y-4 px-10 pb-4 pt-6">
              <StepHeader step={1} title="Grade the setup">
                The desk checks what it can; you answer the rest. The grade decides what you may risk.
              </StepHeader>
              <div className="mx-auto max-w-2xl">{whenAndWhich}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-10 pb-5">{setupCheck}</div>

            {error && <p className="shrink-0 px-10 pb-2 text-center text-[13px] text-down">{error}</p>}
            <div className="shrink-0 space-y-3 border-t bg-raised px-10 pb-5 pt-4">
              {gradePanel}
              <div className="flex items-center justify-center gap-3">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={result?.complete && allowed > 0 ? "accent" : "primary"}
                  disabled={!result?.complete}
                  title={result?.complete ? undefined : "Answer every grade factor first"}
                  onClick={() => {
                    setError(null);
                    // Start the size at what is allowed; you can still change it.
                    if (allowed > 0 && !f.riskPct) set("riskPct", String(allowed));
                    setStep("form");
                  }}
                >
                  {grade
                    ? card && !card.traded
                      ? `Grade ${grade} · not tradable — log it anyway`
                      : `Grade ${grade}${allowed > 0 ? ` · ${allowed}%` : ""} — log the trade`
                    : "Continue"}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      </GlossaryContext.Provider>
    );
  }

  /* ── Step 2: the trade ─────────────────────────────────────────────── */

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
        text:
          card && !card.traded
            ? `${grade} is not tradable — the rules say not to take it.`
            : `${grade} is not tradable today — the check-in says ${verdict === "sit-out" ? "sit out" : "A+ only"}.`,
      };
    }
    if (fl === "during_day_off" && halfRisk && !dayOff) {
      return {
        text: `Half-risk week: ${allowed}% is the most this trade may risk.`,
        fix: (
          <button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => set("riskPct", String(allowed))}>
            use {allowed}%
          </button>
        ),
      };
    }
    return { text: `${FLAG_LABEL[fl]}.` };
  });

  const summary = definition ? answerSummary(definition, answers) : "";
  const title = trade ? "Edit trade" : "Log the trade";
  const outsideWindow = !inEntryWindow(time, rb.entryWindows);
  const tradable = tradableToday(card, verdict);

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
          {/* ── Header: the title and the setup it was graded as ─────────── */}
          <header className="shrink-0 border-b px-7 pb-4 pt-5">
            <div className="flex items-center justify-between">
              <div>
                {!trade && <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Step 2 of 2</p>}
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
                  <span className="text-[14px] font-medium">
                    {rb.name} · rulebook v{version}
                  </span>
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
                  <Card
                    index={0}
                    title={
                      snapshot?.rulebookVersion
                        ? `Setup — as graded under rulebook v${snapshot.rulebookVersion}`
                        : snapshot
                          ? `Setup — as graded against ${snapshot.strategyName || "the old strategy"} then`
                          : "Setup"
                    }
                  >
                    <div className="space-y-4">
                      {setupCheck}
                      {gradePanel}
                    </div>
                  </Card>
                )}

                <Card index={1} title="The trade">
                  {whenAndWhich}
                  <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <Field label="Session">
                      <ToneToggle
                        allowNone
                        value={f.session}
                        onChange={(v) => setF((p) => ({ ...p, session: v, sessionTouched: true }))}
                        options={SESSIONS.map((x) => ({ value: x, label: x, colour: "var(--color-ink)" }))}
                      />
                    </Field>
                    <Field label="Symbol">
                      <input className="field uppercase" value={f.symbol} onChange={(e) => set("symbol", e.target.value)} required />
                    </Field>
                  </div>
                  {ruled && outsideWindow && (
                    <p className="mt-3 text-[12px] font-medium text-down">
                      {time} is outside the entry window ({values.windows}).
                    </p>
                  )}
                  {!definition && (
                    <div className="mt-4">
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
                </Card>

                <Card index={2} title="Setup">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Field label="Box size">
                      <NumberInput value={f.boxSize} onChange={(v) => set("boxSize", v)} placeholder="high − low" suffix="$" />
                    </Field>
                    <Field label="Sweep depth">
                      <NumberInput value={f.sweepDepth} onChange={(v) => set("sweepDepth", v)} placeholder="beyond the edge" suffix="$" />
                      {sweepDepth != null && <p className="anim-fade mt-1 text-[11px] text-faint">{depthHint(sweepDepth, rb)}</p>}
                    </Field>
                    <Field label="Took a 15m swing">
                      <YesNo value={f.took15mSwing} onChange={(v) => set("took15mSwing", v)} />
                    </Field>
                    <Field label="Level sweep">
                      <YesNo value={f.levelSweep} onChange={(v) => set("levelSweep", v)} />
                    </Field>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-6 gap-y-4">
                    <Field label="HTF reason">
                      <Segmented
                        size="sm"
                        allowNone
                        value={f.htfReasonType || null}
                        onChange={(v) => set("htfReasonType", v ?? "")}
                        options={HTF_REASON_TYPES.map((x) => ({ value: x, label: x }))}
                      />
                    </Field>
                    <Field label="POI">
                      <Segmented
                        size="sm"
                        allowNone
                        value={f.poiTests || null}
                        onChange={(v) => set("poiTests", v ?? "")}
                        options={POI_TESTS}
                      />
                    </Field>
                    <Field label={deskFromLean && !trade ? "Desk agreed · from today's briefing" : "Desk agreed"}>
                      <Segmented
                        size="sm"
                        allowNone
                        value={f.deskAgreed || null}
                        onChange={(v) => setF((p) => ({ ...p, deskAgreed: v ?? "", deskTouched: true }))}
                        options={DESK_AGREED}
                      />
                    </Field>
                  </div>
                </Card>

                <Card index={3} title="Risk and result">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Field label="Risk">
                      <NumberInput
                        value={f.riskPct}
                        onChange={(v) => set("riskPct", v)}
                        placeholder={String(allowed || L.maxRiskPct)}
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
                  <p className="mt-2 text-[11px] text-faint">
                    {riskUsd != null && (
                      <>
                        <span className="num text-soft">{fmtUsd(riskUsd)}</span> at risk of {fmtUsd(balanceBefore)} ·{" "}
                      </>
                    )}
                    The broker's dollar result, costs already in it; the % and R are worked out for you. Leave it empty while
                    the trade is open.
                  </p>
                  <div className="mt-4">
                    <Field label="Entry type">
                      <Segmented
                        size="sm"
                        allowNone
                        value={f.entryType || null}
                        onChange={(v) => set("entryType", v ?? "")}
                        options={[
                          { value: "market", label: "Market" },
                          { value: "limit", label: "Limit" },
                        ]}
                      />
                    </Field>
                  </div>
                </Card>

                <Card index={4} title="Exit">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
                    <Field label={`Exit time · ${DESK_LABEL}`}>
                      <input type="time" className="field num" value={f.exitTime} onChange={(e) => set("exitTime", e.target.value)} />
                    </Field>
                    <Field label="Exit reason">
                      <Segmented
                        size="sm"
                        allowNone
                        value={f.exitReason || null}
                        onChange={(v) => set("exitReason", v ?? "")}
                        options={EXIT_REASONS}
                      />
                    </Field>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label={`Stop moved before ${values.trailAfter} of the way?`}>
                      <YesNo value={f.earlyStopMove} onChange={(v) => set("earlyStopMove", v)} />
                    </Field>
                    {held.length > 0 && (
                      <Field label={`Stop at breakeven or better through ${held[0].currency} ${held[0].title}?`}>
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
                  <p className="mt-2 text-[11px] text-faint">In R from your stop: how far it went your way and against you before the exit. They feed the Exit lab.</p>
                </Card>

                <Card index={5} title="Review">
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
                    {ruled && !flags.length && !f.skipped && (
                      <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-subtle px-3.5 py-2 text-[12px] text-soft">
                        <span>
                          ✓ No rule broken · allowed {allowed}%{grade && gRisk != null && tradable ? ` — ${grade} ${gRisk}%` : ""} · day{" "}
                          {+budget.remaining.toFixed(2)}% · week {+weekB.remaining.toFixed(2)}% left
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
                        <p className="px-1 text-[11px] text-faint">
                          Saved either way — a broken rule is recorded, and the rest of the day is off.
                        </p>
                        <input
                          className="field anim-rise text-[13px]"
                          placeholder={`Why? (optional) — saved with the flag${flags.length > 1 ? "s" : ""}`}
                          value={f.flagNote}
                          onChange={(e) => set("flagNote", e.target.value)}
                        />
                      </>
                    )}
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

                <Side index={3} title={`Rulebook v${version ?? doc.version}`}>
                  <RulebookHint rb={rb} values={values} day={day} />
                </Side>

                <Side index={4} title="Notes" grow>
                  <textarea
                    className="field min-h-[132px] flex-1 resize-none text-[13px]"
                    placeholder="Why did you take it? What did you see? What would you do differently?"
                    value={f.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                  <input
                    className="field mt-3 text-[13px]"
                    placeholder="Chart before (TradingView snapshot URL)"
                    value={f.screenshot}
                    onChange={(e) => set("screenshot", e.target.value)}
                  />
                  <input
                    className="field mt-2 text-[13px]"
                    placeholder="Chart after"
                    value={f.screenshotAfter}
                    onChange={(e) => set("screenshotAfter", e.target.value)}
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
              <Button type="button" variant="ghost" onClick={() => setStep("setup")}>
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
    </GlossaryContext.Provider>
  );
}

/** Where a sweep's depth sits against the Compass reference. */
function depthHint(depth: number, rb: Rulebook) {
  if (depth <= rb.sweep.p70) return `within $${rb.sweep.p70}, like ~70% of sweeps`;
  if (depth <= rb.sweep.p85) return `within $${rb.sweep.p85}, like ~85%`;
  if (depth <= rb.sweep.p95) return `deep — beyond $${rb.sweep.p85}`;
  return `very deep — beyond $${rb.sweep.p95}`;
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <ToneToggle
      allowNone
      value={value}
      onChange={onChange}
      options={[
        { value: true, label: "Yes", colour: "var(--color-ink)" },
        { value: false, label: "No", colour: "var(--color-ink)" },
      ]}
    />
  );
}

/** The day's frame from the rulebook: windows, time stop, target and Compass. */
function RulebookHint({
  rb,
  values,
  day,
}: {
  rb: Rulebook;
  values: Record<string, string | null>;
  day: string;
}) {
  return (
    <div className="space-y-1.5 text-[12px]">
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
      {autoFactor(rb, "compass") && (
        <p className="text-soft">
          <span className="text-faint">Compass today </span>
          <span className="num">
            long {compassFor(rb, day, "long") ?? "—"}% · short {compassFor(rb, day, "short") ?? "—"}%
          </span>
        </p>
      )}
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


const StepHeader = ({ step, title, children }: { step: number; title: string; children: ReactNode }) => (
  <header className="text-center">
    <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Step {step} of 2</p>
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

