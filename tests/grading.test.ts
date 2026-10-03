/**
 * Grade computation, run against the real GOLD Model seed AND a differently shaped
 * strategy — two base rules, one choice factor, no number factor — so that nothing
 * in the grading can quietly depend on gold.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { factorSteps } from "../src/lib/grading";
import { condenseRulebook, defaultRulebook, freshStart, retirePlan, windowByHand } from "../src/lib/rulebookText";
import { goldModelDefinition } from "../server/migrate";
import {
  computeGrade,
  definitionErrors,
  gradeRequirements,
  numberFactorErrors,
  rangeIndex,
  rangeLabel,
  rangeValue,
} from "../src/lib/grading";
import type { ChoiceFactor, Definition, NumberFactor } from "../src/lib/types";

const gold = goldModelDefinition() as unknown as Definition;
const factor = (name: string) => gold.factors.find((f) => f.name === name)!;
const option = (name: string, label: string) =>
  (factor(name) as ChoiceFactor).options.find((o) => o.label === label)!.id;
const allRules = gold.baseRules.map((r) => r.id);

/** Every GOLD answer at its best, with overrides by factor name. */
function goldAnswers(over: Record<string, string | number> = {}) {
  const best: Record<string, string | number> = {
    "HTF reason timeframe": "4H / Daily",
    "Entry model": "MSS 5m",
    Displacement: "Strong",
    "Daily bias": "Matches",
    "Compass probability": 75,
    Conviction: "No doubts",
  };
  const merged = { ...best, ...over };
  const answers: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(merged)) {
    const f = factor(name);
    answers[f.id] = f.kind === "number" ? v : option(name, String(v));
  }
  return answers;
}

describe("GOLD Model grading", () => {
  it("is A+ when every rule holds and every answer is the best", () => {
    const r = computeGrade(gold, { ticked: allRules, answers: goldAnswers() });
    assert.equal(r.grade, "A+");
    assert.equal(r.complete, true);
    assert.equal(r.next, null);
  });

  it("takes the lowest cap across all answers", () => {
    const r = computeGrade(gold, {
      ticked: allRules,
      answers: goldAnswers({ "HTF reason timeframe": "1H", Displacement: "Weak" }),
    });
    assert.equal(r.grade, "B");
    assert.deepEqual(
      r.cappedBy.map((c) => c.label),
      ["Displacement: Weak"],
    );
  });

  it("drops to C when any base rule is unticked, whatever the answers", () => {
    const r = computeGrade(gold, { ticked: allRules.slice(1), answers: goldAnswers() });
    assert.equal(r.grade, "C");
    assert.equal(r.missingRules.length, 1);
    assert.equal(r.cappedBy[0].source, "rule");
  });

  it("puts the Compass boundaries 55 / 65 / 70 on the right side", () => {
    const at = (x: number) =>
      computeGrade(gold, { ticked: allRules, answers: goldAnswers({ "Compass probability": x }) }).grade;
    assert.equal(at(54.9), "C");
    assert.equal(at(55), "B"); // 55 to 65 → B includes 55
    assert.equal(at(65), "B"); // …and 65
    assert.equal(at(65.01), "A"); // >65 to 70 → A
    assert.equal(at(70), "A"); // …includes 70
    assert.equal(at(70.01), "A+"); // >70 → A+
  });

  it("labels the Compass ranges exactly as written", () => {
    const f = factor("Compass probability") as NumberFactor;
    assert.deepEqual([0, 1, 2, 3].map((i) => rangeLabel(f, i)), ["<55", "55 to 65", ">65 to 70", ">70"]);
  });

  it("gives each range button a value that falls back into that range", () => {
    const f = factor("Compass probability") as NumberFactor;
    for (const i of [0, 1, 2, 3]) assert.equal(rangeIndex(f, rangeValue(f, i)), i);
  });

  it("explains what caps the grade and what the next one needs", () => {
    const r = computeGrade(gold, {
      ticked: allRules,
      answers: goldAnswers({ "Entry model": "BOS 5m", "HTF reason timeframe": "1H" }),
    });
    assert.equal(r.grade, "A");
    assert.deepEqual(r.cappedBy.map((c) => c.label).sort(), ["Entry model: BOS 5m", "HTF reason timeframe: 1H"]);
    assert.equal(r.next?.grade, "A+");
    assert.deepEqual(r.next?.needs.sort(), ["Entry model: MSS 5m", "HTF reason timeframe: 4H / Daily"]);
  });

  it("marks the grade provisional until every factor is answered", () => {
    const answers = goldAnswers();
    delete answers[factor("Conviction").id];
    const r = computeGrade(gold, { ticked: allRules, answers });
    assert.equal(r.complete, false);
    assert.deepEqual(r.missingFactors.map((f) => f.name), ["Conviction"]);
  });

  it("writes the ladder from the definition", () => {
    const top = gradeRequirements(gold, "A+");
    assert.ok(top.requires.includes("all 7 base rules"));
    assert.ok(top.requires.includes("Compass probability: >70"));
    const c = gradeRequirements(gold, "C");
    assert.ok(c.cappedHere.includes("any base rule missing"));
    assert.ok(c.cappedHere.includes("Daily bias: Against"));
    assert.ok(c.cappedHere.includes("Compass probability: <55"));
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
  const two = windowByHand(freshStart(condenseRulebook(retirePlan(defaultRulebook())), "2.0"));
  const f = (id: string) => two.factors.find((x) => x.id === id)!;

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
    assert.deepEqual(factorSteps(f("bias")).at(-1)!.cap, "C");
    assert.deepEqual(factorSteps(f("conviction")).map((s) => s.cap), ["A+", "A", "B", "C"]);
  });
});
