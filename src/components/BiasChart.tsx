import { useEffect, useState } from "react";
import type { Timeframe } from "@/lib/chart";
import type { DailyBias, Scenario } from "@/lib/dailyBias";
import { useCandles } from "@/lib/useCandles";
import { PriceChart, type ChartLevel, type ChartTone, type ChartZone, type Layers, type MapLevel } from "./PriceChart";
import { Segmented, cx } from "./ui";

/*
 * Today's price with the briefing laid over it — the morning's plan checked against
 * what price is actually doing. Pick a scenario to draw its targets, invalidation
 * and zone; the grey key levels stay underneath as the map.
 */

const DIR_TONE: Record<Scenario["direction"], ChartTone> = { long: "up", short: "down", flat: "neutral" };
const DIR_GLYPH: Record<Scenario["direction"], string> = { long: "▲", short: "▼", flat: "◆" };
const GLYPH_TEXT: Record<ChartTone, string> = { up: "text-up", down: "text-down", neutral: "text-soft", accent: "text-accent" };

const fmt = (v: number) => v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 2 });

/* Chart preferences are per viewer and per browser: localStorage, wrapped. */
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window — the choice just isn't remembered */
  }
}

/** The chart takes the screen: what's left of the viewport under the desk's header. */
function useChartHeight() {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return Math.round(Math.min(940, Math.max(440, vh - 250)));
}

