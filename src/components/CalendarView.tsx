import { Ban, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { QUESTIONS, VERDICTS, type CheckIn } from "@/lib/checkin";
import { evaluateHistory, type DayOff } from "@/lib/discipline";
import { fmtPct, fmtR, fmtTime, tone } from "@/lib/format";
import type { CalendarEvent } from "@/lib/news";
import { coveredDays, fromEvent, fromTradeNews, inSkipRange, newsDay, type NewsItem } from "@/lib/newsRules";
import type { Rulebook } from "@/lib/rulebook";
import { WEEKDAYS, isClosed, tradePct } from "@/lib/stats";
import { deskDay } from "@/lib/tz";
import { FLAG_LABEL, isGrade, type Trade, type TradeFlag } from "@/lib/types";
import { GradeBadge } from "./GradeBadge";
import { verdictColor } from "./ReadinessMeter";
import { setupOf } from "./TradeList";
import { Button, Panel, cx, stagger } from "./ui";

/** What the rules made of one day: its flags, and whether it was off or skipped. */
interface DayRules {
  flags: TradeFlag[];
  dayOff: DayOff | null;
  skip: string[];
}

interface Day {
  key: string;
  date: Date;
  inMonth: boolean;
  /** Taken trades; setups not taken are counted apart. */
  trades: Trade[];
  passed: Trade[];
  pct: number;
}

/** How strongly a day is lit: scaled against the month's biggest move. */
const heat = (pct: number, peak: number) => Math.min(1, Math.abs(pct) / (peak || 1));

/** "YYYY-MM-DD" of a calendar cell, read from its own date parts — never through a timezone. */
const cellKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The month at a glance: every day's result, the days the rules close (skip days, days
 * off) said inside the tile, and the check-in's colour. Click a day for its trades.
 */
