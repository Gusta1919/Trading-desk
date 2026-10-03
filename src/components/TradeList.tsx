import { ArrowDownRight, ArrowUpRight, ChevronDown, Flag, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtDate, fmtPct, fmtR, fmtRate, fmtTime, fmtUsdSigned, tone } from "@/lib/format";
import { ledger } from "@/lib/limits";
import { answerLabel, whyGrade } from "@/lib/grading";
import { classifyOutcome, summarize, tradePct } from "@/lib/stats";
import { FLAG_LABEL, exitReasonLabel, isGrade, rulesHeld, type Limits, type Trade } from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { Button, Empty, Pill, Segmented, Tip, cx } from "./ui";

const RANGES = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

const RESULTS = [
  { value: "win", label: "Win" },
  { value: "loss", label: "Loss" },
  { value: "be", label: "BE" },
  { value: "open", label: "Open" },
  { value: "skipped", label: "Not taken" },
];

/** A setup not taken is neither open nor closed — it never happened on the account. */
const resultOf = (t: Trade) => (t.skipped ? "skipped" : classifyOutcome(t.resultR));

/** Why the setup got its grade — what capped it. */
export const setupOf = (t: Trade) => (t.setupSnapshot ? whyGrade(t.setupSnapshot) : "—");

/** Every answer, for the tooltip. */
const answerLine = (t: Trade) =>
  (t.setupSnapshot?.factors ?? [])
    .map((f) => {
      const a = answerLabel(f, t.setupSnapshot!.answers[f.id]);
      return a ? `${f.name}: ${a}` : null;
    })
    .filter(Boolean)
    .join(" · ");

/** Every filter in one object, so "Clear" is a single assignment. */
const BLANK = { range: "all", direction: "", result: "", flagged: "" };
type Filters = typeof BLANK;

/** The earliest date a trade may carry and still pass the range filter. */
function rangeStart(range: string, now = new Date()) {
  if (range === "all") return null;
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "year") return new Date(now.getFullYear(), 0, 1);
  const from = new Date(now);
  from.setDate(from.getDate() - Number(range));
  return from;
}

