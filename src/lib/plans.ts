/**
 * The morning plan: written before the box closes, or there is no trading that day.
 *
 * "On time" rests on when the plan was first written, never on when it was last
 * edited — the server keeps the first time, so fixing a typo at 09:00 cannot turn a
 * 03:40 plan into a late one.
 */
import { deskDay, deskTime } from "./tz";

export type PlanBias = "bullish" | "bearish" | "unclear";
export type DeskCheck = "agree" | "disagree" | "none";

/** The level map, as short free-text fields. */
export const LEVEL_FIELDS = [
  { id: "pdhPdl", label: "PDH / PDL" },
  { id: "pwhPwl", label: "PWH / PWL" },
  { id: "monthly", label: "Monthly H/L" },
  { id: "quarterly", label: "Quarterly H/L" },
  { id: "yearly", label: "Yearly H/L" },
  { id: "ath", label: "ATH" },
  { id: "eqhEql", label: "EQH / EQL" },
] as const;

export interface Plan {
  date: string; // New York day, "YYYY-MM-DD"
  bias: PlanBias | "";
  levels: Record<string, string>;
  pois: string;
  deskCheck: DeskCheck | "";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type PlanInput = Omit<Plan, "createdAt" | "updatedAt">;

/** Whether a plan was written before the deadline ("HH:mm", New York) on its own day. */
export function planOnTime(plan: Pick<Plan, "date" | "createdAt"> | null | undefined, deadline: string): boolean {
  if (!plan?.createdAt) return false;
  const at = new Date(plan.createdAt);
  if (Number.isNaN(at.getTime())) return false;
  const day = deskDay(at);
  // Written on an earlier day counts too: the plan for Tuesday may be written on Monday night.
  if (day < plan.date) return true;
  return day === plan.date && deskTime(at) < deadline;
}

export type PlanStatus = "on-time" | "late" | "missing";

export function planStatus(plan: Plan | null | undefined, deadline: string): PlanStatus {
  if (!plan) return "missing";
  return planOnTime(plan, deadline) ? "on-time" : "late";
}
