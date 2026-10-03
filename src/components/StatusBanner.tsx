import type { DeskStatus } from "@/lib/discipline";
import type { NewsDay } from "@/lib/newsRules";
import { cx, stagger } from "./ui";

type Tone = "down" | "warn" | "up";

/**
 * What the rules say about today, on every tab: the consequences running, the stops
 * hit, a missing plan, a skip day — or that today's one trade is done. Silent on an
 * ordinary day; the desk only speaks when a rule has something to say.
 */
export function StatusBanner({
  status,
  news,
  onWritePlan,
}: {
  status: DeskStatus;
  /** Today's news as the rules see it; null when the calendar doesn't cover today. */
  news: NewsDay | null;
  onWritePlan: () => void;
}) {
  const lines: { key: string; tone: Tone; text: string; action?: { label: string; run: () => void } }[] = [];
  const off = status.dayOff;
  if (off?.reason === "rule-break") lines.push({ key: "off", tone: "down", text: "Day off — rule break today." });
  if (off?.reason === "days-off") lines.push({ key: "off", tone: "down", text: `Days off until ${off.until} — after a limit was broken on ${off.from}.` });
  if (status.weekBudget.stopHit) lines.push({ key: "week", tone: "down", text: "Weekly stop hit — no more trades this week." });
  if (news?.skip.length) lines.push({ key: "skip", tone: "down", text: `Skip day — ${news.skip.join(", ")}.` });
  else if (status.skipDay) lines.push({ key: "skip", tone: "down", text: "Skip day — the year-end break." });
  if (status.noPlan && status.plan !== "late") {
    lines.push({ key: "plan", tone: "down", text: "No plan, no trade today.", action: { label: "Write the plan", run: onWritePlan } });
  }
  if (status.noPlan && status.plan === "late") lines.push({ key: "plan", tone: "down", text: "No plan, no trade today — the plan came after the deadline." });
  if (status.halfRisk) lines.push({ key: "half", tone: "warn", text: "Half-risk week — every allowance is halved." });
  if (status.doneForToday && !off) lines.push({ key: "done", tone: "up", text: "Done for today." });
  if (!lines.length) return null;

  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-[13px]">
      {lines.map((l, i) => (
        <span key={l.key} className="anim-rise flex items-center gap-2.5" style={stagger(i, 60)}>
          <span
            className={cx(
              "size-1.5 shrink-0 rounded-full",
              l.tone === "down" ? "bg-down" : l.tone === "warn" ? "bg-warn" : "bg-up",
            )}
          />
          <span className={cx("font-medium", l.tone === "down" ? "text-down" : l.tone === "warn" ? "text-warn" : "text-up")}>
            {l.text}
          </span>
          {l.action && (
            <button onClick={l.action.run} className="text-[12px] text-soft underline underline-offset-2 hover:text-ink">
              {l.action.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
