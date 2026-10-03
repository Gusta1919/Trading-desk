import {
  ArrowDown,
  ArrowRight,
  Award,
  Ban,
  Bold,
  BookOpen,
  Braces,
  CalendarClock,
  Check,
  ChevronDown,
  Crosshair,
  Heading2,
  ListChecks,
  ListOrdered,
  List as ListIcon,
  Pencil,
  Plus,
  ShieldAlert,
  Sunrise,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, type OpenItem } from "@/lib/api";
import { answersCappingAt, factorCap, withUnit } from "@/lib/grading";
import { hypothesisResults } from "@/lib/hypotheses";
import { fmtR } from "@/lib/format";
import {
  WEEKDAY_KEYS,
  WEEKDAY_NAMES,
  atLeast,
  autoFactor,
  fill,
  inline,
  longDate,
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
import { Button, Chips, DecimalInput, Modal, cx, stagger } from "./ui";

/** What the drawn tables need beyond the document itself. */
interface Ctx {
  doc: Rulebook;
  values: Record<string, string | null>;
  trades: Trade[];
  state: RulebookState;
  openItems: OpenItem[];
  toggleItem: (id: string, done: boolean) => void;
  /** True in the editor's live preview: nothing in it can be clicked into a change. */
  readOnly: boolean;
}
const RulebookContext = createContext<Ctx | null>(null);
const useCtx = () => useContext(RulebookContext)!;

/** Sections whose text is all there is to them — and the one that can't be edited. */
const NOT_EDITABLE = new Set(["changelog"]);

/**
 * Each rule section's colour and icon, so the page reads at a glance. The colour is
 * handed down as --sec: headings, bullets and the value chips inside take it up.
 */
const LOOK: Record<string, { colour: string; icon: LucideIcon }> = {
  glance: { colour: "var(--color-accent)", icon: Crosshair },
  flow: { colour: "var(--color-up)", icon: ListChecks },
  prep: { colour: "var(--color-cyan)", icon: Sunrise },
  news: { colour: "var(--color-warn)", icon: CalendarClock },
  trade: { colour: "var(--color-accent-2)", icon: Target },
  grading: { colour: "var(--color-low)", icon: Award },
  limits: { colour: "var(--color-down)", icon: ShieldAlert },
};
const PLAIN = { colour: "var(--color-soft)", icon: BookOpen };
const lookOf = (id: string) => LOOK[id] ?? PLAIN;

/** A colour at a strength, for tints and borders. */
const tint = (colour: string, pct: number) => `color-mix(in oklab, ${colour} ${pct}%, transparent)`;

/**
 * The rulebook, in the desk's own style: the rules first, each section in its own
 * colour, every number read live from the values the logic uses; the background
 * (hypotheses, glossary, changelog) in a Reference panel. There is one rulebook, the
 * one in force: each section edits in place, and every save is a line in the
 * changelog. (Underneath, each save is kept, so a trade is still judged by the rules
 * it was graded under — but that history is never shown or opened.)
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
  const [editing, setEditing] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [referenceOpen, setReferenceOpen] = useState(false);

  useEffect(() => {
    api.openItems().then(setOpenItems).catch(() => {});
  }, []);

  const current = state.current;
  const doc = state.doc;
  const values = useMemo(() => tokenValues(doc), [doc]);
  const rules = doc.sections.filter((s) => !s.reference);
  const reference = doc.sections.filter((s) => s.reference);

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
    readOnly: false,
  };
  const section = doc.sections.find((s) => s.id === editing) ?? null;
  const edit = (id: string) => (!NOT_EDITABLE.has(id) ? () => setEditing(id) : undefined);
  const showReference = () => {
    setReferenceOpen(true);
    requestAnimationFrame(() => document.getElementById("rb-reference")?.scrollIntoView({ behavior: "smooth" }));
  };

  return (
    <RulebookContext.Provider value={ctx}>
      <div className="grid items-start gap-6 xl:grid-cols-[210px_minmax(0,1fr)]">
        {/* ── Section navigation ──────────────────────────────────────── */}
        <nav className="anim-rise card sticky top-24 hidden space-y-0.5 px-3 py-4 xl:block" aria-label="Rulebook sections">
          {rules.map((s) => (
            <a
              key={s.id}
              href={`#rb-${s.id}`}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-soft transition-colors hover:bg-subtle hover:text-ink"
            >
              <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: lookOf(s.id).colour }} />
              {s.title}
            </a>
          ))}
          {reference.length > 0 && (
            <button
              onClick={showReference}
              className="mt-2 flex w-full items-center gap-2.5 rounded-lg border-t px-2.5 pb-1.5 pt-3 text-left text-[12.5px] text-faint transition-colors hover:text-ink"
            >
              <BookOpen size={12} />
              Reference
            </button>
          )}
        </nav>

        <div className="min-w-0 space-y-5">
          {/* ── The rulebook's own header: its name and the last change ── */}
          <header className="anim-rise card relative overflow-hidden px-6 py-4">
            <Glow colour="var(--color-accent)" />
            <div className="relative min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Rulebook</p>
              <h2 className="text-[20px] font-semibold tracking-tight">{doc.name}</h2>
              {current && (
                <p className="truncate text-[12px] text-faint">
                  Last change {longDate(deskDay(new Date(current.createdAt)))} · {current.reason}
                </p>
              )}
            </div>
          </header>

          {rules.map((s, i) => (
            <SectionCard key={s.id} section={s} index={i} onEdit={edit(s.id)} />
          ))}

          {reference.length > 0 && (
            <section id="rb-reference" className="anim-rise card scroll-mt-24 overflow-hidden" style={stagger(rules.length + 1, 70)}>
              <button
                onClick={() => setReferenceOpen((o) => !o)}
                aria-expanded={referenceOpen}
                className="flex w-full items-center gap-3 px-6 py-4 text-left transition-colors hover:bg-subtle"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-subtle text-soft">
                  <BookOpen size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">Reference</span>
                  <span className="block truncate text-[12px] text-faint">{reference.map((s) => s.title).join(" · ")}</span>
                </span>
                <ChevronDown size={16} className={cx("ml-auto shrink-0 text-faint transition-transform duration-300", referenceOpen && "rotate-180")} />
              </button>
              {referenceOpen && (
                <div className="anim-fade space-y-8 border-t px-6 py-6" style={{ "--sec": "var(--color-soft)" } as CSSProperties}>
                  {reference.map((s) => {
                    const onEdit = edit(s.id);
                    return (
                      <div key={s.id} id={`rb-${s.id}`} className="scroll-mt-24">
                        <header className="mb-3 flex items-baseline gap-3">
                          <h3 className="text-[14px] font-semibold">{s.title}</h3>
                          {onEdit && <EditButton onClick={onEdit} />}
                        </header>
                        <Body body={s.body} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {section && current && (
        <SectionEditor
          key={section.id}
          section={section}
          doc={state.doc}
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

/** A soft light in the card's corner, in the section's colour — the desk's mesh, up close. */
const Glow = ({ colour }: { colour: string }) => (
  <span
    aria-hidden
    className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full blur-3xl"
    style={{ background: tint(colour, 13) }}
  />
);

const EditButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-faint transition-colors hover:bg-subtle hover:text-ink"
  >
    <Pencil size={12} /> Edit
  </button>
);

function SectionCard({ section: s, index, onEdit }: { section: Section; index: number; onEdit?: () => void }) {
  const { colour, icon: Icon } = lookOf(s.id);
  return (
    <section
      id={`rb-${s.id}`}
      className="anim-rise card relative scroll-mt-24 overflow-hidden px-6 py-5"
      style={{ ...stagger(index + 1, 70), "--sec": colour } as CSSProperties}
    >
      <Glow colour={colour} />
      <header className="relative mb-4 flex items-center gap-3">
        <span
          className="anim-stamp flex size-8 shrink-0 items-center justify-center rounded-xl"
          style={{ color: colour, backgroundColor: tint(colour, 15), ...stagger(index + 3, 70) }}
        >
          <Icon size={16} />
        </span>
        <h3 className="text-[16px] font-semibold tracking-tight">{s.title}</h3>
        {onEdit && <EditButton onClick={onEdit} />}
      </header>
      <div className="relative">
        <Body body={s.body} />
      </div>
    </section>
  );
}

/* ── Rendering the text ──────────────────────────────────────────────── */

const TOKEN_PART = /(\{\{\s*[^}]+?\s*\}\})/;

/**
 * One line of text with its **bold** bold and its tokens filled. A value with a digit
 * in it (a time, a %, an R) is set as a small chip in the section's colour, so the
 * numbers stand out from the words around them.
 */
function Line({ text }: { text: string }) {
  const { values } = useCtx();
  const filled = (part: string, key: number) => {
    const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(part);
    const value = m ? values[m[1]] : null;
    if (value == null) return <Fragment key={key}>{part}</Fragment>;
    if (!/\d/.test(value)) return <Fragment key={key}>{value}</Fragment>;
    return (
      <span
        key={key}
        className="num whitespace-nowrap rounded-md px-1 py-px text-[0.94em] font-medium text-ink"
        style={{ backgroundColor: "color-mix(in oklab, var(--sec, var(--color-soft)) 16%, transparent)" }}
      >
        {value}
      </span>
    );
  };
  return (
    <>
      {inline(text).map((p, i) => {
        const parts = p.text.split(TOKEN_PART).filter(Boolean).map(filled);
        return p.bold ? (
          <b key={i} className="font-semibold text-ink">
            {parts}
          </b>
        ) : (
          <Fragment key={i}>{parts}</Fragment>
        );
      })}
    </>
  );
}

function Body({ body }: { body: string }) {
  return (
    <div className="space-y-3.5 text-[13.5px] leading-relaxed text-soft">
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
        <h4 className="pt-2 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--sec, var(--color-faint))" }}>
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
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          {ordered ? (
            <span
              className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ color: "var(--sec, var(--color-soft))", backgroundColor: "color-mix(in oklab, var(--sec, var(--color-soft)) 15%, transparent)" }}
            >
              {i + 1}
            </span>
          ) : (
            <span className="mt-[9px] size-1.5 shrink-0 rounded-full" style={{ backgroundColor: "var(--sec, var(--color-faint))" }} />
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

/* ── The tables and pictures drawn from values ───────────────────────── */

function Generated({ id }: { id: string }) {
  const { doc, values } = useCtx();
  switch (id) {
    case "flow":
      return <DecisionFlow />;
    case "day":
      return <DayTimeline />;
    case "skip-days":
      return <SkipDays />;
    case "release-window":
      return <ReleaseWindow />;
    case "base-rules":
      return <BaseRules />;
    case "factors":
      return <FactorsTable />;
    case "compass":
      return <CompassTable />;
    case "ladder":
      return <Ladder />;
    case "consequences":
      return <ConsequenceLadder />;
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

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** The trading day, drawn: the box, the entry windows, the pause between them and the time stop. */
function DayTimeline() {
  const { doc } = useCtx();
  type Kind = "box" | "entry" | "pause" | "manage";
  const parts: { from: string; to: string; kind: Kind }[] = [{ from: doc.box.from, to: doc.box.to, kind: "box" }];
  let at = doc.box.to;
  for (const w of doc.entryWindows) {
    if (minutes(w.from) > minutes(at)) parts.push({ from: at, to: w.from, kind: "pause" });
    parts.push({ from: w.from, to: w.to, kind: "entry" });
    at = w.to;
  }
  if (minutes(doc.timeStop) > minutes(at)) parts.push({ from: at, to: doc.timeStop, kind: "manage" });

  const start = minutes(doc.box.from);
  const end = Math.max(minutes(doc.timeStop), minutes(at)) + 30;
  const x = (t: string) => ((minutes(t) - start) / (end - start)) * 100;
  const style: Record<Kind, { label: string; colour: string; fill: string }> = {
    box: { label: "Box", colour: "var(--color-accent)", fill: tint("var(--color-accent)", 30) },
    entry: { label: "Entries", colour: "var(--color-up)", fill: tint("var(--color-up)", 26) },
    pause: {
      label: "No entries",
      colour: "var(--color-down)",
      fill: `repeating-linear-gradient(135deg, ${tint("var(--color-down)", 22)} 0 6px, ${tint("var(--color-down)", 9)} 6px 12px)`,
    },
    manage: { label: "Manage only", colour: "var(--color-soft)", fill: tint("var(--color-soft)", 14) },
  };
  const ticks = [...new Set(parts.flatMap((p) => [p.from, p.to]))];

  return (
    <div className="pb-1 pt-1">
      <div className="relative">
        <div className="flex h-11 overflow-hidden rounded-xl border">
          {parts.map((p, i) => (
            <div
              key={i}
              className="anim-grow flex min-w-0 items-center justify-center px-1"
              style={{ width: `${x(p.to) - x(p.from)}%`, background: style[p.kind].fill, ...stagger(i, 160) }}
              title={`${style[p.kind].label} ${p.from}–${p.to}`}
            >
              <span className="truncate text-[11px] font-semibold" style={{ color: style[p.kind].colour }}>
                {style[p.kind].label}
              </span>
            </div>
          ))}
          <div className="flex-1" />
        </div>
        {/* The time stop: everything is flat here. */}
        <div className="anim-fade absolute -bottom-1 -top-1 w-0.5 rounded-full bg-down" style={{ left: `${x(doc.timeStop)}%`, ...stagger(parts.length, 160) }} />
        <span
          className="anim-fade num absolute top-1/2 -translate-y-1/2 pl-2 text-[11px] font-semibold text-down"
          style={{ left: `${x(doc.timeStop)}%`, ...stagger(parts.length, 160) }}
        >
          Flat
        </span>
      </div>
      <div className="relative mt-1.5 h-4">
        {ticks.map((t, i) => (
          <span
            key={t}
            className={cx("num absolute -translate-x-1/2 text-[10.5px] text-faint", i > 0 && i < ticks.length - 1 && "max-sm:hidden")}
            style={{ left: `${x(t)}%` }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The skip days, as stop signs; the long names keep only their first sentence. */
function SkipDays() {
  const { doc } = useCtx();
  return (
    <ul className="flex flex-wrap gap-2">
      {skipDayLines(doc.news).map((t, i) => (
        <li
          key={t}
          title={t}
          className="anim-pop flex items-center gap-1.5 rounded-full border border-down/25 bg-down/10 px-3 py-1 text-[12.5px] text-ink"
          style={stagger(i, 50)}
        >
          <Ban size={12} className="text-down" />
          {t.split(". ")[0]}
        </li>
      ))}
    </ul>
  );
}

/** The release window around one release, drawn to scale with a floor so the short side shows. */
function ReleaseWindow() {
  const { doc } = useCtx();
  const { beforeMin, afterMin } = doc.news;
  const total = beforeMin + afterMin || 1;
  const before = Math.max((beforeMin / total) * 100, 16);
  const stripes = `repeating-linear-gradient(135deg, ${tint("var(--color-warn)", 24)} 0 6px, ${tint("var(--color-warn)", 10)} 6px 12px)`;
  return (
    <div className="max-w-xl">
      <div className="relative flex h-9 overflow-hidden rounded-xl border">
        <div className="anim-grow flex items-center justify-center" style={{ width: `${before}%`, background: stripes }}>
          <span className="num text-[11px] font-semibold text-warn">−{beforeMin} min</span>
        </div>
        <div className="anim-grow flex flex-1 items-center justify-center" style={{ background: stripes, ...stagger(1, 160) }}>
          <span className="num text-[11px] font-semibold text-warn">+{afterMin} min · no new entries</span>
        </div>
        <span className="absolute inset-y-0 w-0.5 bg-warn" style={{ left: `${before}%` }} />
      </div>
      <p className="num mt-1 text-[10.5px] text-faint" style={{ paddingLeft: `calc(${before}% - 1.6rem)` }}>
        release
      </p>
    </div>
  );
}

/** Every base rule as a checklist line; the ones the desk checks itself are marked. */
function BaseRules() {
  const { doc } = useCtx();
  return (
    <ol className="grid gap-2 md:grid-cols-2">
      {doc.baseRules.map((r, i) => (
        <li key={r.id} className="anim-rise flex gap-3 rounded-xl border bg-surface/40 px-3.5 py-2.5" style={stagger(i, 45)}>
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-up/15 text-up">
            <Check size={12} strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1 text-[13px] leading-snug">
            <span className="block text-ink">
              <Line text={r.text} />
            </span>
            {r.hint && (
              <span className="mt-0.5 block text-[11.5px] text-faint">
                <Line text={r.hint} />
              </span>
            )}
          </span>
          {r.auto && (
            <span className="self-start rounded-full bg-cyan/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-cyan" title="The desk checks this one">
              auto
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Every factor: what lands an answer on each rung. */
function FactorsTable() {
  const { doc, values } = useCtx();
  const rungs: Grade[] = ["A+", "A", "B", "C"];
  return (
    <Table
      head={["Factor", ...rungs.map((g) => <GradeBadge key={g} grade={g} size="sm" />)]}
      rows={doc.factors.map((f) => [
        <span key="n" className="block min-w-36">
          {f.name}
          {f.auto && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-cyan">auto</span>}
          {f.hint && <span className="block text-[11px] text-faint">{fill(f.hint, values)}</span>}
        </span>,
        ...rungs.map((g) => {
          const here = answersCappingAt(f, g);
          return here.length ? (
            <span key={g} className={cx(f.kind === "number" && "num")}>
              {here.map((h) => (f.kind === "number" ? withUnit(h, f.unit) : h)).join(" / ")}
            </span>
          ) : (
            <span key={g} className="text-faint">
              —
            </span>
          );
        }),
      ])}
    />
  );
}

/** The frozen snapshot as a heatmap: the stronger the reading, the stronger the colour; a cap shows in its grade's colour. */
function CompassTable() {
  const { doc } = useCtx();
  const f = autoFactor(doc, "compass");
  const cells = WEEKDAY_KEYS.flatMap((d) => [doc.compass.days[d].short, doc.compass.days[d].long]);
  const lo = Math.min(...cells);
  const hi = Math.max(...cells);
  const cell = (v: number, i: number) => {
    const cap = f ? factorCap(f, v) : null;
    const colour = cap && cap !== "A+" ? GRADE_COLOUR[cap] : "var(--color-up)";
    const strength = hi > lo ? (v - lo) / (hi - lo) : 1;
    return (
      <div
        key={i}
        className="anim-pop flex items-baseline justify-between gap-2 rounded-lg px-3 py-2"
        style={{ backgroundColor: tint(colour, 10 + strength * 30), ...stagger(i, 30) }}
      >
        <span className="num text-[13px] font-medium text-ink">{v.toFixed(1)}%</span>
        {cap && cap !== "A+" && (
          <span className="text-[10.5px] font-semibold" style={{ color: colour }}>
            max {cap}
          </span>
        )}
      </div>
    );
  };
  return (
    <div className="max-w-xl">
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 text-[12.5px]">
        <span />
        <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Short · high swept</span>
        <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Long · low swept</span>
        {WEEKDAY_KEYS.map((d, i) => (
          <Fragment key={d}>
            <span className="self-center text-ink">{WEEKDAY_NAMES[d]}</span>
            {cell(doc.compass.days[d].short, i * 2)}
            {cell(doc.compass.days[d].long, i * 2 + 1)}
          </Fragment>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Frozen {longDate(doc.compass.frozenOn)}, about {doc.compass.sessions} sessions. Refresh every {doc.compass.refreshDays} days.
      </p>
    </div>
  );
}

/** The grades as four tiles: what each one may risk. */
function Ladder() {
  const { doc } = useCtx();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {doc.grades.map((c, i) => {
        const colour = GRADE_COLOUR[c.grade];
        return (
          <div
            key={c.grade}
            className="anim-pop rounded-xl border px-4 py-3"
            style={{ borderColor: tint(colour, 30), backgroundColor: tint(colour, 7), ...stagger(i, 70) }}
          >
            <GradeBadge grade={c.grade} size="sm" />
            <p className="num mt-2 text-[20px] font-semibold leading-none" style={{ color: c.traded ? colour : "var(--color-down)" }}>
              {c.traded ? `${c.riskPct}%` : "No trade"}
            </p>
            <p className="mt-1 text-[11px] text-faint">{c.traded ? "risk per trade" : "not taken"}</p>
          </div>
        );
      })}
    </div>
  );
}

/** What a broken rule costs: since 2.0 one rule, before it a ladder from mild to severe. */
function ConsequenceLadder() {
  const { doc } = useCtx();
  const c = doc.consequences;
  if (c.anyBreak) return <DaysOff days={c.daysOff} />;
  const steps = [
    { when: "Any rule break", then: "rest of the day off", colour: "var(--color-warn)" },
    {
      when: `${c.breaks} breaks in one week`,
      then: `next week at ${c.factor === 0.5 ? "half" : `${c.factor * 100}%`} risk`,
      colour: "var(--color-accent-2)",
    },
    {
      when: `The ${doc.maxTradesPerDay === 1 ? "one" : doc.maxTradesPerDay}-trade rule or a loss limit broken`,
      then: `${c.daysOff} trading days off`,
      colour: "var(--color-down)",
    },
  ];
  return (
    <ol className="grid gap-2 md:grid-cols-3">
      {steps.map((s, i) => (
        <li
          key={i}
          className="anim-rise rounded-xl border px-4 py-3"
          style={{ borderColor: tint(s.colour, 30), backgroundColor: tint(s.colour, 7), ...stagger(i, 90) }}
        >
          <p className="text-[12.5px] text-soft">{s.when}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[13.5px] font-semibold" style={{ color: s.colour }}>
            <ArrowRight size={13} className="shrink-0" />
            {s.then}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Since 2.0: any rule broken → the next N trading days off, drawn as the days it costs. */
function DaysOff({ days }: { days: number }) {
  const colour = "var(--color-down)";
  return (
    <div
      className="anim-rise flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border px-5 py-4"
      style={{ borderColor: tint(colour, 30), backgroundColor: tint(colour, 7) }}
    >
      <div className="min-w-0">
        <p className="text-[12.5px] text-soft">Any rule broken</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold text-down">
          <ArrowRight size={14} className="shrink-0" />
          {days} trading {days === 1 ? "day" : "days"} off
        </p>
      </div>
      <ol className="ml-auto flex items-center gap-1.5" aria-hidden>
        <li className="rounded-lg border border-down/40 px-2.5 py-1 text-[11px] font-medium text-down">break</li>
        {Array.from({ length: days }, (_, i) => (
          <li
            key={i}
            className="anim-pop rounded-lg px-2.5 py-1 text-[11px] font-medium text-ink"
            style={{ backgroundColor: tint(colour, 22), ...stagger(i + 1, 140) }}
          >
            day {i + 1}
          </li>
        ))}
        <li className="anim-fade rounded-lg bg-up/15 px-2.5 py-1 text-[11px] font-medium text-up" style={stagger(days + 1, 140)}>
          back
        </li>
      </ol>
    </div>
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

/** Every change from the rulebook's fresh start on, newest first: when, and what. */
function Changelog() {
  const { state, doc } = useCtx();
  const from = doc.changelogFrom;
  const rows = [
    ...state.versions
      .filter((v) => !from || atLeast(v.version, from))
      .map((v) => ({ date: deskDay(new Date(v.createdAt)), change: v.reason })),
    ...doc.history.map((h) => ({ date: h.date, change: h.change })),
  ];
  return (
    <Table
      head={["Date", "Change"]}
      rows={rows.map((r) => [
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
    { label: "Exit", text: doc.flow.exit, colour: "var(--color-cyan)" },
  ];
  const n = doc.flow.gates.length;
  return (
    <div className="space-y-4">
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {doc.flow.gates.map((g, i) => (
          <li
            key={i}
            className="anim-rise flex items-start gap-3 rounded-xl border bg-surface/40 px-3.5 py-3 text-[13px] leading-snug text-ink"
            style={stagger(i, 80)}
          >
            <span
              className="anim-stamp num flex size-6 shrink-0 items-center justify-center rounded-full bg-up/15 text-[11px] font-semibold text-up"
              style={stagger(i + 2, 80)}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <Line text={g} />
            </span>
          </li>
        ))}
      </ol>
      <p className="flex items-center gap-2 text-[12px] text-faint">
        <span className="h-px flex-1 bg-line" />
        <span>
          Any <b className="font-semibold text-down">no</b> means no trade today. All {n} <b className="font-semibold text-up">yes</b>:
        </span>
        <ArrowDown size={12} />
        <span className="h-px flex-1 bg-line" />
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className="anim-rise rounded-xl border px-4 py-3 text-[13px] leading-snug text-soft"
            style={{ borderColor: tint(s.colour, 30), backgroundColor: tint(s.colour, 7), ...stagger(n + i, 80) }}
          >
            <b className="mb-0.5 block text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: s.colour }}>
              {s.label}
            </b>
            <Line text={s.text} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Editing a section ───────────────────────────────────────────────── */

/** The small formatting the text understands, as buttons: each acts at the cursor. */
type Format = "heading" | "bullet" | "numbered" | "bold";
const FORMATS: { id: Format; label: ReactNode; title: string }[] = [
  { id: "heading", label: <Heading2 size={14} />, title: "Heading — ### at the start of the line" },
  { id: "bullet", label: <ListIcon size={14} />, title: "Bullet — - at the start of the line" },
  { id: "numbered", label: <ListOrdered size={14} />, title: "Numbered — 1. at the start of the line" },
  { id: "bold", label: <Bold size={14} />, title: "Bold — **around the words**" },
];

/**
 * One section's values and text in one place, with the section drawn live beside them
 * exactly as the rulebook will show it. Saving writes the whole rulebook as the next
 * version, so a change here can never leave the text and the logic out of step.
 */
function SectionEditor({
  section,
  doc,
  onClose,
  onSaved,
}: {
  section: Section;
  doc: Rulebook;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const outer = useCtx();
  const [draft, setDraft] = useState<Rulebook>(() => structuredClone(doc));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const text = useRef<HTMLTextAreaElement>(null);
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
  const { colour, icon: Icon } = lookOf(section.id);
  const setSection = (patch: Partial<Section>) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.id === section.id ? { ...s, ...patch } : s)) }));
  const patch = (p: Partial<Rulebook>) => setDraft((d) => ({ ...d, ...p }));

  /** Puts `insert` at the cursor (or around the selection), then the cursor after it. */
  function edit(make: (body: string, from: number, to: number) => { body: string; cursor: number }) {
    const el = text.current;
    const from = el?.selectionStart ?? mine.body.length;
    const to = el?.selectionEnd ?? from;
    const out = make(mine.body, from, to);
    setSection({ body: out.body });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(out.cursor, out.cursor);
    });
  }
  const format = (f: Format) =>
    edit((body, from, to) => {
      if (f === "bold") {
        const words = body.slice(from, to) || "bold";
        return { body: `${body.slice(0, from)}**${words}**${body.slice(to)}`, cursor: from + words.length + 4 };
      }
      const prefix = f === "heading" ? "### " : f === "bullet" ? "- " : "1. ";
      const lineStart = body.lastIndexOf("\n", from - 1) + 1;
      return { body: `${body.slice(0, lineStart)}${prefix}${body.slice(lineStart)}`, cursor: from + prefix.length };
    });
  const insertValue = (key: string) => {
    edit((body, from, to) => {
      const token = `{{${key}}}`;
      return { body: `${body.slice(0, from)}${token}${body.slice(to)}`, cursor: from + token.length };
    });
    setPicking(false);
    setQuery("");
  };
  const choices = Object.entries(values)
    .filter(([k, v]) => !k.startsWith("ref:") && v != null)
    .filter(([k, v]) => !query || `${k} ${v}`.toLowerCase().includes(query.toLowerCase()));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // The note is yours to write; without one the changelog still says what was edited.
      await api.saveRulebook(draft, reason.trim() || `Edited ${mine.title || section.title}`, "minor");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} width="max-w-6xl">
      <div className="relative flex max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-2xl" style={{ "--sec": colour } as CSSProperties}>
        <Glow colour={colour} />

        {/* ── The section being edited, its name editable in place ── */}
        <header className="relative flex shrink-0 items-center gap-4 border-b px-7 pb-4 pt-5">
          <span
            className="anim-stamp flex size-10 shrink-0 items-center justify-center rounded-xl"
            style={{ color: colour, backgroundColor: tint(colour, 15) }}
          >
            <Icon size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-faint">Edit the rulebook</p>
            <input
              id="rb-edit-title"
              aria-label="Section title"
              className="-ml-1.5 w-full rounded-lg bg-transparent px-1.5 py-0.5 text-[19px] font-semibold tracking-tight outline-none transition-colors hover:bg-subtle focus:bg-subtle"
              value={mine.title}
              onChange={(e) => setSection({ title: e.target.value })}
            />
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-faint transition-colors hover:bg-subtle hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* ── Left: what you change ── */}
            <div className="min-w-0 space-y-4">
              <div className="anim-rise space-y-4" style={stagger(1, 90)}>
                <ValuesEditor id={section.id} draft={draft} patch={patch} />
              </div>

              <Card title="Text" index={2}>
                <div className="mb-2 flex flex-wrap items-center gap-1">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      title={f.title}
                      onClick={() => format(f.id)}
                      className="flex size-8 items-center justify-center rounded-lg text-soft transition-colors hover:bg-subtle hover:text-ink"
                    >
                      {f.label}
                    </button>
                  ))}
                  <span className="mx-1 h-5 w-px bg-line" />
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPicking((p) => !p)}
                      aria-expanded={picking}
                      className={cx(
                        "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                        picking ? "bg-subtle text-ink" : "text-soft hover:bg-subtle hover:text-ink",
                      )}
                    >
                      <Braces size={13} /> Insert a value
                    </button>
                    {picking && (
                      <div className="anim-pop absolute left-0 top-10 z-20 w-80 rounded-xl border bg-raised p-2" style={{ boxShadow: "var(--shadow-lift)" }}>
                        <input
                          id="rb-edit-value-search"
                          autoFocus
                          className="field mb-1.5 py-1.5 text-[12.5px]"
                          placeholder="Search: risk, window, stop…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setPicking(false))}
                        />
                        <ul className="max-h-60 overflow-y-auto">
                          {choices.map(([k, v]) => (
                            <li key={k}>
                              <button
                                type="button"
                                onClick={() => insertValue(k)}
                                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle"
                              >
                                <span className="num truncate text-[11.5px] text-faint">{k}</span>
                                <span className="num shrink-0 text-[12px] text-ink">{v}</span>
                              </button>
                            </li>
                          ))}
                          {!choices.length && <li className="px-2 py-1.5 text-[12px] text-faint">Nothing matches.</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
                <textarea
                  id="rb-edit-body"
                  ref={text}
                  aria-label="Section text"
                  className="field num min-h-[240px] resize-y text-[12.5px] leading-relaxed [field-sizing:content]"
                  value={mine.body}
                  onChange={(e) => setSection({ body: e.target.value })}
                />
                <p className="mt-2 text-[11px] text-faint">
                  Numbers come from the values, never typed: insert one and it updates everywhere when the value changes.
                </p>
              </Card>
            </div>

            {/* ── Right: the section as it will read ── */}
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
              <div className="anim-rise" style={stagger(3, 90)}>
                <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
                  <span className="size-1.5 animate-pulse rounded-full" style={{ backgroundColor: colour }} />
                  Live preview
                </p>
                <RulebookContext.Provider value={{ ...outer, doc: draft, values, readOnly: true }}>
                  <SectionCard section={mine} index={0} />
                </RulebookContext.Provider>
              </div>
              <Card title="Before you change a rule" index={4}>
                <ul className="space-y-1.5 text-[12px] text-soft">
                  {draft.guidance.map((g, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] size-1 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
                      {fill(g, values)}
                    </li>
                  ))}
                </ul>
              </Card>
            </aside>
          </div>
        </div>

        {problems.length > 0 && (
          <div className="anim-rise relative mx-7 mb-3 rounded-xl border border-warn/25 bg-warn/[0.06] px-4 py-3 text-[12px] text-warn">
            <p className="font-medium">Fix before saving:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {problems.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Why, which version, save ── */}
        <footer className="relative flex shrink-0 flex-wrap items-center gap-3 border-t bg-raised px-7 py-4">
          <label className="relative min-w-[260px] flex-1">
            <Pencil size={13} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              id="rb-edit-reason"
              className="field pl-9 text-[13px]"
              placeholder="What changed, and why? Optional — it goes in the changelog"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && changed && !problems.length && save()}
            />
          </label>
          {error && <span className="anim-fade text-[12px] text-down">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" onClick={save} disabled={saving || !changed || problems.length > 0}>
            <Check size={15} /> {changed ? "Save" : "No changes yet"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

/** A card of the editor: it rises in after the one before it, its title marked in the section's colour. */
function Card({ title, index = 0, children }: { title: string; index?: number; children: ReactNode }) {
  return (
    <section className="anim-rise rounded-2xl border bg-surface/40 px-5 py-4" style={stagger(index, 90)}>
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">
        <span className="size-1.5 rounded-full" style={{ backgroundColor: "var(--sec, var(--color-faint))" }} />
        {title}
      </h3>
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
  const has = (sectionId: string) => d.sections.some((s) => s.id === sectionId);
  switch (id) {
    case "glance":
      return <WhenCard draft={d} patch={patch} />;
    case "overview":
      // Before v1.4 the overview held the decision flow too.
      return (
        <>
          <WhenCard draft={d} patch={patch} />
          <FlowCard draft={d} patch={patch} />
        </>
      );
    case "flow":
      return <FlowCard draft={d} patch={patch} />;
    case "prep":
      // v1.2 had a plan deadline here; since v1.3 nothing in daily preparation is a setting.
      return d.planBy ? (
        <Card title="Deadline">
          <Time label="Plan written by" value={d.planBy} onChange={(v) => patch({ planBy: v })} />
        </Card>
      ) : null;
    case "news":
      return <NewsEditor draft={d} patch={patch} />;
    case "setup":
      return <SweepCard draft={d} patch={patch} />;
    case "entry":
      return <EntryCard draft={d} patch={patch} />;
    case "stop":
      return (
        <Card title="Target values">
          <Num label="Liquidity beyond the edge" value={d.liquidityR} onChange={(v) => patch({ liquidityR: v })} suffix="R" />
        </Card>
      );
    case "trade":
      return (
        <>
          <BaseRulesCard draft={d} patch={patch} />
          <EntryCard draft={d} patch={patch} />
          <ManageCard draft={d} patch={patch} />
        </>
      );
    case "grading":
      return (
        <>
          {/* Since v1.4 the base rules are edited with the trade they describe. */}
          {!has("trade") && <BaseRulesCard draft={d} patch={patch} />}
          <Card title="Grade factors — each answer caps the best grade">
            <FactorsEditor value={d.factors} onChange={(v) => patch({ factors: v })} />
          </Card>
          <Card title="Grade ladder">
            <GradeLadder grades={d.grades} definition={d} onChange={(v) => patch({ grades: v })} />
          </Card>
          {/* Before 2.0 the Compass came from this snapshot; since then it is read live. */}
          {autoFactor(d, "compass") && <CompassEditor draft={d} patch={patch} />}
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
      return <ManageCard draft={d} patch={patch} />;
    case "limits":
      return (
        <>
          <LimitsCard draft={d} patch={patch} />
          {/* Since v1.4 the consequences sit with the limits they enforce. */}
          {!has("discipline") && <ConsequencesCard draft={d} patch={patch} />}
          <AccountsCard draft={d} patch={patch} />
        </>
      );
    case "discipline":
      return <ConsequencesCard draft={d} patch={patch} />;
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
                {!has("entry") && (
                  <Num label="Set the minimum R:R after" value={d.calibration.rr} onChange={(v) => patch({ calibration: { ...d.calibration, rr: v } })} suffix="trades" className="w-36" />
                )}
              </Row>
            </div>
          </Card>
          {!has("setup") && <SweepCard draft={d} patch={patch} />}
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

/* The value cards, shared by the sections that own each value. */
type CardProps = { draft: Rulebook; patch: (p: Partial<Rulebook>) => void };

function WhenCard({ draft: d, patch }: CardProps) {
  return (
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
  );
}

function FlowCard({ draft: d, patch }: CardProps) {
  return (
    <Card title="Decision flow">
      <span className="label">The gates, one per line</span>
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
  );
}

function BaseRulesCard({ draft: d, patch }: CardProps) {
  return (
    <Card title="Base rules — every one must hold, or the setup is a C">
      <BaseRulesEditor value={d.baseRules} onChange={(v) => patch({ baseRules: v })} />
    </Card>
  );
}

function EntryCard({ draft: d, patch }: CardProps) {
  return (
    <Card title="Entry and target values">
      <Row>
        <Num label="Minimum R:R (net)" value={d.rr.min} onChange={(v) => patch({ rr: { ...d.rr, min: v } })} suffix=":1" />
        <Num label="Liquidity filter" value={d.liquidityR} onChange={(v) => patch({ liquidityR: v })} suffix="R" />
        <Num label="Limit order valid for" value={d.limitCandles} onChange={(v) => patch({ limitCandles: Math.max(1, Math.round(v)) })} suffix="candles" className="w-36" />
        <Num label="Set the minimum after" value={d.calibration.rr} onChange={(v) => patch({ calibration: { ...d.calibration, rr: v } })} suffix="trades" className="w-36" />
      </Row>
    </Card>
  );
}

function ManageCard({ draft: d, patch }: CardProps) {
  return (
    <Card title="Management">
      <Num label="Hands off until" value={Number((d.trailAfter * 100).toFixed(2))} onChange={(v) => patch({ trailAfter: v / 100 })} suffix="% of the way" className="w-40" />
    </Card>
  );
}

function SweepCard({ draft: d, patch }: CardProps) {
  return (
    <Card title="Sweep depth reference (Compass)">
      <Row>
        <Num label="70% within" value={d.sweep.p70} onChange={(v) => patch({ sweep: { ...d.sweep, p70: v } })} suffix="$" />
        <Num label="85% within" value={d.sweep.p85} onChange={(v) => patch({ sweep: { ...d.sweep, p85: v } })} suffix="$" />
        <Num label="95% within" value={d.sweep.p95} onChange={(v) => patch({ sweep: { ...d.sweep, p95: v } })} suffix="$" />
      </Row>
    </Card>
  );
}

function LimitsCard({ draft: d, patch }: CardProps) {
  const l = d.limits;
  const limits = (p: Partial<Rulebook["limits"]>) => patch({ limits: { ...l, ...p } });
  return (
    <Card title="Your limits">
      <Row>
        <Num label="Max risk per trade" value={l.maxRiskPct} onChange={(v) => limits({ maxRiskPct: v })} suffix="%" />
        <Num label="Daily stop" value={l.dailyStopPct} onChange={(v) => limits({ dailyStopPct: v })} suffix="%" />
        <Num label="Weekly stop" value={l.weeklyStopPct} onChange={(v) => limits({ weeklyStopPct: v })} suffix="%" />
      </Row>
    </Card>
  );
}

function ConsequencesCard({ draft: d, patch }: CardProps) {
  if (d.consequences.anyBreak) {
    return (
      <Card title="Consequence">
        <Num
          label="Trading days off after any rule break"
          value={d.consequences.daysOff}
          onChange={(v) => patch({ consequences: { ...d.consequences, daysOff: Math.max(1, Math.round(v)) } })}
          suffix="days"
          className="w-40"
        />
      </Card>
    );
  }
  return (
    <Card title="Consequences">
      <Row>
        <Num label="Breaks in a week" value={d.consequences.breaks} onChange={(v) => patch({ consequences: { ...d.consequences, breaks: Math.max(1, Math.round(v)) } })} />
        <Num label="Next week's risk ×" value={d.consequences.factor} onChange={(v) => patch({ consequences: { ...d.consequences, factor: v } })} />
        <Num label="Days off after a limit break" value={d.consequences.daysOff} onChange={(v) => patch({ consequences: { ...d.consequences, daysOff: Math.max(0, Math.round(v)) } })} className="w-36" />
      </Row>
    </Card>
  );
}

function AccountsCard({ draft: d, patch }: CardProps) {
  const l = d.limits;
  const limits = (p: Partial<Rulebook["limits"]>) => patch({ limits: { ...l, ...p } });
  return (
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
      <p className="mt-3 text-[11px] text-faint">
        Not shown in the rulebook. The opening balance is where the journal's compounding starts; every % and R is re-derived from it.
      </p>
    </Card>
  );
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
          <div key={i} className="anim-rise flex items-center gap-2" style={stagger(i, 40)}>
            <select
              aria-label="Release kind"
              className="field min-w-0 flex-1 text-[12.5px]"
              value={p.category}
              onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, category: e.target.value } : x)))}
            >
              {CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
            <select
              aria-label="Currency"
              className="field num w-24 shrink-0 text-[12.5px]"
              value={p.currency}
              onChange={(e) => onChange(value.map((x, k) => (k === i ? { ...x, currency: e.target.value } : x)))}
            >
              {NEWS_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={() => onChange(value.filter((_, k) => k !== i))}
              className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-subtle hover:text-down"
              title="Remove"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <AddButton onClick={() => onChange([...value, { category: "rates", currency: "USD" }])}>Add a release</AddButton>
      </div>
    </div>
  );
}

/** The news rules as two cards, one per thing they do: close a whole day, or pause entries around a release. */
function NewsEditor({ draft: d, patch }: { draft: Rulebook; patch: (p: Partial<Rulebook>) => void }) {
  const n = d.news;
  const set = (p: Partial<Rulebook["news"]>) => patch({ news: { ...n, ...p } });
  return (
    <>
      <Card title="Skip days — no trading at all">
        <div className="space-y-5">
          <PairsEditor label="A red release of this kind" value={n.skip} onChange={(v) => set({ skip: v })} />
          <div>
            <span className="label">Bank holidays on</span>
            <Chips options={NEWS_CURRENCIES} value={n.holidayCurrencies} onChange={(v) => set({ holidayCurrencies: v })} />
          </div>
          <div>
            <span className="label">Every year from … to (MM-DD)</span>
            <div className="num flex items-center gap-2">
              <input
                aria-label="Skip range from"
                className="field w-24"
                value={n.skipRange?.from ?? ""}
                placeholder="12-22"
                onChange={(e) => set({ skipRange: e.target.value || n.skipRange?.to ? { from: e.target.value, to: n.skipRange?.to ?? "" } : null })}
              />
              <span className="text-faint">to</span>
              <input
                aria-label="Skip range to"
                className="field w-24"
                value={n.skipRange?.to ?? ""}
                placeholder="01-02"
                onChange={(e) => set({ skipRange: { from: n.skipRange?.from ?? "", to: e.target.value } })}
              />
            </div>
          </div>
        </div>
      </Card>
      <Card title="Release windows — no new entries around a release">
        <div className="space-y-5">
          <div>
            <span className="label">Every other red release on</span>
            <Chips options={NEWS_CURRENCIES} value={n.windowCurrencies} onChange={(v) => set({ windowCurrencies: v })} />
          </div>
          <PairsEditor label="And also these" value={n.windowExtra} onChange={(v) => set({ windowExtra: v })} />
          <Row>
            <Num label="From" value={n.beforeMin} onChange={(v) => set({ beforeMin: v })} suffix="min before" className="w-36" />
            <Num label="To" value={n.afterMin} onChange={(v) => set({ afterMin: v })} suffix="min after" className="w-36" />
          </Row>
        </div>
      </Card>
    </>
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
