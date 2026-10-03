import { useState } from "react";
import { fmtDate, fmtPct, tone } from "@/lib/format";
import type { EquityPoint } from "@/lib/stats";
import { useWidth } from "./ui";

const H = 340;
const PAD = { top: 16, right: 16, bottom: 26, left: 52 };

/**
 * A smooth line through the points (Catmull-Rom converted to cubic béziers).
 * Equity moves in steps, but a tensioned curve reads as a trajectory.
 */
function spline(pts: [number, number][], tension = 0.22) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Round, human-friendly axis steps (0.5, 1, 2, 5, 10 …). */
function niceTicks(min: number, max: number, count = 4) {
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

export function EquityChart({ points }: { points: EquityPoint[] }) {
  const [ref, width] = useWidth(600);
  const [hover, setHover] = useState<number | null>(null);

  // Start the line at 0% before the first trade.
  const values = [0, ...points.map((p) => p.cum)];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const innerW = Math.max(width - PAD.left - PAD.right, 10);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(values.length - 1, 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
  const path = spline(pts);
  const area = `${path}L${x(values.length - 1)},${H - PAD.bottom}L${x(0)},${H - PAD.bottom}Z`;
  const last = values[values.length - 1] ?? 0;
  const lineColour = last >= 0 ? "var(--color-up)" : "var(--color-down)";

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - PAD.left) / innerW) * (values.length - 1));
    setHover(i >= 1 && i < values.length ? i : null);
  }

  const hp = hover != null ? points[hover - 1] : null;

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={H}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="block"
        role="img"
        aria-label="Equity curve, cumulative return in percent"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className={t === 0 ? "stroke-faint" : "stroke-line"}
              strokeDasharray={t === 0 ? "3 3" : undefined}
            />
            <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-faint text-caption">
              {t > 0 ? "+" : ""}
              {t}%
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} className="fill-faint text-caption">
          Trade 1
        </text>
        <text x={width - PAD.right} y={H - 6} textAnchor="end" className="fill-faint text-caption">
          Trade {points.length}
        </text>

        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColour} stopOpacity="0.28" />
            <stop offset="100%" stopColor={lineColour} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The curve draws itself in, then the fill fades up beneath it. */}
        <path
          d={area}
          fill="url(#equity-fill)"
          className="anim-fade"
          style={{ animationDelay: "2.4s", animationDuration: "2s" }}
        />
        {/* Two passes make the glow: a wide soft stroke, then the crisp line.
            Far cheaper to paint than an SVG blur filter, which stalls on wide charts. */}
        {[
          { w: 8, o: 0.16 },
          { w: 2.25, o: 1 },
        ].map((pass, i) => (
          <path
            key={i}
            d={path}
            fill="none"
            strokeWidth={pass.w}
            strokeOpacity={pass.o}
            strokeLinecap="round"
            strokeLinejoin="round"
            stroke={lineColour}
            style={{
              strokeDasharray: 4000,
              animation: "drawLine 4.5s cubic-bezier(0.25,1,0.5,1) both",
            }}
          />
        ))}

        {hp && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-soft/40" />
            <circle
              cx={x(hover)}
              cy={y(hp.cum)}
              r={5}
              strokeWidth={2}
              className="stroke-bg"
              fill={lineColour}
            />
          </g>
        )}
      </svg>

      {hp && hover != null && (
        <div
          className="anim-fade pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-lg border bg-raised px-3 py-2 text-small shadow-[var(--shadow-lift)]"
          style={
            x(hover) > width - 190
              ? { right: width - x(hover) + 12 }
              : { left: x(hover) + 12 }
          }
        >
          <div className="mb-1 text-faint">
            Trade {hp.n} · {fmtDate(hp.date)}
          </div>
          <Row label="Trade" value={fmtPct(hp.pct)} cls={tone(hp.pct)} />
          <Row label="Total" value={fmtPct(hp.cum)} cls="font-semibold" />
          {hp.dd < 0 && <Row label="From peak" value={fmtPct(hp.dd)} cls="text-soft" />}
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
  <div className="num flex justify-between gap-4">
    <span className="text-soft">{label}</span>
    <span className={cls}>{value}</span>
  </div>
);
