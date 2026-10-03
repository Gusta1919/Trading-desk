/**
 * Discipline: every flag in the rulebook, the weekly budget, and the consequence
 * ladder worked out over the history — including how it heals when a trade is deleted.
 *
 * October 2026 is EDT (UTC−4): 03:30 New York is 07:30Z, 04:30 New York is 08:30Z.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoRuleState, deskStatus, evaluateHistory, judgeDraft, nextTradingDays } from "../src/lib/discipline";
import { planOnTime } from "../src/lib/plans";
import { weekBudget } from "../src/lib/risk";
import type { Trade, TradeNews } from "../src/lib/types";
import { doc, plan, rulebookOf, ruledTrade } from "./fixtures";

const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const THU = "2026-10-08";
const FRI = "2026-10-09";
const NEXT_MON = "2026-10-12";
const allPlans = [MON, TUE, WED, THU, FRI, NEXT_MON, "2026-10-13", "2026-10-14"].map((d) => plan(d));
const LATE = new Date("2026-10-20T12:00:00Z");

function judge(trades: Trade[], extra: { plans?: typeof allPlans; checkins?: { date: string; verdict: "ready" | "caution" | "sit-out" }[]; now?: Date } = {}) {
  return evaluateHistory({ trades, plans: extra.plans ?? allPlans, checkins: extra.checkins ?? [], rulebookOf, now: extra.now ?? LATE });
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

  it("outside the entry window, at its edges", () => {
    const at = (time: string) => {
      const t = ruledTrade(`${MON}T${time}`);
      return flagsOf([t], t).includes("outside_entry_window");
    };
    assert.equal(at("08:24"), false);
    assert.equal(at("08:25"), true);
    assert.equal(at("09:30"), false);
    assert.equal(at("11:00"), false);
    assert.equal(at("11:01"), true);
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

  it("no plan, or a plan written after 04:00", () => {
    const t = ruledTrade(`${MON}T04:30`);
    assert.ok(flagsOf([t], t, { plans: [] }).includes("no_plan"));
    assert.ok(flagsOf([t], t, { plans: [plan(MON, `${MON}T08:05:00.000Z`)] }).includes("no_plan")); // 04:05 NY
    assert.ok(!flagsOf([t], t, { plans: [plan(MON, `${MON}T07:59:00.000Z`)] }).includes("no_plan")); // 03:59 NY
  });

  it("B and C are never tradable; the check-in narrows A+ and A further", () => {
    const b = ruledTrade(`${MON}T04:30`, { grade: "B" });
    assert.ok(flagsOf([b], b).includes("non_traded_grade"));
    const a = ruledTrade(`${MON}T04:30`, { grade: "A" });
    assert.ok(!flagsOf([a], a).includes("non_traded_grade"));
    assert.ok(flagsOf([a], a, { checkins: [{ date: MON, verdict: "caution" }] }).includes("non_traded_grade"));
    const top = ruledTrade(`${MON}T04:30`, { grade: "A+" });
    assert.ok(!flagsOf([top], top, { checkins: [{ date: MON, verdict: "caution" }] }).includes("non_traded_grade"));
    assert.ok(flagsOf([top], top, { checkins: [{ date: MON, verdict: "sit-out" }] }).includes("non_traded_grade"));
  });

  it("over risk: above the 0.5% cap", () => {
    const t = ruledTrade(`${MON}T04:30`, { riskPct: 0.75 });
    assert.ok(flagsOf([t], t).includes("over_risk"));
  });

  it("leaves a trade from before the rulebook with the flags it was saved with", () => {
    const old = ruledTrade(`${MON}T13:30`, { rulebookVersion: null, flags: ["over_risk"] });
    assert.deepEqual(flagsOf([old], old), ["over_risk"]);
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
    // A loss limit broken: the next two trading days off.
    assert.equal(j.timeline.dayOff.get(NEXT_MON)?.reason, "days-off");
    assert.equal(j.timeline.dayOff.get("2026-10-13")?.until, "2026-10-13");
  });
});

describe("the consequence ladder", () => {
  it("any rule break: the rest of the day off", () => {
    const a = ruledTrade(`${MON}T04:30`, { exitReason: "other" });
    const j = judge([a]);
    assert.equal(j.timeline.dayOff.get(MON)?.reason, "rule-break");
  });

  it("a second trade: the next two trading days off, skipping the weekend", () => {
    assert.deepEqual(nextTradingDays(FRI, 2), [NEXT_MON, "2026-10-13"]);
    const a = ruledTrade(`${MON}T04:30`);
    const b = ruledTrade(`${MON}T09:45`);
    const c = ruledTrade(`${TUE}T04:30`);
    const j = judge([a, b, c]);
    assert.ok(j.byId.get(b.id)!.flags.includes("second_trade_today"));
    assert.deepEqual(j.timeline.dayOff.get(TUE), { reason: "days-off", from: MON, until: WED });
    assert.ok(j.byId.get(c.id)!.flags.includes("during_day_off"));
    assert.equal(j.byId.get(c.id)!.allowed, 0);
  });

  it("two breaks in a week: the next week at half risk", () => {
    const a = ruledTrade(`${MON}T04:30`, { exitReason: "other" });
    const b = ruledTrade(`${WED}T04:30`, { exitReason: "other" });
    const full = ruledTrade(`${NEXT_MON}T04:30`, { riskPct: 0.5, resultR: 1 });
    const halved = ruledTrade(`${NEXT_MON}T04:30`, { riskPct: 0.25, resultR: 1 });
    const j1 = judge([a, b, full]);
    assert.ok(j1.timeline.halfWeeks.has("2026-W42"));
    assert.equal(j1.byId.get(full.id)!.allowed, 0.25);
    assert.deepEqual(j1.byId.get(full.id)!.flags, ["during_day_off"]);
    assert.deepEqual(judge([a, b, halved]).byId.get(halved.id)!.flags, []);
  });

  it("heals when the trade that caused it is deleted", () => {
    const a = ruledTrade(`${MON}T04:30`);
    const b = ruledTrade(`${MON}T09:45`);
    const c = ruledTrade(`${TUE}T04:30`);
    assert.deepEqual(judge([b, c]).byId.get(b.id)!.flags, []);
    assert.deepEqual(judge([b, c]).byId.get(c.id)!.flags, []);
    assert.ok(judge([a, b, c]).byId.get(c.id)!.flags.length > 0);
  });

  it("ignores skipped setups entirely", () => {
    const skipped = ruledTrade(`${MON}T04:30`, { skipped: true, riskPct: 0, grade: "B" });
    const real = ruledTrade(`${MON}T05:30`);
    const j = judge([skipped, real]);
    assert.equal(j.byId.has(skipped.id), false);
    assert.deepEqual(j.byId.get(real.id)!.flags, []);
  });

  it("judges a draft against the rest before it is saved", () => {
    const a = ruledTrade(`${MON}T04:30`);
    const draft = ruledTrade(`${MON}T09:45`);
    const j = judgeDraft(draft, { trades: [a], plans: allPlans, checkins: [], rulebookOf, now: LATE });
    assert.ok(j.flags.includes("second_trade_today"));
  });
});

describe("today's status", () => {
  const now = new Date(`${TUE}T10:00:00Z`); // 06:00 NY
  it("is done for today after the day's trade closes", () => {
    const s = deskStatus({ trades: [ruledTrade(`${TUE}T04:30`)], plans: allPlans, checkins: [], rulebookOf, doc, now });
    assert.equal(s.doneForToday, true);
    assert.equal(s.allowedByGrade["A+"], 0);
  });
  it("allows 0.5% on A+ and A, nothing on B, on a fresh day", () => {
    const s = deskStatus({ trades: [], plans: allPlans, checkins: [], rulebookOf, doc, now });
    assert.deepEqual(s.allowedByGrade, { "A+": 0.5, A: 0.5, B: 0, C: 0 });
    assert.equal(s.noPlan, false);
  });
  it("says no plan, no trade once 04:00 has passed without one", () => {
    const s = deskStatus({ trades: [], plans: [], checkins: [], rulebookOf, doc, now });
    assert.equal(s.noPlan, true);
    const early = deskStatus({ trades: [], plans: [], checkins: [], rulebookOf, doc, now: new Date(`${TUE}T07:00:00Z`) });
    assert.equal(early.noPlan, false); // 03:00 NY — still time to write it
  });
  it("on Caution only A+ is allowed", () => {
    const s = deskStatus({ trades: [], plans: allPlans, checkins: [{ date: TUE, verdict: "caution" }], rulebookOf, doc, now });
    assert.deepEqual(s.allowedByGrade, { "A+": 0.5, A: 0, B: 0, C: 0 });
  });
});

describe("plans", () => {
  it("counts as on time only before the deadline, by when it was first written", () => {
    assert.ok(planOnTime(plan(MON, `${MON}T07:59:00.000Z`), "04:00"));
    assert.ok(!planOnTime(plan(MON, `${MON}T08:00:00.000Z`), "04:00"));
    assert.ok(planOnTime(plan(TUE, `${MON}T22:00:00.000Z`), "04:00")); // written the evening before
    assert.ok(!planOnTime(null, "04:00"));
  });
});

describe("automatic base rules", () => {
  const ctx = (date: string, extra = {}) => ({ doc, date, trades: [] as Trade[], plans: allPlans, news: [], ...extra });
  it("knows the entry window and the plan", () => {
    assert.equal(autoRuleState("entry-window", ctx(`${MON}T04:30`)), true);
    assert.equal(autoRuleState("entry-window", ctx(`${MON}T08:30`)), false);
    assert.equal(autoRuleState("plan", ctx(`${MON}T04:30`)), true);
    assert.equal(autoRuleState("plan", ctx(`${MON}T04:30`, { plans: [] })), false);
  });
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
    const s = deskStatus({ trades: [], plans: allPlans, checkins: [], rulebookOf, doc, now, news });
    assert.equal(s.skipDay, true);
    assert.deepEqual(s.allowedByGrade, { "A+": 0, A: 0, B: 0, C: 0 });
  });
});
