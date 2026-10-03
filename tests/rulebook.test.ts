/**
 * The rulebook document: every number in the text comes from one value, the text
 * format round-trips into blocks, and versions count the way the changelog reads.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FIRST_VERSION, defaultRulebook } from "../src/lib/goldModel";
import {
  compareVersions,
  fill,
  nextVersion,
  parseBody,
  rulebookErrors,
  skipDayLines,
  tokenValues,
  type Rulebook,
} from "../src/lib/rulebook";

const v = (doc: Rulebook, key: string) => tokenValues(doc)[key];

describe("the GOLD Model as it ships", () => {
  it("is valid as written — every token has a value, every table exists", () => {
    assert.deepEqual(rulebookErrors(defaultRulebook()), []);
  });

  it("starts the changelog at 1.0", () => {
    assert.equal(FIRST_VERSION, "1.0");
  });

  it("has nine base rules, the desk answering the news and the budget itself", () => {
    const d = defaultRulebook();
    assert.equal(d.baseRules.length, 9);
    assert.deepEqual(d.baseRules.filter((r) => r.auto).map((r) => r.auto), ["news", "daily-budget"]);
  });

  it("grades on five factors, all answered by hand", () => {
    assert.deepEqual(defaultRulebook().factors.map((f) => f.id), ["htf-tf", "disp", "bias", "compass", "conviction"]);
  });

  it("holds the rules in seven sections, and the background in the Reference panel", () => {
    const d = defaultRulebook();
    assert.deepEqual(d.sections.filter((s) => !s.reference).map((s) => s.id), ["glance", "flow", "prep", "news", "trade", "grading", "limits"]);
    assert.deepEqual(d.sections.filter((s) => s.reference).map((s) => s.id), ["changes", "glossary", "changelog"]);
  });

  it("puts A+ and A at 0.5%, and keeps B and C out of the desk", () => {
    const d = defaultRulebook();
    assert.equal(v(d, "risk.A+"), "0.5%");
    assert.equal(v(d, "risk.A"), "0.5%");
    assert.equal(v(d, "risk.B"), "Not tradable");
    assert.equal(v(d, "grades.tradable"), "A+ or A");
    assert.equal(v(d, "risk.entry"), "0.5%");
  });

  it("has one consequence: any break, the next trading day off", () => {
    const d = defaultRulebook();
    assert.equal(d.daysOff, 1);
    assert.equal(v(d, "consequence.days"), "the next trading day");
    assert.equal(v({ ...d, daysOff: 2 }, "consequence.days"), "the next two trading days");
  });

  it("works out the account lines from the balances, not from typed numbers", () => {
    const d = defaultRulebook();
    assert.equal(v(d, "limits.opening"), "$193,933.27");
    assert.equal(v(d, "limits.floor"), "$180,000");
    assert.equal(v(d, "limits.goal"), "$220,000");
    assert.equal(v(d, "limits.target"), "10%");
  });

  it("reads the displacement and Compass boundaries from the factors themselves", () => {
    const d = defaultRulebook();
    assert.equal(v(d, "disp.weak"), "0.25×");
    assert.equal(v(d, "disp.strong"), "1.0×");
    assert.equal(v(d, "compass.cut"), "60%");
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
    d.factors = d.factors.filter((f) => f.id !== "compass");
    assert.ok(rulebookErrors(d).some((e) => e.includes("{{compass.cut}}")));
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

[[flow]]`);
    assert.deepEqual(blocks, [
      { kind: "h", text: "Title" },
      { kind: "p", text: "A paragraph over two lines." },
      { kind: "list", ordered: true, items: [{ text: "One", children: ["under one"] }, { text: "Two", children: [] }] },
      { kind: "table", head: ["A", "B"], rows: [["1", "2"]] },
      { kind: "note", text: "Why: because." },
      { kind: "gen", id: "flow" },
    ]);
  });
});

describe("versions", () => {
  it("counts every saved change as the next version", () => {
    assert.equal(nextVersion("1.0"), "1.1");
    assert.equal(nextVersion("1.9"), "1.10");
  });

  it("sorts newest first, numerically", () => {
    assert.deepEqual(["1.2", "1.10", "2.0", "1.3"].sort(compareVersions), ["2.0", "1.10", "1.3", "1.2"]);
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

