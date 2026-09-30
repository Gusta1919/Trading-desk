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
import { DEFAULT_STANCE, stanceOf, type NewsStance } from "./newsRules";

/** The squawk is polled; the calendar barely changes and the server caches it hard. */
const HEADLINE_POLL_MS = 5 * 60 * 1000;
const CALENDAR_POLL_MS = 30 * 60 * 1000;

export interface NewsState {
  events: CalendarEvent[];
  headlines: Headline[];
  rules: NewsStance;
  calendarError: string | null;
  wireError: string | null;
  stale: boolean;
  loadingCalendar: boolean;
  loadingWire: boolean;
  fetchedAt: string | null;
  refresh: () => void;
  saveRules: (r: NewsStance) => void;
}

export function useNews(): NewsState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [rules, setRules] = useState<NewsStance>(DEFAULT_STANCE);
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

  const saveRules = useCallback((next: NewsStance) => {
    setRules(next);
    newsApi.saveRules(next).catch(() => {});
  }, []);

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
    saveRules,
  };
}

/* ── Alerts ──────────────────────────────────────────────────────────── */

export interface AlertState {
  /** Set briefly when something fires, so the shell can flash its border. */
  pulse: "event" | "critical" | null;
  lastMessage: string | null;
}

/**
 * Watches the calendar and the wire and makes a noise when it matters: one minute
 * before a red release, again as it prints, and on any headline carrying emergency
 * language. Sound only happens when the user has unmuted, which is also what
 * unlocks audio in the browser.
 */
export function useNewsAlerts(
  events: CalendarEvent[],
  headlines: Headline[],
  rules: NewsStance,
  enabled: boolean,
): AlertState {
  const [pulse, setPulse] = useState<AlertState["pulse"]>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  /** Headlines seen before the alert engine started must not all fire at once. */
  const seen = useRef<Set<string> | null>(null);
  const firedEvents = useRef(new Set<string>());

  const fire = useCallback(
    (kind: "event" | "critical", message: string) => {
      setLastMessage(message);
      setPulse(kind);
      window.setTimeout(() => setPulse(null), 1000);
      if (enabled) {
        chime(kind);
        flashTitle(`🔔 ${kind === "critical" ? "BREAKING" : "NEWS"} | Trading Desk`);
      }
    },
    [enabled],
  );

  /* Red releases: one minute out, and on the second. */
  useEffect(() => {
    const timers: number[] = [];
    const now = Date.now();

    for (const e of events) {
      if (!e.at || e.allDay) continue;
      if (stanceOf(e, rules) === "holiday") continue;
      const at = new Date(e.at).getTime();

      for (const [offset, label] of [
        [-60_000, "in 1 minute"],
        [0, "now"],
      ] as const) {
        const due = at + offset - now;
        // Only schedule what is still ahead and inside a day, so we never hold
        // thousands of timers for a whole week of releases.
        if (due <= 0 || due > 86_400_000) continue;
        const key = `${e.id}@${offset}`;
        timers.push(
          window.setTimeout(() => {
            if (firedEvents.current.has(key)) return;
            firedEvents.current.add(key);
            fire("event", `${e.currency} ${e.title} — ${label}`);
          }, due),
        );
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [events, rules, fire]);

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

  return { pulse, lastMessage };
}
