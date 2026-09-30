import { ChevronDown, ExternalLink, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { highlight, isImportant } from "@/lib/alerts";
import {
  ALL_CURRENCIES,
  DEFAULT_FILTERS,
  IMPACTS,
  TYPE_OPTIONS,
  type CalendarFilters,
  type Impact,
  type VolatilityWindow,
  deskMinutes,
  impactColour,
  loadFilters,
  loadFiltersOpen,
  passes,
  saveFilters,
  saveFiltersOpen,
  splitByDay,
  typeLabel,
  untilLabel,
  volatilityWindows,
  windowPhase,
} from "@/lib/calendarView";
import { type CalendarEvent, type Headline } from "@/lib/news";
import type { NewsState } from "@/lib/useNews";
import { NEWS_CATEGORIES, NEWS_CURRENCIES, categoryLabel, categoryOf } from "@/lib/newsRules";
import { DESK_LABEL, deskDateLabel, deskDay, deskStamp, deskTime } from "@/lib/tz";
import { Chips, cx, stagger } from "./ui";

/** Everything is shown on the desk's clock, whatever timezone the feed used. */
const time = (iso: string) => deskTime(iso);

const dayLabel = (iso: string, now = new Date()) => {
  const day = deskDay(new Date(iso));
  if (day === deskDay(now)) return "Today";
  if (day === deskDay(new Date(now.getTime() + 86_400_000))) return "Tomorrow";
  return deskDateLabel(iso);
};

const ago = (iso: string | null) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export function NewsView({ news }: { news: NewsState }) {
  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">News</h2>
          <p className="text-[12px] text-faint">
            Today first, on {DESK_LABEL} time — when the day will move, what already
            printed, then the rest of the week. The raw wire underneath.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={news.refresh}
            disabled={news.loadingCalendar || news.loadingWire}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-soft hover:bg-subtle hover:text-ink disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={news.loadingWire ? "animate-spin" : undefined}
            />{" "}
            Refresh
          </button>
        </div>
      </div>

      <Calendar news={news} />
      <Wire news={news} />
    </div>
  );
}

/* ── Left column: today's calendar ───────────────────────────────────── */

/** Re-renders on a slow tick so countdowns and the "now" line keep moving. */
function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/**
 * Built for a day trader: today on top, answering "when will it move?", and the
 * rest of the week folded away underneath.
 */
