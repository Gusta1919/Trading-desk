/** Shared builders for tests: a trade graded under the rulebook, a plan, the rulebook itself. */
import type { Plan } from "../src/lib/plans";
import type { Rulebook } from "../src/lib/rulebook";
import { defaultRulebook } from "../src/lib/rulebookText";
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

/** A plan for a day, written at a UTC instant (03:30 New York in October is 07:30Z). */
export function plan(date: string, createdAtUtc = `${date}T07:30:00.000Z`): Plan {
  return { date, bias: "bullish", levels: {}, pois: "", deskCheck: "", notes: "", createdAt: createdAtUtc, updatedAt: createdAtUtc };
}

export const doc: Rulebook = defaultRulebook();
export const rulebookOf = () => doc;
