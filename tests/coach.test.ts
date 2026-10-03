/**
 * The Coach under the new rules: what it says on real-shaped days, and that it never
 * falls back on advice the rules no longer have ("half size", "positions a day").
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goldModelDefinition } from "../server/migrate";
import { buildBriefing } from "../src/lib/coach";
import { computeGrade } from "../src/lib/grading";
import { allowedRisk, dayBudget, flagsFor, gradeCard, gradeRisk } from "../src/lib/risk";
import { deskDay } from "../src/lib/tz";
import { DEFAULT_LIMITS, type ChoiceFactor, type Strategy, type Trade, type TradeFlag } from "../src/lib/types";

const gold = {
  id: "gold",
  name: "GOLD Model",
  ...(goldModelDefinition() as object),
  boxUnit: "points",
  boxMin: null,
  boxMax: null,
  createdAt: "",
  updatedAt: "",
} as unknown as Strategy;

const NOW = new Date("2026-10-01T14:00:00Z"); // 10:00 in New York
const TODAY = deskDay(NOW);

let n = 0;
function trade(date: string, grade: string, riskPct: number, resultR: number | null, flags: TradeFlag[] = [], extra: Partial<Trade> = {}): Trade {
  n++;
  return {
    id: `t${n}`,
    date,
    symbol: "XAUUSD",
    direction: "long",
    session: "New York",
    setup: "",
    strategyId: "gold",
    htf: "",
    entryModel: "",
    riskPct,
    plannedRiskPct: riskPct,
    plannedRR: 2,
    resultR,
    followedPlan: true,
    grade,
    emotion: 2,
    mistakes: [],
    checklist: [],
    checklistTotal: 0,
    setupSnapshot: null,
    flags,
    flagNote: "",
    skipped: false,
    hypotheticalR: null,
    costPct: null,
    boxSize: null,
    pnlUsd: null,
    news: [],
    notes: "",
    screenshot: "",
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

const brief = (trades: Trade[]) => buildBriefing(trades, [], NOW, [gold], DEFAULT_LIMITS);
const card = (trades: Trade[], id: string) => brief(trades).cards.find((c) => c.id === id);
const allText = (trades: Trade[]) =>
  brief(trades)
    .cards.map((c) => `${c.title} ${c.body} ${c.stat ?? ""} ${c.why ?? ""}`)
    .join(" ")
    .toLowerCase();

describe("Coach — today against the daily budget", () => {
  it("after an A loss, quotes what each grade may still risk", () => {
    const c = card([trade(`${TODAY}T04:30`, "A", 0.5, -1)], "budget");
    assert.ok(c, "expected a budget card");
    assert.match(c!.title, /0\.5% of your 1% budget left/);
    assert.match(c!.body, /A\+ 0\.5% · A 0\.5% · B 0\.25%/);
  });

  it("after an A+ loss, says the desk is closed", () => {
    const b = brief([trade(`${TODAY}T04:30`, "A+", 1, -1)]);
    assert.ok(b.cards.some((c) => c.id === "stop-hit"));
    assert.equal(b.headline, "Daily stop hit. The desk reopens tomorrow.");
  });

  it("after four B losses, says the desk is closed", () => {
    const four = [4, 5, 6, 7].map((h) => trade(`${TODAY}T0${h}:00`, "B", 0.25, -1));
    assert.ok(card(four, "stop-hit"));
  });

  it("raises the alarm for a trade taken after the stop", () => {
    const b = brief([
      trade(`${TODAY}T04:30`, "A+", 1, -1),
      trade(`${TODAY}T09:00`, "A", 0.5, -1, ["after_daily_stop"]),
    ]);
    assert.equal(b.cards[0].id, "after-stop");
    assert.equal(b.tone, "alert");
    assert.equal(b.headline, "Past your daily stop. Close the desk now.");
  });

  it("calls a crossed line out on the day it happens", () => {
    const c = card([trade(`${TODAY}T04:30`, "A", 0.8, 1, ["over_risk"], { flagNote: "felt sure" })], "flags-today");
    assert.ok(c);
    assert.match(c!.body, /felt sure/);
  });

  it("on a green day, keeps the bar at A or better", () => {
    const b = brief([trade(`${TODAY}T04:30`, "A+", 1, 2)]);
    assert.ok(b.cards.some((c) => c.id === "green-day"));
    assert.equal(b.tone, "good");
  });

  it("with a trade open, counts its risk against the budget", () => {
    const c = card([trade(`${TODAY}T04:30`, "A", 0.5, null)], "open");
    assert.match(c!.body, /0\.5% risk is already counted.*0\.5% is left/);
  });
});

describe("Coach — no advice from the old rules", () => {
  it("never mentions half size, reduced risk or positions a day", () => {
    const history: Trade[] = [];
    // 3 wins in a row, a check-in-free history, and a flagged over-risk trade.
    for (let d = 1; d <= 9; d++) history.push(trade(`2026-09-0${d}T04:30`, "A", 0.5, d % 3 === 0 ? -1 : 1.5));
    history.push(trade(`2026-09-10T04:30`, "A+", 1.2, 2, ["over_risk"]));
    const text = allText([...history, trade(`${TODAY}T04:30`, "A", 0.5, -1)]);
    for (const banned of ["half size", "half your", "half risk", "reduced risk", "positions a day", "position a day"]) {
      assert.ok(!text.includes(banned), `found "${banned}"`);
    }
  });
});

describe("Coach — the ladder", () => {
  it("says so when a traded grade loses money", () => {
    const history = Array.from({ length: 12 }, (_, i) =>
      trade(`2026-08-${String(i + 1).padStart(2, "0")}T04:30`, "B", 0.25, i % 4 === 0 ? 1 : -1),
    );
    const c = card(history, "ladder-gold");
    assert.ok(c);
    assert.match(c!.title, /B setups in GOLD Model are losing money/);
    assert.match(c!.body, /switching B to Don't/);
  });

  it("keeps skipped setups out of every result", () => {
    const skipped = trade(`${TODAY}T04:30`, "C", 0, null, [], { skipped: true, hypotheticalR: 3 });
    const b = brief([skipped]);
    assert.ok(!b.cards.some((c) => ["open", "green-day", "budget", "stop-hit"].includes(c.id)));
  });
});

describe("Coach — a long, realistic history runs cleanly", () => {
  it("builds a briefing over 60 graded trades with snapshots, flags and skips", () => {
    const def = gold;
    const f = (name: string) => def.factors.find((x) => x.name === name)!;
    const opt = (name: string, i: number) => (f(name) as ChoiceFactor).options[i % (f(name) as ChoiceFactor).options.length].id;
    const trades: Trade[] = [];
    for (let i = 0; i < 60; i++) {
      const day = `2026-${String(6 + Math.floor(i / 20)).padStart(2, "0")}-${String((i % 20) + 1).padStart(2, "0")}`;
      const answers = {
        [f("HTF reason timeframe").id]: opt("HTF reason timeframe", i),
        [f("Entry model").id]: opt("Entry model", i + 1),
        [f("Displacement").id]: opt("Displacement", i),
        [f("Daily bias").id]: opt("Daily bias", i % 5 ? 0 : 1),
        [f("Compass probability").id]: 50 + ((i * 7) % 30),
        [f("Conviction").id]: opt("Conviction", i % 7 ? 0 : 1),
      };
      const ticked = def.baseRules.map((r) => r.id);
      const g = computeGrade(def, { ticked, answers }).grade;
      const budget = dayBudget(trades, day, DEFAULT_LIMITS);
      const allowed = allowedRisk(gradeRisk(def, g), budget, DEFAULT_LIMITS);
      const skipped = !gradeCard(def, g)!.traded;
      const risk = skipped ? 0 : allowed;
      const r = ((i * 37) % 11) / 3 - 1.2;
      trades.push(
        trade(`${day}T04:30`, g, risk, skipped ? null : r, skipped ? [] : flagsFor({ riskPct: risk, allowed, card: gradeCard(def, g), budget, limits: DEFAULT_LIMITS }), {
          skipped,
          hypotheticalR: skipped ? r : null,
          plannedRiskPct: skipped ? null : allowed,
          checklist: ticked,
          checklistTotal: ticked.length,
          setupSnapshot: { strategyName: def.name, baseRules: def.baseRules, factors: def.factors, grades: def.grades, ticked, answers, grade: g },
        }),
      );
    }
    const b = brief(trades);
    assert.ok(b.cards.length > 0);
    assert.ok(b.headline.length > 0);
    for (const c of b.cards) assert.ok(!/undefined|NaN/.test(`${c.title} ${c.body} ${c.stat ?? ""}`), c.id);
  });
});
