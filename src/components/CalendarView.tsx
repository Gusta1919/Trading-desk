import { Ban, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { evaluateHistory, type DayOff } from "@/lib/discipline";
import { dayKey, fmtPct, fmtR, fmtTime, tone } from "@/lib/format";
import type { CalendarEvent } from "@/lib/news";
import { coveredDays, fromEvent, fromTradeNews, newsDay, inSkipRange, type NewsItem } from "@/lib/newsRules";
import { weekOfDay } from "@/lib/risk";
import type { Rulebook } from "@/lib/rulebook";
import { WEEKDAYS, isClosed, tradePct } from "@/lib/stats";
import { QUESTIONS, VERDICTS, type CheckIn } from "@/lib/checkin";
import { deskDay } from "@/lib/tz";
import { FLAG_LABEL, isGrade, type Trade, type TradeFlag } from "@/lib/types";
import { verdictColor } from "./CheckIn";
import { GradeBadge } from "./GradeBadge";
import { setupOf } from "./TradeList";
import { Button, cx, stagger } from "./ui";

/** What the rules made of one day: its flags, and whether it was off or skipped. */
interface DayRules {
  flags: TradeFlag[];
  dayOff: DayOff | null;
  skip: string[];
  /** More than one taken trade: always a violation. */
  overTrades: boolean;
}

interface Day {
  key: string;
  date: Date;
  inMonth: boolean;
  trades: Trade[];
  pct: number;
}

/** How strongly a day is lit: scaled against the month's biggest move. */
function heat(pct: number, peak: number) {
  return Math.min(1, Math.abs(pct) / (peak || 1));
}

/** "YYYY-MM-DD" of a calendar cell, read from its own date parts. */
const cellKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function CalendarView({
  trades,
  checkins,
  doc,
  rulebookOf,
  calendar = [],
  onOpen,
  compact = false,
}: {
  /** Taken trades only. */
  trades: Trade[];
  checkins: CheckIn[];
  doc?: Rulebook;
  rulebookOf?: (v: string | null) => Rulebook;
  calendar?: CalendarEvent[];
  onOpen: (t: Trade) => void;
  /** Board mode: fits a small panel — no week column, no day panel, smaller cells. */
  compact?: boolean;
}) {
  /* The rules over the whole history: flags, days off, half-risk weeks. */
  const judged = useMemo(
    () => (rulebookOf ? evaluateHistory({ trades, checkins, rulebookOf }) : null),
    [trades, checkins, rulebookOf],
  );
  const covered = useMemo(() => coveredDays(calendar), [calendar]);
  const today = deskDay();
  /** A day's rules, worked out only for weekdays up to today — the future has broken nothing yet. */
  const rulesOf = (key: string, dayTrades: Trade[], weekday: boolean): DayRules | null => {
    if (!doc || !weekday) return null;
    const off = judged?.timeline.dayOff.get(key) ?? null;
    // Ahead of today only a scheduled day off is known.
    if (key > today) return off ? { flags: [], dayOff: off, skip: [], overTrades: false } : null;
    const items: NewsItem[] | null =
      covered && key >= covered.from && key <= covered.to
        ? calendar.filter((e) => e.at && deskDay(new Date(e.at)) === key).map(fromEvent)
        : dayTrades.length
          ? dayTrades.flatMap((t) => t.news).map(fromTradeNews)
          : null;
    const skip = items ? newsDay(key, items, doc.news).skip : inSkipRange(key, doc.news) ? ["the year-end break"] : [];
    return {
      flags: [...new Set(dayTrades.flatMap((t) => judged?.byId.get(t.id)?.flags ?? t.flags))],
      dayOff: off,
      skip,
      overTrades: dayTrades.filter((t) => !t.skipped).length > doc.maxTradesPerDay,
    };
  };
  // "Today" is New York's date, like every date a trade carries.
  const todayKey = dayKey(new Date());
  const thisMonth = () => new Date(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, 1);
  const [month, setMonth] = useState(thisMonth);
  const [selected, setSelected] = useState<string | null>(todayKey);

  const byDay = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of trades) {
      const k = t.date.slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [trades]);

  // 6 rows × 7 days, starting on the Monday on/before the 1st of the month.
  const weeks = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    const days: Day[] = Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      /*
       * A cell is a calendar date, not a moment in time: its key comes straight from
       * the year, month and day. Converting it through a timezone would move midnight
       * here to the evening before in New York and shift every trade a day later.
       */
      const key = cellKey(date);
      const ts = byDay.get(key) ?? [];
      return {
        key,
        date,
        inMonth: date.getMonth() === month.getMonth(),
        trades: ts,
        pct: ts.filter(isClosed).reduce((a, t) => a + tradePct(t), 0),
      };
    });
    const rows = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
    // Drop a trailing week that belongs entirely to the next month.
    return rows.filter((row) => row.some((d) => d.inMonth));
  }, [month, byDay]);

  const monthDays = weeks.flat().filter((d) => d.inMonth && d.trades.length);
  const peak = Math.max(...monthDays.map((d) => Math.abs(d.pct)), 0.001);
  const monthPct = monthDays.reduce((a, d) => a + d.pct, 0);
  const greenDays = monthDays.filter((d) => d.pct > 0).length;
  const redDays = monthDays.filter((d) => d.pct < 0).length;
  const monthTrades = monthDays.reduce((a, d) => a + d.trades.length, 0);

  const shift = (n: number) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const selectedTrades = selected ? byDay.get(selected) ?? [] : [];
  const selectedCheckIn = checkins.find((c) => c.date === selected);

  return (
    <div className={cx(compact ? "flex h-full min-h-0 flex-col gap-2" : "space-y-4")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="px-2" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Button>
          <h2 className="w-40 text-center text-[15px] font-semibold">
            {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </h2>
          <Button variant="ghost" className="px-2" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="ghost"
            className="text-[12px]"
            onClick={() => {
              setMonth(thisMonth());
              setSelected(todayKey);
            }}
          >
            Today
          </Button>
        </div>
        <div className={cx("num flex gap-5 text-soft", compact ? "text-[12px]" : "text-[13px]")}>
          <span>
            Month <b className="font-medium text-ink">{fmtPct(monthPct)}</b>
          </span>
          <span>{monthTrades} trade{monthTrades === 1 ? "" : "s"}</span>
          {!compact && (
            <span>
              {greenDays} green · {redDays} red days
            </span>
          )}
        </div>
      </div>

      {!compact && doc && <WeekAhead doc={doc} calendar={calendar} />}

      <div
        className={cx(
          compact
            ? "min-h-0 flex-1 overflow-hidden rounded-lg border"
            : "card overflow-x-auto",
        )}
      >
        <div
          className={cx(
            "grid",
            compact
              ? "h-full grid-cols-7 grid-rows-[auto_repeat(var(--weeks),minmax(0,1fr))]"
              : "min-w-[720px] grid-cols-[repeat(7,1fr)_0.9fr]",
          )}
          style={compact ? ({ "--weeks": weeks.length } as React.CSSProperties) : undefined}
        >
          {(compact ? WEEKDAYS : [...WEEKDAYS, "Week"]).map((d) => (
            <div
              key={d}
              className={cx(
                "border-b text-[10px] font-medium uppercase tracking-[0.1em] text-faint",
                compact ? "px-2 py-1.5" : "px-4 py-3",
              )}
            >
              {compact ? d[0] + d[1] : d}
            </div>
          ))}

          {weeks.map((week, w) => {
            const weekDays = week.filter((d) => d.inMonth);
            const weekPct = weekDays.reduce((a, d) => a + d.pct, 0);
            const weekTrades = weekDays.reduce((a, d) => a + d.trades.length, 0);
            const weekKey = weekOfDay(week[0].key);
            const half = judged?.timeline.halfWeeks.has(weekKey);
            return [
              ...week.map((d, i) => (
                <DayCell
                  key={d.key}
                  day={d}
                  peak={peak}
                  checkin={checkins.find((c) => c.date === d.key)}
                  rules={compact ? null : rulesOf(d.key, d.trades, i < 5)}
                  compact={compact}
                  isToday={d.key === todayKey}
                  isSelected={d.key === selected}
                  onClick={() => {
                    setSelected(d.key);
                    // On the board there's no day panel, so a day with trades opens the
                    // first one directly — one click from calendar to the trade itself.
                    if (compact && d.trades.length) onOpen(d.trades[0]);
                  }}
                />
              )),
              compact ? null : (
              <div
                key={`w${w}`}
                className="group/week flex min-h-[88px] flex-col justify-center gap-0.5 border-b px-3 py-2 last:border-b-0"
              >
                {weekTrades > 0 && (
                  <>
                    <span className="num text-[14px] font-medium text-soft">{fmtPct(weekPct)}</span>
                    <span className="num text-[11px] text-faint">
                      {weekTrades} trade{weekTrades === 1 ? "" : "s"}
                    </span>
                  </>
                )}
                {half && <span className="text-[10px] font-medium text-warn">half risk</span>}
              </div>
              ),
            ];
          })}
        </div>
      </div>

      {selected && !compact && (
        <div className="card px-6 py-5">
          <h3 className="mb-3 text-[14px] font-semibold">
            {new Date(`${selected}T00:00`).toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h3>
          {selectedCheckIn && <DayCheckIn checkin={selectedCheckIn} />}
          {(() => {
            const r = rulesOf(selected, selectedTrades, ![0, 6].includes(new Date(`${selected}T12:00`).getDay()));
            if (!r) return null;
            if (!r.skip.length && !r.dayOff && !r.overTrades && !r.flags.length) return null;
            return (
              <div className="mb-4 space-y-1 text-[12px]">
                {r.skip.length > 0 && <p className="text-down">Skip day: {r.skip.join(", ")}</p>}
                {r.dayOff && (
                  <p className="text-down">
                    {r.dayOff.reason === "rule-break" ? "Day off after a rule break" : `Day off — after a limit broken on ${r.dayOff.from}`}
                  </p>
                )}
                {r.overTrades && <p className="font-medium text-down">More than one trade — the one-trade rule was broken.</p>}
                {r.flags.length > 0 && <p className="text-warn">Flags: {r.flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}</p>}
              </div>
            );
          })()}
          {selectedTrades.length === 0 ? (
            <p className="text-soft">No trades on this day.</p>
          ) : (
            <ul className="-mx-2">
              {selectedTrades.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => onOpen(t)}
                    className="num flex w-full items-center gap-4 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-subtle"
                  >
                    <span className="w-12 text-faint">{fmtTime(t.date)}</span>
                    <span className="w-24 font-medium">{t.symbol}</span>
                    <span className="w-14 text-soft">{t.direction === "long" ? "Long" : "Short"}</span>
                    <span className="w-10 shrink-0">{isGrade(t.grade) && <GradeBadge grade={t.grade} size="sm" />}</span>
                    <span className="min-w-0 max-w-xl flex-1 truncate text-soft">{setupOf(t)}</span>
                    <span className={cx("w-16 text-right font-medium", tone(t.resultR))}>
                      {t.resultR == null ? "open" : fmtR(t.resultR)}
                    </span>
                    <span className={cx("w-16 text-right font-medium", tone(isClosed(t) ? tradePct(t) : null))}>
                      {isClosed(t) ? fmtPct(tradePct(t)) : "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    </div>
  );
}

/** Compact view of the day's check-in: verdict, score, every answer and the note. */
function DayCheckIn({ checkin }: { checkin: CheckIn }) {
  return (
    <div className="mb-4 rounded-lg bg-subtle px-4 py-3">
      <div className={cx("flex items-center gap-2 text-[13px] font-medium", verdictColor[checkin.verdict])}>
        <span className="size-2 rounded-full bg-current" />
        {VERDICTS[checkin.verdict].label}
        <span className="num font-normal text-faint">{checkin.score}/100</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        {QUESTIONS.map((q) => {
          const o = q.options[checkin.answers[q.id]];
          if (!o) return null;
          return (
            <span key={q.id}>
              <span className="text-faint">{q.short}:</span>{" "}
              <span className={cx(o.risk === 2 ? "text-down" : o.risk === 1 ? "text-warn" : "text-soft")}>
                {o.label}
              </span>
            </span>
          );
        })}
      </div>
      {checkin.note && <p className="mt-2 text-[12px] italic text-soft">“{checkin.note}”</p>}
    </div>
  );
}

function DayCell({
  day,
  peak,
  checkin,
  rules,
  isToday,
  isSelected,
  onClick,
  compact,
}: {
  day: Day;
  peak: number;
  checkin?: CheckIn;
  rules?: DayRules | null;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const n = day.trades.length;
  const hasClosed = day.trades.some(isClosed);
  const intensity = hasClosed ? heat(day.pct, peak) : 0;
  /* Green and red live in the text and a thin edge — the cell itself stays dark. */
  const hue = day.pct >= 0 ? "var(--color-up)" : "var(--color-down)";

  return (
    <button
      onClick={onClick}
      style={
        intensity
          ? {
              backgroundColor: `color-mix(in oklab, ${hue} ${2 + intensity * 6}%, var(--color-surface))`,
              boxShadow: `inset 2px 0 0 color-mix(in oklab, ${hue} ${34 + intensity * 56}%, transparent)`,
            }
          : undefined
      }
      className={cx(
        "group relative flex overflow-hidden border-b border-r text-left transition-[transform,background-color] duration-200",
        compact
          ? "min-h-0 flex-row items-baseline justify-between gap-1 px-2 py-1"
          : "min-h-[104px] flex-col items-start gap-1.5 px-4 py-3",
        !day.inMonth && "opacity-25",
        "hover:bg-raised",
        isSelected && "ring-1 ring-inset ring-line",
      )}
    >
      {n > 0 && !compact && (
        <span className="pointer-events-none absolute left-1/2 top-full z-20 hidden -translate-x-1/2 translate-y-1 group-hover:block">
          <span className="glass block min-w-[190px] rounded-xl border px-3 py-2 text-[12px] shadow-xl">
            <span className="num block text-faint">
              {day.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            </span>
            {day.trades.map((t) => (
              <span key={t.id} className="num mt-1 flex justify-between gap-3">
                <span className="text-soft">{t.symbol}</span>
                <span className={tone(t.resultR)}>
                  {t.resultR == null ? "open" : fmtR(t.resultR)}
                </span>
              </span>
            ))}
            {checkin && (
              <span className="mt-1.5 block border-t pt-1.5 text-[11px] text-faint">
                Check-in {checkin.score}/100
              </span>
            )}
          </span>
        </span>
      )}
      <span
        className={cx(
          "num flex items-center justify-center rounded-full",
          compact ? "size-5 text-[11px]" : "size-6 text-[12px]",
          isToday ? "bg-ink font-semibold text-bg" : "text-soft",
        )}
      >
        {day.date.getDate()}
      </span>
      {n > 0 && (
        <span className={cx(compact ? "flex items-baseline gap-1" : "contents")}>
          <span
            className={cx(
              "num font-medium",
              compact ? "text-[11px]" : "text-[14px]",
              hasClosed ? tone(day.pct) : "text-faint",
              hasClosed && (day.pct >= 0 ? "glow-up" : "glow-down"),
            )}
          >
            {hasClosed ? fmtPct(day.pct, compact ? 1 : 2) : "open"}
          </span>
          {!compact && (
            <span className={cx("num text-[10px]", rules?.overTrades ? "font-medium text-down" : "text-faint")}>
              {n} trade{n > 1 ? "s" : ""}
              {rules?.overTrades && " ⚠ one-trade rule"}
            </span>
          )}
          {compact && n > 1 && <span className="num text-[10px] text-down">⚠{n}</span>}
        </span>
      )}
      {/* The rules' read of the day, in one quiet line at the bottom. */}
      {rules && !compact && (
        <span className="mt-auto flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
          {checkin && (
            <span
              className={cx("size-1.5 rounded-full bg-current", verdictColor[checkin.verdict])}
              title={`Check-in: ${VERDICTS[checkin.verdict].label} (${checkin.score})`}
            />
          )}
          {rules.skip.length > 0 && (
            <span className="text-down" title={rules.skip.join(", ")}>skip day</span>
          )}
          {rules.dayOff && <span className="font-medium text-down">day off</span>}
          {rules.flags.length > 0 && (
            <span className="text-warn" title={rules.flags.map((f) => FLAG_LABEL[f]).join(", ")}>
              ⚠ {rules.flags.length}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/* ── The week's no-trade days ────────────────────────────────────────── */

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/**
 * Monday to Friday of this New York week — or of the next one at the weekend — and which
 * of those days the news rules close completely. A day the calendar doesn't cover yet
 * says so, rather than passing for a quiet one.
 */
function WeekAhead({ doc, calendar }: { doc: Rulebook; calendar: CalendarEvent[] }) {
  const today = deskDay();
  const wd = weekdayOf(today);
  const monday = wd === 6 ? addDays(today, 2) : wd === 0 ? addDays(today, 1) : addDays(today, 1 - wd);
  const covered = coveredDays(calendar);
  const days = Array.from({ length: 5 }, (_, i) => {
    const key = addDays(monday, i);
    const known = covered != null && key >= covered.from && key <= covered.to;
    const nd = newsDay(key, calendar.filter((e) => e.at && deskDay(new Date(e.at)) === key).map(fromEvent), doc.news);
    const skip = known ? nd.skip : inSkipRange(key, doc.news) ? ["the year-end break"] : null;
    return { key, skip, windows: known ? nd.windows.length : null };
  });
  const closed = days.filter((d) => d.skip?.length).length;

  return (
    <section className="anim-rise card px-5 py-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold">{wd === 0 || wd === 6 ? "Next week" : "This week"}</h3>
        <p className="text-[12px] text-faint">
          {closed ? `${closed} day${closed === 1 ? "" : "s"} with no trading because of news` : "No news closes a day"}
        </p>
      </header>
      <ol className="grid grid-cols-5 gap-2">
        {days.map((d, i) => {
          const off = Boolean(d.skip?.length);
          const past = d.key < today;
          return (
            <li
              key={d.key}
              title={off ? d.skip!.join(", ") : undefined}
              className={cx(
                "anim-pop min-w-0 rounded-xl border px-3 py-2.5 transition-opacity",
                off ? "border-down/30 bg-down/10" : "bg-surface/40",
                d.key === today && "ring-1 ring-accent/60",
                past && "opacity-50",
              )}
              style={stagger(i, 60)}
            >
              <p className="num text-[11px] text-faint">
                {new Date(`${d.key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}
              </p>
              {off ? (
                <>
                  <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-down">
                    <Ban size={12} className="shrink-0" /> No trading
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-soft">{d.skip![0]}</p>
                </>
              ) : d.skip == null ? (
                <p className="mt-1 text-[12px] text-faint">Calendar not out yet</p>
              ) : (
                <>
                  <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-up">
                    <Check size={12} className="shrink-0" /> Tradable
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-faint">
                    {d.windows ? `${d.windows} release window${d.windows === 1 ? "" : "s"}` : "no release windows"}
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
