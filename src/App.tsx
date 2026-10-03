import { Download, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarView } from "@/components/CalendarView";
import { CheckIn } from "@/components/CheckIn";
import { CoachView } from "@/components/CoachView";
import { DailyBiasView } from "@/components/DailyBiasView";
import { Simulation } from "@/components/Simulation";
import { ReadinessMeter } from "@/components/ReadinessMeter";
import { RiskChip } from "@/components/RiskChip";
import { Bell, BellOff } from "lucide-react";
import { NewsView } from "@/components/NewsView";
import { unlockAudio, clearTitle, testChime } from "@/lib/alerts";
import { useNews, useNewsAlerts } from "@/lib/useNews";
import { useDailyBias } from "@/lib/useDailyBias";
import { useRulebook } from "@/lib/useRulebook";
import { briefingLean } from "@/lib/dailyBias";
import { countsForTrading, coveredDays, fromEvent, newsDay } from "@/lib/newsRules";
import { deskStatus } from "@/lib/discipline";
import { deskDay } from "@/lib/tz";
import { TodayDock } from "@/components/TodayStatus";
import { StandAside } from "@/components/StandAside";
import { StatsStrip } from "@/components/StatsStrip";
import { StatsView } from "@/components/StatsView";
import { RulebookView } from "@/components/RulebookView";
import { TradeForm } from "@/components/TradeForm";
import { TradeList } from "@/components/TradeList";
import { Button, Segmented, cx } from "@/components/ui";
import { api } from "@/lib/api";
import type { CheckIn as CheckInData } from "@/lib/checkin";
import type { Limits } from "@/lib/types";
import { buildBriefing, nudge, type CoachDesk } from "@/lib/coach";
import { takenTrades } from "@/lib/risk";
import { dayKey } from "@/lib/format";
import type { Trade } from "@/lib/types";

/** Now, refreshed every minute — the rules change at 04:00, 08:25, 11:00 and 12:00. */
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

type View = "journal" | "bias" | "calendar" | "rulebook" | "stats" | "news" | "risk" | "coach";

