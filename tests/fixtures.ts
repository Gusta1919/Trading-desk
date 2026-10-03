/** Shared builders for tests: a trade graded under the rulebook, and the rulebook itself (v1.3). */
import type { Rulebook } from "../src/lib/rulebook";
import { PLAN_RETIRED_VERSION, defaultRulebook, retirePlan } from "../src/lib/rulebookText";
import { EMPTY_RULEBOOK_FIELDS, type Trade } from "../src/lib/types";

let n = 0;

/** A taken A+ trade at 0.5%, graded under v1.2, closed at −1R unless told otherwise. */
export function ruledTrade(date: string, extra: Partial<Trade> = {}): Trade {
  n++;
  return {
    id: `r${n}`,
    date,
    symbol: "XAUUSD",
    direction: "long",
    session: "London",
    setup: "",
    strategyId: null,
    htf: "",
    entryModel: "",
    riskPct: 0.5,
    plannedRiskPct: null,
    plannedRR: 2,
    resultR: -1,
    followedPlan: true,
    grade: "A+",
    emotion: null,
    mistakes: [],
    checklist: [],
    checklistTotal: 9,
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
    ...EMPTY_RULEBOOK_FIELDS,
    rulebookVersion: "1.2",
    entryPrice: 2000,
    stopPrice: 1996,
    targetPrice: 2008,
    createdAt: `${date}:00Z${String(n).padStart(4, "0")}`,
    updatedAt: "",
    ...extra,
  };
}

export const doc: Rulebook = { ...retirePlan(defaultRulebook()), version: PLAN_RETIRED_VERSION };
export const rulebookOf = () => doc;
