/**
 * The Exit lab: which target would have paid best, replayed over trades already taken.
 *
 * It needs the MFE — how far price went in your favour before the exit — and reads it
 * the simple way the rulebook does: a trade reaches X R if its MFE reached X R. That
 * makes every answer approximate (the path inside the trade is unknown), so the lab
 * says so, shows how many trades stand behind each row, and stays silent below a
 * minimum sample.
 *
 *  - A smaller target than the trade's own: reached when MFE ≥ X; otherwise the trade
 *    ended as it actually did, since X never came first.
 *  - A bigger target than the one a trade actually hit: known only when the furthest
 *    price until the time stop was logged. Without it the outcome is unknown, and the
 *    trade is left out of that row rather than guessed.
 *  - Breakeven at 1R: a losing trade whose MFE reached 1R is scored 0R.
 */
import { excursions, priceR } from "./rules";
import { isClosed } from "./stats";
import type { Trade } from "./types";

export interface ExitRow {
  id: string;
  label: string;
  /** Trades the row could score. */
  n: number;
  /** Trades left out because their outcome under this rule is unknown. */
  unknown: number;
  avgR: number | null;
  totalR: number | null;
}

export interface ExitLab {
  /** Taken, closed trades with an MFE logged. */
  n: number;
  enough: boolean;
  rows: ExitRow[];
}

export const EXIT_TARGETS = [1, 1.5, 2, 3];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function exitLab(trades: Trade[], minTrades: number): ExitLab {
  const logged = trades
    .filter((t) => !t.skipped && isClosed(t))
    .map((t) => ({ t, mfe: excursions(t).mfeR }))
    .filter((x): x is { t: Trade; mfe: number } => x.mfe != null);

  const row = (id: string, label: string, score: (x: { t: Trade; mfe: number }) => number | null): ExitRow => {
    const scored = logged.map(score);
    const known = scored.filter((r): r is number => r != null);
    return {
      id,
      label,
      n: known.length,
      unknown: scored.length - known.length,
      avgR: mean(known),
      totalR: known.length ? known.reduce((a, b) => a + b, 0) : null,
    };
  };

  const rows: ExitRow[] = [row("actual", "As traded", ({ t }) => t.resultR!)];
  for (const x of EXIT_TARGETS) {
    rows.push(
      row(`target-${x}`, `${x}R target`, ({ t, mfe }) => {
        if (mfe >= x) return x;
        if (t.exitReason !== "target") return t.resultR!;
        // It hit its own (smaller) target; whether it would have gone on to X is only known from the furthest price.
        const fav = priceR(t.direction, t.entryPrice, t.stopPrice, t.maxFavPrice);
        if (fav == null) return null;
        return fav >= x ? x : null;
      }),
    );
  }
  rows.push(row("be-1r", "Breakeven at 1R", ({ t, mfe }) => (mfe >= 1 && t.resultR! < 0 ? 0 : t.resultR!)));

  return { n: logged.length, enough: logged.length >= minTrades, rows };
}