/** The journal: every trade and every setup logged as not taken, newest first. */
export function TradeList({
  trades,
  limits,
  onOpen,
  onNew,
}: {
  trades: Trade[];
  /** For the dollars: the main account's and every linked one's. */
  limits: Limits;
  onOpen: (t: Trade) => void;
  onNew: () => void;
}) {
  const book = useMemo(() => ledger(trades, limits), [trades, limits]);
  const [query, setQuery] = useState("");
  const [f, setF] = useState<Filters>(BLANK);
  const set = (k: keyof Filters, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const filtered = query.trim() !== "" || (Object.keys(BLANK) as (keyof Filters)[]).some((k) => f[k] !== BLANK[k]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = rangeStart(f.range);
    return trades.filter((t) => {
      if (from && new Date(t.date) < from) return false;
      if (f.flagged === "flagged" && !t.flags.length) return false;
      if (f.flagged === "clean" && (t.flags.length || t.skipped)) return false;
      if (f.direction && t.direction !== f.direction) return false;
      if (f.result && resultOf(t) !== f.result) return false;
      if (
        q &&
        ![t.grade, t.session, setupOf(t), t.notes, exitReasonLabel(t.exitReason), ...t.mistakes, ...t.flags.map((x) => FLAG_LABEL[x])]
          .join(" ")
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [trades, query, f]);

  // Setups not taken are listed, never counted.
  const s = useMemo(() => summarize(visible.filter((t) => !t.skipped)), [visible]);
  /** A trade's dollars across every account, and the split for the hover. */
  const dollars = (t: Trade) => book.byTrade.get(t.id);
  const visibleUsd = visible.reduce((a, t) => a + (dollars(t)?.reduce((x, y) => x + y, 0) ?? 0), 0);

  if (trades.length === 0) {
    return (
      <div className="card">
        <Empty
          title="No trades yet"
          body="Log every setup you grade — the ones you take and the ones you pass on. After 20–30 trades, Stats starts showing where your edge really is."
          action={<Button onClick={onNew}>Log your first trade</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="anim-rise flex flex-wrap items-center gap-2" style={{ animationDelay: "80ms" }}>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="field w-72 py-2 pl-9 text-small"
            placeholder="Search notes, mistakes, rules, grades…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <RangeSelect value={f.range} onChange={(v) => set("range", v)} />
        <Segmented
          size="sm"
          allowNone
          value={f.flagged || null}
          onChange={(v) => set("flagged", v ?? "")}
          options={[
            { value: "clean", label: "Clean" },
            { value: "flagged", label: "Rule broken" },
          ]}
        />
        <Segmented
          size="sm"
          allowNone
          value={f.direction || null}
          onChange={(v) => set("direction", v ?? "")}
          options={[
            { value: "long", label: "Long" },
            { value: "short", label: "Short" },
          ]}
        />
        <Segmented size="sm" allowNone value={f.result || null} onChange={(v) => set("result", v ?? "")} options={RESULTS} />
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setF(BLANK);
            }}
            className="anim-fade rounded-lg px-2.5 py-1.5 text-small font-medium text-faint transition-colors duration-500 hover:text-ink"
          >
            Clear
          </button>
        )}
        <div className="num ml-auto flex gap-5 text-small text-soft">
          <span>
            {s.closed} closed{s.open > 0 && ` · ${s.open} open`}
          </span>
          <span>
            win rate <b className="font-medium text-ink">{fmtRate(s.winRate)}</b>
          </span>
          <span>
            net <b className={cx("font-medium text-ink", tone(s.netPct))}>{fmtPct(s.netPct)}</b>
          </span>
          <span>
            <b className={cx("font-medium text-ink", tone(visibleUsd))}>{fmtUsdSigned(visibleUsd)}</b> all accounts
          </span>
        </div>
      </div>

      <div className="card anim-rise overflow-x-auto" style={{ animationDelay: "140ms" }}>
        <table className="num w-full text-left text-body">
          <thead>
            <tr className="border-b">
              <Th>Date</Th>
              <Th>Side</Th>
              <Th>Grade</Th>
              <Th grow>Why this grade</Th>
              <Th>Session</Th>
              <Th>Exit</Th>
              <Th>Rules</Th>
              <Th right>Risk</Th>
              <Th right>Result</Th>
              <Th right>Return</Th>
              <Th right>P&amp;L</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const open = t.resultR == null && !t.skipped;
              const held = rulesHeld(t);
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen(t)}
                  className={cx(
                    "anim-cascade group cursor-pointer border-b transition-colors duration-500 last:border-0 hover:bg-raised/70",
                    t.skipped && "text-soft",
                  )}
                  style={{ animationDelay: `${Math.min(i * 45, 1400)}ms` }}
                >
                  <Td>
                    <span className="text-ink">{fmtDate(t.date)}</span> <span className="text-faint">{fmtTime(t.date)}</span>
                  </Td>
                  <Td>
                    <span className={cx("inline-flex items-center gap-1", t.direction === "long" ? "text-up" : "text-down")}>
                      {t.direction === "long" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      <span className="font-sans text-small font-medium">{t.direction === "long" ? "Long" : "Short"}</span>
                    </span>
                  </Td>
                  <Td>{isGrade(t.grade) ? <GradeBadge grade={t.grade} size="sm" muted={t.skipped} /> : <span className="text-faint">—</span>}</Td>
                  <Td className="w-full max-w-0 truncate font-sans text-soft">
                    <span title={answerLine(t) || undefined}>{setupOf(t)}</span>
                  </Td>
                  <Td>{t.session ? <Pill>{t.session}</Pill> : <span className="text-faint">—</span>}</Td>
                  <Td>
                    {t.skipped ? (
                      <Pill tone="neutral" className="border-dashed">
                        Not taken
                      </Pill>
                    ) : t.exitReason ? (
                      <Pill tone={t.exitReason === "other" ? "down" : t.exitReason === "target" ? "up" : "neutral"}>{exitReasonLabel(t.exitReason)}</Pill>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Td>
                  <Td>
                    {t.skipped ? (
                      <span className="text-faint">—</span>
                    ) : t.flags.length ? (
                      <Tip text={t.flags.map((x) => FLAG_LABEL[x]).join(" · ") + (t.flagNote ? ` — “${t.flagNote}”` : "")}>
                        <span className="inline-flex items-center gap-1 text-small font-medium text-down">
                          <Flag size={12} /> {t.flags.length} broken
                        </span>
                      </Tip>
                    ) : (
                      <span className="text-small text-faint">
                        {held ? `${held.held}/${held.of}` : "—"} <span className="text-up">✓</span>
                      </span>
                    )}
                  </Td>
                  <Td right className="text-soft">
                    {t.skipped ? <span className="text-faint">—</span> : `${+t.riskPct.toFixed(2)}%`}
                  </Td>
                  <Td right className={cx("font-medium", tone(t.skipped ? null : t.resultR))}>
                    {t.skipped ? (
                      <span className="font-normal text-faint" title="What it would have made — never counted">
                        {t.hypotheticalR != null ? `(${fmtR(t.hypotheticalR)})` : "—"}
                      </span>
                    ) : open ? (
                      <span className="font-normal text-accent-2">open</span>
                    ) : (
                      fmtR(t.resultR)
                    )}
                  </Td>
                  <Td right className={cx("font-medium", tone(open || t.skipped ? null : tradePct(t)))}>
                    {open || t.skipped ? <span className="text-faint">—</span> : fmtPct(tradePct(t))}
                  </Td>
                  <Td right>
                    {(() => {
                      const d = dollars(t);
                      if (!d) return <span className="text-faint">—</span>;
                      const total = d.reduce((a, b) => a + b, 0);
                      return (
                        <Tip text={book.accounts.map((a, k) => `${a.name} ${fmtUsdSigned(d[k])}`).join(" · ")} className={cx("font-medium", tone(total))}>
                          {fmtUsdSigned(total)}
                        </Tip>
                      );
                    })()}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <Empty title="Nothing matches" body="No trades match these filters." />}
      </div>
    </div>
  );
}

/** The range filter: a quiet select that lights up while it narrows the list. */
function RangeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx("field w-auto cursor-pointer appearance-none py-2 pl-3.5 pr-9 text-small", value !== "all" && "border-accent/45 text-ink")}
      >
        {RANGES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-faint" />
    </div>
  );
}

/** A header cell; every column but the one that grows is only as wide as what it holds. */
const Th = ({ children, right, grow }: { children: React.ReactNode; right?: boolean; grow?: boolean }) => (
  <th className={cx("eyebrow whitespace-nowrap px-4 py-3 font-semibold", right && "text-right", grow ? "w-full" : "w-px")}>{children}</th>
);

const Td = ({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={cx("whitespace-nowrap px-4 py-3.5", right && "text-right", className)}>{children}</td>
);
