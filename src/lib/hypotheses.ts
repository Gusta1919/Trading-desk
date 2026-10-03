/**
 * The rulebook's hypotheses, measured: ideas being logged, not rules yet.
 *
 * Each one compares the trades on either side of a question — fresh POIs against
 * retested ones, a bias that matched the briefing against one that didn't — using the same small-sample
 * guards as the Insights: a side with fewer than MIN_GROUP trades is shown faded, and
 * the difference is shrunk toward zero by how few trades stand behind it. A hypothesis
 * is ready to decide once its sample reaches its "decide after".
 */
import { releasesHeld } from "./discipline";
import { MIN_GROUP, mean, shrunk } from "./insights";
import { fill, tokenValues, type Hypothesis, type Rulebook } from "./rulebook";
import { isClosed } from "./stats";
import type { Trade } from "./types";

export interface HypothesisSide {
  label: string;
  n: number;
  /** Expectancy in R. */
  avgR: number | null;
  /** Too few trades to read. */
  faded: boolean;
}

export interface HypothesisResult {
  hypothesis: Hypothesis;
  /** What counts toward the sample — trades, cases, limit trades. */
  n: number;
  target: number | null;
  /** 0–1 toward the target. */
  progress: number;
  sides: HypothesisSide[];
  /** First side minus second, shrunk by the smaller side — null when either is too thin. */
  edge: number | null;
  status: "collecting" | "ready";
  /** A word on how it is measured, when the sides need one. */
  note?: string;
}

/** One side of a comparison: its trades' average R — or, for setups not taken, what they would have made. */
function side(label: string, trades: Trade[], r: (t: Trade) => number = (t) => t.resultR ?? 0): HypothesisSide {
  return {
    label,
    n: trades.length,
    avgR: trades.length ? mean(trades.map(r)) : null,
    faded: trades.length < MIN_GROUP,
  };
}

/** The sides each hypothesis compares, and what its sample counts. */
function measure(h: Hypothesis, closed: Trade[], doc: Rulebook, all: Trade[]): { n: number; sides: HypothesisSide[]; note?: string } {
  switch (h.id) {
    case "deep-sweep": {
      const logged = closed.filter((t) => t.sweepDepth != null);
      const deep = doc.sweep.p85;
      return {
        n: logged.length,
        sides: [
          side(`Within $${deep}`, logged.filter((t) => t.sweepDepth! <= deep)),
          side(`Beyond $${deep}`, logged.filter((t) => t.sweepDepth! > deep)),
        ],
      };
    }
    case "swing-15m": {
      const logged = closed.filter((t) => t.took15mSwing != null);
      return {
        n: logged.length,
        sides: [side("Took a 15m swing", logged.filter((t) => t.took15mSwing)), side("Didn't", logged.filter((t) => !t.took15mSwing))],
      };
    }
    case "fresh-poi": {
      const logged = closed.filter((t) => t.poiTests);
      return {
        n: logged.length,
        sides: [side("Fresh", logged.filter((t) => t.poiTests === "fresh")), side("Retested", logged.filter((t) => t.poiTests !== "fresh"))],
      };
    }
    case "release-hold": {
      const cases = closed.filter((t) => releasesHeld(t, doc).length > 0 || t.exitReason === "release");
      return {
        n: cases.length,
        sides: [
          side("Held at breakeven", cases.filter((t) => t.releaseAtBe === true && t.exitReason !== "release")),
          side("Closed by the release rule", cases.filter((t) => t.exitReason === "release")),
        ],
      };
    }
    case "min-rr": {
      const logged = closed.filter((t) => t.plannedRR != null);
      return {
        n: logged.length,
        sides: [
          side("1–1.5R", logged.filter((t) => t.plannedRR! < 1.5)),
          side("1.5–2R", logged.filter((t) => t.plannedRR! >= 1.5 && t.plannedRR! < 2)),
          side("2R+", logged.filter((t) => t.plannedRR! >= 2)),
        ],
      };
    }
    case "runners": {
      const logged = closed.filter((t) => t.mfeR != null);
      return { n: logged.length, sides: [], note: "Answered by the Exit lab in the Risk lab." };
    }
    case "shorts":
      return {
        n: closed.length,
        sides: [side("Long", closed.filter((t) => t.direction === "long")), side("Short", closed.filter((t) => t.direction === "short"))],
      };
    case "desk": {
      const logged = closed.filter((t) => t.biasMatch != null);
      return {
        n: logged.length,
        sides: [side("Bias matched", logged.filter((t) => t.biasMatch)), side("Bias differed", logged.filter((t) => t.biasMatch === false))],
      };
    }
    case "a-plus": {
      const graded = closed.filter((t) => t.grade === "A+" || t.grade === "A");
      return {
        n: graded.length,
        sides: [side("A+", graded.filter((t) => t.grade === "A+")), side("A", graded.filter((t) => t.grade === "A"))],
      };
    }
    case "b-setups": {
      const bs = all.filter((t) => t.skipped && t.grade === "B" && t.hypotheticalR != null);
      return {
        n: bs.length,
        sides: [side("B, not taken", bs, (t) => t.hypotheticalR ?? 0), side("A, taken", closed.filter((t) => t.grade === "A"))],
        note: "B setups count with what they would have made.",
      };
    }
    default:
      return { n: 0, sides: [] };
  }
}

export function hypothesisResults(doc: Rulebook, trades: Trade[]): HypothesisResult[] {
  const values = tokenValues(doc);
  const closed = trades.filter((t) => !t.skipped && isClosed(t));
  return doc.hypotheses.map((h) => {
    const target = Number(fill(h.decideAfter, values)) || null;
    const { n, sides, note } = measure(h, closed, doc, trades);
    const [a, b] = sides;
    const edge =
      a && b && !a.faded && !b.faded && a.avgR != null && b.avgR != null ? shrunk(a.avgR - b.avgR, Math.min(a.n, b.n)) : null;
    return {
      hypothesis: h,
      n,
      target,
      progress: target ? Math.min(1, n / target) : 0,
      sides,
      edge,
      status: target != null && n >= target ? ("ready" as const) : ("collecting" as const),
      note,
    };
  });
}
