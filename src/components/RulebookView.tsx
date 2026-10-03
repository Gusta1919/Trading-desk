import { ArrowDown, Check, History, Pencil, Plus, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type OpenItem } from "@/lib/api";
import { answersCappingAt, factorCap, withUnit } from "@/lib/grading";
import { hypothesisResults } from "@/lib/hypotheses";
import { fmtR } from "@/lib/format";
import {
  WEEKDAY_KEYS,
  WEEKDAY_NAMES,
  autoFactor,
  fill,
  inline,
  longDate,
  nextVersion,
  parseBody,
  rulebookErrors,
  skipDayLines,
  tokenValues,
  type Block,
  type Hypothesis,
  type NewsPair,
  type Rulebook,
  type Section,
} from "@/lib/rulebook";
import type { RulebookState } from "@/lib/useRulebook";
import { NEWS_CATEGORIES, NEWS_CURRENCIES, categoryLabel } from "@/lib/newsRules";
import { deskDay } from "@/lib/tz";
import type { Grade, Trade } from "@/lib/types";
import { GRADE_COLOUR, GradeBadge } from "./GradeBadge";
import { BaseRulesEditor, FactorsEditor, GradeLadder } from "./RuleEditors";
import { Button, Chips, DecimalInput, Modal, Segmented, cx, stagger } from "./ui";

/** What the drawn tables need beyond the document itself. */
interface Ctx {
  doc: Rulebook;
  values: Record<string, string | null>;
  trades: Trade[];
  state: RulebookState;
  openItems: OpenItem[];
  toggleItem: (id: string, done: boolean) => void;
  readOnly: boolean;
  view: (version: string) => void;
}
const RulebookContext = createContext<Ctx | null>(null);
const useCtx = () => useContext(RulebookContext)!;

/** Sections whose text is all there is to them — and the one that can't be edited. */
const NOT_EDITABLE = new Set(["changelog"]);

/**
 * The rulebook, in the desk's own style: the decision flow first, then every section,
 * with every number read live from the values the logic uses. Each section has an edit
 * mode; saving any change asks for a reason and writes a new version.
 */
