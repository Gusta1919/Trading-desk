import { Ban, ChevronDown, ExternalLink, RefreshCw, SlidersHorizontal } from "lucide-react";
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
import {
  NEWS_CATEGORIES,
  NEWS_CURRENCIES,
  categoryLabel,
  categoryOf,
  fromEvent,
  newsDay,
  stanceOf,
  type NewsDay,
} from "@/lib/newsRules";
import type { NewsRules, TimeWindow } from "@/lib/rulebook";
import { DESK_LABEL, deskDateLabel, deskDay, deskStamp, deskTime } from "@/lib/tz";
import { Button, Chips, Empty, PageHeader, cx, stagger } from "./ui";

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

/**
 * The news, the way a day trader reads it: today first, on New York time — when the day
 * will move, what already printed — then the rest of the week, with the days the rulebook
 * closes marked. The raw wire underneath.
 */
export function NewsView({ news, rules, entryWindows }: { news: NewsState; rules: NewsRules; entryWindows: TimeWindow[] }) {
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="News"
        sub={`Today first, then the rest of the week, on ${DESK_LABEL} time. Only red releases count for the rules.`}
        actions={
          <Button variant="ghost" size="sm" onClick={news.refresh} disabled={news.loadingCalendar || news.loadingWire}>
            <RefreshCw size={13} className={news.loadingWire ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />
      <Calendar news={news} rules={rules} entryWindows={entryWindows} />
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
function Calendar({ news, rules, entryWindows }: { news: NewsState; rules: NewsRules; entryWindows: TimeWindow[] }) {
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
  /* What the rulebook makes of today — judged on every release, not only the ones the filters show. */
  const todayRules = useMemo(() => {
    const today = deskDay(new Date(now));
    return newsDay(today, news.events.filter((e) => e.at && deskDay(new Date(e.at)) === today).map(fromEvent), rules);
  }, [news.events, rules, now]);
  const windows = useMemo(() => volatilityWindows(split.today), [split.today]);
  /** Why the rulebook closes a day, judged on every release that day, not only the ones shown. */
  const skipOf = (day: string) =>
    newsDay(day, news.events.filter((e) => e.at && deskDay(new Date(e.at)) === day).map(fromEvent), rules).skip;
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
    <section className="card anim-rise overflow-hidden" style={stagger(1, 70)}>
      <header className="flex items-baseline justify-between border-b px-6 py-4">
        <h3 className="flex items-center gap-2.5 text-title font-semibold">
          Today · {deskDateLabel(new Date(now))}
          {todayRules.skip.length > 0 && <SkipBadge reasons={todayRules.skip} />}
        </h3>
        <div className="flex items-center gap-3 text-caption text-faint">
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
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-small transition-colors duration-200",
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
          <DayMap events={split.today} now={now} rules={todayRules} entryWindows={entryWindows} />
          {/* Wide screens: "when will it move" on the left, the releases on the right. */}
          {/* The week is listed once, on the right; the left column stays in view beside it. */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(340px,2fr)_5fr]">
            <div className="border-b xl:sticky xl:top-0 xl:self-start xl:border-b-0">
              <NextUp nextRed={nextRed} windows={windows} now={now} />
            </div>
            <div className="min-w-0 xl:border-l">
              <Section title="Still to come today" count={upcoming.length}>
                {upcoming.length ? (
                  upcoming.map((e, i) => <Row key={e.id} event={e} now={now} index={i} countdown rules={rules} />)
                ) : (
                  <Quiet>Nothing left today with these filters.</Quiet>
                )}
              </Section>

              {!filters.hidePast && done.length > 0 && (
                <Section title="Already happened today" count={done.length}>
                  {done.map((e, i) => (
                    <Row key={e.id} event={e} now={now} index={upcoming.length + i} rules={rules} />
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
                  rules={rules}
                  skip={skipOf(d.day)}
                />
              ))}
              {split.undated.length > 0 && (
                <DaySection label="No set time" events={split.undated} now={now} index={split.later.length} rules={rules} skip={[]} />
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
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-small transition-[color,opacity,border-color] duration-200 active:scale-[0.97]",
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

      <div className="flex items-center gap-4 pt-0.5 text-caption text-faint">
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
    <span className="w-16 shrink-0 pt-1.5 eyebrow">
      {label}
    </span>
    <div className="min-w-0 flex-1">{children}</div>
    {extra}
  </div>
);

const QuickPicks = ({ picks }: { picks: [string, () => void][] }) => (
  <div className="flex shrink-0 gap-2 pt-1.5 text-caption text-faint">
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

/** A skip day, said the way the Calendar says it: no trading, and why. */
function SkipBadge({ reasons }: { reasons: string[] }) {
  return (
    <span
      title={`No trading at all: ${reasons.join(", ")}`}
      className="anim-fade inline-flex min-w-0 items-center gap-1.5 rounded-full bg-down/12 px-2.5 py-0.5 text-caption font-semibold text-down"
    >
      <Ban size={11} className="shrink-0" />
      No trading
      <span className="truncate font-normal text-soft">· {reasons[0]}</span>
    </span>
  );
}

const minutesOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * One strip for the whole New York day: the sessions as soft bands, your entry windows
 * along the bottom edge, the rulebook's no-entry spans hatched, and every release a dot in
 * its folder colour — where the dots pile up is where price will move.
 */
function DayMap({
  events,
  now,
  rules,
  entryWindows,
}: {
  events: CalendarEvent[];
  now: number;
  rules: NewsDay;
  entryWindows: TimeWindow[];
}) {
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
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-caption text-faint">
        <span className="font-medium uppercase tracking-[0.08em]">Volatility map</span>
        {/* The key, so every mark on the strip reads without a hover. */}
        <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {SESSIONS.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm" style={{ background: `color-mix(in oklab, ${s.colour} 35%, transparent)` }} />
              {s.label}
            </span>
          ))}
          {entryWindows.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-3 rounded-full bg-up" />
              Your entries
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ background: HATCH }} />
            No new entries
          </span>
          <span>{DESK_LABEL} time</span>
        </span>
      </div>

      <div className="relative h-[96px] overflow-hidden rounded-xl border bg-surface/30">
        {Array.from({ length: 23 }, (_, i) => (
          <div key={i} className="absolute inset-y-0 w-px bg-line" style={{ left: pct((i + 1) * 60) }} />
        ))}
        <div className="absolute inset-y-0 left-0 bg-subtle" style={{ width: pct(nowMin) }} />
        {SESSIONS.map((s) => (
          <div
            key={s.label}
            className="anim-grow absolute inset-y-0"
            style={{
              left: pct(s.from),
              width: pct(s.to - s.from),
              background: `linear-gradient(to bottom, color-mix(in oklab, ${s.colour} 16%, transparent), color-mix(in oklab, ${s.colour} 4%, transparent))`,
              animationDelay: s.label === "London" ? "0ms" : "180ms",
            }}
          >
            <span className="absolute left-1.5 top-1 z-10 rounded bg-surface/80 px-1 text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: s.colour }}>
              {s.label}
            </span>
          </div>
        ))}
        {/* The rulebook's release windows: no new entries from just before to an hour after. */}
        {rules.windows.map((w) => (
          <div
            key={`${w.at}${w.title}`}
            title={`${w.currency} ${w.title} — no new entries`}
            className="anim-grow absolute inset-y-0"
            style={{
              left: pct(Math.max(0, w.start)),
              width: pct(Math.min(24 * 60, w.end) - Math.max(0, w.start)),
              background: HATCH,
              animationDelay: "320ms",
            }}
          />
        ))}
        {/* Your entry windows, along the bottom edge. */}
        {entryWindows.map((w, i) => (
          <div
            key={`${w.from}${w.to}`}
            title={`Entries ${w.from}–${w.to}`}
            className="anim-grow absolute bottom-0 h-1 rounded-t-full bg-up/80"
            style={{
              left: pct(minutesOfDay(w.from)),
              width: pct(minutesOfDay(w.to) - minutesOfDay(w.from)),
              animationDelay: `${420 + i * 120}ms`,
            }}
          />
        ))}
        {rules.skip.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-down/[0.07]">
            <span className="flex items-center gap-1.5 rounded-full bg-raised/80 px-3 py-1 text-caption font-semibold text-down backdrop-blur-sm">
              <Ban size={12} /> No trading today · {rules.skip[0]}
            </span>
          </div>
        )}

        {stacks.map(({ minute, events: list }, si) => (
          <div
            key={minute}
            className={cx("absolute bottom-2.5 flex -translate-x-1/2 flex-col-reverse items-center gap-[3px]", minute < nowMin && "opacity-40")}
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
                  boxShadow: e.impact === "High" ? `0 0 10px ${impactColour(e.impact)}` : undefined,
                  // After the session bands, left to right across the day.
                  animationDelay: `${Math.min(300 + (si * 2 + di) * 60, 1400)}ms`,
                }}
              />
            ))}
          </div>
        ))}

        <div className="absolute inset-y-0 w-px bg-ink" style={{ left: pct(nowMin) }} />
      </div>

      {/* The hours — and "now" as a tag under its line, clear of the session names. */}
      <div className="num relative mt-1.5 h-5 text-micro text-faint">
        {TICKS.map((h) => (
          <span
            key={h}
            className={cx("absolute top-0.5", Math.abs(h * 60 - nowMin) < 50 && "opacity-0")}
            style={{ left: pct(h * 60), transform: h === 0 ? undefined : h === 24 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {String(h).padStart(2, "0")}
          </span>
        ))}
        <span
          className="absolute top-0 -translate-x-1/2 rounded-full bg-ink px-1.5 py-px text-micro font-semibold text-bg"
          style={{ left: `clamp(1.5rem, ${pct(nowMin)}, calc(100% - 1.5rem))` }}
        >
          {deskTime(new Date(now))}
        </span>
      </div>
    </div>
  );
}