export function BiasChart({
  b,
  pick,
  onPick,
  className,
  style,
}: {
  b: DailyBias;
  /** Index of the scenario drawn on the chart; -1 draws none. */
  pick: number;
  onPick: (i: number) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [prefs, setPrefs] = useState(() => {
    const p = remembered<{ tf: Timeframe } & Layers>("biasChart", { tf: "15m", levels: true, box: true, sessions: true });
    // Anything stored by an older version that the feed doesn't serve falls back to 15m.
    return ["5m", "15m", "1h"].includes(p.tf) ? p : { ...p, tf: "15m" as const };
  });
  // Always from the latest state: quick successive clicks must not undo each other.
  const update = (change: (p: typeof prefs) => Partial<typeof prefs>) =>
    setPrefs((p) => {
      const merged = { ...p, ...change(p) };
      remember("biasChart", merged);
      return merged;
    });
  const feed = useCandles(prefs.tf);
  const height = useChartHeight();

  const s = pick >= 0 ? (b.scenarios[pick] ?? null) : null;
  const tone: ChartTone = s ? DIR_TONE[s.direction] : "neutral";
  const plan: ChartLevel[] = [
    ...(s?.targets ?? []).map((t, i) => ({
      price: t.price,
      label: `TP${i + 1} ${fmt(t.price)}${t.prob != null ? ` · ${t.prob}%` : ""}`,
      kind: "target" as const,
      tone,
    })),
    ...(s?.invalidation != null
      ? [{ price: s.invalidation, label: `✕ ${fmt(s.invalidation)}`, kind: "invalid" as const, tone: "neutral" as const }]
      : []),
    ...(b.keyLevel?.price != null
      ? [{ price: b.keyLevel.price, label: `Key ${fmt(b.keyLevel.price)}`, kind: "key" as const, tone: "accent" as const }]
      : []),
  ];
  const zone: ChartZone | null = s?.zone
    ? { ...s.zone, label: s.kind === "chop" ? "Chop range" : "Trigger zone", tone }
    : null;
  const map: MapLevel[] = b.levels.map((l) => ({
    price: l.price,
    label: l.label,
    kind: l.kind,
    prob: l.sweepProb,
    verdict: l.verdict,
    note: l.note,
  }));

  const toggles = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Chart layers">
      {(
        [
          ["levels", "Key levels"],
          ["box", "CRT box"],
          ["sessions", prefs.tf === "1h" ? "Days" : "Sessions"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={prefs[key]}
          onClick={() => update((p) => ({ [key]: !p[key] }))}
          className={cx(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors duration-300",
            prefs[key] ? "border-line bg-raised text-ink" : "border-transparent text-faint hover:text-soft",
          )}
        >
          <span className={cx("size-1.5 rounded-full", prefs[key] ? "bg-accent" : "bg-faint/40")} />
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <section className={cx("card overflow-hidden", className)} style={style}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div>
          <h3 className="text-[14px] font-semibold">Today on the chart</h3>
          <p className="text-[11px] text-faint">
            XAU/USD spot · {prefs.tf} · {feed.source || "live feed"}
            {feed.stale && <span className="text-warn"> · delayed</span>} · NY time · refreshed each minute
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-subtle p-1" role="group" aria-label="Scenario drawn on the chart">
            {b.scenarios.map((sc, i) => (
              <button
                key={sc.kind + sc.title}
                type="button"
                onClick={() => onPick(i === pick ? -1 : i)}
                aria-pressed={i === pick}
                title={i === pick ? "Click again to hide the plan" : "Draw this scenario"}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors duration-300",
                  i === pick ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-soft hover:text-ink",
                )}
              >
                <span className={cx("text-[9px]", GLYPH_TEXT[DIR_TONE[sc.direction]])}>{DIR_GLYPH[sc.direction]}</span>
                <span className="capitalize">{sc.kind === "chop" ? "Chop" : sc.kind}</span>
                <span className="num text-faint">{sc.prob}%</span>
              </button>
            ))}
          </div>
          <Segmented
            size="sm"
            value={prefs.tf}
            onChange={(v) => v && update(() => ({ tf: v }))}
            options={[
              { value: "5m", label: "5m" },
              { value: "15m", label: "15m" },
              { value: "1h", label: "1h" },
            ]}
          />
        </div>
      </header>

      <div className="px-5 pb-4 pt-3">
        {feed.candles.length > 0 ? (
          <PriceChart
            candles={feed.candles}
            tf={prefs.tf}
            height={height}
            plan={plan}
            zone={zone}
            map={map}
            layers={prefs}
            toolbar={toggles}
          />
        ) : (
          <div className="flex items-center justify-center text-[13px] text-faint" style={{ height: height + 34 }}>
            {feed.loading
              ? "Loading candles…"
              : `Price feed unavailable${feed.error ? ` — ${feed.error}` : ""}. The briefing below is unaffected.`}
          </div>
        )}
        <Legend />
      </div>
    </section>
  );
}

/** What every mark means and what it can do to price, drawn with the marks themselves. */
function Legend() {
  const line = (cls: string, dash?: string, cap?: "round") => (
    <svg width="20" height="6" aria-hidden className="shrink-0">
      <line x1="1" x2="19" y1="3" y2="3" className={cls} strokeWidth={dash === "0.1 4" ? 1.8 : 1.5} strokeDasharray={dash} strokeLinecap={cap} />
    </svg>
  );
  const group = "flex flex-wrap items-center gap-x-4 gap-y-1.5";
  const head = "w-16 shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint";
  const item = "flex items-center gap-1.5";
  return (
    <div className="mt-3 space-y-1.5 border-t pt-3 text-[11px] text-soft">
      <div className={group}>
        <span className={head}>Plan</span>
        <span className={item}>{line("stroke-down", "6 4")}Target — where the scenario aims</span>
        <span className={item}>{line("stroke-soft")}✕ Invalidation — the idea is wrong beyond it</span>
        <span className={item}>{line("stroke-accent")}Key level — the one to watch</span>
        <span className={item}>
          <span className="h-2.5 w-4 rounded-[2px] bg-down/15" />
          Zone — trigger area or chop range
        </span>
      </div>
      <div className={group}>
        <span className={head}>Levels</span>
        <span className={item}>{line("stroke-soft", "0.1 4", "round")}Liquidity — stops rest here; price is drawn to it</span>
        <span className={item}>{line("stroke-soft")}Support / resistance — price tends to react</span>
        <span className={item}>
          <span className="h-1.5 w-4 rounded-[2px] bg-soft/30" />
          Imbalance (FVG / OB) — price tends to return
        </span>
        <span className="text-faint">% = chance it's touched before the 17:00 NY close (brighter = likelier) · ↩ holds · ⇥ breaks (liquidity: gets taken) · hover a label for more</span>
      </div>
      <div className={group}>
        <span className={head}>Context</span>
        <span className={item}>
          <span className="h-2.5 w-4 rounded-[2px] border border-accent bg-accent/10" />
          CRT 3–4AM box · sweep window to 16:00
        </span>
        <span className={item}>
          <span className="flex gap-[2px]">
            <span className="h-[3px] w-2 rounded-full bg-faint/40" />
            <span className="h-[3px] w-2 rounded-full bg-soft/45" />
            <span className="h-[3px] w-2 rounded-full bg-soft/80" />
          </span>
          Sessions strip: Asia · London · New York (on 1h, trading days)
        </span>
      </div>
    </div>
  );
}
