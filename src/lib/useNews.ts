/**
 * One copy of the news for the whole app.
 *
 * The calendar has to be readable from the trade form on any tab, and the alert
 * engine has to keep running while you are looking at the Coach — so the feed is
 * owned here, at the top, rather than by whichever screen happens to be open.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chime, flashTitle, urgencyOf } from "./alerts";
import { newsApi, type CalendarEvent, type Headline } from "./news";
import { fromEvent, newsDay, stanceOf } from "./newsRules";
import { deskDay, deskTime } from "./tz";
import type { NewsRules } from "./rulebook";
import { defaultRulebook } from "./rulebookText";

/** The squawk is polled; the calendar barely changes and the server caches it hard. */
const HEADLINE_POLL_MS = 5 * 60 * 1000;
const CALENDAR_POLL_MS = 30 * 60 * 1000;

export interface NewsState {
  events: CalendarEvent[];
  headlines: Headline[];
  rules: NewsRules;
  calendarError: string | null;
  wireError: string | null;
  stale: boolean;
  loadingCalendar: boolean;
  loadingWire: boolean;
  fetchedAt: string | null;
  refresh: () => void;
}

export function useNews(): NewsState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [rules, setRules] = useState<NewsRules>(() => defaultRulebook().news);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [wireError, setWireError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [loadingWire, setLoadingWire] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const loadCalendar = useCallback(() => {
    newsApi
      .calendar()
      .then((c) => {
        setEvents(c.events);
        setStale(c.stale);
        setCalendarError(null);
      })
      .catch((e: Error) => setCalendarError(e.message))
      .finally(() => setLoadingCalendar(false));
  }, []);

  const loadWire = useCallback(() => {
    newsApi
      .headlines()
      .then((h) => {
        setHeadlines(h.items);
        setFetchedAt(h.fetchedAt);
        setWireError(null);
      })
      .catch((e: Error) => setWireError(e.message))
      .finally(() => setLoadingWire(false));
  }, []);

  useEffect(() => {
    loadCalendar();
    loadWire();
    newsApi.rules().then(setRules).catch(() => {});
    const a = window.setInterval(loadWire, HEADLINE_POLL_MS);
    const b = window.setInterval(loadCalendar, CALENDAR_POLL_MS);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [loadCalendar, loadWire]);

  const refresh = useCallback(() => {
    setLoadingCalendar(true);
    setLoadingWire(true);
    loadCalendar();
    loadWire();
  }, [loadCalendar, loadWire]);

  return {
    events,
    headlines,
    rules,
    calendarError,
    wireError,
    stale,
    loadingCalendar,
    loadingWire,
    fetchedAt,
    refresh,
  };
}

/* ── Alerts ──────────────────────────────────────────────────────────── */

export interface AlertState {
  /** Set briefly when something fires, so the shell can flash its border. */
  pulse: "event" | "critical" | null;
  /** What the last alert said, for a moment on screen. */
  lastMessage: string | null;
  /** When it said it, so the shell can let the message go after a while. */
  lastAt: number;
}

/** What the rules need from the desk to time their alerts. */
export interface AlertDesk {
  timeStop: string;
  entryWindows: { from: string; to: string }[];
  /** A taken trade from today is still open. */
  openTrade: boolean;
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** The instant a New York wall-clock time falls at today, worked out from now's own New York time. */
function todayAt(hhmm: string, now: number) {
  const nowMin = minutesOf(deskTime(new Date(now)));
  const nowSec = new Date(now).getSeconds();
  return now + (minutesOf(hhmm) - nowMin) * 60_000 - nowSec * 1000;
}

/**
 * Watches the calendar, the wire and the clock, and speaks when a rule is about to
 * matter:
 *  - a release-window release: at T−5 ("close unless the stop is at breakeven") and as it prints
 *  - a skip day: one notice in the morning, no chime at each release
 *  - an open trade: at 11:55 and 12:00, the time stop
 *  - quietly, without sound: entries pause at 08:25 and the last entry is at 11:00
 *  - any headline carrying emergency language
 * Sound only happens when the user has unmuted, which is also what unlocks audio in
 * the browser; the hard cooldown in `chime` keeps a cluster from spamming.
 */
export function useNewsAlerts(
  events: CalendarEvent[],
  headlines: Headline[],
  rules: NewsRules,
  enabled: boolean,
  desk?: AlertDesk,
): AlertState {
  const [pulse, setPulse] = useState<AlertState["pulse"]>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState(0);
  /** Headlines seen before the alert engine started must not all fire at once. */
  const seen = useRef<Set<string> | null>(null);
  const fired = useRef(new Set<string>());

  const fire = useCallback(
    (kind: "event" | "critical", message: string, quiet = false) => {
      setLastMessage(message);
      setLastAt(Date.now());
      setPulse(kind);
      window.setTimeout(() => setPulse(null), 1000);
      if (enabled && !quiet) {
        chime(kind);
        flashTitle(`🔔 ${kind === "critical" ? "BREAKING" : "NEWS"} | Trading Desk`);
      }
    },
    [enabled],
  );

  /** Fires once per key, at `at` (an instant), if that is still ahead and within a day. */
  const schedule = useCallback(
    (timers: number[], key: string, at: number, run: () => void) => {
      const due = at - Date.now();
      if (due <= 0 || due > 86_400_000) return;
      timers.push(
        window.setTimeout(() => {
          if (fired.current.has(key)) return;
          fired.current.add(key);
          run();
        }, due),
      );
    },
    [],
  );

  /* Releases, judged by the rulebook. */
  useEffect(() => {
    const timers: number[] = [];
    for (const e of events) {
      if (!e.at || e.allDay) continue;
      const stance = stanceOf(e, rules);
      const at = new Date(e.at).getTime();
      const name = `${e.currency} ${e.title}`;
      if (stance === "window") {
        schedule(timers, `${e.id}@-5`, at - rules.beforeMin * 60_000, () =>
          fire("event", `${name} in ${rules.beforeMin} min — close unless the stop is at breakeven`),
        );
        schedule(timers, `${e.id}@0`, at, () =>
          fire("event", `${name} — now. No new entries until ${deskTime(new Date(at + rules.afterMin * 60_000))}`),
        );
      } else if (stance === "info") {
        // Red but not a rule: shown, never chimed.
        schedule(timers, `${e.id}@0`, at, () => fire("event", `${name} — now`, true));
      }
      // Skip-day releases get one notice in the morning instead — below.
    }
    return () => timers.forEach(clearTimeout);
  }, [events, rules, fire, schedule]);

  /*
   * A skip day: said once, in the morning, rather than at every release — once per
   * day even across reloads, and not at all after the time stop, when it no longer
   * changes anything.
   */
  useEffect(() => {
    const today = deskDay();
    const items = events.filter((e) => e.at && deskDay(new Date(e.at)) === today).map(fromEvent);
    const day = newsDay(today, items, rules);
    const key = `trade-assistant.skip-notice.${today}`;
    const late = desk && deskTime(new Date()) >= desk.timeStop;
    if (!day.skip.length || late || fired.current.has(key)) return;
    fired.current.add(key);
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* storage blocked: the notice may repeat after a reload, which is harmless */
    }
    fire("event", `Skip day — ${day.skip.join(", ")}. No trading today.`);
  }, [events, rules, fire, desk]);

  /* The clock of the rules: entries pause, the last entry, the time stop. */
  useEffect(() => {
    if (!desk) return;
    const timers: number[] = [];
    const now = Date.now();
    const today = deskDay();
    const [first, second] = desk.entryWindows;
    if (first && second) {
      schedule(timers, `pause@${today}`, todayAt(first.to, now), () =>
        fire("event", `${first.to} — entries pause until ${second.from}`, true),
      );
    }
    const last = desk.entryWindows[desk.entryWindows.length - 1];
    if (last) schedule(timers, `last@${today}`, todayAt(last.to, now), () => fire("event", `${last.to} — the last entry of the day`, true));
    if (desk.openTrade) {
      const stop = todayAt(desk.timeStop, now);
      schedule(timers, `stop-5@${today}`, stop - 5 * 60_000, () => fire("event", `5 minutes to the ${desk.timeStop} time stop — close the trade`));
      schedule(timers, `stop@${today}`, stop, () => fire("critical", `${desk.timeStop} — time stop. Close the trade now.`));
    }
    return () => timers.forEach(clearTimeout);
  }, [desk?.openTrade, desk?.timeStop, desk?.entryWindows, fire, schedule]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The wire: only genuinely urgent language, and only headlines new to this session. */
  useEffect(() => {
    if (!headlines.length) return;
    if (seen.current === null) {
      seen.current = new Set(headlines.map((h) => h.id));
      return; // the first load is history, not breaking news
    }
    for (const h of headlines) {
      if (seen.current.has(h.id)) continue;
      seen.current.add(h.id);
      if (urgencyOf(h.title) === "critical") fire("critical", h.title);
    }
  }, [headlines, fire]);

  return { pulse, lastMessage, lastAt };
}
