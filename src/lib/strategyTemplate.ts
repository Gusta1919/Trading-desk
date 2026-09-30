/**
 * Where new strategies come from: an empty but guided template, or a copy of one
 * you already have. Neither knows anything about a particular strategy.
 */
import { GRADES, type GradeCard, type Strategy, type StrategyInput } from "./types";

export const newId = () => crypto.randomUUID().slice(0, 8);

/** The ladder a new strategy starts with — full, half and quarter size, and C not traded. */
export const DEFAULT_GRADES: GradeCard[] = [
  { grade: "A+", riskPct: 1, traded: true, description: "" },
  { grade: "A", riskPct: 0.5, traded: true, description: "" },
  { grade: "B", riskPct: 0.25, traded: true, description: "" },
  { grade: "C", riskPct: 0, traded: false, description: "" },
];

/** Always four cards in ladder order, whatever was stored. */
export function normalizeGrades(cards: Partial<GradeCard>[] | null | undefined): GradeCard[] {
  return GRADES.map((grade) => {
    const found = cards?.find((c) => c.grade === grade);
    const base = DEFAULT_GRADES.find((d) => d.grade === grade)!;
    return {
      grade,
      riskPct: Number.isFinite(Number(found?.riskPct)) ? Number(found!.riskPct) : base.riskPct,
      traded: typeof found?.traded === "boolean" ? found.traded : base.traded,
      description: typeof found?.description === "string" ? found.description : "",
    };
  });
}

/** An empty strategy: the four grade cards, no rules, no factors. */
export function emptyStrategy(): StrategyInput {
  return {
    name: "",
    instrument: "",
    description: "",
    hoursFrom: "",
    hoursTo: "",
    sessions: [],
    invalidation: "",
    rrFrom: 2,
    rrTo: 3,
    baseRules: [],
    factors: [],
    grades: DEFAULT_GRADES.map((g) => ({ ...g })),
    boxLabel: "",
    boxUnit: "points",
    boxMin: null,
    boxMax: null,
  };
}

/** A full copy to edit into a new strategy. Ids stay: they only have to be unique within one strategy. */
export function duplicateStrategy(s: Strategy | StrategyInput): StrategyInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = s as Strategy;
  const copy = structuredClone(rest) as StrategyInput;
  return { ...copy, name: `${s.name} (copy)` };
}