const HATCH =
  "repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-down) 20%, transparent) 0 4px, transparent 4px 8px)";

/** The next red release as its own card, then today's volatile stretches with how far away each is. */
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
    <div className="space-y-5 px-5 py-4">
      {nextRed ? (
        <div className="anim-rise relative overflow-hidden rounded-xl border border-down/25 bg-down/[0.06] px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-micro font-semibold uppercase tracking-[0.14em] text-down">Next red</span>
            <span className="num text-title font-semibold text-down">{untilLabel(Date.parse(nextRed.at!) - now)}</span>
          </div>
          <p className="mt-1 text-title font-medium leading-snug text-ink">
            <span className="num mr-1.5 text-soft">{nextRed.currency}</span>
            {nextRed.title}
          </p>
          <p className="num mt-0.5 text-small text-soft">
            {deskDay(new Date(nextRed.at!)) === deskDay(new Date(now))
              ? `Today ${time(nextRed.at!)}`
              : `${dayLabel(nextRed.at!, new Date(now))} ${time(nextRed.at!)}`}
          </p>
        </div>
      ) : (
        <p className="text-small text-soft">No more red releases in the feed.</p>
      )}

      <div>
        <div className="mb-1.5 eyebrow">Volatile windows today</div>
        {windows.length === 0 ? (
          <p className="text-small text-soft">No red or orange releases today with these filters.</p>
        ) : (
          windows.map((w, wi) => {
            const phase = windowPhase(w, now);
            return (
              <div
                key={w.start}
                className={cx("anim-rise flex items-center gap-3 rounded-lg px-2 py-1.5 text-small", phase === "live" && "bg-down/10", phase === "done" && "opacity-45")}
                style={stagger(wi, 70)}
              >
                <span className="num w-[88px] shrink-0 text-ink">
                  {deskTime(new Date(w.start))}
                  {w.end > w.start && `–${deskTime(new Date(w.end))}`}
                </span>
                <ImpactCounts events={w.events} impacts={["High", "Medium"]} />
                <span className="min-w-0 truncate text-soft">{[...new Set(w.events.map((e) => e.currency))].join(", ")}</span>
                <span className={cx("num ml-auto shrink-0", phase === "live" ? "font-semibold text-down" : "text-faint")}>
                  {phase === "ahead" ? untilLabel(w.start - now) : phase === "live" ? "volatile now" : "done"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Red, orange, yellow and holiday counts as small dots with numbers. */
function ImpactCounts({ events, impacts }: { events: CalendarEvent[]; impacts: Impact[] }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5">
      {impacts.map((i) => {
        const n = events.filter((e) => e.impact === i).length;
        return n > 0 ? (
          <span key={i} className="num flex items-center gap-1 text-caption text-soft">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: impactColour(i), boxShadow: i === "High" ? `0 0 6px ${impactColour(i)}` : undefined }}
            />
            {n}
          </span>
        ) : null;
      })}
    </span>
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
    <div className="flex justify-between border-b bg-subtle px-5 py-2 eyebrow">
      <span>{title}</span>
      <span className="num">{count}</span>
    </div>
    {children}
  </div>
);

const Quiet = ({ children }: { children: React.ReactNode }) => (
  <p className="border-b px-5 py-4 text-small text-soft">{children}</p>
);

/** "Tomorrow · Thursday 1 Oct", or just the date further out. */
const weekDayLabel = (iso: string, now: Date) => {
  const label = dayLabel(iso, now);
  return label === "Tomorrow" ? `Tomorrow · ${deskDateLabel(iso)}` : label;
};

/**
 * One later day of the week, open. The header gives the day at a glance — closed by the
 * rulebook or not, how many red and orange releases, when it is busiest — before any row.
 */
function DaySection({
  label,
  events,
  now,
  index,
  rules,
  skip,
}: {
  label: string;
  events: CalendarEvent[];
  now: number;
  index: number;
  rules: NewsRules;
  /** Why the rulebook skips this day, if it does. */
  skip: string[];
}) {
  const busiest = volatilityWindows(events).sort((a, b) => b.events.length - a.events.length || a.start - b.start)[0];

  return (
    <div className="anim-rise" style={stagger(index, 90)}>
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y px-5 py-2.5",
          skip.length ? "bg-down/[0.08]" : "bg-subtle",
        )}
      >
        <span className="text-small font-semibold text-ink">{label}</span>
        {skip.length > 0 && <SkipBadge reasons={skip} />}
        <ImpactCounts events={events} impacts={["High", "Medium", "Low", "Holiday"]} />
        {busiest && (
          <span className="num ml-auto text-caption text-faint">
            busiest {deskTime(new Date(busiest.start))}
            {busiest.end > busiest.start && `–${deskTime(new Date(busiest.end))}`}
          </span>
        )}
      </div>
      {events.map((e, i) => (
        <Row key={e.id} event={e} now={now} index={i} rules={rules} />
      ))}
    </div>
  );
}

/**
 * One release on one line, in fixed columns: time, folder, currency, the release with what
 * the rulebook makes of it right beside the name, then forecast and previous lined up.
 */
function Row({
  event: e,
  now,
  index = 0,
  countdown = false,
  rules,
}: {
  event: CalendarEvent;
  now: number;
  index?: number;
  countdown?: boolean;
  rules: NewsRules;
}) {
  const at = e.at ? Date.parse(e.at) : null;
  const past = at != null && at < now;
  const cat = categoryOf(e);
  const stance = stanceOf(e, rules);

  return (
    <div className="anim-rise border-b last:border-0" style={stagger(index)}>
      <div
        title={[IMPACTS.find((i) => i.id === e.impact)?.hint, cat && categoryLabel(cat)].filter(Boolean).join(" · ")}
        className={cx("flex items-center gap-3 px-5 py-2.5 transition-colors duration-300 hover:bg-raised", past && "opacity-45")}
      >
        <span className="num w-11 shrink-0 text-small text-soft">{e.at ? time(e.at) : "—"}</span>
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            backgroundColor: impactColour(e.impact),
            boxShadow: e.impact === "High" ? `0 0 8px ${impactColour(e.impact)}` : undefined,
          }}
        />
        <span className="num w-9 shrink-0 text-small font-medium text-ink">{e.currency}</span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-body text-ink">{e.title}</span>
          {stance === "skip" && (
            <span className="shrink-0 rounded-full bg-down/12 px-2 py-0.5 text-micro font-semibold text-down" title="The rulebook skips this day">
              No trading
            </span>
          )}
          {stance === "window" && at != null && (
            <span className="num shrink-0 rounded-full bg-warn/12 px-2 py-0.5 text-micro font-medium text-warn" title="No new entries in this window">
              no entries {deskTime(new Date(at - rules.beforeMin * 60_000))}–{deskTime(new Date(at + rules.afterMin * 60_000))}
            </span>
          )}
        </span>
        <span className="num hidden w-[76px] shrink-0 text-right text-caption sm:block">
          {e.forecast && (
            <>
              <span className="text-faint">f/c </span>
              <span className="text-soft">{e.forecast}</span>
            </>
          )}
        </span>
        <span className="num hidden w-[84px] shrink-0 text-right text-caption sm:block">
          {e.previous && (
            <>
              <span className="text-faint">prev </span>
              <span className="text-soft">{e.previous}</span>
            </>
          )}
        </span>
        {countdown && at != null && (
          <span className="num w-[62px] shrink-0 text-right text-caption font-medium text-soft">{untilLabel(at - now)}</span>
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
        <h3 className="text-title font-semibold">Wire</h3>
        <div className="flex items-center gap-3 text-caption text-faint">
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
                  <div className="glass sticky top-0 z-10 border-b px-5 py-2 eyebrow">
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
      <span className="num shrink-0 pt-px text-caption tabular-nums text-faint">
        {stamp(flash.at)}
      </span>
      <span className="min-w-0 text-body leading-snug text-ink">
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
  <div className={cx("anim-skeleton h-3 rounded bg-subtle", className)} style={{ animationDelay: `${delay}ms` }} />
);

