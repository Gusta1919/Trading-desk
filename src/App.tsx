import { Bell, BellOff, Download, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BudgetMeter } from "@/components/BudgetMeter";
import { CalendarView } from "@/components/CalendarView";
import { CheckIn } from "@/components/CheckIn";
import { CoachView } from "@/components/CoachView";
import { DailyBiasView } from "@/components/DailyBiasView";
import { NewsView } from "@/components/NewsView";
import { ReadinessMeter } from "@/components/ReadinessMeter";
import { RulebookView } from "@/components/RulebookView";
import { Simulation } from "@/components/Simulation";
import { StandAside } from "@/components/StandAside";
import { StatsStrip } from "@/components/StatsStrip";
import { StatsView } from "@/components/StatsView";
import { TodayDock } from "@/components/TodayStatus";
import { TradeForm } from "@/components/TradeForm";
import { TradeList } from "@/components/TradeList";
import { Button, PageHeader, Segmented, cx } from "@/components/ui";
import { clearTitle, testChime, unlockAudio } from "@/lib/alerts";
import { api } from "@/lib/api";
import type { CheckIn as CheckInData } from "@/lib/checkin";
import { buildBriefing, nudge, type CoachDesk } from "@/lib/coach";
import { briefingLean } from "@/lib/dailyBias";
import { deskStatus } from "@/lib/discipline";
import { countsForTrading, coveredDays, fromEvent, newsDay } from "@/lib/newsRules";
import { takenTrades } from "@/lib/risk";
import { deskDay } from "@/lib/tz";
import type { Trade } from "@/lib/types";
import { useDailyBias } from "@/lib/useDailyBias";
import { useNews, useNewsAlerts } from "@/lib/useNews";
import { useRulebook } from "@/lib/useRulebook";

