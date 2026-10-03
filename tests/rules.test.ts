/**
 * The rulebook's exact checks: the entry window's edges, the Compass lookup, the
 * displacement multiple at its boundaries, R:R and lots from prices, and MFE/MAE.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeGrade } from "../src/lib/grading";
import { BIAS_OPTION, defaultRulebook } from "../src/lib/rulebookText";
import {
  compassFor,
  displacementMultiple,
  excursions,
  inEntryWindow,
  lotSize,
  pastTimeStop,
  plannedRR,
  sessionAt,
  sweepDepthOf,
  weekdayOf,
} from "../src/lib/rules";

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

describe("Compass lookup", () => {
  it("reads the weekday and direction — long is the low swept first", () => {
    assert.equal(compassFor(doc, "2026-10-05", "short"), 53.8); // Monday
    assert.equal(compassFor(doc, "2026-10-05", "long"), 56.2);
    assert.equal(compassFor(doc, "2026-10-07", "long"), 77.9); // Wednesday
    assert.equal(compassFor(doc, "2026-10-08", "short"), 60.0); // Thursday
  });
  it("has nothing on a weekend, so the form asks by hand", () => {
    assert.equal(weekdayOf("2026-10-03"), null);
    assert.equal(compassFor(doc, "2026-10-04", "long"), null);
  });
});

/** The grade with every factor at its best except the ones given. */
function gradeWith(answers: Record<string, string | number>) {
  const best: Record<string, string | number> = {
    "htf-tf": "htf-4h-plus",
    disp: 1.5,
    fvg: "fvg-yes",
    bias: BIAS_OPTION.matches,
    compass: 70,
    conviction: "conv-none",
  };
  return computeGrade(doc, { ticked: doc.baseRules.map((r) => r.id), answers: { ...best, ...answers } }).grade;
}

describe("displacement", () => {
  it("is the close beyond the swing in ATRs, rounded so the boundary is exact", () => {
    assert.equal(displacementMultiple(1.2, 1.2), 1);
    assert.equal(displacementMultiple(0.3, 1.2), 0.25); // 0.2499999… in floating point
    assert.equal(displacementMultiple(0.2, 1.2), 0.1667);
    assert.equal(displacementMultiple(1, 0), null);
    assert.equal(displacementMultiple(null, 1), null);
  });

  it("puts exactly 0.25 in Normal and exactly 1.0 in Strong", () => {
    assert.equal(gradeWith({ disp: 0.2499 }), "B");
    assert.equal(gradeWith({ disp: 0.25 }), "A");
    assert.equal(gradeWith({ disp: 0.9999 }), "A");
    assert.equal(gradeWith({ disp: 1 }), "A+");
  });

  it("reproduces Strong / Normal / Weak with the two factors under the lowest cap", () => {
    // Strong: ≥1.0 and an FVG left.
    assert.equal(gradeWith({ disp: 1.4, fvg: "fvg-yes" }), "A+");
    // Normal: 0.25–1.0, or ≥1.0 without an FVG.
    assert.equal(gradeWith({ disp: 0.6, fvg: "fvg-yes" }), "A");
    assert.equal(gradeWith({ disp: 0.6, fvg: "fvg-no" }), "A");
    assert.equal(gradeWith({ disp: 1.4, fvg: "fvg-no" }), "A");
    // Weak: below 0.25, FVG or not.
    assert.equal(gradeWith({ disp: 0.1, fvg: "fvg-yes" }), "B");
    assert.equal(gradeWith({ disp: 0.1, fvg: "fvg-no" }), "B");
  });

  it("puts a Compass of exactly 60% above the cut", () => {
    assert.equal(gradeWith({ compass: 59.9 }), "B");
    assert.equal(gradeWith({ compass: 60 }), "A+");
  });
});

describe("prices", () => {
  it("works out planned R:R from entry, stop and target", () => {
    assert.equal(plannedRR(2000, 1996, 2008), 2);
    assert.equal(plannedRR(2650, 2652.5, 2645), 2);
    assert.equal(plannedRR(2000, 2000, 2008), null);
    assert.equal(plannedRR(2000, null, 2008), null);
  });

  it("sizes lots from the $ risk, rounded down to 0.01", () => {
    // $969.67 risk, $4 stop, 100 oz a lot: 2.424… lots → 2.42.
    assert.equal(lotSize(969.67, 2000, 1996, 100), 2.42);
    assert.equal(lotSize(1000, 2000, 1995, 100), 2);
    assert.equal(lotSize(500, 2000, 2000, 100), null);
  });

  it("reads MFE and MAE in R from the initial stop", () => {
    // The brief's example: entry 2,000, stop 1,996, best 2,006 → MFE 1.5R.
    assert.deepEqual(excursions({ direction: "long", entryPrice: 2000, stopPrice: 1996, mfePrice: 2006, maePrice: 1998.4 }), {
      mfeR: 1.5,
      maeR: 0.4,
    });
    assert.deepEqual(excursions({ direction: "short", entryPrice: 2650, stopPrice: 2652, mfePrice: 2646, maePrice: 2651 }), {
      mfeR: 2,
      maeR: 0.5,
    });
  });

  it("measures sweep depth from the swept edge", () => {
    assert.equal(sweepDepthOf("short", 2010, 2000, 2016.5), 6.5);
    assert.equal(sweepDepthOf("long", 2010, 2000, 1991), 9);
    assert.equal(sweepDepthOf("long", 2010, 2000, null), null);
  });
});

describe("time stop and sessions", () => {
  it("flags an exit after 12:00 or on another day", () => {
    assert.equal(pastTimeStop("2026-10-05T04:30", "2026-10-05T12:00", "12:00"), false);
    assert.equal(pastTimeStop("2026-10-05T04:30", "2026-10-05T12:01", "12:00"), true);
    assert.equal(pastTimeStop("2026-10-05T04:30", "2026-10-06T03:00", "12:00"), true);
    assert.equal(pastTimeStop("2026-10-05T04:30", "", "12:00"), false);
  });
  it("names the session from the time", () => {
    assert.equal(sessionAt("04:30"), "London");
    assert.equal(sessionAt("09:45"), "New York");
    assert.equal(sessionAt("02:00"), "Asia");
  });
});
