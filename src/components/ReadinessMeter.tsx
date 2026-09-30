import { VERDICTS, type Verdict } from "@/lib/checkin";
import { verdictColor } from "./CheckIn";
import { cx, useCountUp } from "./ui";

/**
 * Today's readiness in the header bar: the verdict, a fixed meter out of 100,
 * and the number — all in the verdict's own colour. Not a control; just a read-out.
 */
export function ReadinessMeter({ score, verdict }: { score: number; verdict: Verdict }) {
  const value = useCountUp(score, 1200) ?? 0;
  const pct = Math.max(0, Math.min(100, value));

  return (
    <span className="flex items-center gap-2">
      <span className={cx("font-medium", verdictColor[verdict])}>{VERDICTS[verdict].label}</span>

      <span className="h-[5px] w-16 overflow-hidden rounded-full bg-subtle">
        <span
          className={cx("block h-full rounded-full bg-current", verdictColor[verdict])}
          style={{ width: `${pct}%`, boxShadow: "0 0 8px currentColor" }}
        />
      </span>

      <span className="num text-faint">
        {Math.round(value)}
        <span className="opacity-50">/100</span>
      </span>
    </span>
  );
}