const TABS: { value: View; label: string }[] = [
  { value: "journal", label: "Journal" },
  { value: "bias", label: "Daily Bias" },
  { value: "calendar", label: "Calendar" },
  { value: "rulebook", label: "Rulebook" },
  { value: "stats", label: "Stats" },
  { value: "news", label: "News" },
  { value: "risk", label: "Risk lab" },
  { value: "coach", label: "Coach" },
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
  const rulebook = useRulebook();
  /* Your limits are part of the rulebook; null until it has loaded from the server. */
  const limits: Limits | null = rulebook.loaded ? rulebook.doc.limits : null;

  /* News is owned here so the trade blocker and the alerts work on every tab. */
  const news = useNews();
  /* Fetched on open, not on first click, so the tab is ready the moment you look. */
  const dailyBias = useDailyBias();
  /*
   * Alerts are on by default — a guard you have to remember to switch on is a guard
   * that is off when it matters. Sound still needs one click, because browsers
   * refuse audio until a gesture; until then the warnings are visual.
   */
  const [sound, setSound] = useState(true);
  const [audible, setAudible] = useState(false);
  /* The calendar shows every folder; only red news on the desk's currencies chimes. */
  const tradingEvents = useMemo(() => news.events.filter(countsForTrading), [news.events]);
  const openToday = useMemo(
    () => trades.some((t) => !t.skipped && t.resultR == null && !t.exitTime && t.date.slice(0, 10) === deskDay()),
    [trades],
  );
  const alerts = useNewsAlerts(tradingEvents, news.headlines, news.rules, sound, {
    timeStop: rulebook.doc.timeStop,
    entryWindows: rulebook.doc.entryWindows,
    openTrade: openToday,
  });
  const [toastGone, setToastGone] = useState(0);
  useEffect(() => {
    if (!alerts.lastAt) return;
    const id = window.setTimeout(() => setToastGone(alerts.lastAt), 12_000);
    return () => clearTimeout(id);
  }, [alerts.lastAt]);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  /* Skipped setups are logged for Compare only — every result, the Coach and the Risk lab use what was taken. */
  const taken = useMemo(() => takenTrades(trades), [trades]);

  const today = checkins.find((c) => c.date === dayKey(new Date()));

  /** A limit is a rule: saving one is a change in the rulebook's changelog, and every flag is re-judged. */
  const saveLimits = async (next: Limits, reason: string) => {
    await api.saveLimits(next, reason);
    await rulebook.reload();
    load();
  };

  /* Today as the rules see it: consequences, budgets, the news — for the Today dock and the RiskChip. */
  const now = useNow();
  const todayNews = useMemo(() => {
    const day = deskDay(now);
    const covered = coveredDays(news.events);
    if (!covered || day < covered.from || day > covered.to) return null;
    const items = news.events.filter((e) => e.at && deskDay(new Date(e.at)) === day).map(fromEvent);
    return newsDay(day, items, rulebook.doc.news);
  }, [news.events, now, rulebook.doc.news]);
  const status = useMemo(
    () =>
      rulebook.loaded
        ? deskStatus({ trades, checkins, rulebookOf: rulebook.rulebookOf, doc: rulebook.doc, now, news: todayNews })
        : null,
    [trades, checkins, rulebook.loaded, rulebook.rulebookOf, rulebook.doc, now, todayNews],
  );
  /* What the Coach reads besides the trades: the rulebook and today's news. */
  const desk: CoachDesk | null = useMemo(
    () => (rulebook.loaded ? { doc: rulebook.doc, rulebookOf: rulebook.rulebookOf, news: todayNews } : null),
    [rulebook.loaded, rulebook.doc, rulebook.rulebookOf, todayNews],
  );
  const coachNudge = useMemo(
    // The Coach sets skipped setups aside itself.
    () => nudge(buildBriefing(trades, checkins, now, desk)),
    [trades, checkins, now, desk],
  );
  /* The briefing's lean only counts when it is today's briefing — it pre-fills "desk agreed" on today's trade. */
  const lean = dailyBias.freshness === "today" ? briefingLean(dailyBias.bias?.bias) : null;

  const load = useCallback(async () => {
    try {
      setTrades(await api.list());
      setLoadError(null);
    } catch {
      setLoadError(
        "Can't reach the local server — your saved data is safe, but nothing new can be saved until it's running again.",
      );
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
        setCheckInOpen(!isWeekendNY() && !list.some((c) => c.date === dayKey(new Date())));
      })
      .catch(() => setCheckInOpen(!isWeekendNY()));
  }, []);

  const saveCheckin = (c: CheckInData) =>
    setCheckins((list) => [c, ...list.filter((x) => x.date !== c.date)]);

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
      // Key events can come from the window itself, which has no .closest — guard for that.
      const target = e.target as HTMLElement | null;
      const typing = typeof target?.closest === "function" && target.closest("input, textarea, select");
      if (e.key.toLowerCase() === "n" && !typing && !formOpen && !checkInOpen && !e.metaKey) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formOpen, checkInOpen]);

  /**
   * Saves a copy of everything as one JSON file — your own backup: trades, check-ins,
   * every rulebook version (the limits, the news rules and the settings live inside
   * it) and the open items.
   */
  async function exportData() {
    const openItems = await api.openItems().catch(() => []);
    const versions = rulebook.versions.map((v) => ({ ...v, doc: rulebook.rulebookOf(v.version) }));
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            rulebookInForce: rulebook.current?.version ?? null,
            trades,
            checkins,
            rulebookVersions: versions,
            openItems,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-journal-${dayKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (checkInOpen === null) return null;
  if (checkInOpen) {
    return (
      <CheckIn
        trades={trades}
        checkins={checkins}
        doc={rulebook.doc}
        rulebookOf={rulebook.rulebookOf}
        calendar={news.events}
        desk={desk}
        onDone={(c) => {
          saveCheckin(c);
          setCheckInOpen(false);
          // The check-in decides what is tradable today; the server has re-judged the trades.
          load();
        }}
        onKeep={today ? () => setCheckInOpen(false) : undefined}
      />
    );
  }

  return (
    <div className="w-full px-8 pb-24 xl:px-12">
      {/* One line, never wrapped: nothing in it shrinks or breaks onto a second row. On
          narrower windows the gaps tighten, the two status bars drop to their numbers and
          Alerts/Backup show as icons (tooltips stay); only under ~1400px does it wrap. */}
      <header className="glass sticky top-0 z-30 -mx-8 flex items-center flex-wrap gap-3 whitespace-nowrap min-[1400px]:flex-nowrap 2xl:gap-5 border-b border-line px-8 py-4 xl:-mx-12 xl:px-12 [&>*]:shrink-0">
        <h1 className="flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.2em]">
          <span className="size-1.5 rounded-full bg-accent shadow-[0_0_12px_var(--glow-accent)]" />
          Trading Desk
        </h1>
        <nav aria-label="Sections" className="[&>div]:flex-nowrap">
          <Segmented size="sm" value={view} onChange={(v) => v && setView(v)} options={TABS} />
        </nav>

        {/* Your risk lines, always in view — small, and a click away from changing. */}
        <div className="ml-auto">
          <RiskChip
            status={status}
            limits={limits}
            evidence={rulebook.doc.calibration.evidence}
            onSave={saveLimits}
          />
        </div>
        <button
          onClick={() => setCheckInOpen(true)}
          title={today ? "Redo today's check-in" : "Do today's check-in"}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-soft hover:bg-subtle hover:text-ink"
        >
          {today ? (
            <ReadinessMeter score={today.score} verdict={today.verdict} />
          ) : (
            "Check in"
          )}
        </button>
        <button
          onClick={async () => {
            // One job: on or off. An earlier version tried to make the first click
            // "add sound", which left anyone whose browser blocks audio unable to
            // mute at all — the button could only ever turn on.
            if (sound) {
              setSound(false);
              setAudible(false);
              clearTitle();
              return;
            }
            // Alerts turn on either way; this click is also the gesture that
            // browsers require before any sound may be played.
            setSound(true);
            const ok = await unlockAudio();
            setAudible(ok);
            // Play it once on the way in: silence is the only way to find out
            // whether a browser is honouring the unlock.
            if (ok) testChime();
          }}
          title={
            !sound
              ? "Alerts off. Click to be warned before red releases."
              : audible
                ? "Alerts on — 5 minutes before and at each release-window release, and at the time stop with a trade open"
                : "Alerts on, but this browser is blocking sound. Visual warnings still work; allow sound for this site to hear the chime."
          }
          className={cx(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-subtle",
            sound ? "text-accent-2" : "text-soft hover:text-ink",
          )}
        >
          {sound ? <Bell size={14} /> : <BellOff size={14} />}
          <span className="hidden 2xl:inline">{sound ? "Alerts" : "Muted"}</span>
        </button>
        <button
          onClick={exportData}
          title="Download a backup of everything: trades, check-ins, the rulebook and its changelog"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-soft hover:bg-subtle hover:text-ink"
        >
          <Download size={14} /> <span className="hidden 2xl:inline">Backup</span>
        </button>
        <Button variant="accent" onClick={openNew} title="New trade (N)">
          <Plus size={15} /> New trade
        </Button>
      </header>

      {loadError && (
        <div className="card mt-8 border-down/40 px-4 py-3 text-[13px] text-down">{loadError}</div>
      )}

      <div className="mt-8 space-y-4">
        {/* The headline numbers stay visible on every tab — except Stats, which shows
            them in full, and Daily Bias, where the chart has to be the first thing on screen. */}
        {view !== "stats" && view !== "bias" && <StatsStrip trades={taken} />}

        {/* Crossfade on tab change. Deliberately a CSS animation, not a JS one:
            browsers pause frame-driven animation in background tabs, which can strand
            content at opacity 0. A time-based animation always finishes. */}
        <div key={view} className="anim-view">
            {view === "journal" && (
              <TradeList
                trades={trades}
                onNew={openNew}
                onOpen={openEdit}
              />
            )}
            {view === "calendar" && (
              <CalendarView
                trades={taken}
                checkins={checkins}
                doc={rulebook.doc}
                rulebookOf={rulebook.rulebookOf}
                calendar={news.events}
                onOpen={openEdit}
              />
            )}
            {view === "rulebook" && <RulebookView state={rulebook} trades={trades} onSaved={load} />}
            {view === "stats" && (
              <StatsView trades={trades} checkins={checkins} doc={rulebook.doc} />
            )}
            {view === "bias" && (
              <DailyBiasView
                state={dailyBias}
                standAside={<StandAside doc={rulebook.doc} status={status} news={todayNews} />}
              />
            )}
            {view === "news" && <NewsView news={news} entryWindows={rulebook.doc.entryWindows} />}
            {view === "risk" && (
              <Simulation trades={taken} doc={rulebook.doc} />
            )}
            {view === "coach" && (
              <CoachView trades={trades} checkins={checkins} desk={desk} />
            )}
        </div>
      </div>

      {/* What the last alert said, for a few seconds — the ring says something happened, this says what. */}
      {alerts.lastMessage && alerts.lastAt !== toastGone && (
        <div
          key={alerts.lastAt}
          role="status"
          className="anim-pop glass fixed bottom-[4.5rem] right-6 z-[65] max-w-sm rounded-xl border px-4 py-3 text-[13px] shadow-[var(--shadow-lift)]"
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
          className="pointer-events-none fixed inset-0 z-[60] anim-fade"
          style={{
            boxShadow: `inset 0 0 0 2px var(--color-${alerts.pulse === "critical" ? "down" : "accent"})`,
          }}
        />
      )}

      {/* Today's status, in the corner of every tab. */}
      {rulebook.loaded && <TodayDock doc={rulebook.doc} status={status} news={todayNews} now={now} />}

      <TradeForm
        calendar={news.events}
        doc={rulebook.doc}
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
