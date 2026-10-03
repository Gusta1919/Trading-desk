/**
 * The editors for the rulebook's grading: base rules, grade factors (choice and number,
 * with their cuts) and the grade ladder. They were the strategy form's; the rulebook
 * reuses them as they were, so the way a rule is written never changed.
 */
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { gradeRequirements, rangeLabel } from "@/lib/grading";
import {
  AUTO_RULES,
  GRADES,
  type AutoRule,
  type BaseRule,
  type ChoiceFactor,
  type Definition,
  type Factor,
  type Grade,
  type GradeCard,
  type NumberFactor,
} from "@/lib/types";
import { GRADE_COLOUR, GradeBadge } from "./GradeBadge";
import { DecimalInput, Segmented, cx, stagger } from "./ui";

const GRADE_OPTIONS = GRADES.map((g) => ({ value: g, label: g }));

export const newId = () => crypto.randomUUID().slice(0, 8);

const AUTO_RULE_LABEL: Record<AutoRule, string> = {
  "daily-budget": "budget left, no trade yet",
  news: "news rules",
};

/** Moves item i one place up or down. */
const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/* ── Base rules ──────────────────────────────────────────────────────── */

export function BaseRulesEditor({ value, onChange }: { value: BaseRule[]; onChange: (v: BaseRule[]) => void }) {
  const edit = (i: number, patch: Partial<BaseRule>) =>
    onChange(value.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-small text-faint">
          No base rules yet. Add the conditions that must be true for any trade — one missing rule
          makes the setup a C.
        </p>
      )}
      {/* One rule per card: the rule itself gets the full width, its hint and who answers it sit under it. */}
      {value.map((r, i) => (
        <div key={r.id} className="space-y-2 rounded-xl border bg-surface/30 px-2.5 py-2.5">
          <div className="flex items-center gap-2">
            <Reorder onUp={() => onChange(move(value, i, -1))} onDown={() => onChange(move(value, i, 1))} first={i === 0} last={i === value.length - 1} />
            <span className="num w-5 shrink-0 text-right text-small text-faint">{i + 1}</span>
            <input
              aria-label={`Rule ${i + 1}`}
              className="field min-w-0 flex-1 font-medium"
              placeholder="e.g. Price swept the Asia range before London"
              value={r.text}
              onChange={(e) => edit(i, { text: e.target.value })}
            />
            <RemoveButton onClick={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-[3.25rem]">
            <input
              aria-label={`Rule ${i + 1} hint`}
              className="field min-w-[10rem] flex-1 text-small"
              placeholder="hint (optional)"
              value={r.hint}
              onChange={(e) => edit(i, { hint: e.target.value })}
            />
            <select
              aria-label={`Who answers rule ${i + 1}`}
              className="field w-48 shrink-0 text-small"
              value={r.auto ?? ""}
              onChange={(e) => {
                const v = e.target.value as AutoRule | "";
                edit(i, { auto: AUTO_RULES.includes(v as AutoRule) ? (v as AutoRule) : undefined });
              }}
              title="Who answers this rule"
            >
              <option value="">Ticked by hand</option>
              {AUTO_RULES.map((a) => (
                <option key={a} value={a}>
                  Auto: {AUTO_RULE_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
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

export function FactorsEditor({ value, onChange }: { value: Factor[]; onChange: (v: Factor[]) => void }) {
  const replace = (i: number, next: Factor) => onChange(value.map((x, k) => (k === i ? next : x)));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-small text-faint">
          No factors yet. A factor is a question you answer on every trade — "HTF reason
          timeframe", "Conviction" — where each answer decides how high the grade may go.
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
              className="field max-w-xs text-small"
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
          <span className="text-small text-faint">caps at</span>
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
        <span className="text-small text-faint">Unit</span>
        <input
          className="field w-24 text-small"
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
              <span className="num w-32 text-body font-medium">{rangeLabel(factor, i)}</span>
              <span className="text-small text-faint">caps at</span>
              <Segmented size="sm" value={cap} onChange={(v) => v && setCap(i, v)} options={GRADE_OPTIONS} />
            </div>
            {i > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-l-2 border-dashed border-line py-1 pl-4 text-small text-faint">
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

export function GradeLadder({
  grades,
  definition,
  onChange,
}: {
  grades: GradeCard[];
  definition: Pick<Definition, "baseRules" | "factors">;
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
            style={{ borderColor: `color-mix(in oklab, ${colour} 30%, transparent)`, ...stagger(gi, 90) }}
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
              className="field min-h-[96px] resize-none text-small leading-relaxed [field-sizing:content]"
              placeholder="What this grade feels like, and why it gets this risk."
              value={card.description}
              onChange={(e) => edit(card.grade, { description: e.target.value })}
            />
            <div className="border-t pt-3 text-small">
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
    <p className="mb-1 eyebrow">{title}</p>
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
  <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-small text-faint hover:text-ink">
    <Plus size={13} /> {children}
  </button>
);

