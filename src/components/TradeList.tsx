import { ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtDate, fmtPct, fmtR, fmtRate, fmtTime, tone } from "@/lib/format";
import { answerLabel, whyGrade } from "@/lib/grading";
import { classifyOutcome, summarize, tradePct } from "@/lib/stats";
import {
  FLAG_LABEL,
  checklistComplete,
  checklistRecorded,
  exitReasonLabel,
  isGrade,
  totalChecks,
  type Trade,
} from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { Button, Pill, Segmented, cx } from "./ui";

const RANGES = [
  { value: "all", label: "All time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

const DIRECTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
];

const RESULTS = [
  { value: "win", label: "Win" },
  { value: "loss", label: "Loss" },
  { value: "be", label: "BE" },
  { value: "open", label: "Open" },
];

/** A skipped setup is neither open nor closed — it never happened on the account. */
const resultOf = (t: Trade) => (t.skipped ? "skipped" : classifyOutcome(t.resultR));

/** Why the setup got its grade — what capped it — or the old fixed fields on older trades. */
/** Every answer, for the tooltip. */
const answerLine = (t: Trade) =>
  t.setupSnapshot!.factors
    .map((f) => {
      const a = answerLabel(f, t.setupSnapshot!.answers[f.id]);
      return a ? `${f.name}: ${a}` : null;
    })
    .filter(Boolean)
    .join("\n");

export function setupOf(t: Trade) {
  if (t.setupSnapshot) return whyGrade(t.setupSnapshot);
  const legacy = [t.entryModel, t.htf, t.setup].filter(Boolean).join(" · ");
  return legacy ? `${legacy} (legacy)` : "—";
}

/** Every filter in one object, so "Clear" is a single assignment. */
const BLANK = { range: "all", symbol: "", direction: "", result: "", flagged: "" };
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

export function TradeList({
  trades,
  onOpen,
  onNew,
  compact = false,
}: {
  trades: Trade[];
  onOpen: (t: Trade) => void;
  onNew: () => void;
  /** Board mode: only the columns worth a glance. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [f, setF] = useState<Filters>(BLANK);
  const set = (k: keyof Filters, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const filtered =
    query.trim() !== "" || (Object.keys(BLANK) as (keyof Filters)[]).some((k) => f[k] !== BLANK[k]);

  /* Options come from the trades themselves — never offer a filter that matches nothing. */
  const symbols = useMemo(
    () => [...new Set(trades.map((t) => t.symbol).filter(Boolean))].sort(),
    [trades],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = rangeStart(f.range);
    return trades.filter((t) => {
      if (from && new Date(t.date) < from) return false;
      if (f.symbol && t.symbol !== f.symbol) return false;
      if (f.flagged === "flagged" && !t.flags.length) return false;
      if (f.flagged === "clean" && (t.flags.length || t.skipped)) return false;
      if (f.direction && t.direction !== f.direction) return false;
      if (f.result && resultOf(t) !== f.result) return false;
      if (
        q &&
        ![t.symbol, t.setup, t.session, t.htf, t.entryModel, setupOf(t), t.notes, exitReasonLabel(t.exitReason), ...t.mistakes, ...t.flags.map((x) => FLAG_LABEL[x])]
          .join(" ")
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [trades, query, f]);

  // Skipped setups are listed, never counted.
  const s = useMemo(() => summarize(visible.filter((t) => !t.skipped)), [visible]);

  if (trades.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center">
        <p className="text-[15px] font-medium">No trades yet</p>
        <p className="max-w-sm text-soft">
          Log every trade, win or lose. After 20–30 trades the Stats tab starts showing
          you where your edge really is.
        </p>
        <Button onClick={onNew} className="mt-2">
          Log your first trade
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className={cx("field py-1.5 pl-8", compact ? "w-44" : "w-72")}
            placeholder="Search setup, notes, mistakes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {!compact && (
          <>
            <FilterSelect value={f.range} onChange={(v) => set("range", v)} options={RANGES} />
            <FilterSelect
              value={f.symbol}
              onChange={(v) => set("symbol", v)}
              placeholder="All symbols"
              options={symbols.map((sym) => ({ value: sym, label: sym }))}
            />
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
              options={DIRECTIONS}
            />
            <Segmented
              size="sm"
              allowNone
              value={f.result || null}
              onChange={(v) => set("result", v ?? "")}
              options={RESULTS}
            />
            {filtered && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setF(BLANK);
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-faint transition-colors duration-500 hover:text-ink"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex gap-5 text-[13px] text-soft">
          <span>
            {s.closed} closed{s.open > 0 && ` · ${s.open} open`}
          </span>
          <span>
            Win rate <b className="font-semibold text-ink">{fmtRate(s.winRate)}</b>
          </span>
          <span>
            Net <b className={cx("font-semibold text-ink", tone(s.netPct))}>{fmtPct(s.netPct)}</b>
          </span>
        </div>
      </div>

      <div className={cx("overflow-x-auto", compact ? "-mx-1" : "card")}>
        <table className={cx("num w-full text-left", compact ? "text-[12px]" : "text-[13px]")}>
          <thead>
            <tr className="border-b text-[11px] uppercase tracking-[0.06em] text-faint">
              <Th>Date</Th>
              <Th>Symbol</Th>
              <Th grow>Why this grade</Th>
              {!compact && <Th>Session</Th>}
              {!compact && <Th>Exit</Th>}
              <Th>Review</Th>
              <Th right>Risk</Th>
              <Th right>Result</Th>
              <Th right>Return</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t, i) => {
              const open = t.resultR == null && !t.skipped;
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen(t)}
                  className="anim-cascade cursor-pointer border-b transition-colors duration-500 last:border-0 hover:bg-raised"
                  style={{ animationDelay: `${Math.min(i * 55, 1600)}ms` }}
                >
                  <Td>
                    <span className="text-ink">{fmtDate(t.date)}</span>{" "}
                    <span className="text-faint">{fmtTime(t.date)}</span>
                  </Td>
                  <Td>
                    <span className="font-medium text-ink">{t.symbol}</span>{" "}
                    <span className="text-faint">{t.direction === "long" ? "Long" : "Short"}</span>
                  </Td>
                  {/* The one column that stretches: on a wide screen the reason gets the room, not a gap on the right. */}
                  <Td className="w-full max-w-0 truncate text-soft">
                    <span title={t.setupSnapshot ? answerLine(t) : undefined}>{setupOf(t)}</span>
                  </Td>
                  {!compact && (
                    <Td>{t.session ? <Pill>{t.session}</Pill> : <span className="text-faint">—</span>}</Td>
                  )}
                  {!compact && (
                    <Td>
                      {t.exitReason ? (
                        <Pill tone={t.exitReason === "other" ? "down" : t.exitReason === "target" ? "up" : "neutral"}>
                          {exitReasonLabel(t.exitReason)}
                        </Pill>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                  )}
                  <Td>
                    <Review t={t} />
                  </Td>
                  {/* Risk is stored at full precision for accurate totals; show two places. */}
                  <Td right className="text-soft">
                    {t.skipped ? <span className="text-faint">skipped</span> : `${+t.riskPct.toFixed(2)}%`}
                  </Td>
                  <Td right className={cx("font-medium", tone(t.skipped ? null : t.resultR))}>
                    {t.skipped ? (
                      <span className="text-faint" title="What it would have made — not counted">
                        {t.hypotheticalR != null ? `(${fmtR(t.hypotheticalR)})` : "—"}
                      </span>
                    ) : open ? (
                      <span className="text-faint">open</span>
                    ) : (
                      fmtR(t.resultR)
                    )}
                  </Td>
                  {/* The numbers close the row, right-aligned against the table's edge. */}
                  <Td right className={cx("font-medium", tone(open || t.skipped ? null : tradePct(t)))}>
                    {open || t.skipped ? "—" : fmtPct(tradePct(t))}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="px-4 py-10 text-center text-soft">No trades match these filters.</p>
        )}
      </div>
    </div>
  );
}

/** One dropdown in the filter bar; lights up in the accent colour while it is narrowing. */
function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  /** The "no filter" row. Omitted for ranges, which always have a value. */
  placeholder?: string;
}) {
  const active = placeholder ? value !== "" : value !== "all";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cx(
          "field w-auto cursor-pointer appearance-none py-1.5 pl-3 pr-8 text-[13px]",
          active && "border-accent/45 text-ink",
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint"
      />
    </div>
  );
}

/** Compact discipline summary: grade, plan ✓/✗ and number of mistakes. */
function Review({ t }: { t: Trade }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-soft">
      <span
        title={checklistRecorded(t) ? "Pre-trade checklist" : "No checklist recorded for this trade"}
        className={cx("num", checklistRecorded(t) && !checklistComplete(t) && "text-down")}
      >
        {checklistRecorded(t) ? `${t.checklist.length}/${totalChecks(t)}` : "—"}
      </span>
      {isGrade(t.grade) && <GradeBadge grade={t.grade} size="sm" />}
      {t.flags.length > 0 && (
        <span
          className="font-medium text-warn"
          title={t.flags.map((f) => FLAG_LABEL[f]).join(", ") + (t.flagNote ? ` — “${t.flagNote}”` : "")}
        >
          ⚑ {t.flags.length}
        </span>
      )}
      {t.followedPlan === true && <span title="Followed plan">✓ plan</span>}
      {t.followedPlan === false && <span title="Broke plan">✗ plan</span>}
      {t.mistakes.length > 0 && (
        <span title={t.mistakes.join(", ")}>
          {t.mistakes.length} mistake{t.mistakes.length > 1 && "s"}
        </span>
      )}
    </div>
  );
}

/** A header cell; every column but the one that grows is only as wide as what it holds. */
const Th = ({ children, right, grow }: { children: React.ReactNode; right?: boolean; grow?: boolean }) => (
  <th className={cx("whitespace-nowrap px-4 py-3 font-medium", right && "text-right", grow ? "w-full" : "w-px")}>{children}</th>
);

const Td = ({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) => (
  <td className={cx("whitespace-nowrap px-4 py-3.5", right && "text-right", className)}>
    {children}
  </td>
);
