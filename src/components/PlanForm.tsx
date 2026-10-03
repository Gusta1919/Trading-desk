import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Verdict } from "@/lib/checkin";
import type { DayOff } from "@/lib/discipline";
import type { NewsDay } from "@/lib/newsRules";
import {
  LEVEL_FIELDS,
  deskCheckFor,
  planOnTime,
  type DeskCheck,
  type Plan,
  type PlanBias,
} from "@/lib/plans";
import { tokenValues, type Rulebook } from "@/lib/rulebook";
import { compassFor } from "@/lib/rules";
import { deskTime } from "@/lib/tz";
import { Button, Segmented, cx, stagger } from "./ui";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The morning plan: today's status as the rules see it, then your bias, levels, POIs,
 * the Compass and the desk check. Written before the plan deadline, or there is no
 * trading today — that line is the whole point of the page.
 */
export function PlanForm({
  day,
  plan,
  doc,
  news,
  verdict,
  dayOff,
  halfRisk,
  lean,
  onSaved,
  onSkip,
  saveLabel = "Save the plan",
}: {
  day: string;
  plan: Plan | null;
  doc: Rulebook;
  /** What the news rules make of today; null when the calendar has nothing for it. */
  news: NewsDay | null;
  verdict?: Verdict;
  dayOff?: DayOff | null;
  halfRisk?: boolean;
  /** The Daily Bias briefing's lean, or null before it has arrived. */
  lean: PlanBias | null;
  onSaved: (p: Plan) => void;
  onSkip?: () => void;
  saveLabel?: string;
}) {
  const [bias, setBias] = useState<PlanBias | "">(plan?.bias ?? "");
  const [levels, setLevels] = useState<Record<string, string>>(plan?.levels ?? {});
  const [pois, setPois] = useState(plan?.pois ?? "");
  const [deskCheck, setDeskCheck] = useState<DeskCheck | "">(plan?.deskCheck ?? "");
  const [deskTouched, setDeskTouched] = useState(Boolean(plan?.deskCheck));
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values = tokenValues(doc);

  // The desk check follows your bias against the briefing's lean, until you set it yourself.
  useEffect(() => {
    if (!deskTouched) setDeskCheck(deskCheckFor(bias, lean));
  }, [bias, lean, deskTouched]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.savePlan({ date: day, bias, levels, pois, deskCheck, notes }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const status: { tone: "down" | "warn" | "soft"; text: string }[] = [];
  if (news?.skip.length) status.push({ tone: "down", text: `Skip day — ${news.skip.join(", ")}. No trading today.` });
  if (verdict === "sit-out") status.push({ tone: "down", text: "Check-in says sit out — nothing is tradable today." });
  if (verdict === "caution") status.push({ tone: "warn", text: "Check-in says caution — only A+ is tradable today." });
  if (dayOff) {
    status.push({
      tone: "down",
      text: dayOff.reason === "rule-break" ? "Day off — a rule was broken today." : `Day off — days off until ${dayOff.until}.`,
    });
  }
  if (halfRisk) status.push({ tone: "warn", text: "Half-risk week — every allowance is halved." });

  const written = plan ? `Written at ${deskTime(plan.createdAt)}${planOnTime(plan, doc.planBy) ? " — on time" : ` — after ${doc.planBy}, so no trading today`}` : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="anim-rise text-[26px] font-semibold tracking-tight">Today's plan</h2>
        <p className="anim-rise mt-1 text-soft" style={stagger(1, 80)}>
          No written plan by {doc.planBy} NY means no trading today.
          {written && <span className="block text-[12px] text-faint">{written}</span>}
        </p>
      </div>

      {/* Today as the rules see it — written by the desk, not by you. */}
      <section className="anim-rise card space-y-2 px-4 py-3.5 text-[13px]" style={stagger(2, 80)}>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Today's status</h3>
        {status.map((s) => (
          <p key={s.text} className={cx("font-medium", s.tone === "down" ? "text-down" : s.tone === "warn" ? "text-warn" : "text-soft")}>
            {s.text}
          </p>
        ))}
        {!news?.skip.length && <p className="text-soft">Not a skip day{news ? "" : " — as far as the calendar knows"}.</p>}
        <p className="text-soft">
          <span className="text-faint">Entries </span>
          <span className="num">{values.windows}</span>
          <span className="text-faint"> · out by </span>
          <span className="num">{doc.timeStop}</span>
        </p>
        {news && news.windows.length > 0 ? (
          <ul className="space-y-1">
            {news.windows.map((w) => (
              <li key={`${w.at}${w.title}`} className="num flex gap-3 text-[12px]">
                <span className="w-11 text-soft">{hhmm(w.at)}</span>
                <span className="w-9 font-medium">{w.currency}</span>
                <span className="min-w-0 flex-1 truncate text-soft">{w.title}</span>
                <span className="text-faint">
                  no entries {hhmm(w.start)}–{hhmm(w.end)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-faint">{news ? "No release windows today." : "No calendar data for today."}</p>
        )}
      </section>

      <div className="anim-rise space-y-1.5" style={stagger(3, 80)}>
        <span className="label">Daily bias</span>
        <Segmented
          value={bias || null}
          onChange={(v) => setBias(v ?? "")}
          allowNone
          options={[
            { value: "bullish", label: "Bullish" },
            { value: "bearish", label: "Bearish" },
            { value: "unclear", label: "Unclear" },
          ]}
        />
        <p className="text-[12px] text-faint">From the Daily chart and the level map: where the next draw on liquidity sits.</p>
      </div>

      <div className="anim-rise" style={stagger(4, 80)}>
        <span className="label">Level map</span>
        <div className="grid gap-2 sm:grid-cols-2">
          {LEVEL_FIELDS.map((l) => (
            <label key={l.id} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-[12px] text-soft">{l.label}</span>
              <input
                className="field num py-1.5 text-[13px]"
                value={levels[l.id] ?? ""}
                onChange={(e) => setLevels((x) => ({ ...x, [l.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="anim-rise" style={stagger(5, 80)}>
        <span className="label">HTF points of interest</span>
        <textarea
          className="field min-h-[64px] resize-none text-[13px]"
          placeholder="1H, 4H, Daily and Weekly FVGs, OBs and VIMBs near price"
          value={pois}
          onChange={(e) => setPois(e.target.value)}
        />
      </div>

      <div className="anim-rise grid gap-4 sm:grid-cols-2" style={stagger(6, 80)}>
        <div>
          <span className="label">Compass today</span>
          <p className="num flex h-[38px] items-center gap-4 rounded-xl bg-subtle px-3.5 text-[13px]">
            <span>
              <span className="text-faint">long </span>
              {compassFor(doc, day, "long") ?? "—"}%
            </span>
            <span>
              <span className="text-faint">short </span>
              {compassFor(doc, day, "short") ?? "—"}%
            </span>
          </p>
        </div>
        <div>
          <span className="label">
            Desk check{lean ? ` · briefing leans ${lean}` : ""}
          </span>
          <Segmented
            size="sm"
            allowNone
            value={deskCheck || null}
            onChange={(v) => {
              setDeskTouched(true);
              setDeskCheck(v ?? "");
            }}
            options={[
              { value: "agree", label: "Agrees" },
              { value: "disagree", label: "Disagrees" },
              { value: "none", label: "No briefing yet" },
            ]}
          />
        </div>
      </div>
      <p className="-mt-2 text-[12px] text-faint">The briefing can veto a trade, never create one or flip your bias.</p>

      <div className="anim-rise" style={stagger(7, 80)}>
        <span className="label">Notes</span>
        <textarea
          className="field min-h-[64px] resize-none text-[13px]"
          placeholder="Anything that makes today a no-trade day"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && <p className="text-[13px] text-down">{error}</p>}
      <div className="anim-rise flex items-center justify-end gap-3" style={stagger(8, 80)}>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            No plan today
          </Button>
        )}
        <Button variant="accent" onClick={save} disabled={saving}>
          <Check size={15} /> {saveLabel}
        </Button>
      </div>
    </div>
  );
}
