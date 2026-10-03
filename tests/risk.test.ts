/**
 * Allowed risk = min(grade risk, remaining daily budget, max risk per trade), and the
 * flags a trade raises when it crosses a line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedRisk, dayBudget, flagsFor, gradeRisk, replayDay } from "../src/lib/risk";
import { DEFAULT_GRADES } from "../src/lib/strategyTemplate";
import type { Definition, Trade } from "../src/lib/types";

const L = { maxRiskPct: 1, dailyStopPct: 1 };
const DAY = "2026-10-01";
const ladder: Pick<Definition, "grades"> = { grades: DEFAULT_GRADES }; // A+ 1 · A 0.5 · B 0.25 · C don't

let n = 0;
/** A trade on DAY: risk in %, result in R (null = still open). */
function trade(riskPct: number, resultR: number | null, extra: Partial<Trade> = {}): Trade {
  n++;
  return {
    id: `t${n}`,
    date: `${DAY}T0${Math.min(n, 9)}:00`,
    symbol: "XAUUSD",
    direction: "long",
    session: "",
    setup: "",
    strategyId: null,
    htf: "",
    entryModel: "",
    riskPct,
    plannedRiskPct: null,
    plannedRR: null,
    resultR,
    followedPlan: null,
    grade: "",
    emotion: null,
    mistakes: [],
    checklist: [],
    checklistTotal: 0,
    setupSnapshot: null,
    flags: [],
    flagNote: "",
    skipped: false,
    hypotheticalR: null,
    costPct: null,
    boxSize: null,
    pnlUsd: null,
    news: [],
    notes: "",
    screenshot: "",
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

const allowedFor = (trades: Trade[], grade: string) =>
  allowedRisk(gradeRisk(ladder, grade), dayBudget(trades, DAY, L), L);

describe("allowed risk", () => {
  it("gives a fresh day the grade's own risk", () => {
    assert.equal(allowedFor([], "A+"), 1);
    assert.equal(allowedFor([], "A"), 0.5);
    assert.equal(allowedFor([], "B"), 0.25);
    assert.equal(allowedFor([], "C"), 0);
  });

  it("caps an A+ at 0.5% after an A loses (-1R at 0.5%)", () => {
    assert.equal(allowedFor([trade(0.5, -1)], "A+"), 0.5);
  });

  it("hits the daily stop after an A+ loses", () => {
    const b = dayBudget([trade(1, -1)], DAY, L);
    assert.equal(b.stopHit, true);
    assert.equal(allowedFor([trade(1, -1)], "A+"), 0);
  });

  it("hits the daily stop after four B losses", () => {
    const four = [trade(0.25, -1), trade(0.25, -1), trade(0.25, -1), trade(0.25, -1)];
    assert.equal(dayBudget(four, DAY, L).stopHit, true);
    assert.equal(allowedFor(four, "B"), 0);
  });

  it("counts an open trade's risk against the budget", () => {
    const b = dayBudget([trade(0.5, null)], DAY, L);
    assert.equal(b.openRisk, 0.5);
    assert.equal(allowedFor([trade(0.5, null)], "A+"), 0.5);
  });

  it("never lets a green day raise the cap above 1%", () => {
    assert.equal(allowedFor([trade(1, 2)], "A+"), 1);
  });

  it("ignores skipped setups", () => {
    assert.equal(allowedFor([trade(0, null, { skipped: true, hypotheticalR: -1 })], "A+"), 1);
  });

  it("only counts what had happened by the trade's own time", () => {
    const later = trade(1, -1, { date: `${DAY}T15:00` });
    assert.equal(dayBudget([later], DAY, L, { before: `${DAY}T09:00` }).stopHit, false);
  });
});

describe("flags", () => {
  const fresh = dayBudget([], DAY, L);
  const card = (g: string) => DEFAULT_GRADES.find((c) => c.grade === g)!;

  it("flags risk above the allowance", () => {
    assert.deepEqual(flagsFor({ riskPct: 0.8, allowed: 0.5, card: card("A"), budget: fresh, limits: L }), ["over_risk"]);
  });

  it("flags a grade marked Don't — without also calling it over risk", () => {
    assert.deepEqual(flagsFor({ riskPct: 0.25, allowed: 0, card: card("C"), budget: fresh, limits: L }), [
      "non_traded_grade",
    ]);
  });

  it("flags a trade after the daily stop", () => {
    const hit = dayBudget([trade(1, -1)], DAY, L);
    assert.deepEqual(flagsFor({ riskPct: 0.5, allowed: 0, card: card("A"), budget: hit, limits: L }), [
      "after_daily_stop",
    ]);
  });

  it("still flags going past the 1% cap after the stop", () => {
    const hit = dayBudget([trade(1, -1)], DAY, L);
    assert.deepEqual(flagsFor({ riskPct: 1.5, allowed: 0, card: card("A+"), budget: hit, limits: L }), [
      "after_daily_stop",
      "over_risk",
    ]);
  });

  it("raises nothing inside the lines", () => {
    assert.deepEqual(flagsFor({ riskPct: 1, allowed: 1, card: card("A+"), budget: fresh, limits: L }), []);
  });
});

describe("replaying a day under the rules", () => {
  it("sizes a later A+ at what the earlier A loss left", () => {
    // A at 0.5% loses 1R → -0.5%; A+ then wins 2R at the 0.5% left → +1%.
    const day = [trade(0.5, -1, { date: `${DAY}T04:00` }), trade(1, 2, { date: `${DAY}T09:00` })];
    const risks = new Map([[day[0].id, 0.5], [day[1].id, 1]]);
    assert.equal(replayDay(day, (t) => risks.get(t.id)!, L), 0.5);
  });

  it("takes nothing after the stop", () => {
    const day = [trade(1, -1, { date: `${DAY}T04:00` }), trade(1, 3, { date: `${DAY}T09:00` })];
    assert.equal(replayDay(day, () => 1, L), -1);
  });
});
