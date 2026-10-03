import { useMemo } from "react";
import type { CheckIn } from "@/lib/checkin";
import { buildBriefing, type CoachDesk } from "@/lib/coach";
import type { Trade } from "@/lib/types";
import { Briefing } from "./Briefing";

/** Coach tab: today's live briefing, read against the rulebook. */
export function CoachView({ trades, checkins, desk }: { trades: Trade[]; checkins: CheckIn[]; desk: CoachDesk | null }) {
  const briefing = useMemo(() => buildBriefing(trades, checkins, undefined, desk), [trades, checkins, desk]);
  return <Briefing briefing={briefing} page animate />;
}
