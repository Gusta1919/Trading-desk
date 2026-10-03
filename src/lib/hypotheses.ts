/**
 * The rulebook's hypotheses, measured: ideas being logged, not rules yet.
 *
 * Each one compares the trades on either side of a question — fresh POIs against
 * retested ones, limit entries against market ones — using the same small-sample
 * guards as the Insights: a side with fewer than MIN_GROUP trades is shown faded, and
 * the difference is shrunk toward zero by how few trades stand behind it. A hypothesis
 * is ready to decide once its sample reaches its "decide after".
 */
import { releasesHeld } from "./discipline";
import { MIN_GROUP, mean, shrunk } from "./insights";
import { fill, tokenValues, type Hypothesis, type Rulebook } from "./rulebook";
import { isClosed } from "./stats";
import { excursions } from "./rules";
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
  status: "collecting" | "ready" | "outside";
  /** A word on how it is measured, when the sides need one. */
  note?: string;
}

function side(label: string, trades: Trade[]): HypothesisSide {
  return {
    label,
    n: trades.length,
    avgR: trades.length ? mean(trades.map((t) => t.resultR ?? 0)) : null,
    faded: trades.length < MIN_GROUP,
  };
}

/** The sides each hypothesis compares, and what its sample counts. */
function measure(h: Hypothesis, closed: Trade[], doc: Rulebook): { n: number; sides: HypothesisSide[]; note?: string } {
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
    case "limit-entry": {
      const limit = closed.filter((t) => t.entryType === "limit");
      return {
        n: limit.length,
        sides: [side("Limit", limit), side("Market", closed.filter((t) => t.entryType === "market"))],
      };
    }
    case "runners": {
      const logged = closed.filter((t) => excursions(t).mfeR != null);
      return { n: logged.length, sides: [], note: "Answered by the Exit lab in the Risk lab." };
    }
    case "shorts":
      return {
        n: closed.length,
        sides: [side("Long", closed.filter((t) => t.direction === "long")), side("Short", closed.filter((t) => t.direction === "short"))],
      };
    case "desk": {
      const logged = closed.filter((t) => t.deskAgreed === "yes" || t.deskAgreed === "no");
      return {
        n: logged.length,
        sides: [side("Desk agreed", logged.filter((t) => t.deskAgreed === "yes")), side("Desk disagreed", logged.filter((t) => t.deskAgreed === "no"))],
      };
    }
    case "a-plus": {
      const graded = closed.filter((t) => t.grade === "A+" || t.grade === "A");
      return {
        n: graded.length,
        sides: [side("A+", graded.filter((t) => t.grade === "A+")), side("A", graded.filter((t) => t.grade === "A"))],
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
    if (h.outside) return { hypothesis: h, n: 0, target, progress: 0, sides: [], edge: null, status: "outside" as const };
    const { n, sides, note } = measure(h, closed, doc);
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
