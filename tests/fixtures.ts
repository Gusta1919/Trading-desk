/** Shared builders for tests: a trade graded under the rulebook, and the rulebook itself. */
import { FIRST_VERSION, defaultRulebook } from "../src/lib/goldModel";
import type { Rulebook } from "../src/lib/rulebook";
import type { Trade } from "../src/lib/types";

let n = 0;

/** A taken A+ trade at 0.5%, closed at −1R unless told otherwise. */
export function ruledTrade(date: string, extra: Partial<Trade> = {}): Trade {
  n++;
  return {
    id: `r${n}`,
    date,
    symbol: "XAUUSD",
    direction: "long",
    session: "London",
    riskPct: 0.5,
    plannedRiskPct: null,
    plannedRR: 2,
    resultR: -1,
    pnlUsd: null,
    riskUsd: null,
    grade: "A+",
    setupSnapshot: null,
    rulebookVersion: FIRST_VERSION,
    flags: [],
    flagNote: "",
    skipped: false,
    hypotheticalR: null,
    boxSize: null,
    sweepDepth: null,
    took15mSwing: null,
    levelSweep: null,
    htfReasons: [],
    poiTests: "",
    biasMatch: null,
    exitTime: "",
    exitReason: "",
    earlyStopMove: null,
    releaseAtBe: null,
    mfeR: null,
    maeR: null,
    maxFavR: null,
    targetBeforeStop: "",
    emotion: null,
    mistakes: [],
    notes: "",
    screenshot: "",
    screenshotAfter: "",
    news: [],
    createdAt: `${date}:00Z${String(n).padStart(4, "0")}`,
    updatedAt: "",
    ...extra,
  };
}

export const doc: Rulebook = { ...defaultRulebook(), version: FIRST_VERSION };
export const rulebookOf = () => doc;
