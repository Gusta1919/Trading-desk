import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dayOffLine, type DeskStatus } from "@/lib/discipline";
import { fmtPct } from "@/lib/format";
import { ledger } from "@/lib/limits";
import { goldMarket, inLabel, type GoldMarket } from "@/lib/market";
import type { NewsDay, ReleaseWindow } from "@/lib/newsRules";
import type { Rulebook } from "@/lib/rulebook";
import { minutesOf } from "@/lib/rules";
import { deskDateLabel, deskNow } from "@/lib/tz";
import type { Trade } from "@/lib/types";
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

/** "opens Sunday 18:00 · in 1d 2h", "closes 17:00 · in 3h 10m" — the market's next change. */
export const marketNext = (g: GoldMarket) =>
  `${g.next.what} ${g.next.day === "today" ? "" : `${g.next.day} `}${g.next.time} · in ${inLabel(g.next.inMinutes)}`;

/**
 * The one line that sums today up right now, most serious first: whether gold is trading
 * at all (its New York hours: Sunday 18:00 to Friday 17:00, a break from 17:00 to 18:00),
 * anything that closes the day, a release window running, then where the clock is against
 * the entry windows and the time stop.
 */
export function headline(doc: Rulebook, status: DeskStatus | null, news: NewsDay | null, now: Date): { tone: Tone; text: string; sub?: string } {
  const m = minutesOf(deskNow(now).slice(11, 16))!;
  const skip = news?.skip.length ? news.skip.join(", ") : status?.skipDay ? "the year-end break" : null;
  const market = goldMarket(deskNow(now));
  if (!market.open) {
    return { tone: "soft", text: "Market closed", sub: `${market.closedFor === "weekend" ? "Weekend" : "Daily break"} · ${marketNext(market)}` };
  }
  // Sunday evening: gold trades again, the desk's week starts Monday morning.
  if (status?.blocked === "it's the weekend") return { tone: "soft", text: "Market open", sub: "Sunday evening · no session until Monday" };
  if (status?.dayOff) {
    return status.dayOff.reason === "rule-break"
      ? { tone: "down", text: "Day off", sub: "A rule was broken today" }
      : { tone: "down", text: "Day off", sub: `After a rule break on ${deskDateLabel(`${status.dayOff.from}T12:00:00Z`)}` };
  }
  if (status?.weekBudget.stopHit) return { tone: "down", text: "Weekly stop hit", sub: "No trades this week" };
  if (skip) return { tone: "down", text: "Skip day", sub: skip };
  if (status?.doneForToday) return { tone: "up", text: "Done for today", sub: status.dayBudget.stopHit ? "Daily stop hit" : "Trade taken" };
  if (status?.verdict === "sit-out") return { tone: "warn", text: "Step away?", sub: "The check-in advises leaving the charts — your call" };
  if (status?.takenToday.some((t) => status.open.includes(t))) return { tone: "up", text: "Trade open", sub: `Hands off · out by ${doc.timeStop}` };

  const stop = minutesOf(doc.timeStop)!;
  const release = news?.windows.find((w) => m >= w.start && m <= w.end);
  const windows = doc.entryWindows.map((w) => ({ from: minutesOf(w.from)!, to: minutesOf(w.to)! }));
  const inside = windows.find((w) => m >= w.from && m < w.to);
  const next = windows.find((w) => w.from > m);
  if (release) return { tone: "warn", text: "Release window", sub: `${release.currency} ${release.title} · entries from ${hhmm(release.end)}` };
  if (inside) {
    const soon = news?.windows.find((w) => w.start > m && w.start < inside.to);
    return { tone: "up", text: "Entries open", sub: soon ? `Release window in ${wait(m, soon.start)}` : `Until ${hhmm(inside.to)} · ${wait(m, inside.to)} left` };
  }
  if (next) return { tone: "soft", text: `Entries at ${hhmm(next.from)}`, sub: `In ${wait(m, next.from)}` };
  if (m < stop) return { tone: "soft", text: "No new entries", sub: `Out by ${doc.timeStop}` };
  return market.next.day === "today"
    ? { tone: "soft", text: "Desk closed", sub: `Time stop passed · market ${marketNext(market)}` }
    : { tone: "soft", text: "Desk closed", sub: `Evening session · entries from ${doc.entryWindows[0]?.from ?? "tomorrow"}` };
}

/**
 * Today as the rules see it — written by the desk, never by you: what closes the day,
 * the entry windows with the one you're in lit up, the time stop, every release window,
 * what a trade may risk right now, and the account against the firm's lines.
 */
