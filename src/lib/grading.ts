/**
 * Grades a setup against its strategy's own definition.
 *
 * Nothing here knows about any particular strategy: a base rule, a choice factor
 * and a number factor are all read from the definition passed in. The rule is the
 * same for every strategy — each base rule and each answer caps the best grade the
 * trade can reach, and the final grade is the lowest of those caps.
 */
import {
  GRADES,
  gradeRank,
  type BaseRule,
  type Definition,
  type Factor,
  type Grade,
  type NumberFactor,
} from "./types";

/** What was ticked and answered. Choice answers are option ids; number answers are numbers. */
export interface SetupAnswers {
  ticked: string[];
  answers: Record<string, string | number>;
}

/** One thing that limits the grade. */
export interface Cap {
  source: "rule" | "factor";
  id: string;
  /** "Entry model: BOS 5m", or the text of a missing base rule. */
  label: string;
  cap: Grade;
}

export interface GradeResult {
  /** The lowest cap so far — A+ when nothing limits the setup. */
  grade: Grade;
  /** Every factor has an answer, so the grade is final rather than provisional. */
  complete: boolean;
  missingFactors: Factor[];
  missingRules: BaseRule[];
  /** Every cap below A+ … */
  caps: Cap[];
  /** … and the ones that set the final grade. */
  cappedBy: Cap[];
  /** What the next grade up would need, or null at A+. */
  next: { grade: Grade; needs: string[] } | null;
}

const lower = (a: Grade, b: Grade): Grade => (gradeRank(a) >= gradeRank(b) ? a : b);
const fmtNum = (x: number) => String(Number(x.toFixed(4)));

/* ── Number factors ──────────────────────────────────────────────────── */

/** Which of the factor's ranges a value falls in, 0 = lowest. */
export function rangeIndex(f: NumberFactor, x: number): number {
  for (let i = 0; i < f.cuts.length; i++) {
    const c = f.cuts[i];
    if (x < c.value || (x === c.value && c.lowerGetsIt)) return i;
  }
  return f.cuts.length;
}

/**
 * A range in words: "<55", "55 to 65", ">65 to 70", ">70". A bare number is
 * included; ">" and "<" mark the ends that are not.
 */
export function rangeLabel(f: NumberFactor, i: number): string {
  const lo = i > 0 ? f.cuts[i - 1] : null;
  const hi = i < f.cuts.length ? f.cuts[i] : null;
  if (!lo && !hi) return "any value";
  if (!lo) return `${hi!.lowerGetsIt ? "≤" : "<"}${fmtNum(hi!.value)}`;
  if (!hi) return `${lo.lowerGetsIt ? ">" : "≥"}${fmtNum(lo.value)}`;
  const from = lo.lowerGetsIt ? `>${fmtNum(lo.value)}` : fmtNum(lo.value);
  const to = hi.lowerGetsIt ? fmtNum(hi.value) : `<${fmtNum(hi.value)}`;
  return `${from} to ${to}`;
}

/**
 * A value that sits inside range i — what a range button saves, so the grade, Compare
 * and the Coach keep reading an ordinary number. The middle of a closed range; one
 * unit past the boundary for the open ends.
 */
export function rangeValue(f: NumberFactor, i: number): number {
  const lo = i > 0 ? f.cuts[i - 1].value : null;
  const hi = i < f.cuts.length ? f.cuts[i].value : null;
  if (lo != null && hi != null) return Number(((lo + hi) / 2).toFixed(4));
  if (hi != null) return hi - 1;
  if (lo != null) return lo + 1;
  return 0;
}

/** Problems with a number factor's boundaries, in words. Empty = valid. */
export function numberFactorErrors(f: NumberFactor): string[] {
  const errors: string[] = [];
  if (f.caps.length !== f.cuts.length + 1) errors.push("every range needs a grade");
  f.cuts.forEach((c, i) => {
    if (!Number.isFinite(c.value)) errors.push(`boundary ${i + 1} is not a number`);
    else if (i > 0 && !(c.value > f.cuts[i - 1].value)) {
      errors.push(`boundaries must go up: ${fmtNum(f.cuts[i - 1].value)} then ${fmtNum(c.value)}`);
    }
  });
  return errors;
}

/** Problems anywhere in a definition, for the strategy form. Empty = valid. */
export function definitionErrors(def: Pick<Definition, "baseRules" | "factors">): string[] {
  const errors: string[] = [];
  def.baseRules.forEach((r, i) => {
    if (!r.text.trim()) errors.push(`Base rule ${i + 1} has no text`);
  });
  def.factors.forEach((f, i) => {
    const name = f.name.trim() || `Factor ${i + 1}`;
    if (!f.name.trim()) errors.push(`Factor ${i + 1} has no name`);
    if (f.kind === "choice") {
      if (f.options.length < 2) errors.push(`${name} needs at least two options`);
      if (f.options.some((o) => !o.label.trim())) errors.push(`${name} has an option with no label`);
    } else {
      for (const e of numberFactorErrors(f)) errors.push(`${name}: ${e}`);
    }
  });
  return errors;
}

/* ── Answers ─────────────────────────────────────────────────────────── */

/** The best grade an answer allows, or null when it is unanswered or unknown. */
export function factorCap(f: Factor, answer: string | number | undefined): Grade | null {
  if (answer === undefined || answer === "") return null;
  if (f.kind === "choice") return f.options.find((o) => o.id === answer)?.cap ?? null;
  const x = Number(answer);
  return Number.isFinite(x) ? (f.caps[rangeIndex(f, x)] ?? null) : null;
}

