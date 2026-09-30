/**
 * What the desk may recommend: a factor that looks profitable is only an edge if it's
 * something you'd want to do more of — never a mistake or a broken rule.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edges, isRuleBreak, type Insight } from "../src/lib/insights";

const insight = (dimension: string, value: string, effect: number, avgR: number): Insight => ({
  key: `${dimension}::${value}`,
  dimension,
  label: `${dimension}: ${value}`,
  n: 20,
  avgR,
  restAvgR: 0,
  diff: effect,
  effect,
  winRate: 0.5,
  netPct: 1,
  confidence: "strong",
});

describe("edges", () => {
  it("never recommends a mistake or a broken rule, however it scored", () => {
    const xs = [
      insight("Mistake", "Early exit", 1.2, 1.2),
      insight("Plan", "broken", 0.4, 0.5),
      insight("Previous trade", "rule-break", 0.3, 0.4),
      insight("Grade", "A+", 0.6, 0.6),
    ];
    assert.deepEqual(edges(xs).map((i) => i.key), ["Grade::A+"]);
  });

  it("still lets the good side of the plan count", () => {
    assert.equal(isRuleBreak({ dimension: "Plan", key: "Plan::followed" }), false);
    assert.equal(isRuleBreak({ dimension: "Checklist", key: "Checklist::skip-x" }), true);
  });
});
