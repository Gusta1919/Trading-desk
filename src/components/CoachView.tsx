import { useMemo, useState } from "react";
import type { CheckIn } from "@/lib/checkin";
import { buildBriefing } from "@/lib/coach";
import type { Limits, Strategy, Trade } from "@/lib/types";
import { Briefing } from "./Briefing";

/** Coach tab: today's live briefing plus a diary of your past reflections. */
export function CoachView({
  trades,
  checkins,
  strategies = [],
  limits,
  compact = false,
}: {
  trades: Trade[];
  checkins: CheckIn[];
  strategies?: Strategy[];
  limits?: Limits | null;
  /** Board mode: top cards only. */
  compact?: boolean;
}) {
  const briefing = useMemo(
    () => buildBriefing(trades, checkins, undefined, strategies, limits),
    [trades, checkins, strategies, limits],
  );
  const [showAll, setShowAll] = useState(false);

  return (
    <Briefing
      briefing={briefing}
      maxCards={compact && !showAll ? 4 : undefined}
      onShowAll={() => setShowAll(true)}
    />
  );
}