function Calendar({ news }: { news: NewsState }) {
  const [filters, setFilters] = useState<CalendarFilters>(loadFilters);
  /* Closed by default: the map and the day are what you come for, not the knobs. */
  const [filtersOpen, setFiltersOpen] = useState(loadFiltersOpen);
  const now = useNow();

  useEffect(() => saveFilters(filters), [filters]);
  useEffect(() => saveFiltersOpen(filtersOpen), [filtersOpen]);
  const update = (patch: Partial<CalendarFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const loading = news.loadingCalendar && !news.events.length;
  const error = news.calendarError;

  const shown = useMemo(
    () => news.events.filter((e) => passes(e, filters)),
    [news.events, filters],
  );
  const split = useMemo(() => splitByDay(shown, new Date(now)), [shown, now]);
  const windows = useMemo(() => volatilityWindows(split.today), [split.today]);
  const upcoming = split.today.filter((e) => Date.parse(e.at!) >= now);
  const done = split.today.filter((e) => Date.parse(e.at!) < now);

  /* The next red release on your currencies, even if it is days away. */
  const nextRed = useMemo(
    () =>
      news.events
        .filter(
          (e) =>
            e.impact === "High" &&
            e.at &&
            Date.parse(e.at) >= now &&
            filters.currencies.includes(e.currency),
        )
        .sort((a, b) => a.at!.localeCompare(b.at!))[0] ?? null,
    [news.events, filters.currencies, now],
  );

  return (
    <section className="card overflow-hidden">
      <header className="flex items-baseline justify-between border-b px-5 py-3.5">
        <h3 className="text-[14px] font-semibold">Today · {deskDateLabel(new Date(now))}</h3>
        <div className="flex items-center gap-3 text-[11px] text-faint">
          <span>
            {loading ? (
              "loading"
            ) : (
              <>
                {shown.length} of {news.events.length} shown
                {news.stale && <span className="text-warn"> · cached</span>}
              </>
            )}
          </span>
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className={cx(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] transition-colors duration-200",
              filtersOpen ? "border-soft text-ink" : "text-soft hover:text-ink",
            )}
          >
            <SlidersHorizontal size={12} />
            Filters
            {!filtersOpen && <FilterSummary filters={filters} />}
            <ChevronDown
              size={12}
              className={cx("transition-transform duration-200", filtersOpen && "rotate-180")}
            />
          </button>
        </div>
      </header>

      {filtersOpen && <FilterBar filters={filters} onChange={update} />}

      {error && !news.events.length ? (
        <Empty
          title="Calendar unavailable"
          body={`${error}. The feed limits how often it can be read; the desk keeps the last copy and tries again later.`}
        />
      ) : loading ? (
        <SkeletonRows rows={7} />
      ) : (
        <div>
          <DayMap events={split.today} now={now} />
          {/* Wide screens: "when will it move" on the left, the releases on the right. */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(340px,2fr)_5fr]">
            <div className="border-b xl:border-b-0 xl:border-r">
              <NextUp nextRed={nextRed} windows={windows} now={now} />
              <WeekAhead days={split.later} now={now} />
            </div>
            <div className="min-w-0">
              <Section title="Still to come today" count={upcoming.length}>
                {upcoming.length ? (
                  upcoming.map((e, i) => <Row key={e.id} event={e} now={now} index={i} countdown />)
                ) : (
                  <Quiet>Nothing left today with these filters.</Quiet>
                )}
              </Section>

              {!filters.hidePast && done.length > 0 && (
                <Section title="Already happened today" count={done.length}>
                  {done.map((e, i) => (
                    <Row key={e.id} event={e} now={now} index={upcoming.length + i} />
                  ))}
                </Section>
              )}

              {/* The rest of the week, open: scanning it is the point. */}
              {split.later.map((d, i) => (
                <DaySection
                  key={d.day}
                  label={weekDayLabel(d.events[0].at!, new Date(now))}
                  events={d.events}
                  now={now}
                  index={i}
                />
              ))}
              {split.undated.length > 0 && (
                <DaySection label="No set time" events={split.undated} now={now} index={split.later.length} />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Filters ─────────────────────────────────────────────────────────── */

/** What the filters are set to, in a few characters, while the panel is closed. */
function FilterSummary({ filters }: { filters: CalendarFilters }) {
  const currencies =
    filters.currencies.length === ALL_CURRENCIES.length
      ? "all"
      : filters.currencies.length <= 3
        ? filters.currencies.join(" ")
        : `${filters.currencies.length} ccy`;
  return (
    <span className="flex items-center gap-1.5 border-l pl-2 text-faint">
      {IMPACTS.filter((i) => filters.impacts.includes(i.id)).map((i) => (
        <span key={i.id} className="size-1.5 rounded-full" style={{ backgroundColor: i.colour }} />
      ))}
      <span className="num">{currencies}</span>
    </span>
  );
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: CalendarFilters;
  onChange: (patch: Partial<CalendarFilters>) => void;
}) {
  const visibleTypes = TYPE_OPTIONS.filter((t) => !filters.hiddenTypes.includes(t));

  return (
    <div className="space-y-2.5 border-b px-5 py-3">
      <FilterRow label="Impact">
        <div className="flex flex-wrap gap-1.5">
          {IMPACTS.map((i) => {
            const on = filters.impacts.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                title={i.hint}
                onClick={() =>
                  onChange({
                    impacts: on
                      ? filters.impacts.filter((x) => x !== i.id)
                      : [...filters.impacts, i.id],
                  })
                }
                className={cx(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-[color,opacity,border-color] duration-200 active:scale-[0.97]",
                  on ? "border-soft text-ink" : "text-faint opacity-55 hover:opacity-100",
                )}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: i.colour }} />
                {i.label}
              </button>
            );
          })}
        </div>
      </FilterRow>

      <FilterRow
        label="Currency"
        extra={
          <QuickPicks
            picks={[
              ["mine", () => onChange({ currencies: [...NEWS_CURRENCIES] })],
              ["all", () => onChange({ currencies: [...ALL_CURRENCIES] })],
            ]}
          />
        }
      >
        <Chips
          options={ALL_CURRENCIES}
          value={filters.currencies}
          onChange={(v) => onChange({ currencies: v })}
        />
      </FilterRow>

      <FilterRow
        label="Type"
        extra={
          <QuickPicks
            picks={[
              ["all", () => onChange({ hiddenTypes: [] })],
              ["none", () => onChange({ hiddenTypes: [...TYPE_OPTIONS] })],
            ]}
          />
        }
      >
        <Chips
          options={TYPE_OPTIONS}
          value={visibleTypes}
          labelOf={typeLabel}
          titleOf={(id) => NEWS_CATEGORIES.find((c) => c.id === id)?.hint ?? "Everything unnamed"}
          onChange={(v) => onChange({ hiddenTypes: TYPE_OPTIONS.filter((t) => !v.includes(t)) })}
        />
      </FilterRow>
      <FilterRow label="Show">
        <Chips
          options={["hidePast"]}
          value={filters.hidePast ? ["hidePast"] : []}
          labelOf={() => "Hide what already happened"}
          onChange={(v) => onChange({ hidePast: v.includes("hidePast") })}
        />
      </FilterRow>

      <div className="flex items-center gap-4 pt-0.5 text-[11px] text-faint">
        <button onClick={() => onChange(DEFAULT_FILTERS)} className="hover:text-ink">
          reset filters
        </button>
      </div>
    </div>
  );
}

const FilterRow = ({
  label,
  extra,
  children,
}: {
  label: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="flex items-start gap-3">
    <span className="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-[0.08em] text-faint">
      {label}
    </span>
    <div className="min-w-0 flex-1">{children}</div>
    {extra}
  </div>
);

const QuickPicks = ({ picks }: { picks: [string, () => void][] }) => (
  <div className="flex shrink-0 gap-2 pt-1.5 text-[11px] text-faint">
    {picks.map(([label, onClick]) => (
      <button key={label} onClick={onClick} className="hover:text-ink">
        {label}
      </button>
    ))}
  </div>
);

/* ── The day at a glance ─────────────────────────────────────────────── */

/** The sessions that set the day's rhythm, on New York's clock. */
const SESSIONS = [
  { label: "London", from: 3 * 60, to: 11 * 60 + 30, colour: "var(--color-cyan)" },
  { label: "New York", from: 8 * 60, to: 17 * 60, colour: "var(--color-accent)" },
];
const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const DOT_SIZE: Record<Impact, number> = { High: 10, Medium: 8, Low: 6, Holiday: 6 };
const STRENGTH: Record<Impact, number> = { High: 0, Medium: 1, Low: 2, Holiday: 3 };
const pct = (minutes: number) => `${(minutes / 1440) * 100}%`;

/**
 * One strip for the whole New York day. The sessions are shaded bands, every release
 * is a dot in its folder colour, and where the dots pile up is where price will move.
 */
function DayMap({ events, now }: { events: CalendarEvent[]; now: number }) {
  const nowMin = deskMinutes(new Date(now).toISOString());

  // Releases in the same minute stack, strongest at the bottom.
  const stacks = useMemo(() => {
    const by = new Map<number, CalendarEvent[]>();
    for (const e of events) {
      const m = deskMinutes(e.at!);
      const list = by.get(m);
      if (list) list.push(e);
      else by.set(m, [e]);
    }
    return [...by.entries()].map(([minute, list]) => ({
      minute,
      events: list.sort((a, b) => STRENGTH[a.impact] - STRENGTH[b.impact]),
    }));
  }, [events]);

  return (
    <div className="border-b px-5 pb-3 pt-4">
      <div className="mb-2.5 flex items-baseline justify-between text-[11px] text-faint">
        <span className="font-medium uppercase tracking-[0.08em]">Volatility map</span>
        <span>{DESK_LABEL} time</span>
      </div>

      <div className="relative h-[92px] overflow-hidden rounded-md">
        {Array.from({ length: 23 }, (_, i) => (
          <div
            key={i}
            className="absolute inset-y-0 w-px bg-line"
            style={{ left: pct((i + 1) * 60) }}
          />
        ))}
        <div className="absolute inset-y-0 left-0 bg-subtle" style={{ width: pct(nowMin) }} />
        {SESSIONS.map((s) => (
          <div
            key={s.label}
            className="anim-grow absolute inset-y-0"
            style={{
              left: pct(s.from),
              width: pct(s.to - s.from),
              background: `color-mix(in oklab, ${s.colour} 9%, transparent)`,
              animationDelay: s.label === "London" ? "0ms" : "180ms",
            }}
          >
            <span
              className="absolute left-1 top-0.5 text-[9px] font-medium uppercase tracking-[0.08em]"
              style={{ color: s.colour }}
            >
              {s.label}
            </span>
          </div>
        ))}

        {stacks.map(({ minute, events: list }, si) => (
          <div
            key={minute}
            className={cx(
              "absolute bottom-1.5 flex -translate-x-1/2 flex-col-reverse items-center gap-[3px]",
              minute < nowMin && "opacity-40",
            )}
            style={{ left: pct(minute) }}
          >
            {list.map((e, di) => (
              <span
                key={e.id}
                title={`${time(e.at!)} ${e.currency} ${e.title}`}
                className="anim-stamp rounded-full"
                style={{
                  width: DOT_SIZE[e.impact],
                  height: DOT_SIZE[e.impact],
                  backgroundColor: impactColour(e.impact),
                  boxShadow: e.impact === "High" ? `0 0 8px ${impactColour(e.impact)}` : undefined,
                  // After the session bands, left to right across the day.
                  animationDelay: `${Math.min(300 + (si * 2 + di) * 60, 1400)}ms`,
                }}
              />
            ))}
          </div>
        ))}

        <div className="absolute inset-y-0 w-px bg-ink" style={{ left: pct(nowMin) }}>
          <span className="absolute right-1 top-0.5 text-[9px] font-medium uppercase text-ink">
            now
          </span>
        </div>
      </div>

      <div className="num relative mt-1 h-4 text-[10px] text-faint">
        {TICKS.map((h) => (
          <span
            key={h}
            className="absolute"
            style={{
              left: pct(h * 60),
              transform: h === 0 ? undefined : h === 24 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The next red release, then today's volatile stretches with how far away each is. */
function NextUp({
  nextRed,
  windows,
  now,
}: {
  nextRed: CalendarEvent | null;
  windows: VolatilityWindow[];
  now: number;
}) {
  return (
    <div className="space-y-4 px-5 py-4">
      {/* The release gets its own line: in this narrow column a name sharing the row
          with the time and countdown was always cut off. */}
      <div className="text-[13px]">
        <div className="flex items-baseline gap-3">
          <span className="w-16 shrink-0 text-[11px] uppercase tracking-[0.08em] text-faint">
            Next red
          </span>
          {nextRed ? (
            <>
              <span className="num shrink-0 text-soft">
                {deskDay(new Date(nextRed.at!)) === deskDay(new Date(now))
                  ? time(nextRed.at!)
                  : `${dayLabel(nextRed.at!, new Date(now))} ${time(nextRed.at!)}`}
              </span>
              <span className="num ml-auto shrink-0 font-medium text-down">
                {untilLabel(Date.parse(nextRed.at!) - now)}
              </span>
            </>
          ) : (
            <span className="text-soft">No more red releases in the feed</span>
          )}
        </div>
        {nextRed && (
          <div className="mt-1 pl-[76px] font-medium leading-snug">
            {nextRed.currency} {nextRed.title}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[11px] uppercase tracking-[0.08em] text-faint">
          Volatile windows today
        </div>
        {windows.length === 0 ? (
          <p className="text-[12px] text-soft">No red or orange releases today with these filters.</p>
        ) : (
          windows.map((w, wi) => {
            const phase = windowPhase(w, now);
            const count = (i: Impact) => w.events.filter((e) => e.impact === i).length;
            return (
              <div key={w.start} className="anim-rise" style={stagger(wi, 70)}>
              <div className={cx("flex items-center gap-3 py-1 text-[12px]", phase === "done" && "opacity-45")}>
                <span className="num w-[88px] shrink-0 text-soft">
                  {deskTime(new Date(w.start))}
                  {w.end > w.start && `–${deskTime(new Date(w.end))}`}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {(["High", "Medium"] as const).map(
                    (i) =>
                      count(i) > 0 && (
                        <span key={i} className="num flex items-center gap-1 text-soft">
                          <span className="size-2 rounded-full" style={{ backgroundColor: impactColour(i) }} />
                          {count(i)}
                        </span>
                      ),
                  )}
                </span>
                <span className="min-w-0 truncate text-soft">
                  {[...new Set(w.events.map((e) => e.currency))].join(", ")}
                </span>
                <span
                  className={cx(
                    "num ml-auto shrink-0",
                    phase === "live" ? "font-medium text-down" : "text-faint",
                  )}
                >
                  {phase === "ahead"
                    ? untilLabel(w.start - now)
                    : phase === "live"
                      ? "volatile now"
                      : "done"}
                </span>
              </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * The rest of the week in a few lines — which days carry red news, and when each is
 * busiest — so the week's shape is readable before scrolling the list beside it.
 */
function WeekAhead({ days, now }: { days: { day: string; events: CalendarEvent[] }[]; now: number }) {
  if (!days.length) return null;
  return (
    <div className="border-t px-5 py-4">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-faint">Week ahead</div>
      {days.map((d, i) => {
        const count = (x: Impact) => d.events.filter((e) => e.impact === x).length;
        const busiest = volatilityWindows(d.events).sort(
          (a, b) => b.events.length - a.events.length || a.start - b.start,
        )[0];
        return (
          <div key={d.day} className="anim-rise flex items-center gap-3 py-1 text-[12px]" style={stagger(i, 70)}>
            <span className="w-[120px] shrink-0 truncate text-soft">{dayLabel(d.events[0].at!, new Date(now))}</span>
            <span className="flex w-20 shrink-0 items-center gap-2.5">
              {(["High", "Medium"] as const).map(
                (x) =>
                  count(x) > 0 && (
                    <span key={x} className="num flex items-center gap-1 text-soft">
                      <span className="size-2 rounded-full" style={{ backgroundColor: impactColour(x) }} />
                      {count(x)}
                    </span>
                  ),
              )}
            </span>
            <span className="min-w-0 truncate text-faint">
              {[...new Set(d.events.map((e) => e.currency))].join(", ")}
            </span>
            <span className="num ml-auto shrink-0 text-faint">
              {busiest ? `busiest ${deskTime(new Date(busiest.start))}` : "quiet"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Lists ───────────────────────────────────────────────────────────── */

const Section = ({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) => (
  <div>
    <div className="flex justify-between border-b bg-subtle px-5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
      <span>{title}</span>
      <span className="num">{count}</span>
    </div>
    {children}
  </div>
);

const Quiet = ({ children }: { children: React.ReactNode }) => (
  <p className="border-b px-5 py-4 text-[12px] text-soft">{children}</p>
);

/** "Tomorrow · Thursday 1 Oct", or just the date further out. */
const weekDayLabel = (iso: string, now: Date) => {
  const label = dayLabel(iso, now);
  return label === "Tomorrow" ? `Tomorrow · ${deskDateLabel(iso)}` : label;
};

/**
 * One later day of the week, open. The header gives the day at a glance — how many
 * red and orange releases, and when it is busiest — before any row is read.
 */
function DaySection({
  label,
  events,
  now,
  index,
}: {
  label: string;
  events: CalendarEvent[];
  now: number;
  index: number;
}) {
  const count = (i: Impact) => events.filter((e) => e.impact === i).length;
  const busiest = volatilityWindows(events).sort(
    (a, b) => b.events.length - a.events.length || a.start - b.start,
  )[0];

  return (
    <div className="anim-rise" style={stagger(index, 90)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-y bg-subtle px-5 py-2.5">
        <span className="text-[12px] font-semibold text-ink">{label}</span>
        <span className="flex items-center gap-3 text-[11px] text-soft">
          {(["High", "Medium", "Low", "Holiday"] as const).map(
            (i) =>
              count(i) > 0 && (
                <span key={i} className="num flex items-center gap-1">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: impactColour(i) }} />
                  {count(i)}
                </span>
              ),
          )}
        </span>
        {busiest && (
          <span className="num ml-auto text-[11px] text-faint">
            busiest {deskTime(new Date(busiest.start))}
            {busiest.end > busiest.start && `–${deskTime(new Date(busiest.end))}`}
          </span>
        )}
      </div>
      {events.map((e, i) => (
        <Row key={e.id} event={e} now={now} index={i} />
      ))}
    </div>
  );
}

function Row({
  event: e,
  now,
  index = 0,
  countdown = false,
}: {
  event: CalendarEvent;
  now: number;
  index?: number;
  countdown?: boolean;
}) {
  const at = e.at ? Date.parse(e.at) : null;
  const past = at != null && at < now;
  const cat = categoryOf(e);

  return (
    <div className="anim-rise border-b last:border-0" style={stagger(index)}>
    <div
      title={[
        IMPACTS.find((i) => i.id === e.impact)?.hint,
        cat && categoryLabel(cat),
      ]
        .filter(Boolean)
        .join(" · ")}
      className={cx(
        "flex items-center gap-3 px-5 py-2.5 transition-colors duration-300 hover:bg-raised",
        past && "opacity-45",
      )}
    >
      <span className="num w-12 shrink-0 text-[12px] text-soft">{e.at ? time(e.at) : "—"}</span>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{
          backgroundColor: impactColour(e.impact),
          boxShadow: e.impact === "High" ? `0 0 8px ${impactColour(e.impact)}` : undefined,
        }}
      />
      <span className="num w-9 shrink-0 text-[12px] font-medium text-ink">{e.currency}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{e.title}</span>
      {(e.forecast || e.previous) && (
        <span className="num hidden shrink-0 text-[11px] text-faint sm:block">
          {e.forecast && <>f/c {e.forecast}</>}
          {e.forecast && e.previous && " · "}
          {e.previous && <>prev {e.previous}</>}
        </span>
      )}
      {countdown && at != null && (
        <span className="num w-[62px] shrink-0 text-right text-[11px] text-soft">
          {untilLabel(at - now)}
        </span>
      )}
    </div>
    </div>
  );
}

/* ── Right column: the wire ──────────────────────────────────────────── */

/**
 * The squawk. One line per flash, timestamped to the second, urgent words lit up —
 * built to be scanned in a glance rather than read.
 */
function Wire({ news }: { news: NewsState }) {
  const [showAll, setShowAll] = useState(false);
  const flashes = showAll ? news.headlines : news.headlines.filter((h) => isImportant(h.title));

  return (
    <section className="card flex flex-col overflow-hidden">
      <header className="flex items-baseline justify-between border-b px-5 py-3.5">
        <h3 className="text-[14px] font-semibold">Wire</h3>
        <div className="flex items-center gap-3 text-[11px] text-faint">
          <button
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? "Only what matters" : "Include routine prints and broker notes"}
            className="hover:text-ink"
          >
            {showAll ? "key only" : "show all"}
          </button>
          <span>
            {news.loadingWire && !news.headlines.length
              ? "connecting"
              : news.fetchedAt
                ? `${flashes.length} · ${ago(news.fetchedAt)}`
                : ""}
          </span>
        </div>
      </header>

      {news.wireError && !news.headlines.length ? (
        <Empty title="Wire unavailable" body={news.wireError} />
      ) : !news.headlines.length ? (
        <SkeletonCards cards={7} />
      ) : !flashes.length ? (
        <Empty
          title="Nothing worth reading"
          body="No central bank, policy or geopolitical flashes in the last batch. Routine prints and broker notes are hidden — use “show all” to see them."
        />
      ) : (
        <div className="max-h-[620px] overflow-y-auto">
          {flashes.map((h, i) => {
            const day = h.at ? deskDay(new Date(h.at)) : "";
            const prev = flashes[i - 1];
            const newDay = i === 0 || day !== (prev.at ? deskDay(new Date(prev.at)) : "");
            return (
              <div key={h.id}>
                {newDay && (
                  <div className="glass sticky top-0 z-10 border-b px-5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
                    {h.at ? wireDayLabel(h.at) : "Undated"}
                  </div>
                )}
                <Flash flash={h} index={i} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** "Today", "Yesterday", or the date — on New York's calendar, like everything else. */
const wireDayLabel = (iso: string, now = new Date()) => {
  const day = deskDay(new Date(iso));
  if (day === deskDay(now)) return "Today";
  if (day === deskDay(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return deskDateLabel(iso);
};

/** Seconds matter on a wire: a print at 13:30:00 is not the same as 13:30:41. */
const stamp = (iso: string | null) => (iso ? deskStamp(iso) : "--:--:--");

function Flash({ flash, index }: { flash: Headline; index: number }) {
  const parts = highlight(flash.title);
  return (
    <a
      href={flash.url}
      target="_blank"
      rel="noreferrer noopener"
      className="anim-rise group flex gap-3 border-b px-5 py-2.5 transition-colors duration-300 last:border-0 hover:bg-raised"
      style={{ animationDelay: `${Math.min(index * 35, 700)}ms` }}
    >
      <span className="num shrink-0 pt-px text-[11px] tabular-nums text-faint">
        {stamp(flash.at)}
      </span>
      <span className="min-w-0 text-[13px] leading-snug text-ink">
        {parts.map((p, i) =>
          p.tone ? (
            <b
              key={i}
              className={cx("font-semibold", p.tone === "critical" ? "text-down" : "text-accent-2")}
              style={{
                textShadow: `0 0 10px var(--color-${p.tone === "critical" ? "down" : "accent"})`,
              }}
            >
              {p.text}
            </b>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </span>
      <ExternalLink
        size={11}
        className="mt-1 shrink-0 text-faint opacity-0 transition-opacity duration-300 group-hover:opacity-70"
      />
    </a>
  );
}

/* ── Waiting states ──────────────────────────────────────────────────── */

const SkeletonRows = ({ rows }: { rows: number }) => (
  <div className="px-5 py-3">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex items-center gap-3 py-3">
        <Bar className="w-10" delay={i * 90} />
        <Bar className="size-2 rounded-full" delay={i * 90 + 30} />
        <Bar className="w-8" delay={i * 90 + 60} />
        <Bar className="flex-1" delay={i * 90 + 90} />
      </div>
    ))}
  </div>
);

const SkeletonCards = ({ cards }: { cards: number }) => (
  <div className="px-5 py-3">
    {Array.from({ length: cards }, (_, i) => (
      <div key={i} className="space-y-2 py-4">
        <Bar className="w-24" delay={i * 110} />
        <Bar className="w-full" delay={i * 110 + 40} />
        <Bar className="w-2/3" delay={i * 110 + 80} />
      </div>
    ))}
  </div>
);

/** A pulsing bar, not a spinner — it shows the shape of what is coming. */
const Bar = ({ className, delay }: { className?: string; delay: number }) => (
  <div
    className={cx("h-3 rounded bg-subtle", className)}
    style={{ animation: `skeleton 1.8s ${delay}ms ease-in-out infinite` }}
  />
);

const Empty = ({ title, body }: { title: string; body: string }) => (
  <div className="px-5 py-12 text-center">
    <p className="text-[14px] font-medium">{title}</p>
    <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-soft">{body}</p>
  </div>
);
