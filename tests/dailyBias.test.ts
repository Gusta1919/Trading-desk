/**
 * The Daily Bias file is written by a language model, so the parser has to take
 * what models actually write — "55%", 0.55, splits that add to 99 — and never let
 * one bad row take the whole tab down.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amsterdamClock, cleanUrl, parseBias, toHundred } from "../src/lib/dailyBias";

const core = { date: "2026-10-01", bias: { bullish: 55, range: 30, bearish: 15, why: "x" } };

describe("toHundred", () => {
  it("leaves a split that already adds to 100 alone", () => {
    assert.deepEqual(toHundred([55, 30, 15]), [55, 30, 15]);
  });

  it("scales a split that falls short, fixing rounding on the largest remainder", () => {
    const out = toHundred([55, 30, 14]);
    assert.equal(out.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(out, [56, 30, 14]);
  });

  it("returns zeros rather than dividing by nothing", () => {
    assert.deepEqual(toHundred([0, 0]), [0, 0]);
  });
});

describe("parseBias", () => {
  it("rejects a file without a date or a full bias split", () => {
    assert.equal(parseBias(null), null);
    assert.equal(parseBias({ bias: core.bias }), null);
    assert.equal(parseBias({ date: "2026-10-01", bias: { bullish: 60, range: 40 } }), null);
    assert.equal(parseBias({ date: "1 Oct", bias: core.bias }), null);
  });

  it("reads percentages written as text or fractions", () => {
    const b = parseBias({ date: "2026-10-01", bias: { bullish: "55%", range: 0.3, bearish: 15 } });
    assert.deepEqual(
      b && [b.bias.bullish, b.bias.range, b.bias.bearish],
      [55, 30, 15],
    );
  });

  it("keeps the core when everything else is missing", () => {
    const b = parseBias(core)!;
    assert.deepEqual(b.levels, []);
    assert.deepEqual(b.scenarios, []);
    assert.equal(b.keyLevel, null);
    assert.equal(b.consensus, null);
    assert.equal(b.macro.surprise, null);
  });

  it("drops a malformed level instead of the whole ladder", () => {
    const b = parseBias({
      ...core,
      levels: [
        { price: "2,672.5", label: "PDH", kind: "liquidity", sweepProb: 60, verdict: "break" },
        { price: "n/a", label: "broken" },
        { price: 2640, label: "Asian low", kind: "made-up-kind", verdict: "maybe" },
      ],
    })!;
    assert.equal(b.levels.length, 2);
    assert.equal(b.levels[0].price, 2672.5);
    assert.equal(b.levels[1].kind, "support");
    assert.equal(b.levels[1].verdict, "unclear");
  });

  it("makes the three scenarios share 100%", () => {
    const b = parseBias({
      ...core,
      scenarios: [
        { kind: "primary", prob: 50, direction: "long" },
        { kind: "alternative", prob: 30, direction: "short" },
        { kind: "chop", prob: 15 },
      ],
    })!;
    assert.equal(b.scenarios.reduce((a, s) => a + s.prob, 0), 100);
  });

  it("stores instants as UTC so the desk can show them on New York time", () => {
    const b = parseBias({ ...core, mainEvent: { title: "ISM", at: "2026-10-01T16:00:00+02:00" } })!;
    assert.equal(b.mainEvent?.at, "2026-10-01T14:00:00.000Z");
  });

  it("refuses links that aren't http(s)", () => {
    const b = parseBias({
      ...core,
      analysts: [{ name: "X", url: "javascript:alert(1)", lean: "BULLISH" }],
    })!;
    assert.equal(b.analysts[0].url, "");
    assert.equal(b.analysts[0].lean, "bullish");
  });
});

describe("cleanUrl", () => {
  it("unwraps the Google redirects Gmail puts around links in drafts", () => {
    const wrapped =
      "https://www.google.com/url?q=https://www.fxempire.com/forecasts/article/gold-1633778&source=gmail&ust=1790877720000000&usg=AOv";
    assert.equal(cleanUrl(wrapped), "https://www.fxempire.com/forecasts/article/gold-1633778");
  });

  it("leaves ordinary links alone and drops anything that isn't http(s)", () => {
    assert.equal(cleanUrl("https://www.kitco.com/news/a"), "https://www.kitco.com/news/a");
    assert.equal(cleanUrl("javascript:alert(1)"), "");
    assert.equal(cleanUrl("https://www.google.com/url?q=javascript:alert(1)"), "");
    assert.equal(cleanUrl("not a link"), "");
  });
});

describe("parseBias — the visual fields", () => {
  it("reads trends, the dealing range, drivers and the day's range", () => {
    const b = parseBias({
      ...core,
      structure: { d1Trend: "BEARISH", h4Trend: "range", rangeLow: 4110, rangeHigh: "4,285" },
      macro: { drivers: [{ name: "DXY", value: "101.2", change: "-0.1%", gold: "bullish" }, { value: "no name" }] },
      risk: { dayLow: 4164.8, dayHigh: 4220 },
    })!;
    assert.equal(b.structure.d1Trend, "bearish");
    assert.equal(b.structure.h4Trend, "range");
    assert.deepEqual([b.structure.rangeLow, b.structure.rangeHigh], [4110, 4285]);
    assert.deepEqual(b.macro.drivers, [{ name: "DXY", value: "101.2", change: "-0.1%", gold: "bullish" }]);
    assert.deepEqual([b.risk.dayLow, b.risk.dayHigh], [4164.8, 4220]);
  });

  it("puts a range written high-first the right way round", () => {
    const b = parseBias({ ...core, structure: { rangeLow: 4285, rangeHigh: 4110 } })!;
    assert.deepEqual([b.structure.rangeLow, b.structure.rangeHigh], [4110, 4285]);
  });

  it("leaves them empty for an older briefing, so the tab falls back to its text", () => {
    const b = parseBias({ ...core, structure: { d1: "Bearish", zone: "discount" } })!;
    assert.equal(b.structure.d1Trend, null);
    assert.equal(b.structure.rangeLow, null);
    assert.equal(b.structure.zone, "discount");
    assert.deepEqual(b.macro.drivers, []);
    assert.equal(b.risk.dayLow, null);
  });

  it("reads a scenario's zone, from its fields or else from its words", () => {
    const b = parseBias({
      ...core,
      scenarios: [
        { kind: "chop", prob: 30, title: "4136-4181 range into NFP" },
        { kind: "primary", prob: 45, zoneLow: 4181, zoneHigh: 4162, title: "Fade retest" },
        { kind: "alternative", prob: 25, title: "Sweep of 4111 then reclaim" },
      ],
    })!;
    assert.deepEqual(b.scenarios.map((s) => s.zone), [
      { low: 4136, high: 4181 },
      { low: 4162, high: 4181 },
      null,
    ]);
  });

  it("drops half a range rather than drawing a gauge from one end", () => {
    const b = parseBias({ ...core, risk: { dayLow: 4164.8 } })!;
    assert.deepEqual([b.risk.dayLow, b.risk.dayHigh], [null, null]);
  });
});

describe("amsterdamClock", () => {
  it("reads the Amsterdam calendar, not the machine's or New York's", () => {
    // 23:30 UTC on Thursday is already Friday 01:30 in Amsterdam (CEST).
    const c = amsterdamClock(new Date("2026-10-01T23:30:00Z"));
    assert.equal(c.date, "2026-10-02");
    assert.equal(c.minutes, 90);
    assert.equal(c.weekend, false);
  });

  it("knows a weekend", () => {
    assert.equal(amsterdamClock(new Date("2026-10-03T10:00:00Z")).weekend, true);
  });
});