export function CalendarView({
  trades,
  checkins,
  doc,
  rulebookOf,
  calendar,
  onOpen,
}: {
  /** Every trade, setups not taken included. */
  trades: Trade[];
  checkins: CheckIn[];
  doc: Rulebook;
  rulebookOf: (v: string | null) => Rulebook;
  calendar: CalendarEvent[];
  onOpen: (t: Trade) => void;
}) {
  /* The rules over the whole history: flags and days off. */
  const judged = useMemo(() => evaluateHistory({ trades, checkins, rulebookOf }), [trades, checkins, rulebookOf]);
  const covered = useMemo(() => coveredDays(calendar), [calendar]);
  const today = deskDay();

  /** A day's rules: for weekdays up to today, and ahead of it what is already scheduled. */
  const rulesOf = (key: string, dayTrades: Trade[], weekday: boolean): DayRules | null => {
    if (!weekday) return null;
    const off = judged.timeline.dayOff.get(key) ?? null;
    const known = covered != null && key >= covered.from && key <= covered.to;
    const calendarItems = () => calendar.filter((e) => e.at && deskDay(new Date(e.at)) === key).map(fromEvent);
    if (key > today) {
      const ahead = known ? newsDay(key, calendarItems(), doc.news).skip : inSkipRange(key, doc.news) ? ["the year-end break"] : [];
      return off || ahead.length ? { flags: [], dayOff: off, skip: ahead } : null;
    }
    const items: NewsItem[] | null = known ? calendarItems() : dayTrades.length ? dayTrades.flatMap((t) => t.news).map(fromTradeNews) : null;
    const skip = items ? newsDay(key, items, doc.news).skip : inSkipRange(key, doc.news) ? ["the year-end break"] : [];
    return { flags: [...new Set(dayTrades.flatMap((t) => judged.byId.get(t.id)?.flags ?? t.flags))], dayOff: off, skip };
  };

  const thisMonth = () => new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  const [month, setMonth] = useState(thisMonth);
  const [selected, setSelected] = useState<string>(today);

  const byDay = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of trades) {
      const k = t.date.slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return map;
  }, [trades]);

  // Monday-first rows, starting on the Monday on or before the 1st.
  const weeks = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    const days: Day[] = Array.from({ length: 42 }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = cellKey(date);
      const all = byDay.get(key) ?? [];
      const taken = all.filter((t) => !t.skipped);
      return { key, date, inMonth: date.getMonth() === month.getMonth(), trades: taken, passed: all.filter((t) => t.skipped), pct: taken.filter(isClosed).reduce((a, t) => a + tradePct(t), 0) };
    });
    const rows = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
    return rows.filter((row) => row.some((d) => d.inMonth));
  }, [month, byDay]);

  const monthDays = weeks.flat().filter((d) => d.inMonth && d.trades.length);
  const peak = Math.max(...monthDays.map((d) => Math.abs(d.pct)), 0.001);
  const monthPct = monthDays.reduce((a, d) => a + d.pct, 0);
  const greenDays = monthDays.filter((d) => d.pct > 0).length;
  const redDays = monthDays.filter((d) => d.pct < 0).length;
  const monthTrades = monthDays.reduce((a, d) => a + d.trades.length, 0);

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const selectedAll = byDay.get(selected) ?? [];
  const selectedCheckIn = checkins.find((c) => c.date === selected);
  const selectedRules = rulesOf(selected, selectedAll.filter((t) => !t.skipped), ![0, 6].includes(new Date(`${selected}T12:00`).getDay()));

  return (
    <div className="space-y-5">
      <div className="anim-rise flex flex-wrap items-center gap-x-6 gap-y-3" style={stagger(1, 70)}>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="px-2" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </Button>
          <h2 key={month.toISOString()} className="anim-fade w-44 text-center text-title font-semibold">
            {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </h2>
          <Button variant="ghost" size="sm" className="px-2" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMonth(thisMonth());
              setSelected(today);
            }}
          >
            Today
          </Button>
        </div>
        <div className="num flex gap-5 text-small text-soft">
          <span>
            month <b className={cx("font-medium text-ink", tone(monthPct))}>{fmtPct(monthPct)}</b>
          </span>
          <span>
            {monthTrades} trade{monthTrades === 1 ? "" : "s"}
          </span>
          <span>
            {greenDays} green · {redDays} red days
          </span>
        </div>
      </div>

      <div className="card anim-rise overflow-x-auto" style={stagger(2, 70)}>
        <div key={month.toISOString()} className="grid min-w-[720px] grid-cols-[repeat(7,1fr)_0.9fr]">
          {[...WEEKDAYS, "Week"].map((d) => (
            <div key={d} className="eyebrow border-b px-4 py-3">
              {d}
            </div>
          ))}

          {weeks.map((week, w) => {
            const weekDays = week.filter((d) => d.inMonth);
            const weekPct = weekDays.reduce((a, d) => a + d.pct, 0);
            const weekTrades = weekDays.reduce((a, d) => a + d.trades.length, 0);
            return [
              ...week.map((d, i) => (
                <DayCell
                  key={d.key}
                  index={w * 7 + i}
                  day={d}
                  peak={peak}
                  checkin={checkins.find((c) => c.date === d.key)}
                  rules={rulesOf(d.key, d.trades, i < 5)}
                  isToday={d.key === today}
                  isSelected={d.key === selected}
                  onClick={() => setSelected(d.key)}
                />
              )),
              <div key={`w${w}`} className="flex min-h-[96px] flex-col justify-center gap-0.5 border-b px-4 py-2 last:border-b-0">
                {weekTrades > 0 && (
                  <>
                    <span className={cx("num text-title font-medium", tone(weekPct))}>{fmtPct(weekPct)}</span>
                    <span className="num text-caption text-faint">
                      {weekTrades} trade{weekTrades === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </div>,
            ];
          })}
        </div>
      </div>

      <Panel
        key={selected}
        index={3}
        title={new Date(`${selected}T00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        sub={selected === today ? "Today" : undefined}
      >
        {selectedCheckIn && <DayCheckIn checkin={selectedCheckIn} />}
        {selectedRules && (selectedRules.skip.length > 0 || selectedRules.dayOff || selectedRules.flags.length > 0) && (
          <div className="mb-4 space-y-1 text-small">
            {selectedRules.skip.length > 0 && <p className="text-down">No trading: {selectedRules.skip.join(", ")}.</p>}
            {selectedRules.dayOff && (
              <p className="text-down">{selectedRules.dayOff.reason === "rule-break" ? "Day off — a rule was broken." : `Day off — after a rule break on ${selectedRules.dayOff.from}.`}</p>
            )}
            {selectedRules.flags.length > 0 && <p className="text-down">Broken: {selectedRules.flags.map((f) => FLAG_LABEL[f].toLowerCase()).join(", ")}.</p>}
          </div>
        )}
        {selectedAll.length === 0 ? (
          <p className="text-body text-soft">Nothing logged on this day.</p>
        ) : (
          <ul className="-mx-2">
            {selectedAll.map((t, i) => (
              <li key={t.id} className="anim-rise" style={stagger(i, 50)}>
                <button onClick={() => onOpen(t)} className="num flex w-full items-center gap-4 rounded-lg px-2 py-2 text-left text-body transition-colors hover:bg-subtle">
                  <span className="w-12 text-faint">{fmtTime(t.date)}</span>
                  <span className={cx("w-14 font-sans font-medium", t.direction === "long" ? "text-up" : "text-down")}>{t.direction === "long" ? "Long" : "Short"}</span>
                  <span className="w-10 shrink-0">{isGrade(t.grade) && <GradeBadge grade={t.grade} size="sm" muted={t.skipped} />}</span>
                  <span className="min-w-0 flex-1 truncate font-sans text-soft">{setupOf(t)}</span>
                  {t.skipped ? (
                    <span className="w-40 text-right text-faint">not taken {t.hypotheticalR != null ? `(${fmtR(t.hypotheticalR)})` : ""}</span>
                  ) : (
                    <>
                      <span className={cx("w-16 text-right font-medium", tone(t.resultR))}>{t.resultR == null ? "open" : fmtR(t.resultR)}</span>
                      <span className={cx("w-20 text-right font-medium", tone(isClosed(t) ? tradePct(t) : null))}>{isClosed(t) ? fmtPct(tradePct(t)) : "—"}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** The day's check-in: verdict, score, every answer and the note. */
function DayCheckIn({ checkin }: { checkin: CheckIn }) {
  return (
    <div className="well mb-4 px-4 py-3">
      <div className={cx("flex items-center gap-2 text-body font-medium", verdictColor[checkin.verdict])}>
        <span className="size-2 rounded-full bg-current" />
        {VERDICTS[checkin.verdict].label}
        <span className="num font-normal text-faint">{checkin.score}/100</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-small">
        {QUESTIONS.map((q) => {
          const o = q.options[checkin.answers[q.id]];
          if (!o) return null;
          return (
            <span key={q.id}>
              <span className="text-faint">{q.short}:</span> <span className={cx(o.risk === 2 ? "text-down" : o.risk === 1 ? "text-warn" : "text-soft")}>{o.label}</span>
            </span>
          );
        })}
      </div>
      {checkin.note && <p className="mt-2 text-small italic text-soft">“{checkin.note}”</p>}
    </div>
  );
}

function DayCell({
  index,
  day,
  peak,
  checkin,
  rules,
  isToday,
  isSelected,
  onClick,
}: {
  index: number;
  day: Day;
  peak: number;
  checkin?: CheckIn;
  rules: DayRules | null;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const n = day.trades.length;
  const hasClosed = day.trades.some(isClosed);
  const intensity = hasClosed ? heat(day.pct, peak) : 0;
  const hue = day.pct >= 0 ? "var(--color-up)" : "var(--color-down)";
  // A day the rules close: said inside the tile, so the month shows them at a glance.
  const skip = rules?.skip.length ? rules.skip : null;
  const closed = skip ? { title: "No trading", why: skip[0], all: skip.join(", ") } : rules?.dayOff && !n ? { title: "Day off", why: "after a broken rule", all: "" } : null;

  return (
    <button
      onClick={onClick}
      style={{
        ...stagger(index, 12, 500),
        ...(intensity
          ? { backgroundColor: `color-mix(in oklab, ${hue} ${3 + intensity * 9}%, var(--color-surface))` }
          : closed
            ? { backgroundColor: "color-mix(in oklab, var(--color-down) 8%, var(--color-surface))" }
            : {}),
      }}
      className={cx(
        "anim-fade group relative flex min-h-[104px] flex-col items-start gap-1.5 overflow-hidden border-b border-r px-4 py-3 text-left transition-[background-color,box-shadow] duration-300",
        !day.inMonth && "opacity-25",
        "hover:bg-raised",
        isSelected && "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink)_30%,transparent)]",
      )}
    >
      <span className={cx("num flex size-6 items-center justify-center rounded-full text-small", isToday ? "bg-ink font-semibold text-bg" : "text-soft")}>{day.date.getDate()}</span>
      {closed && (
        <span className="anim-fade min-w-0 max-w-full" title={closed.all || undefined}>
          <span className="flex items-center gap-1.5 text-body font-semibold text-down">
            <Ban size={13} className="shrink-0" /> {closed.title}
          </span>
          <span className="mt-0.5 block truncate text-caption text-soft">{closed.why}</span>
        </span>
      )}
      {n > 0 && (
        <>
          <span className={cx("num text-title font-medium", hasClosed ? tone(day.pct) : "text-accent-2", hasClosed && (day.pct >= 0 ? "glow-up" : "glow-down"))}>
            {hasClosed ? fmtPct(day.pct) : "open"}
          </span>
          <span className="num text-caption text-faint">
            {n} trade{n > 1 ? "s" : ""}
          </span>
        </>
      )}
      {/* The rest of the day, in one quiet line at the bottom. */}
      {(checkin || day.passed.length > 0 || (rules && (rules.flags.length > 0 || (rules.dayOff && n > 0)))) && (
        <span className="mt-auto flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
          {checkin && <span className={cx("size-1.5 rounded-full bg-current", verdictColor[checkin.verdict])} title={`Check-in: ${VERDICTS[checkin.verdict].label} (${checkin.score})`} />}
          {day.passed.length > 0 && <span className="text-faint">{day.passed.length} not taken</span>}
          {rules?.flags.length ? (
            <span className="font-medium text-down" title={rules.flags.map((f) => FLAG_LABEL[f]).join(", ")}>
              ⚑ {rules.flags.length}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}
