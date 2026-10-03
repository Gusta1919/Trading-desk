import { dayOffLine, type DeskStatus } from "@/lib/discipline";
import type { NewsDay } from "@/lib/newsRules";
import { tokenValues, type Rulebook } from "@/lib/rulebook";
import { cx } from "./ui";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The desk's own "stand aside today", worked out from the rulebook rather than read
 * from the briefing — so the rules never depend on how a routine happened to word its
 * list: the check-in, a skip day, a day off, the release windows, the entry windows and
 * the time stop.
 */
export function StandAside({ doc, status, news }: { doc: Rulebook; status: DeskStatus | null; news: NewsDay | null }) {
  const values = tokenValues(doc);
  const lines: { tone: "down" | "warn" | "soft"; text: string }[] = [];
  if (news?.skip.length) lines.push({ tone: "down", text: `Skip day — ${news.skip.join(", ")}. No trading at all.` });
  else if (status?.skipDay) lines.push({ tone: "down", text: "Skip day — the year-end break. No trading at all." });
  if (status?.dayOff) {
    lines.push({ tone: "down", text: dayOffLine(status.dayOff, status.day) });
  }
  if (status?.verdict === "sit-out") lines.push({ tone: "warn", text: "The check-in advises leaving the charts today — your call." });
  if (status?.verdict === "careful") lines.push({ tone: "warn", text: "The check-in says trade with care." });
  if (status?.weekBudget.stopHit) lines.push({ tone: "down", text: "Weekly stop hit — stand aside for the rest of the week." });
  if (status?.doneForToday) lines.push({ tone: "soft", text: "Today's trade is done." });
  for (const w of news?.windows ?? []) {
    lines.push({ tone: "warn", text: `${hhmm(Math.max(0, w.start))}–${hhmm(w.end)} no new entries — ${w.currency} ${w.title}` });
  }
  lines.push({ tone: "soft", text: `Entries only ${values.windows}; positions closed by ${doc.timeStop}.` });

  return (
    <div>
      <div className="eyebrow mb-2">Stand aside today · the desk's rules</div>
      <ul className="space-y-1.5 text-body">
        {lines.map((l) => (
          <li key={l.text} className={cx("flex gap-2", l.tone === "down" ? "text-down" : l.tone === "warn" ? "text-warn" : "text-soft")}>
            <span className="text-faint">✕</span>
            {l.text}
          </li>
        ))}
      </ul>
      {!news && <p className="mt-1.5 text-caption text-faint">The calendar has nothing for today, so release windows aren't known.</p>}
    </div>
  );
}
