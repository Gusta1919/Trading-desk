/**
 * The rulebook document: every number in the text comes from one value, the text
 * format round-trips into blocks, and versions count the way the changelog reads.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  atLeast,
  compareVersions,
  fill,
  nextVersion,
  parseBody,
  rulebookErrors,
  skipDayLines,
  tokenValues,
  type Rulebook,
} from "../src/lib/rulebook";
import { BIAS_RULE, CONDENSED_VERSION, PLAN_RETIRED_VERSION, condenseRulebook, defaultRulebook, retirePlan } from "../src/lib/rulebookText";

const v = (doc: Rulebook, key: string) => tokenValues(doc)[key];

describe("rulebook v1.2", () => {
  it("is valid as written — every token has a value, every table exists", () => {
    assert.deepEqual(rulebookErrors(defaultRulebook()), []);
  });

  it("has the brief's nine base rules and six factors, with the auto ones marked", () => {
    const d = defaultRulebook();
    assert.equal(d.baseRules.length, 9);
    assert.deepEqual(
      d.baseRules.filter((r) => r.auto).map((r) => r.auto),
      ["news", "entry-window", "daily-budget", "plan"],
    );
    assert.deepEqual(
      d.factors.map((f) => f.auto ?? null),
      [null, "displacement", null, "bias", "compass", null],
    );
  });

  it("puts A+ and A at 0.5%, and keeps B and C out of the desk", () => {
    const d = defaultRulebook();
    assert.equal(v(d, "risk.A+"), "0.5%");
    assert.equal(v(d, "risk.A"), "0.5%");
    assert.equal(v(d, "risk.B"), "Not tradable");
    assert.equal(v(d, "backtest.B"), "0.25%");
    assert.equal(v(d, "backtest.C"), "No trade");
    assert.equal(v(d, "grades.tradable"), "A+ or A");
    assert.equal(v(d, "risk.entry"), "0.5%");
  });

  it("works out the account arithmetic from the balances, not from typed numbers", () => {
    const d = defaultRulebook();
    assert.equal(v(d, "limits.opening"), "$193,933.27");
    assert.equal(v(d, "limits.openingLoss"), "−$6,066.73");
    assert.equal(v(d, "limits.openingLossPct"), "−3.03%");
    assert.equal(v(d, "limits.room"), "$13,933.27");
    assert.equal(v(d, "limits.roomPct"), "6.97%");
    assert.equal(v(d, "limits.floor"), "$180,000");
    assert.equal(v(d, "limits.phase1Need"), "+$26,066.73");
    assert.equal(v(d, "limits.phase1NeedPct"), "+13.03%");
    assert.equal(v(d, "limits.phase1Goal"), "$220,000");
    assert.equal(v(d, "odds.phase1"), "6.97 ÷ (13.03 + 6.97) ≈ 35%");
    assert.equal(v(d, "odds.phase2"), "10 ÷ (5 + 10) ≈ 67%");
    assert.equal(v(d, "odds.both"), "23%");
    assert.equal(v(d, "limits.weeklyStop.losses"), "four");
  });

  it("reads the displacement and Compass boundaries from the factors themselves", () => {
    const d = defaultRulebook();
    assert.equal(v(d, "disp.weak"), "0.25×");
    assert.equal(v(d, "disp.strong"), "1.0×");
    assert.equal(v(d, "compass.cut"), "60%");
    assert.equal(v(d, "compass.all.short"), "61.4% (283 of 461)");
    assert.equal(v(d, "compass.all.long"), "66.7% (352 of 528)");
  });

  it("changes every sentence when one value changes", () => {
    const d = defaultRulebook();
    d.grades[1].riskPct = 0.25;
    d.entryWindows[1].to = "10:30";
    const values = tokenValues(d);
    assert.equal(fill("A at {{risk.A}}, entries until {{window.2.to}}", values), "A at 0.25%, entries until 10:30");
    assert.equal(values["risk.entry"], "0.25–0.5%");
  });

  it("writes the skip days from the news rules", () => {
    assert.deepEqual(skipDayLines(defaultRulebook().news), [
      "US Non-Farm Payrolls day. Non-Farm Employment Change, Average Hourly Earnings and Unemployment Rate come out together.",
      "US CPI day",
      "FOMC rate-decision day",
      "ECB rate decision (Main Refinancing Rate)",
      "US and UK bank holidays",
      "22 December to 2 January",
    ]);
  });

  it("refuses a token with no value, a table it can't draw, and a window that ends before it starts", () => {
    const d = defaultRulebook();
    d.sections[0].body += "\n\n{{risk.Z}} and [[nonsense]]";
    d.entryWindows[0] = { from: "08:00", to: "07:00" };
    const errors = rulebookErrors(d);
    assert.ok(errors.some((e) => e.includes("{{risk.Z}}")));
    assert.ok(errors.some((e) => e.includes("[[nonsense]]")));
    assert.ok(errors.some((e) => e.includes("Entry window 1 must end after it starts")));
  });

  it("notices a deleted factor that the text still quotes", () => {
    const d = defaultRulebook();
    d.factors = d.factors.filter((f) => f.auto !== "displacement");
    assert.ok(rulebookErrors(d).some((e) => e.includes("{{disp.weak}}")));
  });
});

describe("the text format", () => {
  it("reads headings, lists with sub-items, tables, asides and drawn tables", () => {
    const blocks = parseBody(`### Title

A paragraph
over two lines.

1. One
  - under one
2. Two

| A | B |
| --- | --- |
| 1 | 2 |

> Why: because.

[[compass]]`);
    assert.deepEqual(blocks, [
      { kind: "h", text: "Title" },
      { kind: "p", text: "A paragraph over two lines." },
      { kind: "list", ordered: true, items: [{ text: "One", children: ["under one"] }, { text: "Two", children: [] }] },
      { kind: "table", head: ["A", "B"], rows: [["1", "2"]] },
      { kind: "note", text: "Why: because." },
      { kind: "gen", id: "compass" },
    ]);
  });
});

describe("versions", () => {
  it("bumps minor or major", () => {
    assert.equal(nextVersion("1.2", "minor"), "1.3");
    assert.equal(nextVersion("1.9", "minor"), "1.10");
    assert.equal(nextVersion("1.2", "major"), "2.0");
  });

  it("sorts newest first, numerically", () => {
    assert.deepEqual(["1.2", "1.10", "2.0", "1.3"].sort(compareVersions), ["2.0", "1.10", "1.3", "1.2"]);
    assert.ok(atLeast("1.10", "1.2"));
    assert.ok(atLeast("1.2", "1.2"));
    assert.ok(!atLeast("1.1", "1.2"));
    assert.ok(!atLeast(null, "1.2"));
  });
});

describe("glossary tips", () => {
  it("marks each term once, by any of its names, never inside another word", async () => {
    const { gloss } = await import("../src/lib/glossary");
    const g = defaultRulebook().glossary;
    const parts = gloss("5m MSS after the sweep; MSS again. MAE and EQL, not MSSX.", g);
    assert.deepEqual(
      parts.filter((p) => p.meaning).map((p) => p.text),
      ["MSS", "MAE", "EQL"],
    );
    assert.equal(parts.map((p) => p.text).join(""), "5m MSS after the sweep; MSS again. MAE and EQL, not MSSX.");
  });
});

describe("v1.3 — the written plan retired", () => {
  const v13 = { ...retirePlan(defaultRulebook()), version: PLAN_RETIRED_VERSION };
  it("swaps the plan rule for a hand-ticked 'daily bias decided'", () => {
    assert.equal(v13.baseRules.length, 9);
    assert.ok(!v13.baseRules.some((r) => r.id === "plan"));
    const bias = v13.baseRules.find((r) => r.id === BIAS_RULE.id)!;
    assert.equal(bias.text, "Daily bias decided");
    assert.equal(bias.auto, undefined);
    assert.deepEqual(v13.baseRules.filter((r) => r.auto).map((r) => r.auto), ["news", "entry-window", "daily-budget"]);
  });
  it("answers the bias factor by hand, drops the deadline, and rewrites the gate", () => {
    assert.equal(v13.factors.find((f) => f.id === "bias")!.auto, undefined);
    assert.equal(v13.planBy, undefined);
    assert.equal(v13.flow.gates[0], "Daily bias decided?");
  });
  it("leaves no {{planBy}} behind, so the text still validates", () => {
    assert.ok(!JSON.stringify(v13).includes("{{planBy}}"));
    assert.deepEqual(rulebookErrors(v13), []);
  });
  it("keeps text you edited, writing out a leftover deadline as the time", () => {
    const edited = defaultRulebook();
    edited.sections = edited.sections.map((s) => (s.id === "prep" ? { ...s, body: `My own prep, done by {{planBy}}.` } : s));
    const out = retirePlan(edited);
    assert.equal(out.sections.find((s) => s.id === "prep")!.body, "My own prep, done by 04:00.");
  });
});

describe("v1.4 — the rulebook condensed", () => {
  const v13 = { ...retirePlan(defaultRulebook()), version: PLAN_RETIRED_VERSION };
  const v14 = { ...condenseRulebook(v13), version: CONDENSED_VERSION };
  const rules = v14.sections.filter((s) => !s.reference);
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

  it("validates as written", () => {
    assert.deepEqual(rulebookErrors(v14), []);
  });

  it("holds only the rules, in seven sections and a fraction of the words", () => {
    assert.deepEqual(rules.map((s) => s.id), ["glance", "flow", "prep", "news", "trade", "grading", "limits"]);
    const before = v13.sections.reduce((n, s) => n + words(s.body), 0);
    const after = rules.reduce((n, s) => n + words(s.body), 0);
    assert.ok(after < before / 4, `${after} words of rules, from ${before}`);
  });

  it("drops the asides, the pilot numbers, the spread rule and the challenge plan from the rules", () => {
    const text = rules.map((s) => s.body).join("\n");
    assert.ok(!/^>/m.test(text));
    assert.ok(!/pilot|spread|phase|FTMO|backtest/i.test(text), text);
  });

  it("keeps the background in the Reference panel", () => {
    assert.deepEqual(
      v14.sections.filter((s) => s.reference).map((s) => s.id),
      ["changes", "backtest", "open", "glossary", "changelog"],
    );
  });

  it("changes no value the logic reads", () => {
    const { sections: _a, flow: _b, version: _c, ...after } = v14;
    const { sections: _d, flow: _e, version: _f, ...before } = v13;
    assert.deepEqual(after, before);
  });

  it("keeps text you wrote yourself, in its new place or after the rules", () => {
    const edited = structuredClone(v13);
    edited.sections = edited.sections.map((s) =>
      s.id === "news" ? { ...s, body: "My news rules." } : s.id === "manage" ? { ...s, body: "My exits." } : s,
    );
    const out = condenseRulebook(edited);
    const ids = out.sections.filter((s) => !s.reference).map((s) => s.id);
    assert.equal(out.sections.find((s) => s.id === "news")!.body, "My news rules.");
    assert.deepEqual(ids, ["glance", "flow", "prep", "news", "trade", "grading", "limits", "manage"]);
  });

  it("keeps a decision flow you edited", () => {
    const edited = structuredClone(v13);
    edited.flow.gates = ["My one gate?"];
    assert.deepEqual(condenseRulebook(edited).flow.gates, ["My one gate?"]);
    assert.notDeepEqual(condenseRulebook(v13).flow, v13.flow);
  });
});