/** Now, refreshed every minute — the rules change at the box, the windows and the time stop. */
function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Saturday or Sunday in New York — no session, so no check-in is asked for. */
const isWeekendNY = (d = new Date()) => {
  const wd = new Date(`${deskDay(d)}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
};

type View = "journal" | "bias" | "news" | "calendar" | "stats" | "risk" | "coach" | "rulebook";

/** In the order of a trading day: the record, the morning's prep, then the review, then the rules. */
const TABS: { value: View; label: string }[] = [
  { value: "journal", label: "Journal" },
  { value: "bias", label: "Daily Bias" },
  { value: "news", label: "News" },
  { value: "calendar", label: "Calendar" },
  { value: "stats", label: "Stats" },
  { value: "risk", label: "Risk lab" },
  { value: "coach", label: "Coach" },
  { value: "rulebook", label: "Rulebook" },
];

const loadView = (): View => {
  try {
    const v = localStorage.getItem("view") as View | null;
    return v && TABS.some((t) => t.value === v) ? v : "journal";
  } catch {
    return "journal";
  }
};

export default function App() {
  const [view, setViewState] = useState<View>(loadView);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [checkins, setCheckins] = useState<CheckInData[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rulebook = useRulebook();
  const doc = rulebook.doc;

  /* News is owned here so the trade form and the alerts work on every tab. */
  const news = useNews();
  /* Fetched on open, so the Daily Bias tab is ready the moment you look. */
  const dailyBias = useDailyBias();

  /*
   * Alerts are on by default — a guard you have to remember to switch on is a guard
   * that is off when it matters. Sound still needs one click, because browsers refuse
   * audio until a gesture; until then the warnings are visual.
   */
  const [sound, setSound] = useState(true);
  const [audible, setAudible] = useState(false);
  const tradingEvents = useMemo(() => news.events.filter(countsForTrading), [news.events]);
  const openToday = useMemo(
    () => trades.some((t) => !t.skipped && t.resultR == null && !t.exitTime && t.date.slice(0, 10) === deskDay()),
    [trades],
  );
  const alerts = useNewsAlerts(tradingEvents, news.headlines, doc.news, sound, {
    timeStop: doc.timeStop,
    entryWindows: doc.entryWindows,
    openTrade: openToday,
  });
  const [toastGone, setToastGone] = useState(0);
  useEffect(() => {
    if (!alerts.lastAt) return;
    const id = window.setTimeout(() => setToastGone(alerts.lastAt), 12_000);
    return () => clearTimeout(id);
  }, [alerts.lastAt]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Trade | null>(null);
  // null = still loading, so the journal doesn't flash before the check-in.
  const [checkInOpen, setCheckInOpen] = useState<boolean | null>(null);

  /** Remembers the tab you were on between sessions. */
  const setView = (v: View) => {
    setViewState(v);
    window.scrollTo({ top: 0 });
    try {
      localStorage.setItem("view", v);
    } catch {
      /* private window — the choice just won't be remembered */
    }
  };

  const taken = useMemo(() => takenTrades(trades), [trades]);
  const todayKey = deskDay();
  const today = checkins.find((c) => c.date === todayKey);

  /* Today as the rules see it: for the dock, the budget meter, the Daily Bias tab and the Coach. */
  const now = useNow();
  const todayNews = useMemo(() => {
    const day = deskDay(now);
    const covered = coveredDays(news.events);
    if (!covered || day < covered.from || day > covered.to) return null;
    const items = news.events.filter((e) => e.at && deskDay(new Date(e.at)) === day).map(fromEvent);
    return newsDay(day, items, doc.news);
  }, [news.events, now, doc.news]);
  const status = useMemo(
    () => (rulebook.loaded ? deskStatus({ trades, checkins, rulebookOf: rulebook.rulebookOf, doc, now, news: todayNews }) : null),
    [trades, checkins, rulebook.loaded, rulebook.rulebookOf, doc, now, todayNews],
  );
  const desk: CoachDesk | null = useMemo(
    () => (rulebook.loaded ? { doc, rulebookOf: rulebook.rulebookOf, news: todayNews } : null),
    [rulebook.loaded, doc, rulebook.rulebookOf, todayNews],
  );
  const coachNudge = useMemo(() => nudge(buildBriefing(trades, checkins, now, desk)), [trades, checkins, now, desk]);
  /* The briefing's lean counts only when it is today's: it pre-fills "my bias matches the briefing". */
  const lean = dailyBias.freshness === "today" ? briefingLean(dailyBias.bias?.bias) : null;

  /** Reloads the journal — after any save, since the server re-derives every result and flag. */
  const load = useCallback(async () => {
    try {
      setTrades(await api.list());
      setLoadError(null);
    } catch {
      setLoadError("Can't reach the desk's server. Your saved data is safe, but nothing new can be saved until it's running again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .checkins()
      .then((list) => {
        setCheckins(list);
        // Weekends are for analysis, not trading — the desk opens without the check-in.
        setCheckInOpen(!isWeekendNY() && !list.some((c) => c.date === deskDay()));
      })
      .catch(() => setCheckInOpen(!isWeekendNY()));
  }, []);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (t: Trade) => {
    setEditing(t);
    setFormOpen(true);
  };

  // "N" opens a new trade from anywhere (unless you're typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = typeof target?.closest === "function" && target.closest("input, textarea, select");
      if (e.key.toLowerCase() === "n" && !typing && !formOpen && !checkInOpen && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formOpen, checkInOpen]);

  /** Everything as one JSON file — your own backup: trades, check-ins and every rulebook version. */
  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), trades, checkins, rulebook: rulebook.versions }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trading-desk-${todayKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (checkInOpen === null) return null;
  if (checkInOpen) {
    return (
      <CheckIn
        trades={trades}
        checkins={checkins}
        doc={doc}
        rulebookOf={rulebook.rulebookOf}
        calendar={news.events}
        desk={desk}
        onDone={(c) => {
          setCheckins((list) => [c, ...list.filter((x) => x.date !== c.date)]);
          setCheckInOpen(false);
          // Reload the journal so every tab reads the same day.
          load();
        }}
        onKeep={today ? () => setCheckInOpen(false) : undefined}
      />
    );
  }

  return (
    <div className="min-h-screen pb-28">
      <header className="glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 whitespace-nowrap px-8 py-3.5 2xl:gap-5 [&>*]:shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2">
              <span className="anim-breathe absolute inset-0 rounded-full bg-accent shadow-[0_0_12px_var(--glow-accent)]" />
            </span>
            <span className="text-small font-semibold uppercase tracking-[0.22em]">Trading Desk</span>
          </div>
          <nav aria-label="Sections" className="ml-2">
            <Segmented size="sm" value={view} onChange={(v) => v && setView(v)} options={TABS} />
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <BudgetMeter status={status} limits={rulebook.loaded ? doc.limits : null} />
            <button
              onClick={() => setCheckInOpen(true)}
              title={today ? "Redo today's check-in" : "Do today's check-in"}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-small text-soft transition-colors hover:bg-subtle hover:text-ink"
            >
              {today ? <ReadinessMeter score={today.score} verdict={today.verdict} /> : "Check in"}
            </button>
            <button
              onClick={async () => {
                // One job: on or off. Turning on is also the click browsers require before any sound.
                if (sound) {
                  setSound(false);
                  setAudible(false);
                  clearTitle();
                  return;
                }
                setSound(true);
                const ok = await unlockAudio();
                setAudible(ok);
                if (ok) testChime();
              }}
              title={
                !sound
                  ? "Alerts off. Click to be warned before red releases."
                  : audible
                    ? "Alerts on — before and at each release-window release, and at the time stop with a trade open"
                    : "Alerts on, but this browser is blocking sound. Visual warnings still work."
              }
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-small transition-colors hover:bg-subtle",
                sound ? "text-accent-2" : "text-soft hover:text-ink",
              )}
            >
              {sound ? <Bell size={14} /> : <BellOff size={14} />}
            </button>
            <button
              onClick={exportData}
              title="Download a backup of everything: trades, check-ins and the rulebook with its changelog"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-small text-soft transition-colors hover:bg-subtle hover:text-ink"
            >
              <Download size={14} />
            </button>
          </div>
          <Button variant="accent" onClick={openNew} title="New trade (N)">
            <Plus size={15} /> New trade
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-8 pt-8">
        {loadError && <div className="card anim-rise mb-6 border-down/40 px-5 py-3 text-body text-down">{loadError}</div>}

        {/* Crossfade on tab change — a CSS animation, which always finishes even in a background tab. */}
        <div key={view} className="anim-view space-y-6">
          {view === "journal" && (
            <PageHeader title="Journal" sub="Every trade, and every setup you passed on, newest first. Open a row to see or change it." />
          )}
          {view === "calendar" && (
            <PageHeader title="Calendar" sub="Each day's result, and the days the rules kept you out. Pick a day for its trades." />
          )}
          {(view === "journal" || view === "calendar") && <StatsStrip trades={taken} />}
          {view === "journal" && <TradeList trades={trades} onNew={openNew} onOpen={openEdit} />}
          {view === "bias" && (
            <DailyBiasView
              state={dailyBias}
              crt={{ box: doc.box, until: doc.timeStop }}
              standAside={<StandAside doc={doc} status={status} news={todayNews} />}
            />
          )}
          {view === "news" && <NewsView news={news} rules={doc.news} entryWindows={doc.entryWindows} />}
          {view === "calendar" && (
            <CalendarView trades={trades} checkins={checkins} doc={doc} rulebookOf={rulebook.rulebookOf} calendar={news.events} onOpen={openEdit} />
          )}
          {view === "stats" && <StatsView trades={trades} checkins={checkins} doc={doc} />}
          {view === "risk" && <Simulation trades={taken} doc={doc} />}
          {view === "coach" && <CoachView trades={trades} checkins={checkins} desk={desk} />}
          {view === "rulebook" && <RulebookView state={rulebook} trades={trades} onSaved={load} />}
        </div>
      </main>

      {/* What the last alert said, for a few seconds — the ring says something happened, this says what. */}
      {alerts.lastMessage && alerts.lastAt !== toastGone && (
        <div
          key={alerts.lastAt}
          role="status"
          className="anim-pop glass fixed bottom-[4.5rem] right-6 z-[65] max-w-sm rounded-xl border px-4 py-3 text-body shadow-[var(--shadow-lift)]"
        >
          <button onClick={() => setToastGone(alerts.lastAt)} className="float-right ml-3 text-faint hover:text-ink" aria-label="Dismiss">
            ×
          </button>
          {alerts.lastMessage}
        </div>
      )}

      {/* A one-second ring around the desk, so an alert lands even in silence. */}
      {alerts.pulse && (
        <div
          aria-hidden
          className="anim-fade pointer-events-none fixed inset-0 z-[60]"
          style={{ boxShadow: `inset 0 0 0 2px var(--color-${alerts.pulse === "critical" ? "down" : "accent"})` }}
        />
      )}

      {/* Today's status, in the corner of every tab. */}
      {rulebook.loaded && <TodayDock doc={doc} status={status} news={todayNews} now={now} trades={trades} />}

      <TradeForm
        calendar={news.events}
        doc={doc}
        rulebookOf={rulebook.rulebookOf}
        open={formOpen}
        trade={editing}
        trades={trades}
        checkins={checkins}
        lean={lean}
        nudge={coachNudge}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