/** An answer in words, e.g. "BOS 5m" or "68 %". */
export function answerLabel(f: Factor, answer: string | number | undefined): string | null {
  if (answer === undefined || answer === "") return null;
  if (f.kind === "choice") return f.options.find((o) => o.id === answer)?.label ?? null;
  // A number reads as its range — what was actually decided — not as the value stored for it.
  const x = Number(answer);
  return Number.isFinite(x) ? withUnit(rangeLabel(f, rangeIndex(f, x)), f.unit) : null;
}

/** "75%" and "$20" sit tight; word units get a space: "12 pts". */
export function withUnit(text: string, unit: string | undefined): string {
  if (!unit) return text;
  return /^[A-Za-z]/.test(unit) ? `${text} ${unit}` : `${text}${unit}`;
}

/**
 * Why a logged setup got its grade, in one short line: what capped it — or, for an
 * A+, that nothing did. Read from the trade's own frozen snapshot.
 */
export function whyGrade(snap: Pick<Definition, "baseRules" | "factors"> & SetupAnswers): string {
  const r = computeGrade(snap, snap);
  if (r.grade === "A+") return r.complete ? "every answer at its best" : "A+ so far";
  return r.cappedBy.map((c) => (c.source === "rule" ? `missing: ${c.label}` : c.label)).join(" · ");
}

/** The answers to a factor that still allow `grade` or better, in words. */
export function answersReaching(f: Factor, grade: Grade): string[] {
  if (f.kind === "choice") {
    return f.options.filter((o) => gradeRank(o.cap) <= gradeRank(grade)).map((o) => o.label);
  }
  return f.caps
    .map((cap, i) => ({ cap, i }))
    .filter(({ cap }) => gradeRank(cap) <= gradeRank(grade))
    .map(({ i }) => rangeLabel(f, i));
}

/** The answers to a factor that cap a setup at exactly `grade`, in words. */
export function answersCappingAt(f: Factor, grade: Grade): string[] {
  if (f.kind === "choice") return f.options.filter((o) => o.cap === grade).map((o) => o.label);
  return f.caps.map((cap, i) => ({ cap, i })).filter(({ cap }) => cap === grade).map(({ i }) => rangeLabel(f, i));
}

const needFor = (f: Factor, grade: Grade) => {
  const ok = answersReaching(f, grade);
  return ok.length ? `${f.name}: ${ok.join(f.kind === "choice" ? " / " : " or ")}` : null;
};

/* ── The grade ───────────────────────────────────────────────────────── */

export function computeGrade(def: Pick<Definition, "baseRules" | "factors">, input: SetupAnswers): GradeResult {
  const ticked = new Set(input.ticked);
  const caps: Cap[] = [];

  const missingRules = def.baseRules.filter((r) => !ticked.has(r.id));
  for (const r of missingRules) caps.push({ source: "rule", id: r.id, label: r.text, cap: "C" });

  const missingFactors: Factor[] = [];
  for (const f of def.factors) {
    const answer = input.answers[f.id];
    const cap = factorCap(f, answer);
    if (cap == null) {
      missingFactors.push(f);
      continue;
    }
    if (cap !== "A+") caps.push({ source: "factor", id: f.id, label: `${f.name}: ${answerLabel(f, answer)}`, cap });
  }

  const grade = caps.reduce<Grade>((g, c) => lower(g, c.cap), "A+");
  const cappedBy = caps.filter((c) => c.cap === grade && grade !== "A+");

  let next: GradeResult["next"] = null;
  if (grade !== "A+") {
    const target = GRADES[gradeRank(grade) - 1];
    const needs: string[] = [];
    // A missing base rule caps at C, so any grade above C needs every rule.
    for (const r of missingRules) needs.push(r.text);
    for (const f of def.factors) {
      const cap = factorCap(f, input.answers[f.id]);
      if (cap != null && gradeRank(cap) > gradeRank(target)) {
        const n = needFor(f, target);
        if (n) needs.push(n);
      }
    }
    next = { grade: target, needs };
  }

  return { grade, complete: missingFactors.length === 0, missingFactors, missingRules, caps, cappedBy, next };
}

/* ── What each rung of the ladder means ──────────────────────────────── */

export interface GradeRequirements {
  /** The minimum each factor must show to reach this grade. */
  requires: string[];
  /** The answers that land a setup exactly on this grade. */
  cappedHere: string[];
}

/**
 * Written from the definition itself, so the ladder can never drift out of step with
 * the rules and factors that actually decide it.
 */
export function gradeRequirements(def: Pick<Definition, "baseRules" | "factors">, grade: Grade): GradeRequirements {
  const requires: string[] = [];
  const cappedHere: string[] = [];
  const rules = def.baseRules.length;

  if (grade === "C") {
    if (rules) cappedHere.push("any base rule missing");
  } else if (rules) {
    requires.push(rules === 1 ? "the base rule" : `all ${rules} base rules`);
  }

  for (const f of def.factors) {
    if (grade !== "C") {
      const n = needFor(f, grade);
      if (n) requires.push(n);
    }
    const here = answersCappingAt(f, grade);
    if (here.length) cappedHere.push(`${f.name}: ${here.join(f.kind === "choice" ? " / " : " or ")}`);
  }
  return { requires, cappedHere };
}

/** One line per rung, for compact places like the strategy card. */
export function gradeOneLiner(def: Pick<Definition, "baseRules" | "factors">, grade: Grade): string {
  const r = gradeRequirements(def, grade);
  if (grade === "A+") return r.requires.length ? r.requires.join(" · ") : "No conditions defined yet";
  return r.cappedHere.length ? `when ${r.cappedHere.join(" · ")}` : "nothing lands here";
}
