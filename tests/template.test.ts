/** Creating a strategy from the empty template, and via Duplicate. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goldModelDefinition } from "../server/migrate";
import { definitionErrors } from "../src/lib/grading";
import { duplicateStrategy, emptyStrategy, normalizeGrades } from "../src/lib/strategyTemplate";
import type { Strategy } from "../src/lib/types";

describe("empty template", () => {
  const s = emptyStrategy();

  it("has the four grade cards with the default risks and C not traded", () => {
    assert.deepEqual(
      s.grades.map((g) => [g.grade, g.riskPct, g.traded, g.description]),
      [
        ["A+", 1, true, ""],
        ["A", 0.5, true, ""],
        ["B", 0.25, true, ""],
        ["C", 0, false, ""],
      ],
    );
  });

  it("starts with no base rules and no factors", () => {
    assert.equal(s.baseRules.length, 0);
    assert.equal(s.factors.length, 0);
    assert.deepEqual(definitionErrors(s), []);
  });

  it("returns a fresh copy each time", () => {
    const a = emptyStrategy();
    a.grades[0].riskPct = 0.1;
    assert.equal(emptyStrategy().grades[0].riskPct, 1);
  });
});

describe("duplicate", () => {
  const original = {
    ...emptyStrategy(),
    ...(goldModelDefinition() as object),
    id: "abc",
    name: "GOLD Model",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  } as Strategy;

  it("copies the whole definition under a new name, without the id", () => {
    const copy = duplicateStrategy(original);
    assert.equal(copy.name, "GOLD Model (copy)");
    assert.equal("id" in copy, false);
    assert.equal(copy.baseRules.length, 7);
    assert.equal(copy.factors.length, 6);
    assert.deepEqual(copy.grades, original.grades);
  });

  it("is a deep copy — editing it leaves the original alone", () => {
    const copy = duplicateStrategy(original);
    copy.baseRules[0].text = "changed";
    copy.grades[0].riskPct = 0.1;
    assert.notEqual(original.baseRules[0].text, "changed");
    assert.equal(original.grades[0].riskPct, 1);
  });
});

describe("grade cards", () => {
  it("always come back as four, in ladder order", () => {
    const cards = normalizeGrades([{ grade: "B", riskPct: 0.3, traded: false }]);
    assert.deepEqual(cards.map((c) => c.grade), ["A+", "A", "B", "C"]);
    assert.equal(cards[2].riskPct, 0.3);
    assert.equal(cards[2].traded, false);
  });
});