export function TodayCard({
  doc,
  status,
  news,
  now,
  trades,
  animate = false,
}: {
  doc: Rulebook;
  status: DeskStatus | null;
  /** Today's news as the rules see it; null when the calendar doesn't cover today. */
  news: NewsDay | null;
  now: Date;
  /** For the account; leave out to skip it. */
  trades?: Trade[];
  animate?: boolean;
}) {
  const weekend = status?.blocked === "it's the weekend";
  // On a weekend no window is live — the clock still runs, the session doesn't.
  const m = weekend ? -1 : minutesOf(deskNow(now).slice(11, 16))!;
  const market = goldMarket(deskNow(now));
  const account = useMemo(() => (trades ? ledger(trades, doc.limits, now) : null), [trades, doc.limits, now]);

  const lines: { tone: Tone; text: string }[] = [
    market.open ? { tone: "up", text: `Gold is trading — ${marketNext(market)}.` } : { tone: "soft", text: `Gold is closed (${market.closedFor}) — ${marketNext(market)}.` },
  ];
  if (weekend) lines.push({ tone: "soft", text: "Weekend — no session today. Analysis only." });
  else if (news?.skip.length) lines.push({ tone: "down", text: `Skip day — ${news.skip.join(", ")}. No trading today.` });
  else if (status?.skipDay) lines.push({ tone: "down", text: "Skip day — the year-end break. No trading today." });
  if (status?.dayOff) {
    lines.push({
      tone: "down",
      text: dayOffLine(status.dayOff, status.day),
    });
  }
  if (status?.weekBudget.stopHit) lines.push({ tone: "down", text: "Weekly stop hit — no more trades this week." });
  if (status?.verdict === "sit-out") lines.push({ tone: "warn", text: "The check-in advises leaving the charts today. Your call — make it knowingly." });
  if (status?.verdict === "careful") lines.push({ tone: "warn", text: "The check-in says trade with care: only the cleanest setup." });
  if (status?.doneForToday && !status.dayOff) lines.push({ tone: "up", text: "Done for today." });
  if (lines.length === 1 && !weekend) lines.push({ tone: "soft", text: news ? "Not a skip day." : "Not a skip day — as far as the calendar knows." });

  const rise = (i: number) => (animate ? stagger(i, 60) : undefined);
  const block = cx(animate && "anim-rise");
  const limits = doc.limits;

  return (
    <div className="space-y-3.5 text-body">
      <div className="space-y-1">
        {lines.map((l, i) => (
          <p key={l.text} style={rise(i)} className={cx(block, "font-medium", TONE_TEXT[l.tone])}>
            {l.text}
          </p>
        ))}
      </div>

      {/* The day's clock: entry windows, the gap between them, the time stop. */}
      <div style={rise(lines.length)} className={cx(block, "flex flex-wrap items-center gap-1.5 whitespace-nowrap")}>
        <span className="text-caption text-faint">Entries</span>
        {doc.entryWindows.map((w) => {
          const live = m >= minutesOf(w.from)! && m < minutesOf(w.to)!;
          return (
            <span key={w.from} className={cx("num rounded-md px-1.5 py-0.5 text-small", live ? "bg-up/15 text-up" : "bg-subtle text-soft")}>
              {w.from}–{w.to}
            </span>
          );
        })}
        <span className="ml-1 text-caption text-faint">out by</span>
        <span className={cx("num rounded-md bg-subtle px-1.5 py-0.5 text-small", !weekend && m >= minutesOf(doc.timeStop)! ? "text-faint" : "text-soft")}>{doc.timeStop}</span>
      </div>

      <div style={rise(lines.length + 1)} className={block}>
        {news && news.windows.length > 0 ? (
          <ul className="space-y-1">
            {news.windows.map((w) => (
              <ReleaseRow key={`${w.at}${w.title}`} w={w} m={m} />
            ))}
          </ul>
        ) : (
          <p className="text-small text-faint">{news ? "No release windows today." : "No calendar data for today."}</p>
        )}
      </div>

      {status && (
        <div style={rise(lines.length + 2)} className={cx(block, "grid grid-cols-3 gap-3 border-t pt-3")}>
          <Mini label="Day left" value={`${status.dayBudget.remaining.toFixed(2)}%`} of={`of ${limits.dailyStopPct}%`} tone={status.dayBudget.stopHit ? "text-down" : ""} />
          <Mini label="Week left" value={`${status.weekBudget.remaining.toFixed(2)}%`} of={`of ${limits.weeklyStopPct}%`} tone={status.weekBudget.stopHit ? "text-down" : ""} />
          <Mini
            label="Next trade"
            value={status.blocked ? "0%" : `${Math.max(...Object.values(status.allowedByGrade))}%`}
            of={status.blocked ?? "best grade"}
            tone={status.blocked ? "text-down" : "text-up"}
          />
        </div>
      )}

      {account && (
        <div style={rise(lines.length + 3)} className={cx(block, "border-t pt-3")}>
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Since you started</span>
            <span className={cx("num text-small font-medium", account.total.pnlPct > 0 ? "text-up" : account.total.pnlPct < 0 ? "text-down" : "text-soft")}>
              {fmtPct(account.total.pnlPct)}
            </span>
          </div>
          <ul className="num mt-1.5 space-y-0.5 text-caption text-faint">
            {account.accounts.map((a) => (
              <li key={a.name} className="flex justify-between gap-3">
                <span className="truncate font-sans">{a.name}</span>
                <span className={a.pnlPct > 0 ? "text-up" : a.pnlPct < 0 ? "text-down" : ""}>{fmtPct(a.pnlPct)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, of, tone }: { label: string; value: string; of: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow truncate">{label}</div>
      <div className={cx("num mt-0.5 text-title font-medium", tone)}>{value}</div>
      <div className="truncate text-caption text-faint">{of}</div>
    </div>
  );
}

function ReleaseRow({ w, m }: { w: ReleaseWindow; m: number }) {
  const live = m >= w.start && m <= w.end;
  const past = m > w.end;
  return (
    <li className={cx("num flex items-center gap-3 text-small", past && "opacity-45")}>
      <span className={cx("w-11", live ? "text-warn" : "text-soft")}>{hhmm(w.at)}</span>
      <span className="w-9 font-medium">{w.currency}</span>
      <span className="min-w-0 flex-1 truncate font-sans text-soft">{w.title}</span>
      <span className={live ? "text-warn" : "text-faint"}>
        no entries {hhmm(Math.max(0, w.start))}–{hhmm(w.end)}
      </span>
    </li>
  );
}

/**
 * Today's status, docked in the bottom-right corner of every tab: one quiet line that
 * says where the day stands right now, opening into the whole card as the mouse rests on
 * it — no click — and folding away again when it leaves.
 */
export function TodayDock({ doc, status, news, now, trades }: { doc: Rulebook; status: DeskStatus | null; news: NewsDay | null; now: Date; trades: Trade[] }) {
  const [open, setOpen] = useState(false);
  // Each opening draws the card afresh, so its rows rise in again; closing keeps them while it fades.
  const [opens, setOpens] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const h = headline(doc, status, news, now);

  // A short grace on the way out, so crossing the gap between the line and the card keeps it open.
  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 200);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (open) setOpens((n) => n + 1);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "America/New_York" }).format(now);

  return (
    <div onMouseEnter={show} onMouseLeave={hide} className="pointer-events-none fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      <div
        aria-hidden={!open}
        className={cx(
          "glass w-[24rem] origin-bottom-right rounded-2xl border p-4 shadow-[var(--shadow-lift)]",
          "transition-[opacity,transform,translate] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
          open ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.97] opacity-0",
        )}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="eyebrow">Today</h3>
          <span className="num text-caption text-faint">
            {day} · {deskNow(now).slice(11, 16)} NY
          </span>
        </div>
        {opens > 0 && <TodayCard key={opens} animate doc={doc} status={status} news={news} now={now} trades={trades} />}
      </div>
      <button
        type="button"
        onFocus={show}
        onBlur={hide}
        onClick={show}
        aria-expanded={open}
        title="Today — rest the mouse here for the whole day"
        className={cx(
          "glass group pointer-events-auto flex items-center gap-3 rounded-full border py-2 pl-3.5 pr-3 text-small shadow-[var(--shadow-lift)] transition-colors",
          open ? "border-faint/40" : "hover:border-faint/40",
        )}
      >
        <span className="relative flex size-2">
          {h.tone !== "soft" && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-40", TONE_DOT[h.tone])} />}
          <span className={cx("relative size-2 rounded-full", TONE_DOT[h.tone])} />
        </span>
        <span className={cx("font-medium", TONE_TEXT[h.tone])}>{h.text}</span>
        {h.sub && <span className="max-w-[16rem] truncate text-soft">{h.sub}</span>}
        <ChevronDown size={13} className={cx("text-faint transition-transform duration-300", !open && "rotate-180")} />
      </button>
    </div>
  );
}
