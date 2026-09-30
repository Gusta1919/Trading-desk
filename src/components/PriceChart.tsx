import { useMemo, useState, type ReactNode } from "react";
import {
  crtBox,
  dayRuns,
  levelEffect,
  levelRole,
  priceDomain,
  sessionRuns,
  stackLabels,
  timeMarks,
  verdictEffect,
  zoneFromText,
  type Candle,
  type Timeframe,
} from "@/lib/chart";
import type { LevelKind, Verdict } from "@/lib/dailyBias";
import { DESK_TZ, deskTime } from "@/lib/tz";
import { cx, useWidth } from "./ui";

/*
 * The Daily Bias chart, drawn by hand in SVG so it wears the desk's own tokens.
 *
 * Two layers, kept apart on purpose so nothing reads two ways:
 * - the MAP (grey, labelled on the left): the briefing's key levels. Line style says
 *   what a level does to price — dotted liquidity pulls price in, a solid hairline
 *   is a reaction level, a band is an imbalance price returns to. Brighter means
 *   more likely to be reached today.
 * - the PLAN (colour, tagged on the right): the chosen scenario's targets, its
 *   invalidation and the key level, next to the live price.
 */

export type ChartTone = "up" | "down" | "neutral" | "accent";

export interface ChartLevel {
  price: number;
  /** Short tag at the right edge, e.g. "TP1 4136 · 65%". */
  label: string;
  kind: "target" | "invalid" | "key";
  tone: ChartTone;
}

export interface ChartZone {
  low: number;
  high: number;
  label: string;
  tone: ChartTone;
}

export interface MapLevel {
  price: number;
  label: string;
  kind: LevelKind;
  prob: number | null;
  verdict: Verdict;
  note: string;
}

export interface Layers {
  levels: boolean;
  box: boolean;
  sessions: boolean;
}

const PAD = { top: 28, right: 132, bottom: 26 };
const TAG_GAP = 17;
const LABEL_GAP = 15;

const KIND_TAG: Record<LevelKind, string> = {
  resistance: "RES",
  support: "SUP",
  liquidity: "LIQ",
  fvg: "FVG",
  orderblock: "OB",
  round: "RND",
  open: "OPEN",
};

const STROKE: Record<ChartTone, string> = {
  up: "stroke-up",
  down: "stroke-down",
  neutral: "stroke-soft",
  accent: "stroke-accent",
};
const FILL: Record<ChartTone, string> = { up: "fill-up", down: "fill-down", neutral: "fill-soft", accent: "fill-accent" };
const WASH: Record<ChartTone, string> = {
  up: "fill-up/10",
  down: "fill-down/10",
  neutral: "fill-soft/10",
  accent: "fill-accent/10",
};

/* The session strip: three quiet steps of the same grey; days alternate on 1h. */
const STRIP = {
  asia: "fill-faint/40",
  london: "fill-soft/45",
  ny: "fill-soft/80",
  a: "fill-soft/30",
  b: "fill-soft/60",
} as const;

/* Text over candles gets a halo in the surface colour instead of a box. */
const HALO = { stroke: "var(--color-surface)", strokeWidth: 3.5, paintOrder: "stroke", strokeLinejoin: "round" } as const;

const fmt = (v: number) => v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 2 });
const dayMark = (t: number) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: DESK_TZ, weekday: "short", day: "numeric" }).format(new Date(t));

/** Brighter the likelier: a 70% level reads strongly, a 5% one barely. */
const strength = (p: number | null) => 0.28 + 0.72 * Math.min(1, (p ?? 30) / 100);

