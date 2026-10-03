import { VERDICTS, type Verdict } from "@/lib/checkin";
import { cx, useCountUp } from "./ui";

/** The check-in's colours: cleared is green, stand down is red. */
export const verdictColor: Record<Verdict, string> = { ready: "text-up", "sit-out": "text-down" };
export const verdictBg: Record<Verdict, string> = { ready: "bg-up", "sit-out": "bg-down" };

/**
 * Today's readiness in the top bar: the verdict, a meter out of 100 and the number,
 * in the verdict's own colour. A read-out; clicking it redoes the check-in.
 */
export function ReadinessMeter({ score, verdict }: { score: number; verdict: Verdict }) {
  const value = useCountUp(score, 1200) ?? 0;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span className="flex items-center gap-2">
      <span className={cx("font-medium", verdictColor[verdict])}>{VERDICTS[verdict].label}</span>
      <span className="hidden h-[5px] w-12 overflow-hidden rounded-full bg-subtle 2xl:block">
        <span className={cx("block h-full rounded-full bg-current", verdictColor[verdict])} style={{ width: `${pct}%`, boxShadow: "0 0 8px currentColor" }} />
      </span>
      <span className="num text-faint">
        {Math.round(value)}
        <span className="opacity-50">/100</span>
      </span>
    </span>
  );
}
