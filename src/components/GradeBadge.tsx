import type { Grade } from "@/lib/types";
import { cx } from "./ui";

/** One colour per rung, used everywhere a grade appears. */
export const GRADE_COLOUR: Record<Grade, string> = {
  "A+": "var(--color-up)",
  A: "var(--color-accent-2)",
  B: "var(--color-warn)",
  C: "var(--color-down)",
};

export function GradeBadge({
  grade,
  size = "md",
  muted = false,
}: {
  grade: Grade;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
}) {
  const colour = GRADE_COLOUR[grade];
  return (
    <span
      className={cx(
        "num inline-flex items-center justify-center rounded-md font-semibold",
        size === "sm" && "min-w-[26px] px-1.5 py-0.5 text-caption",
        size === "md" && "min-w-[32px] px-2 py-0.5 text-body",
        size === "lg" && "min-w-[48px] px-2.5 py-1 text-heading",
        muted && "opacity-50",
      )}
      style={{
        color: colour,
        backgroundColor: `color-mix(in oklab, ${colour} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${colour} 35%, transparent)`,
      }}
    >
      {grade}
    </span>
  );
}