/** A clean tick step (1, 2 or 5 × 10ⁿ) giving about `count` ticks. */
function niceStep(span: number, count: number) {
  const raw = span / Math.max(count, 2);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

export function PriceChart({
  candles,
  tf,
  height,
  plan,
  zone,
  map,
  layers,
  toolbar,
}: {
  candles: Candle[];
  tf: Timeframe;
  height: number;
  plan: ChartLevel[];
  zone: ChartZone | null;
  map: MapLevel[];
  layers: Layers;
  toolbar?: ReactNode;
}) {
  const [ref, width] = useWidth(1000);
  const [cursor, setCursor] = useState<{ i: number; y: number } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  const n = candles.length;
  const box = useMemo(() => (layers.box ? crtBox(candles) : null), [candles, layers.box]);
  // Sessions on intraday views; on 1h a week of sessions is noise, so whole trading
  // days are shaded instead (the bottom axis names them).
  const runs = useMemo(() => {
    if (!layers.sessions) return [];
    if (tf === "1h") {
      return dayRuns(candles).map((r, k) => ({
        key: r.day,
        label: null,
        tint: (k % 2 ? "b" : "a") as keyof typeof STRIP,
        from: r.from,
        to: r.to,
      }));
    }
    return sessionRuns(candles).map((r) => ({
      key: `${r.session}-${r.from}`,
      label: r.session,
      tint: (r.session === "New York" ? "ny" : r.session === "London" ? "london" : "asia") as keyof typeof STRIP,
      from: r.from,
      to: r.to,
    }));
  }, [candles, layers.sessions, tf]);
  const [lo, hi] = useMemo(
    () =>
      priceDomain(
        candles,
        [
          ...plan.map((l) => l.price),
          ...(zone ? [zone.low, zone.high] : []),
          ...(box ? [box.low, box.high] : []),
        ],
        // At most half the candles' own range: further targets become edge arrows
        // rather than squashing today's price action into a strip.
        0.5,
      ),
    [candles, plan, zone, box],
  );

  const plotW = Math.max(width - PAD.right, 80);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / n;
  const x = (i: number) => (i + 0.5) * slot;
  const y = (p: number) => PAD.top + ((hi - p) / (hi - lo)) * plotH;
  const priceAt = (py: number) => hi - ((py - PAD.top) / plotH) * (hi - lo);
  const inView = (p: number) => p >= lo && p <= hi;
  const bodyW = Math.max(1, Math.min(9, slot * 0.64));
  const last = candles[n - 1];

  // The map: levels in view, top to bottom, with labels stacked so none collide.
  const levels = useMemo(() => {
    const shown = layers.levels ? map.filter((m) => inView(m.price)).sort((a, b) => b.price - a.price) : [];
    const labelY = stackLabels(
      shown.map((m) => y(m.price) - 5),
      LABEL_GAP,
      PAD.top + 10,
      PAD.top + plotH - 4,
    );
    return shown.map((m, k) => {
      // An imbalance whose note gives its range ("H1 bearish FVG ~4175-4190") is drawn
      // as that range, as long as the range actually contains the level.
      const z = levelRole(m.kind) === "imbalance" ? zoneFromText(m.note) : null;
      const zone = z && z.low <= m.price && m.price <= z.high ? z : null;
      return {
      ...m,
      zone,
      y: y(m.price),
      labelY: labelY[k],
      // Where a plan line already sits on the same price, the plan draws the line.
      underPlan: plan.some((p) => Math.abs(y(p.price) - y(m.price)) < 2.5),
      };
    });
    // y() and inView() are derived from lo, hi and plotH, all listed.
  }, [map, layers.levels, lo, hi, plotH, plan]);

  // The plan: right-edge tags for each line plus the live price; off-scale lines keep
  // their tag, pinned to the edge with an arrow.
  const tags = useMemo(() => {
    const raw = [
      ...plan.map((l) => {
        const off = l.price > hi ? "up" : l.price < lo ? "down" : null;
        return {
          y: off === "up" ? PAD.top : off === "down" ? PAD.top + plotH : y(l.price),
          text: `${off === "up" ? "↑ " : off === "down" ? "↓ " : ""}${l.label}`,
          tone: l.tone,
          live: false,
        };
      }),
      { y: y(last.c), text: fmt(last.c), tone: "accent" as ChartTone, live: true },
    ];
    const ys = stackLabels(
      raw.map((t) => t.y),
      TAG_GAP,
      PAD.top,
      PAD.top + plotH,
    );
    return raw.map((t, k) => ({ ...t, y: ys[k] }));
  }, [plan, lo, hi, plotH, last.c]);

  const tickCount = Math.round(plotH / 70);
  const step = niceStep(hi - lo, tickCount);
  const ticks: number[] = [];
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    if (tags.every((t) => Math.abs(t.y - y(p)) > 11)) ticks.push(p);
  }

  const marks = timeMarks(candles, tf, Math.ceil(64 / slot));
  const focused = focus != null ? levels[focus] : null;

  return (
    <div ref={ref}>
      {toolbar && <div className="mb-2 flex justify-end">{toolbar}</div>}

      <div className="relative">
        <svg width={width} height={height} className="block select-none" role="img" aria-label="XAU/USD candles with the briefing's levels">
          {/* Sessions: a thin strip along the top, out of the price action's way. Segments
              are split by a 2px gap; New York, where the day's move usually happens, is
              the brightest. */}
          {runs.map((r) => (
            <rect
              key={r.key}
              x={x(r.from) - slot / 2 + 1}
              y={PAD.top - 7}
              width={Math.max(1, (r.to - r.from + 1) * slot - 2)}
              height={3}
              rx={1.5}
              className={STRIP[r.tint]}
            />
          ))}

          {/* The plan's zone: chop range or trigger area. */}
          {zone && (
            <rect
              x={0}
              width={plotW}
              y={y(Math.min(zone.high, hi))}
              height={Math.max(1, y(Math.max(zone.low, lo)) - y(Math.min(zone.high, hi)))}
              className={WASH[zone.tone]}
            />
          )}

          {/* CRT 3–4AM box and its 04:00–16:00 sweep window. */}
          {box && (
            <g>
              <rect
                x={x(box.from) - slot / 2}
                y={y(box.high)}
                width={(box.to - box.from + 1) * slot}
                height={Math.max(1, y(box.low) - y(box.high))}
                className="fill-accent/10 stroke-accent"
                strokeWidth={1}
              />
              {box.windowEnd > box.to &&
                [box.high, box.low].map((p) => (
                  <line
                    key={p}
                    x1={x(box.to) + slot / 2}
                    x2={x(box.windowEnd) + slot / 2}
                    y1={y(p)}
                    y2={y(p)}
                    className="stroke-accent/50"
                    strokeWidth={1}
                  />
                ))}
            </g>
          )}

          {/* The map: grey, styled by what each level does to price. */}
          {levels.map((m, k) => {
            if (m.underPlan) return null;
            const role = levelRole(m.kind);
            const dim = focus != null && focus !== k;
            const opacity = dim ? 0.12 : focus === k ? 1 : strength(m.prob);
            if (role === "imbalance") {
              const top = m.zone ? y(Math.min(m.zone.high, hi)) : m.y - 3;
              const bottom = m.zone ? y(Math.max(m.zone.low, lo)) : m.y + 3;
              return (
                <g key={m.label + m.price} style={{ opacity }}>
                  <rect x={0} width={plotW} y={top} height={Math.max(2, bottom - top)} className="fill-soft/15" />
                  {m.zone &&
                    [top, bottom].map((edge) => (
                      <line key={edge} x1={0} x2={plotW} y1={edge} y2={edge} className="stroke-soft/40" strokeWidth={1} />
                    ))}
                </g>
              );
            }
            return (
              <line
                key={m.label + m.price}
                x1={0}
                x2={plotW}
                y1={m.y}
                y2={m.y}
                className="stroke-soft"
                strokeWidth={role === "liquidity" ? 1.6 : focus === k ? 1.5 : 1}
                strokeLinecap="round"
                strokeDasharray={role === "liquidity" ? "0.1 4" : undefined}
                style={{ opacity }}
              />
            );
          })}

          {/* The plan's lines: targets dashed (projections), invalidation and key solid. */}
          {plan.filter((l) => inView(l.price)).map((l) => (
            <line
              key={l.label}
              x1={0}
              x2={plotW}
              y1={y(l.price)}
              y2={y(l.price)}
              className={cx(STROKE[l.tone], l.kind === "invalid" && "opacity-70")}
              strokeWidth={l.kind === "key" ? 1.5 : 1.2}
              strokeDasharray={l.kind === "target" ? "6 4" : undefined}
            />
          ))}

          {/* Candles. */}
          {candles.map((c, i) => {
            const up = c.c >= c.o;
            const top = y(Math.max(c.o, c.c));
            return (
              <g key={c.t} className={up ? "fill-up stroke-up" : "fill-down stroke-down"}>
                <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} strokeWidth={1} />
                <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1, y(Math.min(c.o, c.c)) - top)} stroke="none" />
              </g>
            );
          })}

          {/* Live price: a hairline from the last candle to its tag. */}
          <line x1={x(n - 1)} x2={plotW + 6} y1={y(last.c)} y2={y(last.c)} className="stroke-accent" strokeWidth={1} />

          {/* Crosshair. */}
          {cursor && (
            <g className="stroke-ink/30" strokeWidth={1}>
              <line x1={x(cursor.i)} x2={x(cursor.i)} y1={PAD.top} y2={PAD.top + plotH} />
              <line x1={0} x2={plotW} y1={cursor.y} y2={cursor.y} />
            </g>
          )}

          {/* Hit area: the whole plot, so the pointer never has to find a candle. */}
          <rect
            x={0}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              const i = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - r.left) / slot)));
              setCursor({ i, y: PAD.top + (e.clientY - r.top) });
            }}
            onPointerLeave={() => setCursor(null)}
          />

          {/* Session names along the top. */}
          {runs.map((r) =>
            r.label && (r.to - r.from + 1) * slot > 48 ? (
              <text
                key={`label-${r.key}`}
                x={x(r.from) - slot / 2 + 4}
                y={PAD.top - 12}
                className="fill-faint text-[9px] font-semibold uppercase tracking-[0.08em]"
              >
                {r.label}
              </text>
            ) : null,
          )}

          {box && (
            <text x={x(box.from) - slot / 2} y={y(box.high) - 5} className="fill-accent-2 text-[9px] font-semibold" style={HALO}>
              CRT 3–4AM
            </text>
          )}

          {zone && (
            <text x={plotW - 8} y={y(Math.min(zone.high, hi)) + 13} textAnchor="end" className="fill-soft text-[10px]" style={HALO}>
              {zone.label} {fmt(zone.low)}–{fmt(zone.high)}
            </text>
          )}

          {/* Map labels, left edge: type · name · price · chance · holds/breaks. Hover or focus for what it means. */}
          {levels.map((m, k) => (
            <g
              key={`label-${m.label}-${m.price}`}
              tabIndex={0}
              role="button"
              aria-label={`${m.label} ${fmt(m.price)}: ${levelEffect(m.kind, m.price > last.c)}`}
              className="cursor-help outline-none"
              onPointerEnter={() => setFocus(k)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(k)}
              onBlur={() => setFocus(null)}
              style={{ opacity: focus != null && focus !== k ? 0.3 : 1 }}
            >
              {Math.abs(m.labelY + 5 - m.y) > 3 && (
                <line x1={2} x2={8} y1={m.y} y2={m.labelY - 3} className="stroke-soft/50" strokeWidth={1} />
              )}
              <text x={8} y={m.labelY} className="text-[10px]" style={HALO}>
                <tspan className="num fill-faint text-[9px]">{KIND_TAG[m.kind]} </tspan>
                <tspan className="fill-soft">{m.label} </tspan>
                <tspan className="num fill-ink">{fmt(m.price)}</tspan>
                {m.prob != null && <tspan className="num fill-faint"> · {m.prob}%</tspan>}
                {m.verdict !== "unclear" && <tspan className="fill-soft"> {m.verdict === "hold" ? "↩" : "⇥"}</tspan>}
              </text>
            </g>
          ))}

          {/* Plan tags and the live price, right edge. */}
          {tags.map((t) => (
            <g key={t.text + t.live}>
              <rect x={plotW + 6} y={t.y - 8} width={PAD.right - 12} height={16} rx={4} className={t.live ? "fill-accent/20" : "fill-raised"} />
              <circle cx={plotW + 13} cy={t.y} r={2.5} className={FILL[t.tone]} />
              <text x={plotW + 20} y={t.y + 3.5} className={cx("num text-[10px]", t.live ? "fill-accent-2 font-semibold" : "fill-soft")}>
                {t.text}
              </text>
            </g>
          ))}

          {/* Price scale where the tags leave room. */}
          {ticks.map((p) => (
            <text key={p} x={width - 6} y={y(p) + 3} textAnchor="end" className="num fill-faint text-[9px]">
              {fmt(p)}
            </text>
          ))}

          {/* The price under the pointer. */}
          {cursor && (
            <g>
              <rect x={plotW + 6} y={cursor.y - 8} width={60} height={16} rx={4} className="fill-ink/80" />
              <text x={plotW + 12} y={cursor.y + 3.5} className="num fill-bg text-[10px] font-semibold">
                {fmt(Math.round(priceAt(cursor.y) * 100) / 100)}
              </text>
            </g>
          )}

          {/* The time under the pointer. */}
          {cursor && (
            <g>
              <rect x={x(cursor.i) - 30} y={height - 20} width={60} height={16} rx={4} className="fill-ink/80" />
              <text x={x(cursor.i)} y={height - 8.5} textAnchor="middle" className="num fill-bg text-[10px] font-semibold">
                {tf === "1h" ? `${dayMark(candles[cursor.i].t)} ` : ""}
                {deskTime(new Date(candles[cursor.i].t))}
              </text>
            </g>
          )}

          {/* Time marks. */}
          {marks.map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="num fill-faint text-[9px]">
              {tf === "1h" ? dayMark(candles[i].t) : deskTime(new Date(candles[i].t))}
            </text>
          ))}
        </svg>

        {/* What the focused level can do to price. */}
        {focused && (
          <div
            role="tooltip"
            className="anim-fade pointer-events-none absolute left-2 z-10 w-[300px] rounded-xl border bg-raised px-3.5 py-3 text-[12px] leading-snug"
            style={{
              top: focused.labelY + (focused.labelY > height * 0.6 ? -14 : 12),
              transform: focused.labelY > height * 0.6 ? "translateY(-100%)" : undefined,
              boxShadow: "var(--shadow-lift)",
            }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ink">
                <span className="num mr-1.5 text-[10px] text-faint">{KIND_TAG[focused.kind]}</span>
                {focused.label}
              </span>
              <span className="num text-ink">{fmt(focused.price)}</span>
            </div>
            {focused.prob != null && (
              <div className="mt-2">
                <div className="h-1 overflow-hidden rounded-full bg-subtle">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${focused.prob}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-faint">
                  {focused.prob}% chance price trades at it (a wick counts) before the 17:00 NY close
                </div>
              </div>
            )}
            <p className="mt-2 text-soft">{levelEffect(focused.kind, focused.price > last.c)}</p>
            <p className="mt-1 text-soft">{verdictEffect(focused.verdict, focused.kind)}</p>
            {focused.note && <p className="mt-1.5 text-[11px] text-faint">{focused.note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
