import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeskStatus } from "@/lib/discipline";
import type { NewsDay, ReleaseWindow } from "@/lib/newsRules";
import type { Rulebook } from "@/lib/rulebook";
import { minutesOf } from "@/lib/rules";
import { deskNow } from "@/lib/tz";
import { cx, stagger } from "./ui";

type Tone = "down" | "warn" | "up" | "soft";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const TONE_TEXT: Record<Tone, string> = { down: "text-down", warn: "text-warn", up: "text-up", soft: "text-soft" };
const TONE_DOT: Record<Tone, string> = { down: "bg-down", warn: "bg-warn", up: "bg-up", soft: "bg-faint" };

/** "1h 05m", "25m" — how long until a minute of the day. */
function wait(from: number, to: number) {
  const m = Math.max(0, to - from);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/**
 * The one line that sums today up right now, most serious first: anything that closes
 * the day, then a release window running, then where the clock is against the entry
 * windows and the time stop.
 */
export function headline(
  doc: Rulebook,
  status: DeskStatus | null,
  news: NewsDay | null,
  now: Date,
): { tone: Tone; text: string; sub?: string } {
  const m = minutesOf(deskNow(now).slice(11, 16))!;
  const skip = news?.skip.length ? news.skip.join(", ") : status?.skipDay ? "the year-end break" : null;
  if (status?.blocked === "it's the weekend") return { tone: "soft", text: "Weekend", sub: "Market closed" };
  if (status?.dayOff) {
    return status.dayOff.reason === "rule-break"
      ? { tone: "down", text: "Day off", sub: "Rule broken today" }
      : { tone: "down", text: "Day off", sub: `Until ${status.dayOff.until}` };
  }
  if (status?.weekBudget.stopHit) return { tone: "down", text: "Weekly stop hit", sub: "No trades this week" };
  if (skip) return { tone: "down", text: "Skip day", sub: skip };
  if (status?.doneForToday) return { tone: "up", text: "Done for today", sub: status.dayBudget.stopHit ? "Daily stop hit" : "Trade taken" };
  if (status?.verdict === "sit-out") return { tone: "down", text: "Sit out", sub: "Check-in says so" };
  if (status?.takenToday.some((t) => status.open.includes(t))) {
    return { tone: "up", text: "Trade open", sub: `Hands off · out by ${doc.timeStop}` };
  }

  const stop = minutesOf(doc.timeStop)!;
  const release = news?.windows.find((w) => m >= w.start && m <= w.end);
  const windows = doc.entryWindows.map((w) => ({ from: minutesOf(w.from)!, to: minutesOf(w.to)! }));
  const inside = windows.find((w) => m >= w.from && m < w.to);
  const next = windows.find((w) => w.from > m);
  if (release) return { tone: "warn", text: "Release window", sub: `${release.currency} ${release.title} · entries from ${hhmm(release.end)}` };
  if (inside) {
    const soon = news?.windows.find((w) => w.start > m && w.start < inside.to);
    return {
      tone: "up",
      text: "Entries open",
      sub: soon ? `Release window in ${wait(m, soon.start)}` : `Until ${hhmm(inside.to)} · ${wait(m, inside.to)} left`,
    };
  }
  if (next) return { tone: "soft", text: `Entries at ${hhmm(next.from)}`, sub: `In ${wait(m, next.from)}` };
  if (m < stop) return { tone: "soft", text: "No new entries", sub: `Out by ${doc.timeStop}` };
  return { tone: "soft", text: "Desk closed", sub: "Time stop passed" };
}

/**
 * Today as the rules see it — written by the desk, never by you: what closes the day,
 * the check-in's limit, the entry windows with the one you're in lit up, the time
 * stop, and every release window with its no-entry span.
 */
export function TodayCard({
  doc,
  status,
  news,
  now,
  animate = false,
}: {
  doc: Rulebook;
  status: DeskStatus | null;
  /** Today's news as the rules see it; null when the calendar doesn't cover today. */
  news: NewsDay | null;
  now: Date;
  animate?: boolean;
}) {
  const weekend = status?.blocked === "it's the weekend";
  // On a weekend no window is live — the clock still runs, the session doesn't.
  const m = weekend ? -1 : minutesOf(deskNow(now).slice(11, 16))!;
  const lines: { tone: Tone; text: string }[] = [];
  if (weekend) lines.push({ tone: "soft", text: "Weekend — no session today. Analysis only." });
  else if (news?.skip.length) lines.push({ tone: "down", text: `Skip day — ${news.skip.join(", ")}. No trading today.` });
  else if (status?.skipDay) lines.push({ tone: "down", text: "Skip day — the year-end break. No trading today." });
  if (status?.dayOff) {
    lines.push({
      tone: "down",
      text: status.dayOff.reason === "rule-break" ? "Day off — a rule was broken today." : `Days off until ${status.dayOff.until} — a limit was broken on ${status.dayOff.from}.`,
    });
  }
  if (status?.weekBudget.stopHit) lines.push({ tone: "down", text: "Weekly stop hit — no more trades this week." });
  if (status?.verdict === "sit-out") lines.push({ tone: "down", text: "Check-in says sit out — nothing is tradable today." });
  if (status?.verdict === "caution") lines.push({ tone: "warn", text: "Check-in says caution — only A+ is tradable today." });
  if (status?.halfRisk) lines.push({ tone: "warn", text: "Half-risk week — every allowance is halved." });
  if (status?.doneForToday && !status.dayOff) lines.push({ tone: "up", text: "Done for today." });
  if (!lines.length) lines.push({ tone: "soft", text: news ? "Not a skip day." : "Not a skip day — as far as the calendar knows." });

  const rise = (i: number) => (animate ? stagger(i, 60) : undefined);

  return (
    <div className="space-y-3 text-[13px]">
      <div className="space-y-1">
        {lines.map((l, i) => (
          <p key={l.text} style={rise(i)} className={cx(animate && "anim-rise", "font-medium", TONE_TEXT[l.tone])}>
            {l.text}
          </p>
        ))}
      </div>

      {/* The day's clock: entry windows, the gap between them, the time stop. */}
      <div style={rise(lines.length)} className={cx(animate && "anim-rise", "flex flex-wrap items-center gap-1.5 whitespace-nowrap")}>
        <span className="text-[11px] text-faint">Entries</span>
        {doc.entryWindows.map((w) => {
          const live = m >= minutesOf(w.from)! && m < minutesOf(w.to)!;
          return (
            <span
              key={w.from}
              className={cx(
                "num rounded-md px-1.5 py-0.5 text-[12px]",
                live ? "bg-up/15 text-up" : "bg-subtle text-soft",
              )}
            >
              {w.from}–{w.to}
            </span>
          );
        })}
        <span className="ml-1 text-[11px] text-faint">out by</span>
        <span className={cx("num rounded-md bg-subtle px-1.5 py-0.5 text-[12px]", !weekend && m >= minutesOf(doc.timeStop)! ? "text-faint" : "text-soft")}>
          {doc.timeStop}
        </span>
      </div>

      <div style={rise(lines.length + 1)} className={cx(animate && "anim-rise")}>
        {news && news.windows.length > 0 ? (
          <ul className="space-y-1">
            {news.windows.map((w) => (
              <ReleaseRow key={`${w.at}${w.title}`} w={w} m={m} />
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-faint">{news ? "No release windows today." : "No calendar data for today."}</p>
        )}
      </div>
    </div>
  );
}

function ReleaseRow({ w, m }: { w: ReleaseWindow; m: number }) {
  const live = m >= w.start && m <= w.end;
  const past = m > w.end;
  return (
    <li className={cx("num flex items-center gap-3 text-[12px]", past && "opacity-45")}>
      <span className={cx("w-11", live ? "text-warn" : "text-soft")}>{hhmm(w.at)}</span>
      <span className="w-9 font-medium">{w.currency}</span>
      <span className="min-w-0 flex-1 truncate text-soft">{w.title}</span>
      <span className={live ? "text-warn" : "text-faint"}>
        no entries {hhmm(Math.max(0, w.start))}–{hhmm(w.end)}
      </span>
    </li>
  );
}

/**
 * Today's status, docked in the bottom-right corner of every tab: one quiet line that
 * says where the day stands right now, opening into the whole card on a click.
 */
export function TodayDock({
  doc,
  status,
  news,
  now,
}: {
  doc: Rulebook;
  status: DeskStatus | null;
  news: NewsDay | null;
  now: Date;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const h = headline(doc, status, news, now);

  // Closes on a click outside or on Escape, like the risk lines.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "America/New_York" }).format(now);

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="anim-pop glass w-[22rem] rounded-2xl border p-4 shadow-[var(--shadow-lift)]">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Today's status</h3>
            <span className="num text-[11px] text-faint">
              {day} · {deskNow(now).slice(11, 16)} NY
            </span>
          </div>
          <TodayCard doc={doc} status={status} news={news} now={now} />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Today's status — click for the whole day"
        className="glass group flex items-center gap-3 rounded-full border py-2 pl-3.5 pr-3 text-[12px] shadow-[var(--shadow-lift)] transition-colors hover:border-faint/40"
      >
        <span className="relative flex size-2">
          {h.tone !== "soft" && (
            <span className={cx("absolute inset-0 animate-ping rounded-full opacity-40", TONE_DOT[h.tone])} />
          )}
          <span className={cx("relative size-2 rounded-full", TONE_DOT[h.tone])} />
        </span>
        <span className={cx("font-medium", TONE_TEXT[h.tone])}>{h.text}</span>
        {h.sub && <span className="max-w-[16rem] truncate text-soft">{h.sub}</span>}
        <ChevronDown size={13} className={cx("text-faint transition-transform", !open && "rotate-180")} />
      </button>
    </div>
  );
}
