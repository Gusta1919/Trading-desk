import { ArrowDown, ArrowUp, Copy, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { definitionErrors, gradeRequirements, rangeLabel } from "@/lib/grading";
import { duplicateStrategy, emptyStrategy, newId, normalizeGrades } from "@/lib/strategyTemplate";
import { DESK_LABEL } from "@/lib/tz";
import {
  GRADES,
  SESSIONS,
  inOrder,
  type BaseRule,
  type ChoiceFactor,
  type Factor,
  type Grade,
  type GradeCard,
  type NumberFactor,
  type Strategy,
  type StrategyInput,
} from "@/lib/types";
import { GRADE_COLOUR, GradeBadge } from "./GradeBadge";
import { Button, Chips, DecimalInput, Modal, RangeSlider, Segmented, cx, stagger } from "./ui";

const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: g }));

const toForm = (s: Strategy | StrategyInput | null): StrategyInput => {
  if (!s) return emptyStrategy();
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = s as Strategy;
  return { ...structuredClone(rest), grades: normalizeGrades(rest.grades) } as StrategyInput;
};

const clean = (f: StrategyInput): StrategyInput => ({
  ...f,
  name: f.name.trim(),
  sessions: inOrder(f.sessions, SESSIONS),
  baseRules: f.baseRules.map((r) => ({ ...r, text: r.text.trim(), hint: r.hint.trim() })),
  factors: f.factors.map((x) =>
    x.kind === "choice"
      ? { ...x, name: x.name.trim(), options: x.options.map((o) => ({ ...o, label: o.label.trim() })) }
      : { ...x, name: x.name.trim() },
  ),
  boxLabel: f.boxLabel.trim(),
  boxUnit: f.boxUnit.trim(),
});

