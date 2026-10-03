import { useMemo, useState } from "react";
import type { CheckIn } from "@/lib/checkin";
import { buildBriefing, type CoachDesk } from "@/lib/coach";
import type { Trade } from "@/lib/types";
import { Briefing } from "./Briefing";

/** Coach tab: today's live briefing, read against the rulebook. */
export function CoachView({
  trades,
  checkins,
  desk,
  compact = false,
}: {
  trades: Trade[];
  checkins: CheckIn[];
  desk: CoachDesk | null;
  /** Board mode: top cards only. */
  compact?: boolean;
}) {
  const briefing = useMemo(() => buildBriefing(trades, checkins, undefined, desk), [trades, checkins, desk]);
  const [showAll, setShowAll] = useState(false);

  return (
    <Briefing
      briefing={briefing}
      maxCards={compact && !showAll ? 4 : undefined}
      onShowAll={() => setShowAll(true)}
    />
  );
}
