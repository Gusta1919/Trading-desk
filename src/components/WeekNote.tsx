import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { weekKey, type WeekNote } from "@/lib/types";
import { Segmented, cx } from "./ui";

export const BIASES = [
  { value: "long", label: "Long" },
  { value: "neutral", label: "Neutral" },
  { value: "short", label: "Short" },
];

export const biasTone = (bias: string) =>
  bias === "long" ? "text-up" : bias === "short" ? "text-down" : "text-soft";

/** Human label for a week key: "Week 39 · 21–27 Sep". */
export function weekLabel(key: string) {
  const [year, w] = key.split("-W");
  const jan4 = new Date(Number(year), 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (Number(w) - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `Week ${Number(w)} · ${fmt(monday)}–${fmt(sunday)}`;
}

/**
 * The reasoning you set once a week: bias, why, and the levels that matter.
 * Every trade you take that week is taken against it.
 */
export function WeekNoteCard({
  weeks,
  onSaved,
}: {
  weeks: WeekNote[];
  onSaved: (w: WeekNote) => void;
}) {
  const key = weekKey(new Date());
  const current = weeks.find((w) => w.week === key);

  const [bias, setBias] = useState(current?.bias ?? "");
  const [reasoning, setReasoning] = useState(current?.reasoning ?? "");
  const [levels, setLevels] = useState(current?.levels ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    setBias(current?.bias ?? "");
    setReasoning(current?.reasoning ?? "");
    setLevels(current?.levels ?? "");
  }, [current?.week, current?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next?: { bias?: string }) {
    const payload = {
      week: key,
      bias: next?.bias ?? bias,
      reasoning,
      levels,
    };
    if (
      payload.bias === (current?.bias ?? "") &&
      payload.reasoning === (current?.reasoning ?? "") &&
      payload.levels === (current?.levels ?? "")
    ) {
      return;
    }
    setStatus("saving");
    onSaved(await api.saveWeek(payload));
    setStatus("saved");
  }

  const past = weeks.filter((w) => w.week !== key && (w.reasoning.trim() || w.bias)).slice(0, 8);

  return (
    <section className="card px-6 py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Weekly thesis</h2>
          <p className="text-[12px] text-faint">
            {weekLabel(key)} — set it once, then trade against it all week.
          </p>
        </div>
        <Segmented
          size="sm"
          allowNone
          value={bias || null}
          onChange={(v) => {
            const next = v ?? "";
            setBias(next);
            save({ bias: next });
          }}
          options={BIASES}
        />
      </div>

      <div onBlur={() => save()} className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="label">Why — what the higher timeframes are telling you</label>
          <textarea
            className="field min-h-[110px] resize-y"
            placeholder="e.g. Weekly closed above the range, Daily pulling back into the FVG. I want longs from the 4H demand, no shorts unless the Weekly low breaks."
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Levels that matter this week</label>
          <textarea
            className="field min-h-[110px] resize-y"
            placeholder="e.g. 3412 weekly high · 3380 daily FVG · 3344 last week's low"
            value={levels}
            onChange={(e) => setLevels(e.target.value)}
          />
        </div>
      </div>

      <p className="mt-2 h-4 text-right text-[12px] text-faint">
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
      </p>

      {past.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[12px] text-faint hover:text-ink">
            <span className="group-open:hidden">Past weeks →</span>
            <span className="hidden group-open:inline">Past weeks ↓</span>
          </summary>
          <ul className="mt-3 space-y-3">
            {past.map((w) => (
              <li key={w.week} className="border-l-2 border-line pl-4">
                <div className="flex items-baseline gap-2 text-[12px] text-faint">
                  {weekLabel(w.week)}
                  {w.bias && (
                    <span className={cx("font-medium", biasTone(w.bias))}>{w.bias}</span>
                  )}
                </div>
                {w.reasoning && (
                  <p className="whitespace-pre-wrap text-[13px] text-soft">{w.reasoning}</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