export function RulebookView({
  state,
  trades,
  onSaved,
}: {
  state: RulebookState;
  trades: Trade[];
  /** After a new version is saved: everything graded against the rules is re-read. */
  onSaved: () => void;
}) {
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);

  useEffect(() => {
    api.openItems().then(setOpenItems).catch(() => {});
  }, []);

  const current = state.current;
  const doc = viewing ? state.rulebookOf(viewing) : state.doc;
  const values = useMemo(() => tokenValues(doc), [doc]);
  const version = viewing ?? current?.version ?? doc.version;
  const readOnly = viewing != null && viewing !== current?.version;

  const toggleItem = (id: string, done: boolean) => {
    setOpenItems((list) => list.map((x) => (x.id === id ? { ...x, done } : x)));
    api.setOpenItem(id, done).catch(() => api.openItems().then(setOpenItems));
  };

  const ctx: Ctx = {
    doc,
    values,
    trades,
    state,
    openItems,
    toggleItem,
    readOnly,
    view: (v) => setViewing(v === current?.version ? null : v),
  };
  const section = doc.sections.find((s) => s.id === editing) ?? null;

  return (
    <RulebookContext.Provider value={ctx}>
      <div className="grid items-start gap-6 xl:grid-cols-[230px_minmax(0,1fr)]">
        {/* ── Section navigation ──────────────────────────────────────── */}
        <nav className="anim-rise card sticky top-24 hidden space-y-0.5 px-3 py-4 xl:block" aria-label="Rulebook sections">
          <a href="#rb-flow" className="block rounded-lg px-2.5 py-1.5 text-[12px] text-soft hover:bg-subtle hover:text-ink">
            Decision flow
          </a>
          {doc.sections.map((s, i) => (
            <a
              key={s.id}
              href={`#rb-${s.id}`}
              className="flex gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-soft hover:bg-subtle hover:text-ink"
            >
              <span className="num w-5 text-faint">{i + 1}</span>
              {s.title}
            </a>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {/* ── The rulebook's own header: version, last change, older versions ── */}
          <header className="anim-rise card flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Rulebook</p>
              <h2 className="text-[18px] font-semibold tracking-tight">
                {doc.name} <span className="num text-soft">v{version}</span>
              </h2>
              {current && !readOnly && (
                <p className="truncate text-[12px] text-faint">
                  Last change {longDate(deskDay(new Date(current.createdAt)))} · {current.reason}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-[12px] text-soft">
              <History size={14} className="text-faint" />
              <select
                className="field w-36 py-1.5 text-[12px]"
                value={version}
                onChange={(e) => ctx.view(e.target.value)}
                title="Read an older version"
              >
                {state.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                    {v.version === current?.version ? " · in force" : ""}
                  </option>
                ))}
              </select>
            </label>
          </header>

          {readOnly && (
            <div className="anim-rise card flex flex-wrap items-center gap-3 border-warn/30 px-5 py-3 text-[13px] text-warn">
              Reading v{viewing}, read-only — trades graded under it keep exactly these rules.
              <button onClick={() => setViewing(null)} className="text-soft underline underline-offset-2 hover:text-ink">
                Back to v{current?.version}
              </button>
            </div>
          )}

          <section id="rb-flow" className="anim-rise card scroll-mt-24 px-6 py-5" style={stagger(1, 80)}>
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Decision flow</h3>
            <DecisionFlow />
          </section>

          {doc.sections.map((s, i) => (
            <section
              key={s.id}
              id={`rb-${s.id}`}
              className="anim-rise card scroll-mt-24 px-6 py-5"
              style={stagger(i + 2, 60)}
            >
              <header className="mb-3 flex items-baseline gap-3">
                <span className="num text-[12px] text-faint">§{i + 1}</span>
                <h3 className="text-[15px] font-semibold">{s.title}</h3>
                {!readOnly && !NOT_EDITABLE.has(s.id) && (
                  <button
                    onClick={() => setEditing(s.id)}
                    className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-faint hover:bg-subtle hover:text-ink"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                )}
              </header>
              <Body body={s.body} />
            </section>
          ))}
        </div>
      </div>

      {section && current && (
        <SectionEditor
          key={section.id}
          section={section}
          doc={state.doc}
          version={current.version}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await state.reload();
            onSaved();
          }}
        />
      )}
    </RulebookContext.Provider>
  );
}

/* ── Rendering the text ──────────────────────────────────────────────── */

/** One line of text with its tokens filled and its **bold** bold. */
function Line({ text }: { text: string }) {
  const { values } = useCtx();
  return (
    <>
      {inline(fill(text, values)).map((p, i) =>
        p.bold ? (
          <b key={i} className="font-semibold text-ink">
            {p.text}
          </b>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Body({ body }: { body: string }) {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-soft">
      {parseBody(body).map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case "p":
      return (
        <p>
          <Line text={b.text} />
        </p>
      );
    case "h":
      return (
        <h4 className="pt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
          <Line text={b.text} />
        </h4>
      );
    case "note":
      return (
        <aside className="relative overflow-hidden rounded-xl bg-subtle py-3 pl-5 pr-4 text-[12.5px]">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-accent-2" />
          <Line text={b.text} />
        </aside>
      );
    case "list":
      return <List ordered={b.ordered} items={b.items} />;
    case "table":
      return (
        <Table head={b.head.map((h, i) => <Line key={i} text={h} />)} rows={b.rows.map((r) => r.map((c, i) => <Line key={i} text={c} />))} />
      );
    case "gen":
      return <Generated id={b.id} />;
  }
}

function List({ ordered, items }: { ordered: boolean; items: { text: string; children: string[] }[] }) {
  return (
    <ol className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          {ordered ? (
            <span className="num w-4 shrink-0 text-right text-[12px] text-faint">{i + 1}</span>
          ) : (
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" />
          )}
          <div className="min-w-0">
            <Line text={it.text} />
            {it.children.length > 0 && (
              <ul className="mt-1 space-y-1">
                {it.children.map((c, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="mt-[9px] h-px w-2 shrink-0 bg-faint" />
                    <span>
                      <Line text={c} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Table({ head, rows, faded }: { head: ReactNode[]; rows: ReactNode[][]; faded?: boolean[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-b bg-subtle">
            {head.map((h, i) => (
              <th key={i} className="px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className={cx("align-top", faded?.[i] && "opacity-50")}>
              {r.map((c, j) => (
                <td key={j} className={cx("px-3.5 py-2", j === 0 ? "text-ink" : "text-soft")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── The tables drawn from values ────────────────────────────────────── */

function Generated({ id }: { id: string }) {
  const { doc, values } = useCtx();
  switch (id) {
    case "flow":
      return null; // drawn once, at the top
    case "skip-days":
      return <List ordered={false} items={skipDayLines(doc.news).map((text) => ({ text, children: [] }))} />;
    case "base-rules":
      return (
        <List
          ordered
          items={doc.baseRules.map((r) => ({ text: `${r.text}${r.auto ? " — checked by the desk" : ""}`, children: [] }))}
        />
      );
    case "factors":
      return <FactorsTable />;
    case "compass":
      return <CompassTable />;
    case "ladder":
      return (
        <Table
          head={["Grade", "Live", "Backtest (Forex Tester)"]}
          rows={doc.grades.map((c) => [
            <GradeBadge key="g" grade={c.grade} size="sm" />,
            c.traded ? <span className="num text-ink">{c.riskPct}%</span> : <span className="text-down">Not tradable</span>,
            c.backtestRiskPct != null ? <span className="num">{c.backtestRiskPct}%</span> : "No trade",
          ])}
        />
      );
    case "guidance":
      return <List ordered={false} items={doc.guidance.map((text) => ({ text, children: [] }))} />;
    case "hypotheses":
      return <Hypotheses />;
    case "open-items":
      return <OpenItems />;
    case "glossary":
      return <Table head={["Term", "Meaning"]} rows={doc.glossary.map((g) => [g.term, fill(g.meaning, values)])} />;
    case "changelog":
      return <Changelog />;
  }
  return <p className="text-down">[[{id}]] is not a table the desk can draw.</p>;
}

/** Every factor: what lands an answer on each rung. */
function FactorsTable() {
  const { doc } = useCtx();
  const rungs: Grade[] = ["A+", "A", "B", "C"];
  return (
    <Table
      head={["Factor", "A+", "A", "B", "C (no trade)"]}
      rows={doc.factors.map((f) => [
        <span key="n">
          {f.name}
          {f.auto && <span className="ml-1.5 text-[10px] uppercase tracking-[0.08em] text-faint">auto</span>}
        </span>,
        ...rungs.map((g) => {
          const here = answersCappingAt(f, g);
          return (
            <span key={g} className={cx(f.kind === "number" && "num")}>
              {here.map((h) => (f.kind === "number" ? withUnit(h, f.unit) : h)).join(" / ")}
            </span>
          );
        }),
      ])}
    />
  );
}

/** The frozen snapshot, with each value's cap — a coarse threshold, so the cap is the point. */
function CompassTable() {
  const { doc } = useCtx();
  const f = autoFactor(doc, "compass");
  const cell = (v: number) => {
    const cap = f ? factorCap(f, v) : null;
    return (
      <span className="num">
        {v.toFixed(1)}%
        {cap && cap !== "A+" && <span style={{ color: GRADE_COLOUR[cap] }}>: max {cap}</span>}
      </span>
    );
  };
  return (
    <Table
      head={["Weekday", "Short (high swept first)", "Long (low swept first)"]}
      rows={WEEKDAY_KEYS.map((d) => [WEEKDAY_NAMES[d], cell(doc.compass.days[d].short), cell(doc.compass.days[d].long)])}
    />
  );
}

function Hypotheses() {
  const { doc, values, trades } = useCtx();
  const results = useMemo(() => hypothesisResults(doc, trades), [doc, trades]);
  return (
    <div className="divide-y rounded-xl border">
      {results.map((r, i) => (
        <div key={r.hypothesis.id} className="anim-rise grid gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" style={stagger(i, 40)}>
          <div className="min-w-0">
            <p className="text-[13px] text-ink">
              <Line text={r.hypothesis.text} />
            </p>
            <p className="text-[11px] text-faint">
              Logged as {r.hypothesis.loggedAs} · decide after {r.hypothesis.approx ? "~" : ""}
              {fill(r.hypothesis.decideAfter, values)} {r.hypothesis.unit}
            </p>
            {r.status !== "outside" && (
              <div className="mt-2 flex items-center gap-2">
                <span className="h-1.5 w-32 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${r.progress * 100}%`, backgroundColor: r.status === "ready" ? "var(--color-up)" : "var(--color-soft)" }}
                  />
                </span>
                <span className="num text-[11px] text-faint">
                  {r.n}/{r.target ?? "—"}
                </span>
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]",
                    r.status === "ready" ? "bg-up/15 text-up" : "bg-subtle text-faint",
                  )}
                >
                  {r.status === "ready" ? "Ready to decide" : "Collecting"}
                </span>
              </div>
            )}
          </div>
          <div className="text-[12px]">
            {r.status === "outside" ? (
              <p className="text-faint">Measured in the Forex Tester backtest, outside the desk.</p>
            ) : r.sides.length ? (
              <ul className="space-y-0.5">
                {r.sides.map((s) => (
                  <li key={s.label} className={cx("num flex justify-between gap-3", s.faded && "opacity-40")}>
                    <span className="text-soft">{s.label}</span>
                    <span>
                      <span className={s.avgR == null ? "text-faint" : s.avgR >= 0 ? "text-up" : "text-down"}>{fmtR(s.avgR)}</span>
                      <span className="text-faint"> · {s.n}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-faint">{r.note ?? "No trades logged with this yet."}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OpenItems() {
  const { openItems, toggleItem, readOnly } = useCtx();
  if (!openItems.length) return <p className="text-faint">Nothing open.</p>;
  return (
    <ul className="space-y-1">
      {openItems.map((it) => (
        <li key={it.id}>
          <button
            disabled={readOnly}
            onClick={() => toggleItem(it.id, !it.done)}
            className="group flex w-full gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-subtle disabled:hover:bg-transparent"
          >
            <span
              className={cx(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                it.done ? "border-up/60 bg-up/15 text-up" : "border-faint text-transparent group-hover:border-soft",
              )}
            >
              <Check size={12} strokeWidth={3} />
            </span>
            <span className={cx("text-[13px]", it.done ? "text-faint line-through" : "text-soft")}>{it.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Changelog() {
  const { state, doc, view } = useCtx();
  const rows = [
    ...state.versions.map((v) => ({ version: v.version, date: deskDay(new Date(v.createdAt)), change: v.reason, stored: true })),
    ...doc.history.map((h) => ({ ...h, stored: false })),
  ];
  return (
    <Table
      head={["Version", "Date", "Change"]}
      rows={rows.map((r) => [
        r.stored ? (
          <button key="v" onClick={() => view(r.version)} className="num underline decoration-faint underline-offset-2 hover:text-accent-2">
            {r.version}
          </button>
        ) : (
          <span key="v" className="num" title="From before the rulebook lived in the desk">
            {r.version}
          </span>
        ),
        <span key="d" className="num whitespace-nowrap">
          {longDate(r.date)}
        </span>,
        r.change,
      ])}
    />
  );
}

/* ── The decision flow ───────────────────────────────────────────────── */

function DecisionFlow() {
  const { doc } = useCtx();
  const steps: { label: string; text: string; colour: string }[] = [
    { label: "Enter", text: doc.flow.enter, colour: "var(--color-up)" },
    { label: "Manage", text: doc.flow.manage, colour: "var(--color-accent-2)" },
    { label: "Exit", text: doc.flow.exit, colour: "var(--color-soft)" },
  ];
  return (
    <div className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {doc.flow.gates.map((g, i) => (
          <li
            key={i}
            className="anim-rise relative flex flex-col gap-2 rounded-xl border bg-surface/40 px-3.5 py-3 text-[12.5px] leading-snug text-soft"
            style={stagger(i, 70)}
          >
            <span className="num flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold text-ink">
              {i + 1}
            </span>
            <span>
              <Line text={g} />
            </span>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-2 text-[12px] text-faint">
        <span className="h-px flex-1 bg-line" />
        <span>
          Any <b className="font-semibold text-down">no</b> means no trade today. All seven yes:
        </span>
        <ArrowDown size={12} />
        <span className="h-px flex-1 bg-line" />
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className="anim-rise relative overflow-hidden rounded-xl border bg-surface/40 py-3 pl-5 pr-4 text-[12.5px] leading-snug text-soft"
            style={stagger(doc.flow.gates.length + i, 70)}
          >
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: s.colour }} />
            <b className="font-semibold text-ink">{s.label}</b> <Line text={s.text} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Editing a section ───────────────────────────────────────────────── */

/**
 * One section's values and text in one place. Saving writes the whole rulebook as the
 * next version, so a change here can never leave the text and the logic out of step.
 */
function SectionEditor({
  section,
  doc,
  version,
  onClose,
  onSaved,
}: {
  section: Section;
  doc: Rulebook;
  version: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Rulebook>(() => structuredClone(doc));
  const [reason, setReason] = useState("");
  const [bump, setBump] = useState<"minor" | "major">("minor");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values = useMemo(() => tokenValues(draft), [draft]);
  const problems = useMemo(() => {
    try {
      return rulebookErrors(draft);
    } catch {
      return ["The rulebook is malformed"];
    }
  }, [draft]);
  const changed = JSON.stringify(draft) !== JSON.stringify(doc);
  const mine = draft.sections.find((s) => s.id === section.id)!;
  const setSection = (patch: Partial<Section>) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.id === section.id ? { ...s, ...patch } : s)) }));
  const patch = (p: Partial<Rulebook>) => setDraft((d) => ({ ...d, ...p }));

  async function save() {
    if (!reason.trim()) return setError("Add a one-line reason — it goes in the changelog.");
    setSaving(true);
    setError(null);
    try {
      await api.saveRulebook(draft, reason.trim(), bump);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} width="max-w-6xl">
      <div className="flex max-h-[calc(100vh-3rem)] flex-col">
        <header className="flex shrink-0 items-center justify-between border-b px-7 pb-4 pt-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Edit the rulebook</p>
            <h2 className="text-[18px] font-semibold tracking-tight">{section.title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-faint hover:bg-subtle hover:text-ink">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-5">
              <ValuesEditor id={section.id} draft={draft} patch={patch} />
              <Card title="Text">
                <input className="field mb-3 font-medium" value={mine.title} onChange={(e) => setSection({ title: e.target.value })} />
                <textarea
                  className="field num min-h-[260px] resize-y text-[12.5px] leading-relaxed [field-sizing:content]"
                  value={mine.body}
                  onChange={(e) => setSection({ body: e.target.value })}
                />
                <p className="mt-2 text-[11px] text-faint">
                  ### heading · - bullet · 1. numbered · &gt; aside · | table | · **bold** · [[table drawn from values]] ·{" "}
                  {"{{token}}"} for any value — never type a number the values already hold.
                </p>
              </Card>
            </div>

            <aside className="space-y-4">
              <Card title="Before you change a rule">
                <ul className="space-y-1.5 text-[12px] text-soft">
                  {draft.guidance.map((g, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
                      {fill(g, values)}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Tokens">
                <div className="max-h-72 space-y-0.5 overflow-y-auto text-[11px]">
                  {Object.entries(values)
                    .filter(([k]) => !k.startsWith("ref:"))
                    .map(([k, v]) => (
                      <p key={k} className="num flex justify-between gap-2">
                        <span className="truncate text-faint">{`{{${k}}}`}</span>
                        <span className="truncate text-soft">{v}</span>
                      </p>
                    ))}
                </div>
              </Card>
            </aside>
          </div>
        </div>

        {problems.length > 0 && (
          <div className="mx-7 mb-3 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-[12px] text-warn">
            <p className="font-medium">Fix before saving:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {problems.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-raised px-7 py-4">
          <input
            className="field min-w-[280px] flex-1 text-[13px]"
            placeholder="Why? One line — it goes in the changelog"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changed && !problems.length && save()}
          />
          <Segmented
            size="sm"
            value={bump}
            onChange={(v) => v && setBump(v)}
            options={[
              { value: "minor", label: `v${nextVersion(version, "minor")}` },
              { value: "major", label: `v${nextVersion(version, "major")} · big change` },
            ]}
          />
          {error && <span className="text-[12px] text-down">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={save} disabled={saving || !changed || problems.length > 0}>
            <Check size={15} /> Save as v{nextVersion(version, bump)}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-surface/40 px-5 py-4">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  suffix,
  className = "w-28",
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  suffix?: string;
  className?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <DecimalInput className={className} value={value} onChange={(v) => v != null && onChange(v)} suffix={suffix} />
    </label>
  );
}

function Time({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="time" className="field num w-32" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-end gap-x-5 gap-y-3">{children}</div>;

/** The values a section owns — what the logic reads, and what its text's tokens show. */
function ValuesEditor({ id, draft: d, patch }: { id: string; draft: Rulebook; patch: (p: Partial<Rulebook>) => void }) {
  const l = d.limits;
  const limits = (p: Partial<Rulebook["limits"]>) => patch({ limits: { ...l, ...p } });
  switch (id) {
    case "overview":
      return (
        <>
          <Card title="When and what">
            <div className="space-y-4">
              <Row>
                <label className="block">
                  <span className="label">Instrument</span>
                  <input className="field w-32 uppercase" value={d.instrument} onChange={(e) => patch({ instrument: e.target.value.toUpperCase() })} />
                </label>
                <Num label="Ounces per lot" value={d.ozPerLot} onChange={(v) => patch({ ozPerLot: v })} />
                <Time label="Box from" value={d.box.from} onChange={(v) => patch({ box: { ...d.box, from: v } })} />
                <Time label="Box to" value={d.box.to} onChange={(v) => patch({ box: { ...d.box, to: v } })} />
              </Row>
              <WindowsEditor value={d.entryWindows} onChange={(v) => patch({ entryWindows: v })} />
              <Row>
                <Time label="Time stop" value={d.timeStop} onChange={(v) => patch({ timeStop: v })} />
                <Time label="Compass measured by" value={d.compassBy} onChange={(v) => patch({ compassBy: v })} />
                <Num label="Trades per day" value={d.maxTradesPerDay} onChange={(v) => patch({ maxTradesPerDay: Math.max(1, Math.round(v)) })} />
                <Num label="Planned R:R from" value={d.rr.from} onChange={(v) => patch({ rr: { ...d.rr, from: v } })} suffix="R" />
                <Num label="to" value={d.rr.to} onChange={(v) => patch({ rr: { ...d.rr, to: v } })} suffix="R" />
              </Row>
            </div>
          </Card>
          <Card title="Decision flow">
            <span className="label">The seven gates, one per line</span>
            <textarea
              className="field min-h-[160px] resize-y text-[12.5px] [field-sizing:content]"
              value={d.flow.gates.join("\n")}
              onChange={(e) => patch({ flow: { ...d.flow, gates: e.target.value.split("\n").filter((x) => x.trim()) } })}
            />
            {(["enter", "manage", "exit"] as const).map((k) => (
              <label key={k} className="mt-3 block">
                <span className="label capitalize">{k}</span>
                <input className="field text-[12.5px]" value={d.flow[k]} onChange={(e) => patch({ flow: { ...d.flow, [k]: e.target.value } })} />
              </label>
            ))}
          </Card>
        </>
      );
    case "prep":
      return (
        <Card title="Deadline">
          <Time label="Plan written by" value={d.planBy} onChange={(v) => patch({ planBy: v })} />
        </Card>
      );
    case "news":
      return <NewsEditor draft={d} patch={patch} />;
    case "setup":
      return (
        <Card title="Sweep depth reference (Compass)">
          <Row>
            <Num label="70% within" value={d.sweep.p70} onChange={(v) => patch({ sweep: { ...d.sweep, p70: v } })} suffix="$" />
            <Num label="85% within" value={d.sweep.p85} onChange={(v) => patch({ sweep: { ...d.sweep, p85: v } })} suffix="$" />
            <Num label="95% within" value={d.sweep.p95} onChange={(v) => patch({ sweep: { ...d.sweep, p95: v } })} suffix="$" />
          </Row>
        </Card>
      );
    case "entry":
      return (
        <Card title="Entry values">
          <Row>
            <Num label="Minimum R:R (net)" value={d.rr.min} onChange={(v) => patch({ rr: { ...d.rr, min: v } })} suffix=":1" />
            <Num label="Liquidity filter" value={d.liquidityR} onChange={(v) => patch({ liquidityR: v })} suffix="R" />
            <Num label="Limit order valid for" value={d.limitCandles} onChange={(v) => patch({ limitCandles: Math.max(1, Math.round(v)) })} suffix="candles" className="w-36" />
            <Num label="Set the minimum after" value={d.calibration.rr} onChange={(v) => patch({ calibration: { ...d.calibration, rr: v } })} suffix="trades" className="w-36" />
          </Row>
        </Card>
      );
    case "stop":
      return (
        <Card title="Target values">
          <Num label="Liquidity beyond the edge" value={d.liquidityR} onChange={(v) => patch({ liquidityR: v })} suffix="R" />
        </Card>
      );
    case "grading":
      return (
        <>
          <Card title="Base rules — every one must hold, or the setup is a C">
            <BaseRulesEditor value={d.baseRules} onChange={(v) => patch({ baseRules: v })} />
          </Card>
          <Card title="Grade factors — each answer caps the best grade">
            <FactorsEditor value={d.factors} onChange={(v) => patch({ factors: v })} />
          </Card>
          <Card title="Grade ladder">
            <GradeLadder grades={d.grades} definition={d} onChange={(v) => patch({ grades: v })} />
          </Card>
          <CompassEditor draft={d} patch={patch} />
          <Card title="Review points">
            <Row>
              <Num label="A+ may return to" value={d.aPlus.riskPct} onChange={(v) => patch({ aPlus: { ...d.aPlus, riskPct: v } })} suffix="%" />
              <Num label="after graded trades" value={d.aPlus.trades} onChange={(v) => patch({ aPlus: { ...d.aPlus, trades: v } })} className="w-28" />
              <Num label="if A+ beats A by" value={d.aPlus.edgeR} onChange={(v) => patch({ aPlus: { ...d.aPlus, edgeR: v } })} suffix="R" />
              <Num label="Calibrate displacement after" value={d.calibration.displacement} onChange={(v) => patch({ calibration: { ...d.calibration, displacement: v } })} suffix="trades" className="w-36" />
            </Row>
          </Card>
        </>
      );
    case "manage":
      return (
        <Card title="Management">
          <Num label="Hands off until" value={Number((d.trailAfter * 100).toFixed(2))} onChange={(v) => patch({ trailAfter: v / 100 })} suffix="% of the way" className="w-40" />
        </Card>
      );
    case "limits":
      return (
        <>
          <Card title="Your limits">
            <Row>
              <Num label="Max risk per trade" value={l.maxRiskPct} onChange={(v) => limits({ maxRiskPct: v })} suffix="%" />
              <Num label="Daily stop" value={l.dailyStopPct} onChange={(v) => limits({ dailyStopPct: v })} suffix="%" />
              <Num label="Weekly stop" value={l.weeklyStopPct} onChange={(v) => limits({ weeklyStopPct: v })} suffix="%" />
            </Row>
          </Card>
          <Card title="The firm and the accounts">
            <Row>
              <Num label="Firm daily loss" value={l.dailyLossPct} onChange={(v) => limits({ dailyLossPct: v })} suffix="%" />
              <Num label="Firm max loss" value={l.maxLossPct} onChange={(v) => limits({ maxLossPct: v })} suffix="%" />
              <Num label="Phase 1 target" value={l.phase1TargetPct} onChange={(v) => limits({ phase1TargetPct: v })} suffix="%" />
              <Num label="Phase 2 target" value={l.phase2TargetPct} onChange={(v) => limits({ phase2TargetPct: v })} suffix="%" />
            </Row>
            <div className="mt-4">
              <Row>
                <Num label="Start balance" value={l.startBalance} onChange={(v) => limits({ startBalance: v })} suffix="$" className="w-36" />
                <Num label="Opening balance" value={l.openingBalance} onChange={(v) => limits({ openingBalance: v })} suffix="$" className="w-36" />
                <Num label="Second account" value={l.secondAccount} onChange={(v) => limits({ secondAccount: v })} suffix="$" className="w-36" />
                <Num label="Go-live gate" value={d.goLiveTrades} onChange={(v) => patch({ goLiveTrades: v })} suffix="trades" className="w-36" />
              </Row>
            </div>
            <p className="mt-3 text-[11px] text-faint">The opening balance is where the journal's compounding starts; every % and R is re-derived from it.</p>
          </Card>
        </>
      );
    case "discipline":
      return (
        <Card title="Consequences">
          <Row>
            <Num label="Breaks in a week" value={d.consequences.breaks} onChange={(v) => patch({ consequences: { ...d.consequences, breaks: Math.max(1, Math.round(v)) } })} />
            <Num label="Next week's risk ×" value={d.consequences.factor} onChange={(v) => patch({ consequences: { ...d.consequences, factor: v } })} />
            <Num label="Days off after a limit break" value={d.consequences.daysOff} onChange={(v) => patch({ consequences: { ...d.consequences, daysOff: Math.max(0, Math.round(v)) } })} className="w-36" />
          </Row>
        </Card>
      );
    case "changes":
      return (
        <>
          <Card title="Guidance — one per line">
            <textarea
              className="field min-h-[110px] resize-y text-[12.5px] [field-sizing:content]"
              value={d.guidance.join("\n")}
              onChange={(e) => patch({ guidance: e.target.value.split("\n").filter((x) => x.trim()) })}
            />
            <div className="mt-3">
              <Row>
                <Num label="Evidence for riskier changes" value={d.calibration.evidence} onChange={(v) => patch({ calibration: { ...d.calibration, evidence: v } })} suffix="trades" className="w-36" />
                <Num label="Review provisional numbers from" value={d.calibration.reviewFrom} onChange={(v) => patch({ calibration: { ...d.calibration, reviewFrom: v } })} suffix="trades" className="w-36" />
                <Num label="to" value={d.calibration.reviewTo} onChange={(v) => patch({ calibration: { ...d.calibration, reviewTo: v } })} suffix="trades" className="w-36" />
              </Row>
            </div>
          </Card>
          <HypothesesEditor value={d.hypotheses} onChange={(v) => patch({ hypotheses: v })} />
        </>
      );
    case "glossary":
      return (
        <Card title="Glossary">
          <div className="space-y-2">
            {d.glossary.map((g, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="field w-48 text-[12.5px] font-medium"
                  value={g.term}
                  onChange={(e) => patch({ glossary: d.glossary.map((x, k) => (k === i ? { ...x, term: e.target.value } : x)) })}
                />
                <input
                  className="field text-[12.5px]"
                  value={g.meaning}
                  onChange={(e) => patch({ glossary: d.glossary.map((x, k) => (k === i ? { ...x, meaning: e.target.value } : x)) })}
                />
                <button onClick={() => patch({ glossary: d.glossary.filter((_, k) => k !== i) })} className="text-faint hover:text-down" title="Remove">
                  <X size={14} />
                </button>
              </div>
            ))}
            <AddButton onClick={() => patch({ glossary: [...d.glossary, { term: "", meaning: "" }] })}>Add term</AddButton>
          </div>
        </Card>
      );
  }
  return null;
}

function WindowsEditor({ value, onChange }: { value: Rulebook["entryWindows"]; onChange: (v: Rulebook["entryWindows"]) => void }) {
  return (
    <div>
      <span className="label">Entry windows</span>
      <div className="space-y-2">
        {value.map((w, i) => (
          <div key={i} className="num flex items-center gap-2">
            <input type="time" className="field w-32" value={w.from} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)))} />
            <span className="text-faint">to</span>
            <input type="time" className="field w-32" value={w.to} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)))} />
            {value.length > 1 && (
              <button onClick={() => onChange(value.filter((_, k) => k !== i))} className="text-faint hover:text-down" title="Remove">
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <AddButton onClick={() => onChange([...value, { from: "13:00", to: "14:00" }])}>Add window</AddButton>
      </div>
    </div>
  );
}

const CATEGORY_IDS = NEWS_CATEGORIES.filter((c) => c.id !== "holiday").map((c) => c.id);

function PairsEditor({ label, value, onChange }: { label: string; value: NewsPair[]; onChange: (v: NewsPair[]) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="space-y-2">
        {value.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <select className="field w-56 text-[12.5px]" value={p.category} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, category: e.target.value } : x)))}>
              {CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
            <select className="field num w-24 text-[12.5px]" value={p.currency} onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, currency: e.target.value } : x)))}>
              {NEWS_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button onClick={() => onChange(value.filter((_, k) => k !== i))} className="text-faint hover:text-down" title="Remove">
              <X size={14} />
            </button>
          </div>
        ))}
        <AddButton onClick={() => onChange([...value, { category: "rates", currency: "USD" }])}>Add</AddButton>
      </div>
    </div>
  );
}

function NewsEditor({ draft: d, patch }: { draft: Rulebook; patch: (p: Partial<Rulebook>) => void }) {
  const n = d.news;
  const set = (p: Partial<Rulebook["news"]>) => patch({ news: { ...n, ...p } });
  return (
    <Card title="News rules — only red releases count">
      <div className="grid gap-6 md:grid-cols-2">
        <PairsEditor label="Skip days: a red release of this kind" value={n.skip} onChange={(v) => set({ skip: v })} />
        <div className="space-y-4">
          <div>
            <span className="label">Skip days: bank holidays on</span>
            <Chips options={NEWS_CURRENCIES} value={n.holidayCurrencies} onChange={(v) => set({ holidayCurrencies: v })} />
          </div>
          <div>
            <span className="label">Skip days: a fixed range (MM-DD, inclusive)</span>
            <div className="num flex items-center gap-2">
              <input className="field w-24" value={n.skipRange?.from ?? ""} placeholder="12-22" onChange={(e) => set({ skipRange: e.target.value || n.skipRange?.to ? { from: e.target.value, to: n.skipRange?.to ?? "" } : null })} />
              <span className="text-faint">to</span>
              <input className="field w-24" value={n.skipRange?.to ?? ""} placeholder="01-02" onChange={(e) => set({ skipRange: { from: n.skipRange?.from ?? "", to: e.target.value } })} />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <span className="label">Release windows: every other red release on</span>
            <Chips options={NEWS_CURRENCIES} value={n.windowCurrencies} onChange={(v) => set({ windowCurrencies: v })} />
          </div>
          <Row>
            <Num label="Window from" value={n.beforeMin} onChange={(v) => set({ beforeMin: v })} suffix="min before" className="w-36" />
            <Num label="to" value={n.afterMin} onChange={(v) => set({ afterMin: v })} suffix="min after" className="w-36" />
          </Row>
        </div>
        <PairsEditor label="Release windows: also these" value={n.windowExtra} onChange={(v) => set({ windowExtra: v })} />
      </div>
    </Card>
  );
}

function CompassEditor({ draft: d, patch }: { draft: Rulebook; patch: (p: Partial<Rulebook>) => void }) {
  const c = d.compass;
  const set = (p: Partial<Rulebook["compass"]>) => patch({ compass: { ...c, ...p } });
  return (
    <Card title="Compass snapshot">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_auto_auto]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Weekday</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Short (high first)</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Long (low first)</span>
        {WEEKDAY_KEYS.map((w) => (
          <div key={w} className="contents">
            <span className="self-center text-[13px]">{WEEKDAY_NAMES[w]}</span>
            {(["short", "long"] as const).map((side) => (
              <DecimalInput
                key={side}
                className="w-28"
                value={c.days[w][side]}
                onChange={(v) => v != null && set({ days: { ...c.days, [w]: { ...c.days[w], [side]: v } } })}
                suffix="%"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Row>
          <label className="block">
            <span className="label">Frozen on</span>
            <input type="date" className="field num w-40" value={c.frozenOn} onChange={(e) => set({ frozenOn: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Source</span>
            <input className="field w-72 text-[12.5px]" value={c.source} onChange={(e) => set({ source: e.target.value })} />
          </label>
          <Num label="Sessions" value={c.sessions} onChange={(v) => set({ sessions: v })} />
          <Num label="Midpoint reached" value={c.midpointPct} onChange={(v) => set({ midpointPct: v })} suffix="%" />
          <Num label="Refresh after" value={c.refreshDays} onChange={(v) => set({ refreshDays: v })} suffix="days" />
        </Row>
      </div>
      <div className="mt-4">
        <Row>
          <Num label="All days short: hit" value={c.all.short.hit} onChange={(v) => set({ all: { ...c.all, short: { ...c.all.short, hit: v } } })} />
          <Num label="of" value={c.all.short.of} onChange={(v) => set({ all: { ...c.all, short: { ...c.all.short, of: v } } })} />
          <Num label="Long: hit" value={c.all.long.hit} onChange={(v) => set({ all: { ...c.all, long: { ...c.all.long, hit: v } } })} />
          <Num label="of" value={c.all.long.of} onChange={(v) => set({ all: { ...c.all, long: { ...c.all.long, of: v } } })} />
        </Row>
      </div>
      <p className="mt-3 text-[11px] text-faint">Changing the snapshot changes the Compass every new trade reads. Trades already logged keep theirs.</p>
    </Card>
  );
}

function HypothesesEditor({ value, onChange }: { value: Hypothesis[]; onChange: (v: Hypothesis[]) => void }) {
  const edit = (i: number, p: Partial<Hypothesis>) => onChange(value.map((h, k) => (k === i ? { ...h, ...p } : h)));
  return (
    <Card title="Hypotheses">
      <div className="space-y-2">
        {value.map((h, i) => (
          <div key={h.id} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_90px_120px]">
            <input className="field text-[12.5px]" value={h.text} onChange={(e) => edit(i, { text: e.target.value })} />
            <input className="field text-[12.5px]" value={h.loggedAs} onChange={(e) => edit(i, { loggedAs: e.target.value })} />
            <input className="field num text-[12.5px]" value={h.decideAfter} onChange={(e) => edit(i, { decideAfter: e.target.value })} />
            <input className="field text-[12.5px]" value={h.unit} onChange={(e) => edit(i, { unit: e.target.value })} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">What each hypothesis compares is built into the desk; here you change its wording and when to decide.</p>
    </Card>
  );
}

const AddButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="flex items-center gap-1.5 text-[12px] text-faint hover:text-ink">
    <Plus size={13} /> {children}
  </button>
);
