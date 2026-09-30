import { ExternalLink, Info } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { BiasLevel, DailyBias, Lean, LevelKind, Scenario, Trend } from "@/lib/dailyBias";
import { DESK_TZ, deskDateLabel, deskDay, deskTime } from "@/lib/tz";
import type { DailyBiasState } from "@/lib/useDailyBias";
import { Tip, cx, stagger } from "./ui";

/**
 * Daily Bias tab: the morning's gold read, drawn rather than written.
 *
 * Every number is on screen; the reasoning behind it sits one hover away (Tip), and
 * the complete briefing stays in "Full briefing as text" — less to read, nothing lost.
 */
export function DailyBiasView({ state }: { state: DailyBiasState }) {
  if (state.loading) return null;

  if (state.error && !state.date) {
    return (
      <Notice tone="down" title="Can't reach the local server">
        {state.error}. The briefing file is safe on disk; it shows up once the server is running.
      </Notice>
    );
  }

  if (state.freshness !== "today") return <NotYet state={state} />;

  if (!state.bias) {
    return (
      <div className="space-y-4">
        <Notice tone="warn" title="Today's briefing arrived, but not in the expected shape">
          Showing the plain text instead. Nothing is lost — tomorrow's run starts from scratch.
        </Notice>
        {state.fallback && (
          <pre className="card whitespace-pre-wrap px-6 py-5 font-sans text-[13px] leading-relaxed text-soft">
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
  bullish: { glyph: "▲", bar: "bg-up", text: "text-up", word: "Bullish" },
  neutral: { glyph: "◆", bar: "bg-soft", text: "text-soft", word: "Neutral" },
  bearish: { glyph: "▼", bar: "bg-down", text: "text-down", word: "Bearish" },
} as const;

const trendPole = (t: Trend): Lean => (t === "range" ? "neutral" : t);

/* ── The briefing ────────────────────────────────────────────────────── */

function Briefing({ b }: { b: DailyBias }) {
  const lead = leading(b);
  let i = 0;
  const rise = () => ({ className: "anim-rise", style: stagger(i++, 70) });

  return (
    <div className="space-y-6">
      <header {...rise()} className="anim-rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
            Daily bias · XAU/USD · {deskDateLabel(`${b.date}T12:00:00Z`)}
            {b.generatedAt && <> · written {deskTime(b.generatedAt)} NY</>}
          </div>
          <h2 className={cx("mt-1.5 text-[26px] font-semibold leading-tight tracking-tight", POLE[lead.pole].text)}>
            {POLE[lead.pole].glyph} {lead.word} day · {lead.pct}%
          </h2>
        </div>
        {b.spot != null && (
          <div className="text-right">
            <div className="label !mb-0.5">Spot{b.spotAt && ` · ${deskTime(b.spotAt)} NY`}</div>
            <div className="text-[24px] font-semibold tracking-tight">{px(b.spot)}</div>
          </div>
        )}
      </header>

      <section {...rise()} className="anim-rise card px-6 py-5">
        <SplitBar
          why={b.bias.why}
          parts={[
            { pole: "bullish", label: "Bullish", value: b.bias.bullish },
            { pole: "neutral", label: "Range", value: b.bias.range },
            { pole: "bearish", label: "Bearish", value: b.bias.bearish },
          ]}
        />
        {b.tldr && (
          <p className="mt-4 border-l-2 border-accent/60 pl-4 text-[14px] leading-relaxed">{b.tldr}</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <KeyLevelTile b={b} {...rise()} />
        <EventTile b={b} {...rise()} />
        <StructureTile b={b} {...rise()} />
      </div>

      {b.scenarios.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {b.scenarios.map((s) => (
            <ScenarioCard key={s.kind + s.title} s={s} {...rise()} />
          ))}
        </div>
      )}

      {b.levels.length > 0 && <LevelMap b={b} {...rise()} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {b.sessions.length > 0 && (
          <Panel {...rise()} title="Sessions">
            <ul className="space-y-3.5 px-5 py-4">
              {b.sessions.map((s) => (
                <li key={s.label}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <Tip text={s.why}>{s.label}</Tip>
                    <span className="num text-soft">{s.prob}%</span>
                  </div>
                  <Meter value={s.prob} />
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <Macro b={b} {...rise()} />
      </div>

      {b.analysts.length > 0 && <Consensus b={b} {...rise()} />}

      <Risk b={b} {...rise()} />

      <footer {...rise()} className="anim-rise space-y-3">
        {b.markdown && (
          <details className="group">
            <summary className="cursor-pointer list-none text-[12px] text-faint hover:text-soft">
              <span className="group-open:hidden">Full briefing as text →</span>
              <span className="hidden group-open:inline">Full briefing as text ↓</span>
            </summary>
            <pre className="card mt-3 whitespace-pre-wrap px-6 py-5 font-sans text-[13px] leading-relaxed text-soft">
              {b.markdown}
            </pre>
          </details>
        )}
        <p className="text-[11px] text-faint">
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
            <span className="text-[22px] font-semibold tracking-tight">{k.price != null ? px(k.price) : "—"}</span>
            {dist != null && <span className="num text-[12px] text-soft">{signedPts(dist)} pts</span>}
          </div>
          <div className="text-[13px] text-soft">{k.label}</div>
          {match?.sweepProb != null && (
            <div className="mt-auto pt-3">
              <div className="flex justify-between text-[11px] text-faint">
                <span>Tagged today</span>
                <span className="num text-soft">{match.sweepProb}%</span>
              </div>
              <Meter value={match.sweepProb} />
            </div>
          )}
        </>
      ) : (
        <span className="text-[13px] text-faint">None named today.</span>
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
            <span className="text-[22px] font-semibold tracking-tight">
              {e.at ? `${weekdayIfNotToday(e.at)}${deskTime(e.at)}` : "TBC"}
            </span>
            {e.at && <span className="text-[12px] text-soft">NY · {countdown(e.at)}</span>}
          </div>
          <div className="text-[13px] text-soft">{e.title}</div>
        </>
      ) : (
        <span className="text-[13px] text-faint">No major release today.</span>
      )}
      {sur && (
        <div className="mt-auto pt-3">
          <div className="mb-1.5 text-[11px] text-faint">
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
      <div className="space-y-1.5">
        <TrendRow tf="D1" trend={s.d1Trend} note={s.d1} />
        <TrendRow tf="H4" trend={s.h4Trend} note={s.h4} />
      </div>
      <div className="mt-auto pt-3">
        {s.rangeLow != null && s.rangeHigh != null && b.spot != null ? (
          <RangeGauge low={s.rangeLow} high={s.rangeHigh} spot={b.spot} />
        ) : (
          s.zone && <ZoneStrip zone={s.zone} />
        )}
      </div>
    </Tile>
  );
}

/** A timeframe's direction as a mark; the prose note waits in the tooltip. */
function TrendRow({ tf, trend, note }: { tf: string; trend: Trend | null; note: string }) {
  const pole = trend ? POLE[trendPole(trend)] : null;
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <span className="num w-6 text-[11px] text-faint">{tf}</span>
      <Tip text={note} className="flex min-w-0 items-center gap-1.5">
        {pole ? (
          <>
            <span className={cx("text-[11px]", pole.text)}>{pole.glyph}</span>
            <span>{trend === "range" ? "Range" : pole.word}</span>
          </>
        ) : (
          // An older briefing without a trend field: fall back to its note.
          <span className="truncate text-soft">{note || "—"}</span>
        )}
      </Tip>
    </div>
  );
}

/**
 * Where spot sits in the dealing range. The lower half is discount, the upper half
 * premium, split at equilibrium — the picture behind "premium vs discount".
 */
function RangeGauge({ low, high, spot }: { low: number; high: number; spot: number }) {
  const pct = Math.min(100, Math.max(0, ((spot - low) / (high - low)) * 100));
  const zone = pct < 45 ? "Discount" : pct > 55 ? "Premium" : "Equilibrium";
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[11px] text-faint">
        <span>Dealing range</span>
        <span className="text-soft">
          {zone} · {Math.round(pct)}%
        </span>
      </div>
      <div className="relative h-2">
        <div className="absolute inset-y-0 left-0 w-[calc(50%-1px)] rounded-l-full bg-up/20" />
        <div className="absolute inset-y-0 right-0 w-[calc(50%-1px)] rounded-r-full bg-down/20" />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent"
          style={{ left: `${pct}%` }}
          title={`Spot ${px(spot)}`}
        />
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{px(low)}</span>
        <span>EQ {px((low + high) / 2)}</span>
        <span>{px(high)}</span>
      </div>
    </div>
  );
}

/* ── Scenarios ───────────────────────────────────────────────────────── */

function ScenarioCard({ s, className, style }: { s: Scenario } & Anim) {
  const pole = POLE[s.direction === "long" ? "bullish" : s.direction === "short" ? "bearish" : "neutral"];
  return (
    <article className={cx("card relative flex h-full flex-col overflow-hidden py-5 pl-6 pr-5", className)} style={style}>
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", pole.bar)} />
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
          {s.kind === "chop" ? "Chop" : s.kind} ·{" "}
          <span className={pole.text}>{pole.glyph}</span> {s.direction}
        </div>
        <div className="text-[24px] font-semibold tracking-tight">{s.prob}%</div>
      </div>
      <h3 className="mt-0.5 text-[14px] font-semibold">
        <Tip text={s.why}>{s.title}</Tip>
      </h3>
      {s.trigger && <p className="mt-1.5 line-clamp-2 text-[12px] text-soft">{s.trigger}</p>}
      {s.targets.length > 0 && (
        <ul className="mt-3 space-y-2">
          {s.targets.map((t, n) => (
            <li key={t.price} className="flex items-center gap-2.5 text-[12px]">
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
        <p className="num mt-auto pt-3 text-[12px] text-faint">
          ✕ invalid beyond <span className="text-soft">{px(s.invalidation)}</span>
        </p>
      )}
    </article>
  );
}

/* ── Level map ───────────────────────────────────────────────────────── */

const KIND_TAG: Record<LevelKind, string> = {
  resistance: "RES",
  support: "SUP",
  liquidity: "LIQ",
  fvg: "FVG",
  orderblock: "OB",
  round: "RND",
  open: "OPEN",
};

const ROW_H = 38;

/** A level worth a row: some chance of being reached, or within a day's range of spot. */
function relevant(l: BiasLevel, b: DailyBias) {
  const near = b.spot != null && b.risk.atr != null && Math.abs(l.price - b.spot) <= b.risk.atr;
  return near || l.sweepProb == null || l.sweepProb >= 5;
}

/**
 * The ladder, highest first, with spot slotted in. Rows are evenly spaced so they
 * stay readable; the rail on the left keeps true price distance, and a leader line
 * ties each row to its real place — clusters like 4160/4165 show as clusters.
 */
function LevelMap({ b, className, style }: { b: DailyBias } & Anim) {
  const [all, setAll] = useState(false);
  const sorted = [...b.levels].sort((x, y) => y.price - x.price);
  const shown = all ? sorted : sorted.filter((l) => relevant(l, b));
  const hidden = sorted.length - shown.length;

  type Row = { price: number; level: BiasLevel | null };
  const rows: Row[] = shown.map((l) => ({ price: l.price, level: l }));
  if (b.spot != null) {
    const at = rows.findIndex((r) => r.price < b.spot!);
    rows.splice(at === -1 ? rows.length : at, 0, { price: b.spot, level: null });
  }

  const prices = rows.map((r) => r.price);
  const hi = Math.max(...prices);
  const lo = Math.min(...prices);
  const h = rows.length * ROW_H;
  const trueY = (p: number) => (hi === lo ? h / 2 : 8 + ((hi - p) / (hi - lo)) * (h - 16));
  const rowY = (i: number) => i * ROW_H + ROW_H / 2;

  return (
    <Panel
      title="Key levels"
      note="bar = chance of a tag or sweep today · hover a level for the note"
      className={className}
      style={style}
    >
      <div className="relative px-5 py-3">
        <svg className="absolute left-5 top-3" width="56" height={h} aria-hidden>
          <line x1="6" x2="6" y1={trueY(hi)} y2={trueY(lo)} className="stroke-line" strokeWidth="1" />
          {rows.map((r, n) => {
            const y0 = trueY(r.price);
            const y1 = rowY(n);
            const spot = r.level == null;
            return (
              <g key={n} className={spot ? "stroke-accent" : "stroke-faint/60"}>
                <line x1="2" x2="10" y1={y0} y2={y0} strokeWidth={spot ? 2 : 1} />
                <path d={`M10 ${y0} C 30 ${y0}, 30 ${y1}, 52 ${y1}`} fill="none" strokeWidth="1" />
              </g>
            );
          })}
        </svg>

        <ol className="ml-16">
          {rows.map((r, n) =>
            r.level ? (
              <LevelRow key={n} l={r.level} spot={b.spot} />
            ) : (
              <li key="spot" className="flex items-center gap-3" style={{ height: ROW_H }}>
                <span className="w-16 font-semibold text-accent-2">{px(r.price)}</span>
                <span className="h-px flex-1 bg-accent/40" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-2">Spot</span>
              </li>
            ),
          )}
        </ol>

        {hidden > 0 && !all && (
          <button onClick={() => setAll(true)} className="ml-16 mt-1 text-[12px] text-faint hover:text-ink">
            + {hidden} distant level{hidden === 1 ? "" : "s"} (under 5% and beyond a day's range)
          </button>
        )}
      </div>
    </Panel>
  );
}

function LevelRow({ l, spot }: { l: BiasLevel; spot: number | null }) {
  return (
    <li className="grid grid-cols-[64px_56px_minmax(0,300px)_minmax(120px,260px)_72px] items-center gap-3 text-[13px]" style={{ height: ROW_H }}>
      <span className="num font-medium">{px(l.price)}</span>
      <span className="num text-right text-[12px] text-faint">{spot != null ? signedPts(l.price - spot) : ""}</span>
      <Tip text={l.note} className="flex min-w-0 items-center gap-2">
        <span className="num w-9 shrink-0 text-[10px] text-faint">{KIND_TAG[l.kind]}</span>
        <span className="truncate">{l.label}</span>
      </Tip>
      <span className="flex items-center gap-2">
        {l.sweepProb != null && (
          <>
            <Meter value={l.sweepProb} className="!mt-0 flex-1" />
            <span className="num w-8 text-right text-[12px] text-soft">{l.sweepProb}%</span>
          </>
        )}
      </span>
      <span className="text-[12px] text-soft">
        {l.verdict === "hold" ? "↩ holds" : l.verdict === "break" ? "⇥ breaks" : <span className="text-faint">—</span>}
      </span>
    </li>
  );
}

/* ── Macro ───────────────────────────────────────────────────────────── */

const GOLD_WORD: Record<Lean, string> = { bullish: "tailwind", neutral: "neutral", bearish: "headwind" };

function Macro({ b, className, style }: { b: DailyBias } & Anim) {
  const d = b.macro.drivers;
  const count = (p: Lean) => d.filter((x) => x.gold === p).length;
  return (
    <Panel title="Macro & intermarket" why={b.macro.flow} className={className} style={style}>
      {d.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
            {d.map((x) => (
              <div key={x.name} className="bg-surface px-5 py-3.5">
                <div className="label !mb-1">{x.name}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[18px] font-semibold tracking-tight">{x.value || "—"}</span>
                  {x.change && <span className="num text-[12px] text-soft">{x.change}</span>}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-soft">
                  <span className={POLE[x.gold].text}>{POLE[x.gold].glyph}</span>
                  gold {GOLD_WORD[x.gold]}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t px-5 py-3.5">
            <div className="label">Net for gold</div>
            <SplitBar
              compact
              parts={[
                { pole: "bullish", label: "Tailwinds", value: count("bullish"), raw: true },
                { pole: "neutral", label: "Neutral", value: count("neutral"), raw: true },
                { pole: "bearish", label: "Headwinds", value: count("bearish"), raw: true },
              ]}
            />
          </div>
        </>
      ) : (
        // An older briefing without driver tiles: its three short lines.
        <dl className="space-y-2.5 px-5 py-4 text-[13px]">
          <Fact term="DXY">{b.macro.dxy}</Fact>
          <Fact term="Yields">{b.macro.yields}</Fact>
        </dl>
      )}
    </Panel>
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
  const pct = (p: Lean) => Math.round((col(p).length / n) * 100);

  return (
    <Panel title="Pro-trader consensus" note={`${n} views`} className={className} style={style}>
      <div className="px-5 pt-4">
        <CentredBar bear={pct("bearish")} neutral={pct("neutral")} bull={pct("bullish")} />
      </div>
      <div className="grid grid-cols-3 gap-4 px-5 py-4">
        {(["bearish", "neutral", "bullish"] as const).map((p) => (
          <div key={p}>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">
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
                          <span className="block truncate text-[12px] font-medium">{shortName(a.name)}</span>
                          <span className="block truncate text-[11px] text-faint">
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
        <p className="border-t px-5 py-3 text-[12px] text-soft">
          <span className="font-semibold text-ink">Claude's read · </span>
          {b.consensus.take}
        </p>
      )}
    </Panel>
  );
}

/**
 * Bearish grows left, bullish right, neutral straddles the centre line — a diverging
 * stacked bar, so the lean reads as which side is longer.
 */
function CentredBar({ bear, neutral, bull }: { bear: number; neutral: number; bull: number }) {
  const left = bear + neutral / 2;
  const right = bull + neutral / 2;
  // Scale so the longer side just reaches its edge; the centre line stays at 50%.
  const unit = 50 / Math.max(left, right, 1);
  return (
    <div>
      <div className="relative h-2.5">
        <div
          className="absolute inset-y-0 flex gap-[2px] overflow-hidden rounded-full"
          style={{ left: `${50 - left * unit}%`, width: `${(left + right) * unit}%` }}
        >
          {bear > 0 && <div className="anim-grow h-full bg-down" style={{ flex: bear }} title={`Bearish ${bear}%`} />}
          {neutral > 0 && <div className="anim-grow h-full bg-soft" style={{ flex: neutral }} title={`Neutral ${neutral}%`} />}
          {bull > 0 && <div className="anim-grow h-full bg-up" style={{ flex: bull }} title={`Bullish ${bull}%`} />}
        </div>
        <span className="absolute -inset-y-1 left-1/2 w-px bg-ink/40" />
      </div>
      <div className="mt-2 flex justify-between text-[12px]">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] text-down">▼</span>
          <span className="font-semibold">{bear}%</span>
          <span className="text-faint">bearish</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[10px] text-soft">◆</span>
          <span className="font-semibold">{neutral}%</span>
          <span className="text-faint">neutral</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-faint">bullish</span>
          <span className="font-semibold">{bull}%</span>
          <span className="text-[10px] text-up">▲</span>
        </span>
      </div>
    </div>
  );
}

/* ── Risk ────────────────────────────────────────────────────────────── */

function Risk({ b, className, style }: { b: DailyBias } & Anim) {
  const r = b.risk;
  const used = r.atr != null && r.dayLow != null && r.dayHigh != null ? r.dayHigh - r.dayLow : null;
  const usedPct = used != null && r.atr ? Math.round((used / r.atr) * 100) : null;

  // Group releases by desk day so "today" reads apart from the rest of the week.
  const days = new Map<string, typeof r.events>();
  for (const e of r.events) {
    const k = e.at ? deskDay(new Date(e.at)) : "TBC";
    days.set(k, [...(days.get(k) ?? []), e]);
  }

  return (
    <Panel title="Risk" className={className} style={style}>
      <div className="grid grid-cols-1 gap-6 px-5 py-4 md:grid-cols-3">
        <div>
          <div className="label">Releases · NY time</div>
          <div className="space-y-2.5">
            {[...days].map(([day, list]) => (
              <div key={day}>
                <div className="text-[11px] text-faint">
                  {day === deskDay() ? "Today" : day === "TBC" ? "Time TBC" : deskDateLabel(`${day}T12:00:00Z`)}
                </div>
                <ul className="mt-1 space-y-1">
                  {list.map((e) => (
                    <li key={e.title + e.at} className="flex items-center gap-2.5 text-[13px]">
                      <span className="num w-11 shrink-0 text-soft">{e.at ? deskTime(e.at) : "—"}</span>
                      <span
                        className={cx(
                          "size-2 shrink-0 rounded-full",
                          e.impact === "High" ? "bg-down" : e.impact === "Medium" ? "bg-warn" : "bg-low",
                        )}
                        title={`${e.impact} impact`}
                      />
                      <span className="truncate">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!r.events.length && <p className="text-[13px] text-faint">Nothing scheduled.</p>}
          </div>
        </div>

        <div>
          <div className="label">Volatility</div>
          {usedPct != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[22px] font-semibold tracking-tight">{Math.round(used!)}</span>
                <span className="text-[12px] text-soft">of ATR {r.atr} pts used</span>
              </div>
              <Meter value={Math.min(usedPct, 100)} bar={usedPct >= 80 ? "bg-warn" : "bg-accent"} className="!h-1.5" />
              <p className="mt-1.5 text-[11px] text-faint">
                {usedPct}% of a normal day{r.expectedRange && ` · expected ${r.expectedRange}`}
              </p>
            </>
          ) : (
            <>
              <div className="text-[22px] font-semibold tracking-tight">{r.atr != null ? `ATR ${r.atr}` : "—"}</div>
              {r.expectedRange && <p className="text-[12px] text-faint">Expected {r.expectedRange}</p>}
            </>
          )}
        </div>

        <div>
          <div className="label">Stand aside if</div>
          <ul className="space-y-1.5 text-[13px] text-soft">
            {r.standAside.map((s) => (
              <li key={s} className="flex gap-2">
                <span className="text-faint">✕</span>
                {s}
              </li>
            ))}
          </ul>
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
      <div className={cx("mt-2 flex flex-wrap gap-x-6 gap-y-1", compact ? "text-[12px]" : "text-[13px]")}>
        {parts.map((p) => (
          <span key={p.label} className="flex items-baseline gap-1.5">
            <span className={cx("text-[10px]", POLE[p.pole].text)}>{POLE[p.pole].glyph}</span>
            <span className={cx("font-semibold", !compact && "text-[20px] tracking-tight")}>
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
    <div className="grid grid-cols-3 gap-1 text-center text-[10px] uppercase tracking-[0.08em]">
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
    <article className={cx("card relative flex h-full flex-col gap-1 overflow-hidden py-5 pl-6 pr-5", className)} style={style}>
      <span className={cx("absolute inset-y-0 left-0 w-[3px]", tone)} />
      <div className="label flex items-center gap-1.5">
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

function Panel({
  title,
  note,
  why,
  children,
  className,
  style,
}: { title: string; note?: string; why?: string; children: ReactNode } & Anim) {
  return (
    <section className={cx("card overflow-hidden", className)} style={style}>
      <header className="flex items-baseline justify-between gap-4 border-b px-5 py-3.5">
        <h3 className="flex items-center gap-1.5 text-[14px] font-semibold">
          {title}
          {why && (
            <Tip text={why} className="text-faint">
              <Info size={12} />
            </Tip>
          )}
        </h3>
        {note && <span className="text-right text-[11px] text-faint">{note}</span>}
      </header>
      {children}
    </section>
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
  return (
    <section className="card anim-rise relative overflow-hidden py-5 pl-6 pr-5">
      <span
        className={cx(
          "absolute inset-y-0 left-0 w-[3px]",
          tone === "warn" ? "bg-warn" : tone === "down" ? "bg-down" : "bg-accent",
        )}
      />
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-soft">{children}</p>
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
