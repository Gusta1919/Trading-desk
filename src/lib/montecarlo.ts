/**
 * Monte Carlo over your own results.
 *
 * Every simulated trade is drawn from the trades you actually logged, so the spread
 * reflects your real edge instead of assumed win-rate / R:R inputs.
 */

/** Simulations used for the statistics. */
export const RUNS = 5000;
/** How many of those get drawn on the chart (canvas handles this many comfortably). */
export const DRAWN = 1200;
/** Paths kept for the percentile bands (sorting all 5,000 at every step is wasted work). */
const BAND_SAMPLE = 1200;

/** Deterministic random generator — same trades in, same picture out. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))];

export interface Bands {
  p5: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p95: number[];
}

export interface Sim {
  horizon: number;
  runs: number;
  /** Cumulative % paths kept for drawing. */
  paths: number[][];
  bands: Bands;
  ends: number[]; // sorted final % of every run
  drawdowns: number[]; // sorted deepest drawdown of every run (negative)
  lossStreaks: number[]; // sorted longest losing streak of every run
}

function seedOf(samples: number[]) {
  return Math.round(samples.reduce((a, b) => a + b * 1000, samples.length * 7919));
}

export function simulate(samples: number[], horizon: number, runs = RUNS): Sim {
  const rand = rng(seedOf(samples));
  const paths: number[][] = [];
  const bandRows: number[][] = [];
  const ends: number[] = [];
  const drawdowns: number[] = [];
  const lossStreaks: number[] = [];

  for (let r = 0; r < runs; r++) {
    const keep = r < DRAWN;
    const band = r < BAND_SAMPLE;
    const path: number[] = keep || band ? new Array(horizon) : [];

    let cum = 0;
    let peak = 0;
    let dd = 0;
    let run = 0;
    let longest = 0;

    for (let i = 0; i < horizon; i++) {
      const step = samples[Math.floor(rand() * samples.length)];
      cum += step;
      peak = Math.max(peak, cum);
      dd = Math.min(dd, cum - peak);
      if (step < 0) {
        run++;
        longest = Math.max(longest, run);
      } else if (step > 0) {
        run = 0;
      }
      if (keep || band) path[i] = cum;
    }

    if (keep) paths.push(path);
    if (band) bandRows.push(path);
    ends.push(cum);
    drawdowns.push(dd);
    lossStreaks.push(longest);
  }

  const bands: Bands = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  for (let i = 0; i < horizon; i++) {
    const col = bandRows.map((p) => p[i]).sort((a, b) => a - b);
    bands.p5.push(quantile(col, 0.05));
    bands.p25.push(quantile(col, 0.25));
    bands.p50.push(quantile(col, 0.5));
    bands.p75.push(quantile(col, 0.75));
    bands.p95.push(quantile(col, 0.95));
  }

  return {
    horizon,
    runs,
    paths,
    bands,
    ends: ends.sort((a, b) => a - b),
    drawdowns: drawdowns.sort((a, b) => a - b),
    lossStreaks: lossStreaks.sort((a, b) => a - b),
  };
}

/* ── Projections over calendar time ──────────────────────────────────── */

export interface Projection {
  label: string;
  months: number;
  trades: number;
  median: number;
  mean: number;
  p5: number;
  p95: number;
  chanceUp: number;
}

export const PROJECTION_MONTHS = [1, 3, 6, 12];

/** Trades per month, measured from how often you actually trade. */
export function tradesPerMonth(dates: string[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort();
  const days =
    (new Date(sorted[sorted.length - 1]).getTime() - new Date(sorted[0]).getTime()) / 86_400_000;
  if (days < 7) return null; // too short a window to extrapolate from
  return (dates.length / days) * 30.4;
}

/**
 * One long simulation, read at the 1/3/6/12-month marks — the same futures seen at
 * four moments, which is cheaper and more consistent than four separate runs.
 */
export function project(samples: number[], perMonth: number, runs = 2000): Projection[] {
  const counts = PROJECTION_MONTHS.map((m) => Math.max(1, Math.round(perMonth * m)));
  const horizon = Math.min(counts[counts.length - 1], 2000);
  const rand = rng(seedOf(samples) + 17);

  const snapshots = counts.map(() => [] as number[]);
  for (let r = 0; r < runs; r++) {
    let cum = 0;
    for (let i = 0; i < horizon; i++) {
      cum += samples[Math.floor(rand() * samples.length)];
      const at = counts.indexOf(i + 1);
      if (at !== -1) snapshots[at].push(cum);
    }
    // Horizons longer than the capped simulation reuse the final value.
    counts.forEach((c, k) => {
      if (c > horizon) snapshots[k].push(cum);
    });
  }

  return PROJECTION_MONTHS.map((months, k) => {
    const values = snapshots[k].sort((a, b) => a - b);
    return {
      label: months === 12 ? "1 year" : `${months} month${months > 1 ? "s" : ""}`,
      months,
      trades: counts[k],
      median: quantile(values, 0.5),
      mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
      p5: quantile(values, 0.05),
      p95: quantile(values, 0.95),
      chanceUp: values.filter((v) => v > 0).length / (values.length || 1),
    };
  });
}
