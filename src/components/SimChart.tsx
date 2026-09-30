import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtPct } from "@/lib/format";
import type { Sim } from "@/lib/montecarlo";
import { cx, useWidth } from "./ui";

const PAD = { top: 28, right: 118, bottom: 36, left: 62 };

/** How long the chart takes to draw itself from left to right — slow enough to watch it being drawn. */
const REVEAL_MS = 2800;
/**
 * A gentle ease-in-out: it starts softly, keeps an even pace through the middle and
 * settles at the end. The app's usual ease-out does most of its travel in the first
 * moments, which hides the drawing; this curve keeps it visible all the way across.
 */
const EASE = "cubic-bezier(0.45, 0.05, 0.3, 1)";

export interface PathStats {
  index: number;
  end: number;
  maxDrawdown: number;
  wins: number;
  losses: number;
  longestLossStreak: number;
  best: number;
  worst: number;
}

/** Everything about one simulated future, worked out from its step-by-step returns. */
export function statsOf(path: number[], index: number): PathStats {
  let peak = 0;
  let dd = 0;
  let prev = 0;
  let wins = 0;
  let losses = 0;
  let run = 0;
  let longest = 0;
  let best = -Infinity;
  let worst = Infinity;

  for (const cum of path) {
    const step = cum - prev;
    prev = cum;
    peak = Math.max(peak, cum);
    dd = Math.min(dd, cum - peak);
    if (step > 0) {
      wins++;
      run = 0;
    } else if (step < 0) {
      losses++;
      run++;
      longest = Math.max(longest, run);
    }
    best = Math.max(best, step);
    worst = Math.min(worst, step);
  }

  return {
    index,
    end: path[path.length - 1],
    maxDrawdown: dd,
    wins,
    losses,
    longestLossStreak: longest,
    best,
    worst,
  };
}

