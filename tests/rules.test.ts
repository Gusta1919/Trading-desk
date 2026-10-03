/**
 * The rulebook's exact checks: the entry window's edges, the grade at each factor's
 * boundaries, the time stop, the session from the entry time, and the HTF reason.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGrade } from "../src/lib/grading";
import { BIAS_OPTION, defaultRulebook } from "../src/lib/goldModel";
import { inEntryWindow, pastTimeStop, sessionAt, weekdayOf } from "../src/lib/rules";
import { topHtf } from "../src/lib/types";

const doc = defaultRulebook();
const W = doc.entryWindows;

describe("entry window", () => {
  it("opens at 04:00 and pauses at 08:25", () => {
    assert.equal(inEntryWindow("03:59", W), false);
    assert.equal(inEntryWindow("04:00", W), true);
    assert.equal(inEntryWindow("08:24", W), true);
    assert.equal(inEntryWindow("08:25", W), false);
  });
  it("reopens at 09:30 and takes its last entry at 11:00", () => {
    assert.equal(inEntryWindow("09:29", W), false);
    assert.equal(inEntryWindow("09:30", W), true);
    assert.equal(inEntryWindow("11:00", W), true);
    assert.equal(inEntryWindow("11:01", W), false);
  });
});

describe("weekdays", () => {
  it("reads Monday to Friday from the date itself, and nothing at the weekend", () => {
    assert.equal(weekdayOf("2026-10-05"), "Mon");
    assert.equal(weekdayOf("2026-10-09"), "Fri");
    assert.equal(weekdayOf("2026-10-03"), null);
    assert.equal(weekdayOf("2026-10-04"), null);
  });
});

/** The grade with every factor at its best except the ones given. */
function gradeWith(answers: Record<string, string | number>) {
  const best: Record<string, string | number> = {
    "htf-tf": "htf-4h-plus",
    disp: 1.5,
    bias: BIAS_OPTION.matches,
    compass: 70,
    conviction: "conv-none",
  };
  return computeGrade(doc, { ticked: doc.baseRules.map((r) => r.id), answers: { ...best, ...answers } }).grade;
}

describe("grade boundaries", () => {
  it("puts exactly 0.25 in A and exactly 1.0 in A+ for displacement", () => {
    assert.equal(gradeWith({ disp: 0.2499 }), "B");
    assert.equal(gradeWith({ disp: 0.25 }), "A");
    assert.equal(gradeWith({ disp: 0.9999 }), "A");
    assert.equal(gradeWith({ disp: 1 }), "A+");
  });

  it("puts a Compass of exactly 60% above the cut", () => {
    assert.equal(gradeWith({ compass: 59.9 }), "B");
    assert.equal(gradeWith({ compass: 60 }), "A+");
  });

  it("caps an unclear bias at B and a bias against the trade at C", () => {
    assert.equal(gradeWith({ bias: BIAS_OPTION.unclear }), "B");
    assert.equal(gradeWith({ bias: BIAS_OPTION.against }), "C");
  });

  it("caps a 1H HTF reason at A", () => {
    assert.equal(gradeWith({ "htf-tf": "htf-1h" }), "A");
  });
});

describe("time stop and sessions", () => {
  it("flags an exit after 12:00 or on another day", () => {
    assert.equal(pastTimeStop("2026-10-05T04:30", "2026-10-05T12:00", "12:00"), false);
    assert.equal(pastTimeStop("2026-10-05T04:30", "2026-10-05T12:01", "12:00"), true);
    assert.equal(pastTimeStop("2026-10-05T04:30", "2026-10-06T03:00", "12:00"), true);
    assert.equal(pastTimeStop("2026-10-05T04:30", "", "12:00"), false);
  });
  it("names the session from the entry time", () => {
    assert.equal(sessionAt("04:30"), "London");
    assert.equal(sessionAt("07:59"), "London");
    assert.equal(sessionAt("08:00"), "New York");
    assert.equal(sessionAt("09:45"), "New York");
    assert.equal(sessionAt("02:00"), "Asia");
  });
});

describe("the HTF reason that counts", () => {
  it("is the one on the highest timeframe; a tie goes FVG, OB, VIMB", () => {
    assert.equal(topHtf([]), null);
    assert.deepEqual(topHtf([{ type: "FVG", tf: "1H" }, { type: "OB", tf: "4H" }]), { type: "OB", tf: "4H" });
    assert.deepEqual(topHtf([{ type: "VIMB", tf: "W" }, { type: "FVG", tf: "D" }]), { type: "VIMB", tf: "W" });
    assert.deepEqual(topHtf([{ type: "VIMB", tf: "4H" }, { type: "FVG", tf: "4H" }]), { type: "FVG", tf: "4H" });
  });
});
