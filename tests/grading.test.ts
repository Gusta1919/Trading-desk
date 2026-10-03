/**
 * Grade computation, run against the real GOLD Model seed AND a differently shaped
 * strategy — two base rules, one choice factor, no number factor — so that nothing
 * in the grading can quietly depend on gold.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BIAS_OPTION, defaultRulebook } from "../src/lib/goldModel";
import {
  computeGrade,
  definitionErrors,
  factorSteps,
  gradeRequirements,
  numberFactorErrors,
  rangeIndex,
  rangeLabel,
  rangeValue,
  whyGrade,
} from "../src/lib/grading";
import type { ChoiceFactor, Definition, NumberFactor } from "../src/lib/types";

const gold: Definition = defaultRulebook();
const factor = (id: string) => gold.factors.find((f) => f.id === id)!;
const allRules = gold.baseRules.map((r) => r.id);

/** Every GOLD answer at its best, with overrides by factor id. */
const goldAnswers = (over: Record<string, string | number> = {}): Record<string, string | number> => ({
  "htf-tf": "htf-4h-plus",
  disp: 1.5,
  bias: BIAS_OPTION.matches,
  compass: 70,
  conviction: "conv-none",
  ...over,
});

describe("GOLD Model grading", () => {
  it("is A+ when every rule holds and every answer is the best", () => {
    const r = computeGrade(gold, { ticked: allRules, answers: goldAnswers() });
    assert.equal(r.grade, "A+");
    assert.equal(r.complete, true);
    assert.equal(r.next, null);
  });

  it("takes the lowest cap across all answers", () => {
    const r = computeGrade(gold, { ticked: allRules, answers: goldAnswers({ "htf-tf": "htf-1h", disp: 0.1 }) });
    assert.equal(r.grade, "B");
    assert.deepEqual(r.cappedBy.map((c) => c.label), ["Displacement multiple: <0.25×"]);
  });

  it("drops to C when any base rule is unticked, whatever the answers", () => {
    const r = computeGrade(gold, { ticked: allRules.slice(1), answers: goldAnswers() });
    assert.equal(r.grade, "C");
    assert.equal(r.missingRules.length, 1);
    assert.equal(r.cappedBy[0].source, "rule");
  });

  it("labels the displacement ranges as the rulebook draws them", () => {
    const f = factor("disp") as NumberFactor;
    assert.deepEqual([0, 1, 2].map((i) => rangeLabel(f, i)), ["<0.25", "0.25 to <1", "≥1"]);
  });

  it("gives each range button a value that falls back into that range", () => {
    for (const id of ["disp", "compass"]) {
      const f = factor(id) as NumberFactor;
      for (const i of f.caps.keys()) assert.equal(rangeIndex(f, rangeValue(f, i)), i);
    }
  });

  it("explains what caps the grade and what the next one needs", () => {
    const r = computeGrade(gold, { ticked: allRules, answers: goldAnswers({ conviction: "conv-lacking", "htf-tf": "htf-1h" }) });
    assert.equal(r.grade, "A");
    assert.deepEqual(r.cappedBy.map((c) => c.label).sort(), ["Conviction: Lacking something for A+", "HTF reason timeframe: 1H"]);
    assert.equal(r.next?.grade, "A+");
    assert.deepEqual(r.next?.needs.sort(), ["Conviction: No doubts", "HTF reason timeframe: 4H, Daily or Weekly"]);
  });

  it("says in one line why a setup got its grade", () => {
    const snap = { baseRules: gold.baseRules, factors: gold.factors, ticked: allRules };
    assert.equal(whyGrade({ ...snap, answers: goldAnswers() }), "Every rule held, every factor at its best");
    assert.equal(whyGrade({ ...snap, answers: goldAnswers({ "htf-tf": "htf-1h" }) }), "HTF reason timeframe: 1H");
    assert.match(whyGrade({ ...snap, ticked: allRules.filter((id) => id !== "window"), answers: goldAnswers() }), /^Missing: Inside the entry window/);
  });

  it("marks the grade provisional until every factor is answered", () => {
    const answers = goldAnswers();
    delete answers.conviction;
    const r = computeGrade(gold, { ticked: allRules, answers });
    assert.equal(r.complete, false);
    assert.deepEqual(r.missingFactors.map((f) => f.name), ["Conviction"]);
  });

  it("writes the ladder from the definition", () => {
    const top = gradeRequirements(gold, "A+");
    assert.ok(top.requires.includes(`all ${gold.baseRules.length} base rules`));
    assert.ok(top.requires.includes("Compass: ≥60%"));
    const c = gradeRequirements(gold, "C");
    assert.ok(c.cappedHere.includes("any base rule missing"));
    assert.ok(c.cappedHere.includes("Daily bias: Against"));
  });

  it("is a valid definition", () => {
    assert.deepEqual(definitionErrors(gold), []);
  });
});