function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  const top = Math.ceil(max / step) * step;
  for (let v = Math.floor(min / step) * step; v <= top + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

/**
 * Colour by rank, not by value: the best fifth of futures burn green, the worst
 * fifth deep red, and the crowd in between stays slate so the tails stand out.
 */
function tierOf(rank: number) {
  if (rank >= 0.8) return { rgb: "52,211,153", alpha: 0.1 + (rank - 0.8) * 0.8 };
  if (rank <= 0.2) return { rgb: "225,29,72", alpha: 0.1 + (0.2 - rank) * 0.8 };
  return { rgb: "100,116,139", alpha: 0.06 };
}

/**
 * A thousand futures drawn in one sweep across the desk, graded by where each
 * one finishes, with the five trajectories that tell the story laid over the top.
 */
export function SimChart({
  sim,
  height,
  perMonth,
  selected,
  onSelect,
  unit = "trade",
}: {
  sim: Sim;
  height: number;
  /** Steps per month, used to mark 1M / 3M / 6M / 1Y on the time axis. */
  perMonth: number | null;
  /** What one step of a path is: a trade, or a whole trading day under the rules. */
  unit?: "trade" | "day";
  selected: PathStats | null;
  onSelect: (s: PathStats | null) => void;
}) {
  const [ref, width] = useWidth();
  const crowd = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<PathStats | null>(null);
  /** Cursor side, so the tooltip never covers what you're pointing at. */
  const [cursorRight, setCursorRight] = useState(true);
  const clip = useId().replace(/:/g, "");
  const hoverRaf = useRef(0);
  const pendingHover = useRef<{ x: number; y: number; box: DOMRect } | null>(null);
  const { horizon, paths } = sim;

  // Use the full extent of every drawn path so the fan fills the height.
  const { lo, hi } = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const p of paths) {
      for (const v of p) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { lo: min, hi: max };
  }, [paths]);
  const ticks = useMemo(() => niceTicks(lo * 1.02, hi * 1.02, 6), [lo, hi]);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const innerW = Math.max(width - PAD.left - PAD.right, 10);
  const innerH = height - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + ((i + 1) / horizon) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  /** Each path's position from worst (0) to best (1) by where it ends up. */
  const ranks = useMemo(() => {
    const byEnd = paths
      .map((p, i) => [p[p.length - 1], i] as const)
      .sort((a, b) => a[0] - b[0]);
    const out = new Array<number>(paths.length);
    const last = paths.length - 1 || 1;
    byEnd.forEach(([, idx], place) => {
      out[idx] = place / last;
    });
    return out;
  }, [paths]);

  /**
   * Paths grouped by colour, so the tiers paint in strict layers: all slate, then
   * all red, then all green on top — no muddy interleaving where they cross.
   * (Measured: batching the stroke calls is not itself faster. What keeps the
   * frame cost down is the incremental draw below, which paints each slice once.)
   * Quantising alpha to two decimals is what lets paths share a batch at all.
   */
  const batches = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < paths.length; i++) {
      const { rgb, alpha } = tierOf(ranks[i]);
      const key = `rgba(${rgb},${Math.round(alpha * 100) / 100})`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(i);
      else groups.set(key, [i]);
    }
    const layer = (k: string) => (k.startsWith("rgba(52") ? 2 : k.startsWith("rgba(225") ? 1 : 0);
    return [...groups.entries()]
      .sort((a, b) => layer(a[0]) - layer(b[0]))
      .map(([stroke, idx]) => ({ stroke, idx }));
  }, [paths, ranks]);

  /**
   * The story is told by five trajectories: the median, the quartiles and the tails.
   * They carry the same green / slate / red grammar as the crowd beneath them.
   */
  const trajectories = useMemo(
    () => [
      { key: "p95", vals: sim.bands.p95, label: "Top 5%", colour: "var(--color-up)", width: 1, dash: true },
      { key: "p75", vals: sim.bands.p75, label: "Top 25%", colour: "var(--color-up)", width: 1.5, dash: false },
      { key: "p50", vals: sim.bands.p50, label: "Median", colour: "var(--color-ink)", width: 2.4, dash: false },
      { key: "p25", vals: sim.bands.p25, label: "Bottom 25%", colour: "var(--color-down)", width: 1.5, dash: false },
      { key: "p5", vals: sim.bands.p5, label: "Bottom 5%", colour: "var(--color-down)", width: 1, dash: true },
    ],
    [sim],
  );

  /** Finds the path running closest to the cursor. */
  function pathAt(clientX: number, clientY: number, box: DOMRect) {
    const mx = clientX - box.left;
    const my = clientY - box.top;
    const i = Math.round(((mx - PAD.left) / innerW) * horizon) - 1;
    if (i < 0 || i >= horizon) return null;

    let bestIdx = -1;
    let bestDist = 14; // only snap when the cursor is genuinely near a line
    paths.forEach((p, idx) => {
      const d = Math.abs(y(p[i]) - my);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return bestIdx === -1 ? null : statsOf(paths[bestIdx], bestIdx);
  }

  const months = perMonth
    ? [
        { label: "1M", trades: Math.round(perMonth) },
        { label: "3M", trades: Math.round(perMonth * 3) },
        { label: "6M", trades: Math.round(perMonth * 6) },
        { label: "1Y", trades: Math.round(perMonth * 12) },
      ].filter((m) => m.trades >= 2 && m.trades <= horizon)
    : [];

  const tip = hover ?? selected;

  const line = (vals: number[]) =>
    `M${x(-1)},${y(0)}` + vals.map((v, i) => `L${x(i)},${y(v)}`).join("");

  /*
   * Each path string walks every point in the horizon. Rebuilding all five of them
   * on every mouse move is what made hovering feel heavy, so they are cached against
   * the shape of the chart and only rebuilt when that actually changes.
   */
  const drawn = useMemo(
    () => trajectories.map((t) => ({ ...t, d: line(t.vals) })),
    [trajectories, width, height, horizon, yMin, yMax], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /*
   * Every path, on canvas — SVG cannot hold this many nodes without stalling. They are
   * painted once, in full; the sweep is a clip that eases open over the finished picture.
   * Extending the lines day by day stepped visibly (63 days over two seconds is a tick
   * every few frames); a clip moves by fractions of a pixel, so the reveal is continuous
   * and costs a single paint.
   */
  useEffect(() => {
    const canvas = crowd.current;
    if (!canvas || width < 20) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 0.85;
    ctx.lineJoin = "round";

    for (const batch of batches) {
      ctx.strokeStyle = batch.stroke;
      ctx.beginPath();
      for (const idx of batch.idx) {
        const p = paths[idx];
        ctx.moveTo(x(-1), y(0));
        for (let i = 0; i < horizon; i++) ctx.lineTo(x(i), y(p[i]));
      }
      ctx.stroke();
    }
  }, [paths, batches, width, height, horizon, lo, hi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => cancelAnimationFrame(hoverRaf.current), []);

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {/* The crowd and the five lines above it open with one sweep, on one curve. */}
      <canvas
        ref={crowd}
        style={{ width, height, animation: `reveal ${REVEAL_MS}ms ${EASE} both` }}
        className="absolute inset-0"
      />
      {/*
        The pen: a glowing edge that travels with the sweep, exactly where the lines are
        being drawn, with a faint trail behind it. Same length and curve as the reveal.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          top: PAD.top - 6,
          bottom: PAD.bottom - 6,
          left: 0,
          width: 0,
          animation: `pen ${REVEAL_MS}ms ${EASE} both`,
        }}
      >
        <div
          className="absolute inset-y-0 right-0 w-24"
          style={{ background: "linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-accent-2) 12%, transparent))" }}
        />
        <div
          className="absolute inset-y-0 right-0 w-[2px] rounded-full"
          style={{
            background: "linear-gradient(180deg, transparent, var(--color-accent-2) 20%, var(--color-accent-2) 80%, transparent)",
            boxShadow: "0 0 14px var(--glow-accent), 0 0 4px var(--color-accent-2)",
          }}
        />
      </div>
      <svg
        width={width}
        height={height}
        className="absolute inset-0 cursor-crosshair"
        onMouseMove={(e) => {
          pendingHover.current = {
            x: e.clientX,
            y: e.clientY,
            box: e.currentTarget.getBoundingClientRect(),
          };
          if (hoverRaf.current) return; // one lookup per frame, however fast the mouse moves
          hoverRaf.current = requestAnimationFrame(() => {
            hoverRaf.current = 0;
            const p = pendingHover.current;
            if (!p) return;
            setCursorRight(p.x - p.box.left > p.box.width / 2);
            const next = pathAt(p.x, p.y, p.box);
            // Running along the same thread should not cost a re-render.
            setHover((prev) => (prev?.index === next?.index ? prev : next));
          });
        }}
        onMouseLeave={() => {
          cancelAnimationFrame(hoverRaf.current);
          hoverRaf.current = 0;
          setHover(null);
        }}
        onClick={(e) => {
          const picked = pathAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          onSelect(picked && selected?.index === picked.index ? null : picked);
        }}
      >
        <defs>
          {/* A rectangle that stretches open left to right, uncovering the lines with the sweep. */}
          <clipPath id={clip}>
            <rect
              x={0}
              y={0}
              width={width}
              height={height}
              className="anim-wipe"
              /* Same length and curve as the canvas underneath, so the two stay locked together. */
              style={{ animationDuration: `${REVEAL_MS}ms`, animationTimingFunction: EASE }}
            />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? "stroke-soft/40" : "stroke-line"}
              strokeDasharray={t === 0 ? "5 5" : undefined}
            />
            <text
              x={PAD.left - 12}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="num fill-faint text-[11px]"
            >
              {t > 0 ? "+" : ""}
              {t}%
            </text>
          </g>
        ))}

        {months.map((m) => (
          <g key={m.label}>
            <line
              x1={x(m.trades - 1)}
              x2={x(m.trades - 1)}
              y1={PAD.top}
              y2={height - PAD.bottom}
              className="stroke-accent/20"
              strokeDasharray="2 6"
            />
            <text
              x={x(m.trades - 1)}
              y={PAD.top - 6}
              textAnchor="middle"
              className="num fill-accent/70 text-[10px]"
            >
              {m.label}
            </text>
          </g>
        ))}

        {/* The lines that matter: a soft halo under a crisp stroke, revealed by the sweep. */}
        <g clipPath={`url(#${clip})`}>
          {drawn.map((t) => (
            <g key={t.key}>
              <path
                d={t.d}
                fill="none"
                stroke={t.colour}
                strokeWidth={t.width * 6}
                strokeOpacity={0.07}
                strokeLinecap="round"
              />
              <path
                d={t.d}
                fill="none"
                stroke={t.colour}
                strokeWidth={t.width}
                strokeLinecap="round"
                strokeDasharray={t.dash ? "6 7" : undefined}
              />
            </g>
          ))}
        </g>

        {trajectories.map((t, i) => (
          <text
            key={t.key}
            x={x(horizon - 1) + 10}
            y={y(t.vals[horizon - 1])}
            dy="0.32em"
            className="num text-[10px]"
            fill={t.colour}
            style={{
              opacity: 0,
              animation: `fadeIn 1s ${REVEAL_MS / 1000 + i * 0.1}s var(--ease-slow) both`,
            }}
          >
            {t.label}
          </text>
        ))}

        {hover && paths[hover.index] && (
          <path
            d={line(paths[hover.index])}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1.3}
            strokeOpacity={0.75}
          />
        )}
        {selected && paths[selected.index] && (
          <path
            d={line(paths[selected.index])}
            fill="none"
            stroke="var(--color-accent-2)"
            strokeWidth={1.8}
          />
        )}

        <text x={PAD.left} y={height - 10} className="num fill-faint text-[11px]">
          {unit} 1
        </text>
        <text
          x={x(horizon - 1)}
          y={height - 10}
          textAnchor="end"
          className="num fill-faint text-[11px]"
        >
          {unit} {horizon}
        </text>
      </svg>

      {tip && (
        <div
          className={cx(
            "pointer-events-none absolute top-2 z-10 w-[210px] rounded-lg border bg-surface px-3 py-2 text-[12px] shadow-lg",
            selected && !hover && "border-ink/40",
          )}
          style={cursorRight ? { left: 12 } : { right: 12 }}
        >
          <div className="mb-1.5 flex items-center justify-between text-faint">
            <span>Future #{tip.index + 1}</span>
            <span className="num">{selected?.index === tip.index ? "pinned" : "hover"}</span>
          </div>
          <Row label="Ends at" value={fmtPct(tip.end, 1)} tone={tip.end >= 0 ? "up" : "down"} strong />
          <Row label="Worst drawdown" value={fmtPct(tip.maxDrawdown, 1)} />
          <Row label="Wins / losses" value={`${tip.wins} / ${tip.losses}`} />
          <Row label="Longest losing run" value={`${tip.longestLossStreak}`} />
          <Row label={`Best / worst ${unit}`} value={`${fmtPct(tip.best, 1)} / ${fmtPct(tip.worst, 1)}`} />
          <div className="mt-1.5 text-[11px] text-faint">
            {selected?.index === tip.index ? "Click it again to unpin" : "Click to pin this future"}
          </div>
        </div>
      )}
    </div>
  );
}

const Row = ({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  strong?: boolean;
}) => (
  <div className="num flex justify-between gap-3">
    <span className="text-soft">{label}</span>
    <span className={cx(strong && "font-semibold", tone === "up" && "text-up", tone === "down" && "text-down")}>
      {value}
    </span>
  </div>
);
