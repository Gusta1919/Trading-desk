/**
 * Discipline: every flag in the rulebook, the weekly budget, and the one consequence —
 * the rest of the day and the next trading day off — worked out over the history,
 * including how it heals when a trade is deleted.
 *
 * October 2026 is EDT (UTC−4): 03:30 New York is 07:30Z, 04:30 New York is 08:30Z.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoRuleState, deskStatus, evaluateHistory, judgeDraft, nextTradingDays } from "../src/lib/discipline";
import { weekBudget } from "../src/lib/risk";
import type { Trade, TradeNews } from "../src/lib/types";
import { doc, rulebookOf, ruledTrade } from "./fixtures";

const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const THU = "2026-10-08";
const FRI = "2026-10-09";
const NEXT_MON = "2026-10-12";
const LATE = new Date("2026-10-20T12:00:00Z");

function judge(trades: Trade[], extra: { checkins?: { date: string; verdict: "ready" | "sit-out" }[]; now?: Date } = {}) {
  return evaluateHistory({ trades, checkins: extra.checkins ?? [], rulebookOf, now: extra.now ?? LATE });
}
const flagsOf = (trades: Trade[], t: Trade, extra = {}) => judge(trades, extra).byId.get(t.id)!.flags;

describe("a clean trade", () => {
  it("raises nothing", () => {
    const t = ruledTrade(`${MON}T04:30`, { exitTime: `${MON}T06:00`, exitReason: "stop" });
    assert.deepEqual(flagsOf([t], t), []);
  });
});

describe("flags", () => {
  it("a second trade the same day", () => {
    const a = ruledTrade(`${MON}T04:30`);
    const b = ruledTrade(`${MON}T09:45`);
    assert.deepEqual(flagsOf([a, b], b), ["second_trade_today"]);
  });

  it("an entry in the pause: the window rule unticked makes it a C, which isn't tradable", () => {
    const t = ruledTrade(`${MON}T08:40`, { grade: "C" });
    assert.deepEqual(flagsOf([t], t), ["non_traded_grade"]);
  });

  it("a skip day and a release window, from the trade's own saved news", () => {
    const nfp: TradeNews = { title: "Non-Farm Employment Change", currency: "USD", impact: "High", time: "08:30" };
    const adp: TradeNews = { title: "ADP Non-Farm Employment Change", currency: "USD", impact: "High", time: "08:15" };
    const a = ruledTrade(`${FRI}T04:30`, { news: [nfp] });
    assert.ok(flagsOf([a], a).includes("skip_day"));
    const b = ruledTrade(`${WED}T08:12`, { news: [adp] });
    assert.ok(flagsOf([b], b).includes("in_release_window"));
    const c = ruledTrade(`${WED}T08:09`, { news: [adp] });
    assert.ok(!flagsOf([c], c).includes("in_release_window"));
  });

  it("holding through a release without breakeven", () => {
    const adp: TradeNews = { title: "ADP Non-Farm Employment Change", currency: "USD", impact: "High", time: "08:15" };
    const held = (exit: string, releaseAtBe: boolean | null) => {
      const t = ruledTrade(`${WED}T04:30`, { news: [adp], exitTime: `${WED}T${exit}`, releaseAtBe });
      return flagsOf([t], t).includes("held_risk_through_release");
    };
    assert.equal(held("08:09", null), false); // closed before T−5
    assert.equal(held("08:10", null), false); // closed at T−5: allowed
    assert.equal(held("08:11", false), true);
    assert.equal(held("09:00", true), false); // stop at breakeven: allowed
    assert.equal(held("09:00", null), true); // unanswered counts as not at breakeven
  });

  it("the time stop, discretionary exits and early stop moves", () => {
    const late = ruledTrade(`${MON}T04:30`, { exitTime: `${MON}T12:05` });
    assert.ok(flagsOf([late], late).includes("past_time_stop"));
    const open = ruledTrade(`${MON}T04:30`, { resultR: null });
    assert.ok(flagsOf([open], open, { now: new Date(`${MON}T16:30:00Z`) }).includes("past_time_stop")); // 12:30 NY
    assert.ok(!flagsOf([open], open, { now: new Date(`${MON}T15:30:00Z`) }).includes("past_time_stop")); // 11:30 NY
    const other = ruledTrade(`${MON}T04:30`, { exitReason: "other", earlyStopMove: true });
    assert.deepEqual(
      flagsOf([other], other).filter((f) => f === "discretionary_exit" || f === "early_stop_move"),
      ["discretionary_exit", "early_stop_move"],
    );
  });

  it("B and C are never tradable", () => {
    const b = ruledTrade(`${MON}T04:30`, { grade: "B" });
    assert.deepEqual(flagsOf([b], b), ["non_traded_grade"]);
    const a = ruledTrade(`${MON}T04:30`, { grade: "A" });
    assert.deepEqual(flagsOf([a], a), []);
  });

  it("a stand-down check-in closes the day, even for an A+", () => {
    const top = ruledTrade(`${MON}T04:30`, { grade: "A+" });
    assert.deepEqual(flagsOf([top], top, { checkins: [{ date: MON, verdict: "sit-out" }] }), ["traded_on_stand_down"]);
    assert.deepEqual(flagsOf([top], top, { checkins: [{ date: MON, verdict: "ready" }] }), []);
    assert.equal(judge([top], { checkins: [{ date: MON, verdict: "sit-out" }] }).byId.get(top.id)!.allowed, 0);
  });

  it("over risk: above the 0.5% cap", () => {
    const t = ruledTrade(`${MON}T04:30`, { riskPct: 0.75 });
    assert.ok(flagsOf([t], t).includes("over_risk"));
  });

  it("re-derives every flag from the trade itself, whatever it was saved with", () => {
    const t = ruledTrade(`${MON}T04:30`, { flags: ["over_risk"] });
    assert.deepEqual(flagsOf([t], t), []);
  });
});

describe("the weekly budget", () => {
  it("is the weekly stop minus the week's net loss and open risk", () => {
    const trades = [ruledTrade(`${MON}T04:30`), ruledTrade(`${TUE}T04:30`), ruledTrade(`${WED}T04:30`, { resultR: null })];
    const b = weekBudget(trades, THU, doc.limits);
    assert.equal(b.lossToday, 1);
    assert.equal(b.openRisk, 0.5);
    assert.equal(b.remaining, 0.5);
    assert.equal(b.stopHit, false);
  });

  it("four losses at 0.5% hit the −2% weekly stop", () => {
    const losses = [MON, TUE, WED, THU].map((d) => ruledTrade(`${d}T04:30`));
    const fri = ruledTrade(`${FRI}T04:30`);
    const j = judge([...losses, fri]);
    assert.ok(j.byId.get(fri.id)!.flags.includes("after_weekly_stop"));
    assert.equal(j.byId.get(fri.id)!.allowed, 0);
    // Trading past the stop is a break: the rest of Friday, and the next trading day.
    assert.deepEqual(j.timeline.dayOff.get(NEXT_MON), { reason: "days-off", from: FRI, until: NEXT_MON });
    assert.equal(j.timeline.dayOff.get("2026-10-13"), undefined);
  });
});

describe("the consequence", () => {
  it("any rule break: the rest of the day off", () => {
    const a = ruledTrade(`${MON}T04:30`, { exitReason: "other" });
    const j = judge([a]);
    assert.equal(j.timeline.dayOff.get(MON)?.reason, "rule-break");
  });

  it("then the next trading day, skipping the weekend", () => {
    assert.deepEqual(nextTradingDays(FRI, 1), [NEXT_MON]);
    const a = ruledTrade(`${MON}T04:30`);
    const b = ruledTrade(`${MON}T09:45`);
    const c = ruledTrade(`${TUE}T04:30`);
    const j = judge([a, b, c]);
    assert.ok(j.byId.get(b.id)!.flags.includes("second_trade_today"));
    assert.deepEqual(j.timeline.dayOff.get(TUE), { reason: "days-off", from: MON, until: TUE });
    assert.ok(j.byId.get(c.id)!.flags.includes("during_day_off"));
    assert.equal(j.byId.get(c.id)!.allowed, 0);
    // Trading on the day off is a break of its own: it costs the day after it too.
    assert.deepEqual(j.timeline.dayOff.get(WED), { reason: "days-off", from: TUE, until: WED });
    assert.equal(judge([a, b]).timeline.dayOff.get(WED), undefined);
  });

  it("takes as many days as the rulebook says", () => {
    const two = { ...doc, daysOff: 2 };
    const a = ruledTrade(`${MON}T04:30`, { exitReason: "other" });
    const j = evaluateHistory({ trades: [a], checkins: [], rulebookOf: () => two, now: LATE });
    assert.deepEqual(j.timeline.dayOff.get(TUE), { reason: "days-off", from: MON, until: WED });
    assert.deepEqual(j.timeline.dayOff.get(WED), { reason: "days-off", from: MON, until: WED });
  });

  it("never halves a later week: risk is back to normal after the day off", () => {
    const a = ruledTrade(`${MON}T04:30`, { exitReason: "other" });
    const b = ruledTrade(`${WED}T04:30`, { exitReason: "other" });
    const full = ruledTrade(`${NEXT_MON}T04:30`, { riskPct: 0.5, resultR: 1 });
    const j = judge([a, b, full]);
    assert.deepEqual(j.byId.get(full.id)!.flags, []);
    assert.equal(j.byId.get(full.id)!.allowed, 0.5);
  });

  it("heals when the trade that caused it is deleted", () => {
    const a = ruledTrade(`${MON}T04:30`);
    const b = ruledTrade(`${MON}T09:45`);
    const c = ruledTrade(`${TUE}T04:30`);
    assert.deepEqual(judge([b, c]).byId.get(b.id)!.flags, []);
    assert.deepEqual(judge([b, c]).byId.get(c.id)!.flags, []);
    assert.ok(judge([a, b, c]).byId.get(c.id)!.flags.length > 0);
  });

  it("ignores setups that were not taken", () => {
    const skipped = ruledTrade(`${MON}T04:30`, { skipped: true, riskPct: 0, grade: "B" });
    const real = ruledTrade(`${MON}T05:30`);
    const j = judge([skipped, real]);
    assert.equal(j.byId.has(skipped.id), false);
    assert.deepEqual(j.byId.get(real.id)!.flags, []);
  });

  it("judges a draft against the rest before it is saved", () => {
    const a = ruledTrade(`${MON}T04:30`);
    const draft = ruledTrade(`${MON}T09:45`);
    const j = judgeDraft(draft, { trades: [a], checkins: [], rulebookOf, now: LATE });
    assert.ok(j.flags.includes("second_trade_today"));
  });
});

describe("today's status", () => {
  const now = new Date(`${TUE}T10:00:00Z`); // 06:00 NY
  it("is done for today after the day's trade closes", () => {
    const s = deskStatus({ trades: [ruledTrade(`${TUE}T04:30`)], checkins: [], rulebookOf, doc, now });
    assert.equal(s.doneForToday, true);
    assert.equal(s.allowedByGrade["A+"], 0);
  });
  it("allows 0.5% on A+ and A, nothing on B, on a fresh day", () => {
    const s = deskStatus({ trades: [], checkins: [], rulebookOf, doc, now });
    assert.deepEqual(s.allowedByGrade, { "A+": 0.5, A: 0.5, B: 0, C: 0 });
    assert.equal(s.blocked, null);
  });
  it("says why nothing is allowed: the weekend, a taken trade, a sit-out check-in", () => {
    const sat = deskStatus({ trades: [], checkins: [], rulebookOf, doc, now: new Date("2026-10-10T14:00:00Z") });
    assert.equal(sat.blocked, "it's the weekend");
    assert.deepEqual(sat.allowedByGrade, { "A+": 0, A: 0, B: 0, C: 0 });
    const taken = deskStatus({ trades: [ruledTrade(`${TUE}T04:30`)], checkins: [], rulebookOf, doc, now });
    assert.equal(taken.blocked, "today's trade is taken");
    const sit = deskStatus({ trades: [], checkins: [{ date: TUE, verdict: "sit-out" }], rulebookOf, doc, now });
    assert.equal(sit.blocked, "the check-in says stand down");
    assert.deepEqual(sit.allowedByGrade, { "A+": 0, A: 0, B: 0, C: 0 });
  });
  it("names the day off after a broken rule", () => {
    const s = deskStatus({ trades: [ruledTrade(`${MON}T04:30`, { exitReason: "other" })], checkins: [], rulebookOf, doc, now });
    assert.equal(s.blocked, "a day off after a broken rule");
    assert.equal(s.dayOff?.until, TUE);
  });
});

describe("automatic base rules", () => {
  const ctx = (date: string, extra = {}) => ({ doc, date, trades: [] as Trade[], news: [], ...extra });
  it("answers the news rule, or hands it back when there is no data", () => {
    assert.equal(autoRuleState("news", ctx(`${MON}T04:30`)), true);
    assert.equal(autoRuleState("news", ctx(`${MON}T04:30`, { news: null })), null);
    assert.equal(autoRuleState("news", ctx("2026-12-23T04:30", { news: null })), false);
    const nfp = [{ title: "Non-Farm Employment Change", currency: "USD", impact: "High", minutes: 510 }];
    assert.equal(autoRuleState("news", ctx(`${FRI}T04:30`, { news: nfp })), false);
  });
  it("closes the budget rule once today's one trade is taken", () => {
    assert.equal(autoRuleState("daily-budget", ctx(`${MON}T09:45`, { trades: [ruledTrade(`${MON}T04:30`, { resultR: 1 })] })), false);
    assert.equal(autoRuleState("daily-budget", ctx(`${MON}T04:30`)), true);
  });
});

describe("today's allowance on a skip day", () => {
  it("is nothing, whatever the grade", () => {
    const now = new Date(`${FRI}T10:00:00Z`);
    const news = { skip: ["US Non-Farm Payrolls"], windows: [] };
    const s = deskStatus({ trades: [], checkins: [], rulebookOf, doc, now, news });
    assert.equal(s.skipDay, true);
    assert.deepEqual(s.allowedByGrade, { "A+": 0, A: 0, B: 0, C: 0 });
  });
});
