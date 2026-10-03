/**
 * Allowed risk = min(grade risk, remaining daily and weekly budget, max risk per trade),
 * and replaying a day under the rules.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedRisk, dayBudget, gradeRisk, replayDay, replayDayDetailed } from "../src/lib/risk";
import type { Definition, GradeCard, Trade } from "../src/lib/types";
import { ruledTrade } from "./fixtures";

/** The ladder these tests reason with: A+ 1 · A 0.5 · B 0.25 · C not traded. */
const DEFAULT_GRADES: GradeCard[] = [
  { grade: "A+", riskPct: 1, traded: true, description: "" },
  { grade: "A", riskPct: 0.5, traded: true, description: "" },
  { grade: "B", riskPct: 0.25, traded: true, description: "" },
  { grade: "C", riskPct: 0, traded: false, description: "" },
];

const L = { maxRiskPct: 1, dailyStopPct: 1 };
const DAY = "2026-10-01";
const ladder: Pick<Definition, "grades"> = { grades: DEFAULT_GRADES }; // A+ 1 · A 0.5 · B 0.25 · C don't

let n = 0;
/** A trade on DAY: risk in %, result in R (null = still open). */
function trade(riskPct: number, resultR: number | null, extra: Partial<Trade> = {}): Trade {
  n++;
  return ruledTrade(`${DAY}T0${Math.min(n, 9)}:00`, { riskPct, resultR, grade: "", session: "", ...extra });
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

describe("replaying under the rulebook's caps", () => {
  it("takes only the day's first trade under the one-trade rule", () => {
    const day = [trade(0.5, 1, { date: `${DAY}T04:30` }), trade(0.5, 2, { date: `${DAY}T09:45` })];
    const r = replayDayDetailed(day, () => 0.5, { ...L, weeklyStopPct: 2 }, { maxTrades: 1 });
    assert.equal(r.net, 0.5);
    assert.deepEqual(r.sized.map((s) => [s.risk, s.overTrades]), [[0.5, false], [0, true]]);
  });

  it("stops at what is left of the weekly stop", () => {
    // The week has lost 1.75% already: of a 2% weekly stop, 0.25% is left for the day.
    const day = [trade(0.5, -1, { date: `${DAY}T04:30` })];
    const r = replayDayDetailed(day, () => 0.5, { ...L, weeklyStopPct: 2 }, { weekNetBefore: -1.75 });
    assert.equal(r.sized[0].risk, 0.25);
    assert.equal(r.net, -0.25);
  });
});
