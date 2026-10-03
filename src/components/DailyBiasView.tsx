import { ArrowDownRight, ArrowUpRight, CircleAlert, ExternalLink, Info, MoveRight, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { toHundred, type DailyBias, type Driver, type Lean, type Scenario, type Trend } from "@/lib/dailyBias";
import { DESK_TZ, deskDateLabel, deskDay, deskTime } from "@/lib/tz";
import type { DailyBiasState } from "@/lib/useDailyBias";
import { BiasChart } from "./BiasChart";
import { PageHeader, Panel as UiPanel, Tip, cx, stagger } from "./ui";

/**
 * Daily Bias tab: the morning's gold read, drawn rather than written.
 *
 * Every number is on screen; the reasoning behind it sits one hover away (Tip), and
 * the complete briefing stays in "Full briefing as text" — less to read, nothing lost.
 */
/** The desk's own stand-aside list, drawn next to the briefing's. */
const StandAsideContext = createContext<ReactNode>(null);
type Crt = { box: { from: string; to: string }; until: string };
/** The rulebook's box and time stop, for the chart. */
const CrtContext = createContext<Crt>({ box: { from: "03:00", to: "04:00" }, until: "12:00" });

export function DailyBiasView({ state, standAside, crt }: { state: DailyBiasState; standAside?: ReactNode; crt: Crt }) {
  return (
    <CrtContext.Provider value={crt}>
    <StandAsideContext.Provider value={standAside ?? null}>
      <div className="space-y-6">
        <PageHeader
          title="Daily Bias"
          sub="This morning's read on gold: the plan on the live chart, the scenarios and what to watch. The rulebook still decides."
        />
        <View state={state} standAside={standAside} />
      </div>
    </StandAsideContext.Provider>
    </CrtContext.Provider>
  );
}

/** Without a briefing, the desk's own list still stands — the rules never wait for the routine. */
const OwnList = ({ node }: { node?: ReactNode }) => (node ? <div className="card anim-rise px-6 py-5">{node}</div> : null);

function View({ state, standAside }: { state: DailyBiasState; standAside?: ReactNode }) {
  if (state.loading) return null;

  if (state.error && !state.date) {
    return (
      <Notice tone="down" title="Can't reach the local server">
        {state.error}. The briefing file is safe on disk; it shows up once the server is running.
      </Notice>
    );
  }

  if (state.freshness !== "today") {
    return (
      <div className="space-y-4">
        <NotYet state={state} />
        <OwnList node={standAside} />
      </div>
    );
  }

  if (!state.bias) {
    return (
      <div className="space-y-4">
        <Notice tone="warn" title="Today's briefing arrived, but not in the expected shape">
          Showing the plain text instead. Nothing is lost — tomorrow's run starts from scratch.
        </Notice>
        <OwnList node={standAside} />
        {state.fallback && (
          <pre className="card whitespace-pre-wrap px-6 py-5 font-sans text-body leading-relaxed text-soft">
            {state.fallback}
          </pre>
        )}
      </div>
    );
  }

  return <Briefing b={state.bias} />;
}

/* ── Polarity: one encoding everywhere ───────────────────────────────── */

/*
 * Bullish / neutral / bearish always wear the same three marks. The neutral is the
 * lighter `soft` grey, not `faint`: against the desk's red, `faint` drops to ΔE 5.7
 * under protanopia, `soft` clears the colour-blind check. Every mark also carries a
 * glyph and a word, so polarity never rests on colour alone.
 */
const POLE = {
  bullish: {
    glyph: "▲", bar: "bg-up", text: "text-up", tint: "bg-up/10", word: "Bullish",
    ring: "ring-up/60", edge: "border-up/40", hoverEdge: "hover:border-up/40",
  },
  neutral: {
    glyph: "◆", bar: "bg-soft", text: "text-soft", tint: "bg-subtle", word: "Neutral",
    ring: "ring-soft/60", edge: "border-soft/40", hoverEdge: "hover:border-soft/40",
  },
  bearish: {
    glyph: "▼", bar: "bg-down", text: "text-down", tint: "bg-down/10", word: "Bearish",
    ring: "ring-down/60", edge: "border-down/40", hoverEdge: "hover:border-down/40",
  },
} as const;

const trendPole = (t: Trend): Lean => (t === "range" ? "neutral" : t);

/* ── The briefing ────────────────────────────────────────────────────── */

function Briefing({ b }: { b: DailyBias }) {
  const crt = useContext(CrtContext);
  const lead = leading(b);
  // One scenario is on the chart at a time; the cards and the chart's pills share it.
  const [pick, setPick] = useState(() => Math.max(0, b.scenarios.findIndex((s) => s.kind === "primary")));
  const choose = (i: number) => setPick(i === pick ? -1 : i);
  let i = 0;
  const rise = () => ({ className: "anim-rise", style: stagger(i++, 70) });

  // The day's three outcomes sit in the middle of the chart's title bar: the likeliest in
  // its colour, the split as one thin bar underneath, the reasoning a hover away.
  const split = [
    { pole: "bullish", word: "Bullish", pct: b.bias.bullish },
    { pole: "neutral", word: "Range", pct: b.bias.range },
    { pole: "bearish", word: "Bearish", pct: b.bias.bearish },
  ] as const;
  const headline = (
    <Tip
      text={
        <>
          <span className="block text-ink">The kind of day expected, up to the 17:00 NY close.</span>
          {b.bias.why && <span className="mt-1 block">{b.bias.why}</span>}
        </>
      }
    >
      <span className="block w-[300px]" aria-label={`Bullish ${b.bias.bullish}%, range ${b.bias.range}%, bearish ${b.bias.bearish}%`}>
        <span className="flex items-baseline justify-between text-small">
          {split.map((x) => (
            <span
              key={x.pole}
              className={cx("flex items-baseline gap-1.5", x.pole === lead.pole ? cx("font-semibold", POLE[x.pole].text) : "text-faint")}
            >
              <span className="text-[9px]">{POLE[x.pole].glyph}</span>
              {x.word}
              <span className={cx("num text-title", x.pole !== lead.pole && "text-soft")}>{x.pct}%</span>
            </span>
          ))}
        </span>
        <span className="mt-1.5 flex h-[5px] gap-[2px]">
          {split
            .filter((x) => x.pct > 0)
            .map((x) => (
              <span
                key={x.pole}
                className={cx("rounded-full", POLE[x.pole].bar, x.pole !== lead.pole && "opacity-35")}
                style={{ flexGrow: x.pct }}
              />
            ))}
        </span>
      </span>
    </Tip>
  );

  /*
   * Most practical first: the plan against live price (with the day's call on top),
   * then what to do (scenarios), what to watch (tiles), when (sessions, risk), why
   * (macro, consensus) and finally the full text.
   */
  return (
    <div className="space-y-6">
      <BiasChart
        b={b}
        pick={pick}
        onPick={setPick}
        headline={headline}
        day={deskDateLabel(`${b.date}T12:00:00Z`)}
        writtenAt={b.generatedAt ? `${deskTime(b.generatedAt)} NY` : null}
        crt={crt}
        {...rise()}
      />

      {b.scenarios.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {b.scenarios.map((s, i) => (
            <ScenarioCard key={s.kind + s.title} s={s} selected={i === pick} onSelect={() => choose(i)} {...rise()} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <KeyLevelTile b={b} {...rise()} />
        <EventTile b={b} {...rise()} />
        <VolatilityTile b={b} {...rise()} />
        <StructureTile b={b} {...rise()} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {b.sessions.length > 0 && (
          <Panel
            {...rise()}
            title="Sessions"
            sub="How today's Asia, London and New York sessions are likely to trade: the chance each call comes true."
          >
            <ul className="space-y-3.5 px-6 pb-5">
              {b.sessions.map((s) => (
                <li key={s.label}>
                  <div className="flex items-baseline justify-between gap-3 text-body">
                    <Tip text={s.why}>{s.label}</Tip>
                    <span className="num text-soft">{s.prob}%</span>
                  </div>
                  <Meter value={s.prob} />
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {(() => {
          const r = rise();
          return (
            <Risk
              b={b}
              className={cx(r.className, b.sessions.length > 0 ? "lg:col-span-2" : "lg:col-span-3")}
              style={r.style}
            />
          );
        })()}
      </div>

      <Macro b={b} {...rise()} />

      {b.analysts.length > 0 && <Consensus b={b} {...rise()} />}

      <footer {...rise()} className="anim-rise space-y-3">
        {b.markdown && (
          <details className="group">
            <summary className="cursor-pointer list-none text-small text-faint hover:text-soft">
              <span className="group-open:hidden">Full briefing as text →</span>
              <span className="hidden group-open:inline">Full briefing as text ↓</span>
            </summary>
            <pre className="card mt-3 whitespace-pre-wrap px-6 py-5 font-sans text-body leading-relaxed text-soft">
              {b.markdown}
            </pre>
          </details>
        )}
        <p className="text-caption text-faint">
          Hover any label or <Info size={10} className="inline -translate-y-px" /> for the reasoning.
          Probabilities are Claude's subjective estimates from public analysis, not a fitted model. Analysis,
          not financial advice.
        </p>
      </footer>
    </div>
  );
}

/* ── Top tiles ───────────────────────────────────────────────────────── */

function KeyLevelTile({ b, className, style }: { b: DailyBias } & Anim) {
  const k = b.keyLevel;
  // The same price in the ladder carries its sweep odds; match within half a point.
  const match = k?.price != null ? b.levels.find((l) => Math.abs(l.price - k.price!) <= 0.5) : undefined;
  const dist = k?.price != null && b.spot != null ? k.price - b.spot : null;
  return (
    <Tile tone="bg-accent" label="Key level" why={k?.why} className={className} style={style}>
      {k ? (
        <>
          <div className="flex items-baseline gap-2.5">
            <span className="text-stat font-semibold tracking-tight">{k.price != null ? px(k.price) : "—"}</span>
            {dist != null && <span className="num text-small text-soft">{signedPts(dist)} pts</span>}
          </div>
          <div className="text-body text-soft">{k.label}</div>
          {match?.sweepProb != null && (
            <div className="mt-auto pt-3">
              <div className="flex justify-between text-caption text-faint">
                <span>Touched by 17:00 NY</span>
                <span className="num text-soft">{match.sweepProb}%</span>
              </div>
              <Meter value={match.sweepProb} />
            </div>
          )}
        </>
      ) : (
        <span className="text-body text-faint">None named today.</span>
      )}
    </Tile>
  );
}

function EventTile({ b, className, style }: { b: DailyBias } & Anim) {
  const e = b.mainEvent;
  const sur = b.macro.surprise;
  return (
    <Tile tone="bg-warn" label="Main event" why={e?.why} className={className} style={style}>
      {e ? (
        <>
          <div className="flex items-baseline gap-2.5">
            <span className="text-stat font-semibold tracking-tight">
              {e.at ? `${weekdayIfNotToday(e.at)}${deskTime(e.at)}` : "TBC"}
            </span>
            {e.at && <span className="text-small text-soft">NY · {countdown(e.at)}</span>}
          </div>
          <div className="text-body text-soft">{e.title}</div>
        </>
      ) : (
        <span className="text-body text-faint">No major release today.</span>
      )}
      {sur && (
        <div className="mt-auto pt-3">
          <div className="mb-1.5 text-caption text-faint">
            <Tip text={sur.why}>Surprise{sur.event && e?.title !== sur.event ? ` · ${sur.event}` : ""}</Tip>
          </div>
          <SplitBar
            compact
            parts={[
              { pole: "bullish", label: "Gold-bullish", value: sur.bullish },
              { pole: "bearish", label: "Gold-bearish", value: sur.bearish },
            ]}
          />
        </div>
      )}
    </Tile>
  );
}

function StructureTile({ b, className, style }: { b: DailyBias } & Anim) {
  const s = b.structure;
  return (
    <Tile tone="bg-soft" label="Structure" why={s.why} className={className} style={style}>
      {s.d1Trend || s.h4Trend ? (
        <div className="mt-1 grid grid-cols-2 gap-2">
          <TrendCard tf="D1" trend={s.d1Trend} note={s.d1} />
          <TrendCard tf="H4" trend={s.h4Trend} note={s.h4} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <TrendRow tf="D1" note={s.d1} />
          <TrendRow tf="H4" note={s.h4} />
        </div>
      )}
      <div className="mt-auto pt-4">
        {s.rangeLow != null && s.rangeHigh != null && b.spot != null ? (
          <RangeGauge low={s.rangeLow} high={s.rangeHigh} spot={b.spot} />
        ) : (
          s.zone && <ZoneStrip zone={s.zone} />
        )}
      </div>
    </Tile>
  );
}

/** How much of a normal day's range is already spent — room left to trade. */
function VolatilityTile({ b, className, style }: { b: DailyBias } & Anim) {
  const r = b.risk;
  const used = r.dayLow != null && r.dayHigh != null ? r.dayHigh - r.dayLow : null;
  const pct = used != null && r.atr ? Math.round((used / r.atr) * 100) : null;
  return (
    <Tile
      tone="bg-cyan"
      label="Volatility"
      why={r.expectedRange ? `Expected range today: ${r.expectedRange}.` : undefined}
      className={className}
      style={style}
    >
      {pct != null ? (
        <>
          <div className="flex items-baseline gap-2.5">
            <span className="text-stat font-semibold tracking-tight">{pct}%</span>
            <span className="text-small text-soft">of ATR used</span>
          </div>
          <div className="text-body text-soft">
            {Math.round(used!)} of {r.atr} pts · {Math.max(0, Math.round(r.atr! - used!))} pts left
          </div>
          <div className="mt-auto pt-3">
            <Meter value={Math.min(pct, 100)} bar={pct >= 80 ? "bg-warn" : "bg-cyan"} className="!h-1.5" />
            <div className="mt-1.5 flex justify-between text-caption text-faint">
              <span>
                Range {px(r.dayLow!)}–{px(r.dayHigh!)}
              </span>
              {pct >= 80 && <span className="text-warn">most of the day's move is done</span>}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="text-stat font-semibold tracking-tight">{r.atr != null ? `ATR ${r.atr}` : "—"}</div>
          {r.expectedRange && <div className="text-body text-soft">Expected {r.expectedRange}</div>}
        </>
      )}
    </Tile>
  );
}

const TREND_ICON = { bullish: TrendingUp, bearish: TrendingDown, range: MoveRight } as const;

/** A timeframe's direction, read in one glance: arrow, word, tinted card. The note is on hover. */
function TrendCard({ tf, trend, note }: { tf: string; trend: Trend | null; note: string }) {
  if (!trend) {
    return <div className="rounded-xl bg-subtle px-3 py-2.5 text-small text-faint">{tf} · —</div>;
  }
  const pole = POLE[trendPole(trend)];
  const Icon = TREND_ICON[trend];
  return (
    <Tip text={note} className="block">
      <span className={cx("flex items-center gap-2.5 rounded-xl px-3 py-2.5", pole.tint)}>
        <Icon size={22} strokeWidth={2.25} className={cx("shrink-0", pole.text)} />
        <span className="min-w-0">
          <span className="num block text-micro text-faint">{tf}</span>
          <span className="block text-title font-semibold leading-tight">
            {trend === "range" ? "Range" : pole.word}
          </span>
        </span>
      </span>
    </Tip>
  );
}

/** Older briefings without trend fields: the note itself, one line. */
function TrendRow({ tf, note }: { tf: string; note: string }) {
  return (
    <div className="flex items-center gap-2.5 text-body">
      <span className="num w-6 shrink-0 text-caption text-faint">{tf}</span>
      <Tip text={note} className="truncate text-soft">
        {note || "—"}
      </Tip>
    </div>
  );
}

/**
 * Where spot sits in the dealing range: discount fades into premium around
 * equilibrium, and a pin marks spot with its price — "premium vs discount" as a picture.
 */
function RangeGauge({ low, high, spot }: { low: number; high: number; spot: number }) {
  const pct = Math.min(100, Math.max(0, ((spot - low) / (high - low)) * 100));
  const zone = pct < 45 ? "discount" : pct > 55 ? "premium" : "equilibrium";
  const pole = zone === "discount" ? POLE.bullish : zone === "premium" ? POLE.bearish : POLE.neutral;
  // Keep the price chip inside the tile at the extremes.
  const chipAt = Math.min(86, Math.max(14, pct));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-caption">
        <span className="text-faint">Dealing range</span>
        <span className="flex items-center gap-1.5 text-soft">
          <span className={cx("size-1.5 rounded-full", pole.bar)} />
          <span className="font-semibold capitalize text-ink">{zone}</span> · {Math.round(pct)}%
        </span>
      </div>
      <div className="relative pt-7">
        <span
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md bg-accent/15 px-1.5 py-0.5 text-caption font-semibold text-accent-2"
          style={{ left: `${chipAt}%` }}
        >
          {px(spot)}
        </span>
        <span className="absolute top-[22px] -bottom-1 w-[2px] -translate-x-1/2 bg-accent" style={{ left: `${pct}%` }} />
        <div
          className="h-3 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--color-up) 45%, transparent), var(--color-subtle) 50%, color-mix(in oklab, var(--color-down) 45%, transparent))",
          }}
        />
        <span className="absolute -bottom-1 left-1/2 top-[24px] w-px bg-ink/40" />
        <span
          className="absolute bottom-[-2px] size-4 -translate-x-1/2 rounded-full border-2 border-surface bg-accent"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="num mt-2 grid grid-cols-3 text-caption text-faint">
        <span>{px(low)}</span>
        <span className="text-center">EQ {px((low + high) / 2)}</span>
        <span className="text-right">{px(high)}</span>
      </div>
      <div className="grid grid-cols-2 eyebrow">
        <span>Discount</span>
        <span className="text-right">Premium</span>
      </div>
    </div>
  );
}

/* ── Scenarios ───────────────────────────────────────────────────────── */

function ScenarioCard({
  s,
  selected,
  onSelect,
  className,
  style,
}: { s: Scenario; selected: boolean; onSelect: () => void } & Anim) {
  const pole = POLE[s.direction === "long" ? "bullish" : s.direction === "short" ? "bearish" : "neutral"];
  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      title={selected ? "Shown on the chart" : "Show on the chart"}
      className={cx(
        // The card lights up in its own direction's colour, not the desk's orange accent:
        // a picked short reads red, a long green, chop grey.
        "card flex h-full cursor-pointer flex-col px-6 py-5 outline-none",
        "hover:-translate-y-[3px] hover:bg-raised hover:shadow-[var(--shadow-lift)] focus-visible:ring-1",
        pole.ring,
        pole.hoverEdge,
        selected && cx("ring-1", pole.edge),
        className,
      )}
      style={style}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="eyebrow">
          {s.kind === "chop" ? "Chop" : s.kind} ·{" "}
          <span className={pole.text}>{pole.glyph}</span> {s.direction}
        </div>
        <div className={cx("num text-stat font-semibold tracking-tight", pole.text)}>{s.prob}%</div>
      </div>
      <h3 className="mt-0.5 text-title font-semibold">
        <Tip text={s.why}>{s.title}</Tip>
      </h3>
      {s.trigger && <p className="mt-1.5 line-clamp-2 text-small text-soft">{s.trigger}</p>}
      {s.targets.length > 0 && (
        <ul className="mt-3 space-y-2">
          {s.targets.map((t, n) => (
            <li key={t.price} className="flex items-center gap-2.5 text-small">
              <span className="w-7 text-faint">TP{n + 1}</span>
              <span className="num w-14">{px(t.price)}</span>
              {t.prob != null && (
                <>
                  <Meter value={t.prob} className="!mt-0 flex-1" bar={pole.bar} />
                  <span className="num w-9 text-right text-soft">{t.prob}%</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.invalidation != null && (
        <p className="num mt-auto pt-3 text-small text-faint">
          ✕ invalid beyond <span className="text-soft">{px(s.invalidation)}</span>
        </p>
      )}
    </article>
  );
}

/* ── Macro ───────────────────────────────────────────────────────────── */

/* Full width: one row of driver cards whatever their count (written out for Tailwind). */
const DRIVER_COLS: Record<number, string> = {
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
};

const GOLD_WORD: Record<Lean, string> = { bullish: "tailwind", neutral: "neutral", bearish: "headwind" };

function Macro({ b, className, style }: { b: DailyBias } & Anim) {
  const d = b.macro.drivers;
  const count = (p: Lean) => d.filter((x) => x.gold === p).length;
  const net = count("bullish") - count("bearish");
  return (
    <Panel title="Macro & intermarket" why={b.macro.flow} className={className} style={style}>
      {d.length > 0 ? (
        <>
          <div className={cx("grid grid-cols-2 gap-3 px-6 pb-5 sm:grid-cols-3", DRIVER_COLS[Math.min(Math.max(d.length, 3), 6)])}>
            {d.map((x) => (
              <DriverCard key={x.name} x={x} />
            ))}
          </div>
          <div className="border-t px-6 py-4">
            <SidesBar
              title="Net for gold"
              verdict={net > 0 ? "Net tailwind" : net < 0 ? "Net headwind" : "Balanced"}
              bear={{ value: count("bearish"), shown: `${count("bearish")} headwind${count("bearish") === 1 ? "" : "s"}` }}
              neutral={{ value: count("neutral"), shown: `${count("neutral")} neutral` }}
              bull={{ value: count("bullish"), shown: `${count("bullish")} tailwind${count("bullish") === 1 ? "" : "s"}` }}
            />
          </div>
        </>
      ) : (
        // An older briefing without driver cards: its two short lines.
        <dl className="space-y-2.5 px-6 pb-5 text-body">
          <Fact term="DXY">{b.macro.dxy}</Fact>
          <Fact term="Yields">{b.macro.yields}</Fact>
        </dl>
      )}
    </Panel>
  );
}

/** Which way a driver moved, when its change is a signed number ("-2bp", "+0.3%"). */
function moveOf(change: string): "up" | "down" | null {
  const m = change.trim().match(/^([+\-−])\s*\d/);
  return m ? (m[1] === "+" ? "up" : "down") : null;
}

/**
 * One instrument: its level and move up top, and — the part that matters for the
 * trade — whether it pushes gold up or down today, as the chip.
 */
function DriverCard({ x }: { x: Driver }) {
  const pole = POLE[x.gold];
  const move = moveOf(x.change);
  return (
    <div className="well px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate eyebrow">{x.name}</span>
        {move === "up" && <ArrowUpRight size={14} className="shrink-0 text-soft" />}
        {move === "down" && <ArrowDownRight size={14} className="shrink-0 text-soft" />}
      </div>
      <div className="mt-1 truncate text-heading font-semibold tracking-tight">{x.value || "—"}</div>
      <div className="num truncate text-caption text-faint">{x.change || " "}</div>
      <span className={cx("mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption font-medium", pole.tint)}>
        <span className={cx("text-[9px]", pole.text)}>{pole.glyph}</span>
        Gold {GOLD_WORD[x.gold]}
      </span>
    </div>
  );
}

/* ── Consensus ───────────────────────────────────────────────────────── */

/**
 * Who leans which way, laid out left (bearish) to right (bullish) under a bar
 * centred on neutral — the analysts are the chart. Counts come from the chips shown,
 * so the bar and the columns always agree.
 */
function Consensus({ b, className, style }: { b: DailyBias } & Anim) {
  const ref = b.generatedAt ? Date.parse(b.generatedAt) : Date.now();
  const col = (p: Lean) => b.analysts.filter((a) => a.lean === p);
  const n = b.analysts.length;
  const [bear, neutral, bull] = toHundred([col("bearish").length, col("neutral").length, col("bullish").length]);
  const fresh = b.analysts.filter(
    (a) => a.publishedAt != null && ref - Date.parse(a.publishedAt) <= 24 * 3_600_000,
  ).length;
  const verdict = bear - bull >= 10 ? "Bearish lean" : bull - bear >= 10 ? "Bullish lean" : "Split";

  return (
    <Panel title="Pro-trader consensus" note={`${n} views · ${fresh} from the last 24h`} className={className} style={style}>
      <div className="px-6">
        <SidesBar
          verdict={verdict}
          bear={{ value: bear, shown: `${bear}% bearish` }}
          neutral={{ value: neutral, shown: `${neutral}% neutral` }}
          bull={{ value: bull, shown: `${bull}% bullish` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-4 px-6 py-5">
        {(["bearish", "neutral", "bullish"] as const).map((p) => (
          <div key={p}>
            <div className="mb-2 flex items-center gap-1.5 eyebrow">
              <span className={POLE[p].text}>{POLE[p].glyph}</span>
              {POLE[p].word} · {col(p).length}
            </div>
            <ul className="space-y-1.5">
              {col(p).map((a) => {
                const hours = a.publishedAt ? Math.max(0, Math.round((ref - Date.parse(a.publishedAt)) / 3_600_000)) : null;
                const stale = hours == null || hours > 24;
                return (
                  <li key={a.name + a.source}>
                    <Tip
                      className="block"
                      text={
                        <>
                          {a.levels && <span className="num block text-ink">{a.levels}</span>}
                          {a.why}
                        </>
                      }
                    >
                      <span className="flex items-center gap-2 rounded-lg border bg-raised px-2.5 py-1.5">
                        <span className={cx("size-1.5 shrink-0 rounded-full", POLE[p].bar)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-small font-medium">{shortName(a.name)}</span>
                          <span className="block truncate text-caption text-faint">
                            {a.source}
                            {" · "}
                            <span className={stale ? "text-warn" : undefined}>{hours == null ? "undated" : `${hours}h`}</span>
                          </span>
                        </span>
                        {a.url && (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-faint hover:text-accent-2"
                            aria-label={`Open ${a.name}'s analysis`}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </span>
                    </Tip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {b.consensus?.take && (
        <p className="border-t px-6 py-3.5 text-small text-soft">
          <span className="font-semibold text-ink">Claude's read · </span>
          {b.consensus.take}
        </p>
      )}
    </Panel>
  );
}

/**
 * Two sides and a middle across the full width: bearish/headwinds from the left,
 * bullish/tailwinds from the right, neutral between. The tick at 50% makes the
 * dominant side obvious without reading a number; segments are split by 2px gaps.
 */
function SidesBar({
  title,
  verdict,
  bear,
  neutral,
  bull,
}: {
  title?: string;
  verdict: string;
  bear: { value: number; shown: string };
  neutral: { value: number; shown: string };
  bull: { value: number; shown: string };
}) {
  const parts = [
    { key: "bearish" as const, ...bear },
    { key: "neutral" as const, ...neutral },
    { key: "bullish" as const, ...bull },
  ];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-caption">
        <span className="text-faint">{title}</span>
        <span className="font-semibold uppercase tracking-[0.08em] text-ink">{verdict}</span>
      </div>
      <div className="relative">
        <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-subtle">
          {parts.map((p) =>
            p.value > 0 ? (
              <div
                key={p.key}
                className={cx("anim-grow h-full", POLE[p.key].bar)}
                style={{ flex: p.value }}
                title={p.shown}
              />
            ) : null,
          )}
        </div>
        <span className="absolute -inset-y-1 left-1/2 w-px bg-ink/50" />
      </div>
      <div className="mt-2 grid grid-cols-3 text-small">
        <span className="flex items-baseline gap-1.5">
          <span className="text-micro text-down">▼</span>
          <span className="font-semibold">{bear.shown}</span>
        </span>
        <span className="flex items-baseline justify-center gap-1.5 text-soft">
          <span className="text-micro">◆</span>
          {neutral.shown}
        </span>
        <span className="flex items-baseline justify-end gap-1.5">
          <span className="font-semibold">{bull.shown}</span>
          <span className="text-micro text-up">▲</span>
        </span>
      </div>
    </div>
  );
}

/* ── Risk ────────────────────────────────────────────────────────────── */

/** The desk's own list under the briefing's — the rules, whatever the routine wrote. */
function DeskList() {
  const node = useContext(StandAsideContext);
  return node ? <div className="mt-5 border-t pt-4">{node}</div> : null;
}

function Risk({ b, className, style }: { b: DailyBias } & Anim) {
  const r = b.risk;
  // Group releases by desk day so "today" reads apart from the rest of the week.
  const days = new Map<string, typeof r.events>();
  for (const e of r.events) {
    const k = e.at ? deskDay(new Date(e.at)) : "TBC";
    days.set(k, [...(days.get(k) ?? []), e]);
  }

  return (
    <Panel title="Risk & timing" sub="Scheduled releases on New York time, and when to keep your hands off." className={className} style={style}>
      <div className="grid grid-cols-1 gap-6 px-6 pb-5 md:grid-cols-2">
        <div>
          <div className="eyebrow mb-2 block">Releases</div>
          <div className="space-y-2.5">
            {[...days].map(([day, list]) => (
              <div key={day}>
                <div className="text-caption text-faint">
                  {day === deskDay() ? "Today" : day === "TBC" ? "Time TBC" : deskDateLabel(`${day}T12:00:00Z`)}
                </div>
                <ul className="mt-1 space-y-1">
                  {list.map((e) => (
                    <li key={e.title + e.at} className="flex items-center gap-2.5 text-body">
                      <span className="num w-11 shrink-0 text-soft">{e.at ? deskTime(e.at) : "—"}</span>
                      <span
                        className={cx(
                          "size-2 shrink-0 rounded-full",
                          e.impact === "High" ? "bg-down" : e.impact === "Medium" ? "bg-warn" : "bg-low",
                        )}
                        title={`${e.impact} impact`}
                      />
                      <span className="truncate">{e.title}</span>
                      {e.at && Date.parse(e.at) > Date.now() && Date.parse(e.at) - Date.now() < 24 * 3_600_000 && (
                        <span className="num ml-auto shrink-0 text-caption text-faint">{countdown(e.at)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!r.events.length && <p className="text-body text-faint">Nothing scheduled.</p>}
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2 block">Stand aside if</div>
          <ul className="space-y-1.5 text-body text-soft">
            {r.standAside.map((x) => (
              <li key={x} className="flex gap-2">
                <span className="text-faint">✕</span>
                {x}
              </li>
            ))}
            {!r.standAside.length && <li className="text-faint">No stand-aside conditions today.</li>}
          </ul>
          <DeskList />
        </div>
      </div>
    </Panel>
  );
}

/* ── Before the briefing lands ───────────────────────────────────────── */

/** Before today's briefing has landed — or on a day none is due. */
function NotYet({ state }: { state: DailyBiasState }) {
  const last = state.date ? ` The last one on file is from ${deskDateLabel(`${state.date}T12:00:00Z`)}.` : "";
  const g = state.gmail;

  // Nothing can arrive until the desk can read Gmail, so say that before anything else.
  if (g?.state === "off" && state.freshness !== "offday") {
    return (
      <Notice tone="warn" title="Gmail isn't connected to the desk yet">
        The briefing is written in the cloud at 9:46 Amsterdam time and saved as a Gmail draft. The desk
        needs a Gmail app password in your Mac's Keychain (item "trading-desk-gmail") to collect it — see
        JAK-URUCHOMIC.txt.
      </Notice>
    );
  }
  // A wrong password or a Gmail outage should be visible straight away, not only once it's late.
  if (g?.state === "error" && state.freshness !== "offday") {
    return (
      <Notice tone="down" title="Couldn't collect today's briefing from Gmail">
        {g.message}. Checked at {deskTime(g.checkedAt)} NY; the desk tries again every two minutes.{last}
      </Notice>
    );
  }
  if (state.freshness === "late") {
    return (
      <Notice tone="warn" title="Today's briefing hasn't arrived">
        No briefing draft in Gmail yet
        {g?.state === "ok" && <> (last checked {deskTime(g.checkedAt)} NY)</>}. The cloud run may have
        failed or be running late — check the Gold Daily Bias routine on claude.ai. The desk keeps looking
        every two minutes.{last}
      </Notice>
    );
  }
  if (state.freshness === "offday") {
    return (
      <Notice tone="info" title="No briefing today">
        Briefings are written on weekdays. The next one lands Monday around 10:00 Amsterdam time.
      </Notice>
    );
  }
  return (
    <Notice tone="info" title="Today's briefing is on its way">
      It's written in the cloud at 9:46 Amsterdam time and saved as a Gmail draft. The desk collects it
      from there and shows it here by itself — the Claude app doesn't need to be open.{last}
    </Notice>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

type Anim = { className?: string; style?: React.CSSProperties };

type Part = { pole: Lean; label: string; value: number; raw?: boolean };

/**
 * Mutually exclusive outcomes as one bar: they visibly add up to the whole. Segments
 * are split by a 2px gap in the surface colour, never an outline. `raw` values are
 * counts; they're scaled to the bar and shown as counts.
 */
function SplitBar({ parts, compact = false, why }: { parts: Part[]; compact?: boolean; why?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const bar = (
    <div className={cx("flex gap-[2px] overflow-hidden rounded-full", compact ? "h-1.5" : "h-3")}>
      {parts.map((p) =>
        p.value > 0 ? (
          <div
            key={p.label}
            className={cx("anim-grow h-full", POLE[p.pole].bar)}
            style={{ width: `${(p.value / total) * 100}%` }}
            title={`${p.label} ${p.raw ? p.value : `${p.value}%`}`}
          />
        ) : null,
      )}
    </div>
  );
  return (
    <div>
      {why ? <Tip text={why} className="block">{bar}</Tip> : bar}
      <div className={cx("mt-2 flex flex-wrap gap-x-6 gap-y-1", compact ? "text-small" : "text-body")}>
        {parts.map((p) => (
          <span key={p.label} className="flex items-baseline gap-1.5">
            <span className={cx("text-micro", POLE[p.pole].text)}>{POLE[p.pole].glyph}</span>
            <span className={cx("font-semibold", !compact && "text-heading tracking-tight")}>
              {p.raw ? p.value : `${p.value}%`}
            </span>
            <span className="text-faint">{p.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A single magnitude, 0–100, on a same-hue track. */
function Meter({ value, className, bar = "bg-accent" }: { value: number; className?: string; bar?: string }) {
  return (
    <div className={cx("mt-1 h-1 overflow-hidden rounded-full bg-subtle", className)}>
      <div className={cx("anim-grow h-full rounded-full", bar)} style={{ width: `${value}%` }} />
    </div>
  );
}

/** Older briefings without range bounds: which third of the range price is in. */
function ZoneStrip({ zone }: { zone: "premium" | "discount" | "equilibrium" }) {
  const zones = ["discount", "equilibrium", "premium"] as const;
  return (
    <div className="grid grid-cols-3 gap-1 text-center text-micro uppercase tracking-[0.08em]">
      {zones.map((z) => (
        <div
          key={z}
          className={cx(
            "rounded-md py-1",
            z === zone
              ? z === "discount"
                ? "bg-up/15 text-up"
                : z === "premium"
                  ? "bg-down/15 text-down"
                  : "bg-subtle text-ink"
              : "bg-subtle/50 text-faint",
          )}
        >
          {z}
        </div>
      ))}
    </div>
  );
}

function Tile({
  label,
  tone,
  why,
  children,
  className,
  style,
}: { label: string; tone: string; why?: string; children: ReactNode } & Anim) {
  return (
    <article className={cx("card flex h-full flex-col gap-1 px-6 py-5", className)} style={style}>
      <div className="eyebrow mb-2 flex items-center gap-1.5">
        <span className={cx("size-1.5 rounded-full", tone)} />
        {label}
        {why && (
          <Tip text={why}>
            <Info size={11} />
          </Tip>
        )}
      </div>
      {children}
    </article>
  );
}

/** The desk's Panel, with the reasoning one hover away and a quiet note on the right. */
function Panel({
  title,
  sub,
  note,
  why,
  children,
  className,
  style,
}: { title: string; sub?: string; note?: string; why?: string; children: ReactNode } & Anim) {
  return (
    <UiPanel
      flush
      className={className}
      style={style}
      title={
        why ? (
          <span className="flex items-center gap-1.5">
            {title}
            <Tip text={why} className="text-faint">
              <Info size={12} />
            </Tip>
          </span>
        ) : (
          title
        )
      }
      sub={sub}
      action={note && <span className="text-caption text-faint">{note}</span>}
    >
      {children}
    </UiPanel>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="grid grid-cols-[64px_1fr] gap-3">
      <dt className="text-faint">{term}</dt>
      <dd className="text-soft">{children}</dd>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "info" | "warn" | "down"; title: string; children: ReactNode }) {
  const look = tone === "warn" ? "bg-warn/10 text-warn" : tone === "down" ? "bg-down/10 text-down" : "bg-accent/10 text-accent-2";
  const Icon = tone === "info" ? Sparkles : CircleAlert;
  return (
    <section className="card anim-rise flex gap-4 px-6 py-5">
      <span className={cx("anim-stamp grid size-9 shrink-0 place-items-center rounded-full", look)}>
        <Icon size={17} />
      </span>
      <div>
        <h3 className="text-title font-semibold">{title}</h3>
        <p className="mt-1 max-w-2xl text-body leading-relaxed text-soft">{children}</p>
      </div>
    </section>
  );
}

/* ── Formatting ──────────────────────────────────────────────────────── */

const px = (v: number) => v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 2 });

const signedPts = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${px(Math.abs(Math.round(v * 10) / 10))}`;

/** "Thu " when a release isn't on today's desk calendar, so 10:00 isn't mistaken for today. */
function weekdayIfNotToday(iso: string) {
  if (deskDay(new Date(iso)) === deskDay()) return "";
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: DESK_TZ, weekday: "short" }).format(new Date(iso))} `;
}

function countdown(iso: string) {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (mins <= 0) return "released";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `in ${h}h ${mins % 60}m` : `in ${Math.round(h / 24)}d`;
}

/** "Kitco NewsWire (Kitco AM Report; …)" → "Kitco NewsWire": the brackets live in the tooltip. */
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "") || name;

/** The outcome with the biggest share, which is what the headline announces. */
function leading(b: DailyBias): { pole: Lean; word: string; pct: number } {
  const { bullish, range, bearish } = b.bias;
  if (bullish >= range && bullish >= bearish) return { pole: "bullish", word: "Bullish", pct: bullish };
  if (bearish >= range) return { pole: "bearish", word: "Bearish", pct: bearish };
  return { pole: "neutral", word: "Range", pct: range };
}
