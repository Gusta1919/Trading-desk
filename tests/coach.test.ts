/**
 * The Coach under the rulebook: one trade a day, the consequences running,
 * the weekly stop — and never the advice of the old rules ("B setups", "half size").
 *
 * 1 October 2026 is a Thursday; October is EDT, so 14:00Z is 10:00 in New York.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBriefing, type CoachDesk } from "../src/lib/coach";
import { BIAS_OPTION } from "../src/lib/rulebookText";
import type { Trade, TradeFlag } from "../src/lib/types";
import { doc, rulebookOf, ruledTrade } from "./fixtures";

const NOW = new Date("2026-10-01T14:00:00Z");
const TODAY = "2026-10-01";
const desk = (): CoachDesk => ({ doc, rulebookOf, news: null });

function trade(date: string, grade: string, resultR: number | null, flags: TradeFlag[] = [], extra: Partial<Trade> = {}): Trade {
  return ruledTrade(date, { grade, resultR, flags, ...extra });
}

const brief = (trades: Trade[], d = desk(), now = NOW) => buildBriefing(trades, [], now, d);
const card = (trades: Trade[], id: string, d = desk()) => brief(trades, d).cards.find((c) => c.id === id);
const allText = (trades: Trade[]) =>
  brief(trades)
    .cards.map((c) => `${c.title} ${c.body} ${c.stat ?? ""} ${c.why ?? ""}`)
    .join(" ")
    .toLowerCase();

describe("Coach — today", () => {
  it("after the day's trade closes, says done for today", () => {
    const b = brief([trade(`${TODAY}T04:30`, "A", -1)]);
    assert.ok(b.cards.some((c) => c.id === "done-today"));
    assert.match(b.headline, /Done for today/);
  });

  it("after a full stop, says the desk is closed", () => {
    const b = brief([trade(`${TODAY}T04:30`, "A+", -2)]);
    assert.ok(b.cards.some((c) => c.id === "stop-hit"));
    assert.equal(b.headline, "Daily stop hit. The desk reopens tomorrow.");
  });

  it("raises the alarm for a trade taken after the stop", () => {
    const b = brief([trade(`${TODAY}T04:30`, "A+", -2), trade(`${TODAY}T09:45`, "A", -1, ["after_daily_stop"])]);
    assert.equal(b.cards[0].id, "after-stop");
    assert.equal(b.tone, "alert");
  });

  it("calls a crossed line out on the day it happens", () => {
    const c = card([trade(`${TODAY}T04:30`, "A", 1, ["over_risk"], { flagNote: "felt sure" })], "flags-today");
    assert.ok(c);
    assert.match(c!.body, /felt sure/);
  });

  it("with a trade open, counts its risk against the day and the week", () => {
    const c = card([trade(`${TODAY}T04:30`, "A", null)], "open");
    assert.match(c!.body, /already counted against today's and this week's budgets/);
  });

  it("near 12:00 with a trade open, says close it", () => {
    const at1140 = new Date("2026-10-01T15:40:00Z");
    const b = brief([trade(`${TODAY}T04:30`, "A", null)], desk(), at1140);
    assert.equal(b.cards[0].id, "time-stop");
  });
});

describe("Coach — the rulebook's consequences", () => {
  it("never asks for a written plan — retired in v1.3", () => {
    assert.ok(!card([], "no-plan"));
    assert.ok(!card([], "plan-due"));
  });

  it("says day off after a second trade, until the days off end", () => {
    const yesterday = "2026-09-30";
    const trades = [trade(`${yesterday}T04:30`, "A", 1), trade(`${yesterday}T09:45`, "A", -1, ["second_trade_today"])];
    const c = card(trades, "day-off", desk());
    assert.ok(c);
    assert.match(c!.title, /until 2026-10-02/);
  });

  it("warns of a half-risk week after two breaks last week", () => {
    // Flags on rulebook trades are always re-derived from the trade itself: an "other" exit is a discretionary one.
    const last = [trade("2026-09-21T04:30", "A", 1, [], { exitReason: "other" }), trade("2026-09-23T04:30", "A", 1, [], { exitReason: "other" })];
    assert.ok(card(last, "half-risk", desk()));
  });

  it("says the weekly stop is hit after four losses", () => {
    const week = ["2026-09-28", "2026-09-29", "2026-09-30"].map((d) => trade(`${d}T04:30`, "A", -1));
    week.push(trade("2026-10-01T04:30", "A", -1));
    assert.ok(card(week, "week-stop", desk()));
  });

  it("reports this week's rule adherence when a rule was broken", () => {
    const c = card([trade("2026-09-29T04:30", "A", 1, ["early_stop_move"])], "adherence", desk());
    assert.ok(c);
    assert.match(c!.title, /0%/);
  });
});

describe("Coach — no advice from the old rules", () => {
  it("never mentions B setups, half size or positions a day", () => {
    const history: Trade[] = [];
    for (let d = 1; d <= 9; d++) history.push(trade(`2026-09-0${d}T04:30`, "A", d % 3 === 0 ? -1 : 1.5));
    history.push(trade(`2026-09-10T04:30`, "A+", 2, ["over_risk"]));
    const text = allText([...history, trade(`${TODAY}T04:30`, "A", -1)]);
    for (const banned of ["half size", "half your", "b setups", "skip b", "positions a day", "position a day", "strategies"]) {
      assert.ok(!text.includes(banned), `found "${banned}"`);
    }
  });
});

describe("Coach — the ladder", () => {
  it("says so when A loses money", () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      trade(`2026-08-${String(i + 1).padStart(2, "0")}T04:30`, "A", i % 4 === 0 ? 1 : -1),
    );
    const c = card(history, "ladder-a");
    assert.ok(c);
    assert.match(c!.title, /A setups are losing money/);
  });

  it("keeps A+ at 0.5% until it beats A by enough over enough trades", () => {
    const mk = (g: string, r: number, i: number) => trade(`2026-0${7 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}T04:30`, g, r);
    const close = [...Array.from({ length: 26 }, (_, i) => mk("A+", 0.5, i)), ...Array.from({ length: 26 }, (_, i) => mk("A", 0.4, i + 26))];
    assert.match(card(close, "a-plus-risk")!.title, /stays at 0\.5%/);
    const clear = [...Array.from({ length: 26 }, (_, i) => mk("A+", 1, i)), ...Array.from({ length: 26 }, (_, i) => mk("A", 0.4, i + 26))];
    assert.match(card(clear, "a-plus-risk")!.title, /earned 1%/);
  });

  it("keeps skipped setups out of every result", () => {
    const skipped = trade(`${TODAY}T04:30`, "B", null, [], { skipped: true, hypotheticalR: 3, riskPct: 0 });
    const b = brief([skipped]);
    assert.ok(!b.cards.some((c) => ["open", "done-today", "stop-hit"].includes(c.id)));
  });
});

describe("Coach — a long, realistic history runs cleanly", () => {
  it("builds a briefing over 60 graded trades with snapshots, flags and skips", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 60; i++) {
      const day = `2026-${String(6 + Math.floor(i / 20)).padStart(2, "0")}-${String((i % 20) + 1).padStart(2, "0")}`;
      const answers = {
        "htf-tf": i % 3 ? "htf-4h-plus" : "htf-1h",
        disp: (i % 7) / 4,
        fvg: i % 2 ? "fvg-yes" : "fvg-no",
        bias: i % 5 ? BIAS_OPTION.matches : BIAS_OPTION.unclear,
        compass: 50 + ((i * 7) % 30),
        conviction: i % 7 ? "conv-none" : "conv-lacking",
      };
      const ticked = doc.baseRules.map((r) => r.id);
      trades.push(
        trade(`${day}T04:30`, i % 4 ? "A" : "A+", ((i * 37) % 11) / 3 - 1.2, i % 9 ? [] : ["early_stop_move"], {
          checklist: ticked,
          setupSnapshot: { rulebookVersion: "1.2", baseRules: doc.baseRules, factors: doc.factors, grades: doc.grades, ticked, answers, grade: "A" },
          exitReason: i % 3 ? "target" : "stop",
          mfePrice: 2000 + (i % 5),
          sweepDepth: (i * 3) % 40,
          entryType: i % 4 ? "market" : "limit",
        }),
      );
    }
    const b = brief(trades, desk());
    assert.ok(b.cards.length > 0);
    assert.ok(b.headline.length > 0);
    for (const c of b.cards) assert.ok(!/undefined|NaN|\{\{/.test(`${c.title} ${c.body} ${c.stat ?? ""}`), c.id);
  });
});