/** Moves item i one place up or down. */
const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function StrategyForm({
  open,
  strategy,
  draft = null,
  onClose,
  onSaved,
  onDuplicate,
}: {
  open: boolean;
  /** The strategy being edited, or null for a new one. */
  strategy: Strategy | null;
  /** A new strategy's starting point — a duplicate — instead of the empty template. */
  draft?: StrategyInput | null;
  onClose: () => void;
  /** Called with the saved strategy, so callers can select it straight away. */
  onSaved: (s: Strategy) => void;
  /** Offered while editing: start a new strategy from this one. */
  onDuplicate?: (copy: StrategyInput) => void;
}) {
  const [f, setF] = useState<StrategyInput>(() => toForm(strategy ?? draft));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(toForm(strategy ?? draft));
    setError(null);
    setConfirmDelete(false);
  }, [open, strategy, draft]);

  const set = <K extends keyof StrategyInput>(k: K, v: StrategyInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const problems = useMemo(() => {
    const list = definitionErrors(f);
    if (!f.name.trim()) list.unshift("The strategy needs a name");
    return list;
  }, [f]);

  async function save() {
    if (problems.length) return;
    setSaving(true);
    setError(null);
    try {
      const input = clean(f);
      const saved = strategy
        ? await api.updateStrategy(strategy.id, input)
        : await api.createStrategy(input);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!strategy) return;
    if (!confirmDelete) return setConfirmDelete(true);
    await api.removeStrategy(strategy.id);
    onSaved(strategy);
    onClose();
  }

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
      >
        <header className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-[15px] font-semibold">
            {strategy ? "Edit strategy" : draft ? "New strategy — from a copy" : "New strategy"}
          </h2>
          <button type="button" onClick={onClose} className="text-faint hover:text-ink">
            <X size={18} />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-x-10 gap-y-8 px-8 py-7 lg:grid-cols-2">
          <Section title="What it is">
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Name">
                <input
                  className="field"
                  placeholder="e.g. London sweep"
                  value={f.name}
                  onChange={(e) => set("name", e.target.value)}
                  autoFocus
                  required
                />
              </Field>
              <Field label="Instrument">
                <input
                  className="field uppercase"
                  placeholder="XAUUSD"
                  value={f.instrument}
                  onChange={(e) => set("instrument", e.target.value)}
                />
              </Field>
            </div>
            <Field label="How it works">
              <textarea
                className="field min-h-[90px] resize-y"
                placeholder="The idea in your own words: what the market has to do, and why that gives you an edge."
                value={f.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="When you may trade it">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <Field label="Sessions you trade it in">
                <Chips options={SESSIONS} value={f.sessions} onChange={(v) => set("sessions", v)} />
              </Field>
              <Field label={`Hours · ${DESK_LABEL}`}>
                <div className="num flex items-center gap-2">
                  <input
                    type="time"
                    className="field w-32"
                    value={f.hoursFrom}
                    onChange={(e) => set("hoursFrom", e.target.value)}
                  />
                  <span className="text-faint">to</span>
                  <input
                    type="time"
                    className="field w-32"
                    value={f.hoursTo}
                    onChange={(e) => set("hoursTo", e.target.value)}
                  />
                </div>
              </Field>
            </div>
            <Field label="Idea is invalidated when">
              <input
                className="field"
                placeholder="e.g. a 5m MSS in the opposite direction"
                value={f.invalidation}
                onChange={(e) => set("invalidation", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="The box this setup is measured against">
            <Field label="What you call it">
              <input
                className="field"
                placeholder="e.g. Asia range — leave empty if this strategy has no box"
                value={f.boxLabel}
                onChange={(e) => set("boxLabel", e.target.value)}
              />
            </Field>
            {f.boxLabel.trim() && (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <Field label="Measured in">
                  <input
                    className="field w-32"
                    placeholder="points"
                    value={f.boxUnit}
                    onChange={(e) => set("boxUnit", e.target.value)}
                  />
                </Field>
                <Field label="Tradeable size, from">
                  <DecimalInput className="w-28" value={f.boxMin} onChange={(v) => set("boxMin", v)} placeholder="—" />
                </Field>
                <Field label="to">
                  <DecimalInput className="w-28" value={f.boxMax} onChange={(v) => set("boxMax", v)} placeholder="—" />
                </Field>
                <p className="max-w-md text-[12px] text-faint">
                  Leave the range empty until you have data. Every trade records its box size, and
                  the Compare tab will show which sizes actually pay.
                </p>
              </div>
            )}
          </Section>

          <Section title="Targets">
            <Field label="Planned R:R — the range you aim for">
              <RangeSlider
                min={0.5}
                max={10}
                step={0.25}
                from={f.rrFrom ?? 2}
                to={f.rrTo ?? 3}
                onChange={(from, to) => setF((p) => ({ ...p, rrFrom: from, rrTo: to }))}
                format={(v) => `${v}R`}
              />
            </Field>
          </Section>

          <Section
            title="Base rules — every one must hold, or the setup is a C"
            className="lg:col-span-2"
          >
            <BaseRulesEditor value={f.baseRules} onChange={(v) => set("baseRules", v)} />
          </Section>

          <Section
            title="Grade factors — each answer caps the best grade the setup can reach"
            className="lg:col-span-2"
          >
            <FactorsEditor value={f.factors} onChange={(v) => set("factors", v)} />
            <p className="text-[12px] text-faint">
              The final grade is the lowest cap across every base rule and every answer — one weak
              answer is enough to pull a setup down a rung.
            </p>
          </Section>

          <Section title="Grade ladder" className="lg:col-span-2">
            <GradeLadder
              grades={f.grades}
              definition={f}
              onChange={(v) => set("grades", v)}
            />
          </Section>
        </div>

        {problems.length > 0 && (
          <div className="mx-8 mb-4 rounded-xl bg-warn/[0.08] px-4 py-3 text-[12px] text-warn">
            <p className="font-medium">Fix before saving:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <footer className="flex items-center gap-2 border-t px-6 py-4">
          {strategy && (
            <Button type="button" variant="danger" onClick={remove}>
              {confirmDelete ? "Click again to delete" : "Delete"}
            </Button>
          )}
          {strategy && onDuplicate && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onDuplicate(duplicateStrategy(clean(f)))}
              title="Start a new strategy from this one"
            >
              <Copy size={14} /> Duplicate
            </Button>
          )}
          {error && <span className="text-[13px] text-down">{error}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || problems.length > 0}>
              {strategy ? "Save" : "Add strategy"}
            </Button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}

/* ── Base rules ──────────────────────────────────────────────────────── */

function BaseRulesEditor({ value, onChange }: { value: BaseRule[]; onChange: (v: BaseRule[]) => void }) {
  const edit = (i: number, patch: Partial<BaseRule>) =>
    onChange(value.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-[12px] text-faint">
          No base rules yet. Add the conditions that must be true for any trade on this strategy —
          one missing rule makes the setup a C.
        </p>
      )}
      {value.map((r, i) => (
        <div key={r.id} className="flex items-center gap-2">
          <Reorder onUp={() => onChange(move(value, i, -1))} onDown={() => onChange(move(value, i, 1))} first={i === 0} last={i === value.length - 1} />
          <span className="num w-5 text-right text-[12px] text-faint">{i + 1}</span>
          <input
            className="field"
            placeholder="e.g. Price swept the Asia range before London"
            value={r.text}
            onChange={(e) => edit(i, { text: e.target.value })}
          />
          <input
            className="field w-56 text-[12px]"
            placeholder="hint (optional)"
            value={r.hint}
            onChange={(e) => edit(i, { hint: e.target.value })}
          />
          <select
            className="field w-44 text-[12px]"
            value={r.auto ?? ""}
            onChange={(e) =>
              edit(i, { auto: e.target.value === "daily-budget" ? "daily-budget" : undefined })
            }
            title="Who answers this rule"
          >
            <option value="">Ticked by hand</option>
            <option value="daily-budget">Auto: daily budget left</option>
          </select>
          <RemoveButton onClick={() => onChange(value.filter((_, k) => k !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...value, { id: newId(), text: "", hint: "" }])}>Add rule</AddButton>
    </div>
  );
}

/* ── Grade factors ───────────────────────────────────────────────────── */

const newChoice = (): ChoiceFactor => ({
  id: newId(),
  name: "",
  hint: "",
  kind: "choice",
  options: [
    { id: newId(), label: "", cap: "A+" },
    { id: newId(), label: "", cap: "A" },
  ],
});

const newNumber = (): NumberFactor => ({
  id: newId(),
  name: "",
  hint: "",
  kind: "number",
  unit: "",
  cuts: [{ value: 50, lowerGetsIt: false }],
  caps: ["C", "A+"],
});

function FactorsEditor({ value, onChange }: { value: Factor[]; onChange: (v: Factor[]) => void }) {
  const replace = (i: number, next: Factor) => onChange(value.map((x, k) => (k === i ? next : x)));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-[12px] text-faint">
          No factors yet. A factor is a question you answer on every trade — "Entry model", "HTF
          reason", "Probability" — where each answer decides how high the grade may go.
        </p>
      )}
      {value.map((factor, i) => (
        <div key={factor.id} className="rounded-xl border px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Reorder onUp={() => onChange(move(value, i, -1))} onDown={() => onChange(move(value, i, 1))} first={i === 0} last={i === value.length - 1} />
            <input
              className="field max-w-xs font-medium"
              placeholder="Factor name, e.g. Entry model"
              value={factor.name}
              onChange={(e) => replace(i, { ...factor, name: e.target.value })}
            />
            <input
              className="field max-w-xs text-[12px]"
              placeholder="hint (optional)"
              value={factor.hint}
              onChange={(e) => replace(i, { ...factor, hint: e.target.value })}
            />
            <Segmented
              size="sm"
              value={factor.kind}
              onChange={(k) => {
                if (!k || k === factor.kind) return;
                const fresh = k === "choice" ? newChoice() : newNumber();
                replace(i, { ...fresh, id: factor.id, name: factor.name, hint: factor.hint });
              }}
              options={[
                { value: "choice", label: "Choice" },
                { value: "number", label: "Number" },
              ]}
            />
            <span className="ml-auto" />
            <RemoveButton onClick={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
          <div className="mt-3 pl-9">
            {factor.kind === "choice" ? (
              <ChoiceEditor factor={factor} onChange={(next) => replace(i, next)} />
            ) : (
              <NumberEditor factor={factor} onChange={(next) => replace(i, next)} />
            )}
          </div>
        </div>
      ))}
      <div className="flex gap-4">
        <AddButton onClick={() => onChange([...value, newChoice()])}>Add choice factor</AddButton>
        <AddButton onClick={() => onChange([...value, newNumber()])}>Add number factor</AddButton>
      </div>
    </div>
  );
}

function ChoiceEditor({ factor, onChange }: { factor: ChoiceFactor; onChange: (f: ChoiceFactor) => void }) {
  const edit = (i: number, patch: Partial<ChoiceFactor["options"][number]>) =>
    onChange({ ...factor, options: factor.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });

  return (
    <div className="space-y-2">
      {factor.options.map((o, i) => (
        <div key={o.id} className="flex items-center gap-3">
          <input
            className="field max-w-sm"
            placeholder={i === 0 ? "e.g. MSS 5m" : "another answer…"}
            value={o.label}
            onChange={(e) => edit(i, { label: e.target.value })}
          />
          <span className="text-[12px] text-faint">caps at</span>
          <Segmented size="sm" value={o.cap} onChange={(v) => v && edit(i, { cap: v })} options={GRADE_OPTIONS} />
          <RemoveButton
            onClick={() => onChange({ ...factor, options: factor.options.filter((_, k) => k !== i) })}
          />
        </div>
      ))}
      <AddButton
        onClick={() =>
          onChange({ ...factor, options: [...factor.options, { id: newId(), label: "", cap: "A" }] })
        }
      >
        Add option
      </AddButton>
    </div>
  );
}

/**
 * Ranges are defined by the boundaries between them, lowest first. Each boundary says
 * which side owns its exact value — so ranges can never leave a gap or overlap.
 */
function NumberEditor({ factor, onChange }: { factor: NumberFactor; onChange: (f: NumberFactor) => void }) {
  const setCut = (i: number, patch: Partial<NumberFactor["cuts"][number]>) =>
    onChange({ ...factor, cuts: factor.cuts.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const setCap = (i: number, cap: Grade) =>
    onChange({ ...factor, caps: factor.caps.map((c, k) => (k === i ? cap : c)) });
  const removeCut = (i: number) =>
    onChange({
      ...factor,
      cuts: factor.cuts.filter((_, k) => k !== i),
      // The two ranges either side of the boundary merge; the upper one's grade survives.
      caps: factor.caps.filter((_, k) => k !== i),
    });
  const addCut = () => {
    const top = factor.cuts[factor.cuts.length - 1]?.value ?? 0;
    onChange({
      ...factor,
      cuts: [...factor.cuts, { value: top + 5, lowerGetsIt: true }],
      caps: [...factor.caps, factor.caps[factor.caps.length - 1] ?? "A+"],
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-faint">Unit</span>
        <input
          className="field w-24 text-[12px]"
          placeholder="%"
          value={factor.unit}
          onChange={(e) => onChange({ ...factor, unit: e.target.value })}
        />
      </div>
      {/* Highest range on top, like reading a ladder. */}
      {factor.caps
        .map((cap, i) => ({ cap, i }))
        .reverse()
        .map(({ cap, i }) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="num w-32 text-[13px] font-medium">{rangeLabel(factor, i)}</span>
              <span className="text-[12px] text-faint">caps at</span>
              <Segmented size="sm" value={cap} onChange={(v) => v && setCap(i, v)} options={GRADE_OPTIONS} />
            </div>
            {i > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-l-2 border-dashed border-line py-1 pl-4 text-[12px] text-faint">
                boundary
                <DecimalInput
                  className="w-24"
                  value={factor.cuts[i - 1].value}
                  onChange={(v) => v != null && setCut(i - 1, { value: v })}
                />
                exactly {factor.cuts[i - 1].value} counts as
                <Segmented
                  size="sm"
                  value={factor.cuts[i - 1].lowerGetsIt}
                  onChange={(v) => v != null && setCut(i - 1, { lowerGetsIt: Boolean(v) })}
                  options={[
                    { value: true, label: "lower range" },
                    { value: false, label: "upper range" },
                  ]}
                />
                {factor.cuts.length > 1 && (
                  <button type="button" onClick={() => removeCut(i - 1)} className="hover:text-down">
                    remove boundary
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      <AddButton onClick={addCut}>Add boundary above</AddButton>
    </div>
  );
}

/* ── The ladder ──────────────────────────────────────────────────────── */

function GradeLadder({
  grades,
  definition,
  onChange,
}: {
  grades: GradeCard[];
  definition: Pick<StrategyInput, "baseRules" | "factors">;
  onChange: (v: GradeCard[]) => void;
}) {
  const edit = (g: Grade, patch: Partial<GradeCard>) =>
    onChange(grades.map((c) => (c.grade === g ? { ...c, ...patch } : c)));

  return (
    // Each card spans four shared rows, so the "Needs" lists line up across the ladder.
    <div className="grid gap-x-3 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
      {grades.map((card, gi) => {
        const req = gradeRequirements(definition, card.grade);
        const colour = GRADE_COLOUR[card.grade];
        return (
          <div
            key={card.grade}
            className={cx(
              "anim-rise row-span-4 grid grid-rows-subgrid gap-3 rounded-xl border px-4 py-4",
              !card.traded && "[&>*]:opacity-75",
            )}
            style={{ boxShadow: `inset 0 2px 0 ${colour}`, ...stagger(gi, 90) }}
          >
            <div className="flex items-center justify-between">
              <GradeBadge grade={card.grade} size="lg" />
              <Segmented
                size="sm"
                value={card.traded}
                onChange={(v) => v != null && edit(card.grade, { traded: Boolean(v) })}
                options={[
                  { value: true, label: "Trade" },
                  { value: false, label: "Don't" },
                ]}
              />
            </div>
            <DecimalInput
              value={card.traded ? card.riskPct : 0}
              disabled={!card.traded}
              onChange={(v) => edit(card.grade, { riskPct: v ?? 0 })}
              suffix="% risk"
            />
            <textarea
              className="field min-h-[96px] resize-none text-[12px] leading-relaxed [field-sizing:content]"
              placeholder="What this grade feels like, and why it gets this risk."
              value={card.description}
              onChange={(e) => edit(card.grade, { description: e.target.value })}
            />
            <div className="border-t pt-3 text-[12px]">
              {card.grade === "A+" ? (
                <Requirements title="Needs" items={req.requires} empty="Nothing yet — add rules or factors" />
              ) : (
                <Requirements
                  title="Lands here when"
                  items={req.cappedHere}
                  empty="No answer caps here — only reachable via other rungs"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const Requirements = ({ title, items, empty }: { title: string; items: string[]; empty: string }) => (
  <div>
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</p>
    {items.length ? (
      <ul className="space-y-0.5 text-soft">
        {items.map((x) => (
          <li key={x} className="flex gap-1.5">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
            {x}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-faint">{empty}</p>
    )}
  </div>
);

/* ── Small pieces ────────────────────────────────────────────────────── */

const Reorder = ({ onUp, onDown, first, last }: { onUp: () => void; onDown: () => void; first: boolean; last: boolean }) => (
  <div className="flex shrink-0 flex-col text-faint">
    <button type="button" onClick={onUp} disabled={first} className="hover:text-ink disabled:opacity-20" title="Move up">
      <ArrowUp size={12} />
    </button>
    <button type="button" onClick={onDown} disabled={last} className="hover:text-ink disabled:opacity-20" title="Move down">
      <ArrowDown size={12} />
    </button>
  </div>
);

const RemoveButton = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="shrink-0 text-faint hover:text-down" title="Remove">
    <X size={14} />
  </button>
);

const AddButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-[12px] text-faint hover:text-ink">
    <Plus size={13} /> {children}
  </button>
);

function Section({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cx("space-y-4", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cx(label.length > 30 && "w-full")}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