describe("a differently shaped strategy", () => {
  // Two base rules, one choice factor, no number factor — nothing like gold.
  const trigger: ChoiceFactor = {
    id: "trig",
    name: "Trigger",
    hint: "",
    kind: "choice",
    options: [
      { id: "clean", label: "Clean", cap: "A+" },
      { id: "messy", label: "Messy", cap: "B" },
    ],
  };
  const def: Pick<Definition, "baseRules" | "factors"> = {
    baseRules: [
      { id: "r1", text: "Opening range formed", hint: "" },
      { id: "r2", text: "Volume above average", hint: "" },
    ],
    factors: [trigger],
  };

  it("grades A+ with both rules and the best answer", () => {
    assert.equal(computeGrade(def, { ticked: ["r1", "r2"], answers: { trig: "clean" } }).grade, "A+");
  });

  it("caps at the answer's grade", () => {
    const r = computeGrade(def, { ticked: ["r1", "r2"], answers: { trig: "messy" } });
    assert.equal(r.grade, "B");
    assert.deepEqual(r.next, { grade: "A", needs: ["Trigger: Clean"] });
  });

  it("drops to C on a missing rule", () => {
    assert.equal(computeGrade(def, { ticked: ["r1"], answers: { trig: "clean" } }).grade, "C");
  });

  it("with no rules and no factors, grades A+", () => {
    assert.equal(computeGrade({ baseRules: [], factors: [] }, { ticked: [], answers: {} }).grade, "A+");
  });
});

describe("number factor validation", () => {
  const base: NumberFactor = {
    id: "n",
    name: "Score",
    hint: "",
    kind: "number",
    unit: "",
    cuts: [
      { value: 10, lowerGetsIt: false },
      { value: 20, lowerGetsIt: true },
    ],
    caps: ["C", "B", "A+"],
  };

  it("accepts ascending boundaries", () => {
    assert.deepEqual(numberFactorErrors(base), []);
  });

  it("rejects boundaries that do not go up", () => {
    const bad = { ...base, cuts: [base.cuts[1], base.cuts[0]] };
    assert.equal(numberFactorErrors(bad).length, 1);
  });

  it("rejects a range with no grade", () => {
    assert.equal(numberFactorErrors({ ...base, caps: ["C", "B"] }).length, 1);
  });
});

describe("the rulebook's table: one step per answer", () => {
  const f = factor;

  it("lists every answer with the best grade it allows, best first", () => {
    assert.deepEqual(factorSteps(f("htf-tf")), [
      { label: "4H, Daily or Weekly", cap: "A+" },
      { label: "1H", cap: "A" },
    ]);
    assert.deepEqual(
      factorSteps(f("disp")).map((s) => [s.label, s.cap]),
      [["≥1×", "A+"], ["0.25 to <1×", "A"], ["<0.25×", "B"]],
    );
    assert.deepEqual(
      factorSteps(f("compass")).map((s) => [s.label, s.cap]),
      [["≥60%", "A+"], ["<60%", "B"]],
    );
  });

  it("keeps a C-only answer, so the C column is never empty", () => {
    const bias = factorSteps(f("bias"));
    assert.equal(bias[bias.length - 1].cap, "C");
    assert.deepEqual(factorSteps(f("conviction")).map((s) => s.cap), ["A+", "A", "B", "C"]);
  });
});
