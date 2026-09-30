/**
 * The price chart's arithmetic: sessions on New York time, the CRT 3–4AM box the GOLD
 * Model trades, zones read out of a scenario's words, and the scale that keeps near
 * targets on screen without squashing the candles.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeed } from "../server/candles";
import {
  crtBox,
  levelEffect,
  levelRole,
  priceDomain,
  sessionOf,
  sessionRuns,
  stackLabels,
  timeMarks,
  verdictEffect,
  zoneFromText,
  type Candle,
} from "../src/lib/chart";

// 30 Sep 2026 is in EDT: New York = UTC − 4.
const ny = (hhmm: string, day = "2026-09-30") => Date.parse(`${day}T${hhmm}:00-04:00`);
const bar = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c });

describe("sessionOf", () => {
  it("splits the day on New York time", () => {
    assert.equal(sessionOf(ny("20:00", "2026-09-29")), "Asia");
    assert.equal(sessionOf(ny("02:45")), "Asia");
    assert.equal(sessionOf(ny("03:00")), "London");
    assert.equal(sessionOf(ny("08:00")), "New York");
    assert.equal(sessionOf(ny("16:45")), "New York");
    assert.equal(sessionOf(ny("17:15")), null);
  });

  it("groups consecutive bars into runs", () => {
    const c = ["02:30", "02:45", "03:00", "03:15"].map((t) => bar(ny(t), 1, 1, 1, 1));
    assert.deepEqual(sessionRuns(c), [
      { session: "Asia", from: 0, to: 1 },
      { session: "London", from: 2, to: 3 },
    ]);
  });
});

describe("crtBox", () => {
  it("takes the high and low of the 03:00–04:00 NY hour and its sweep window", () => {
    const c = [
      bar(ny("02:45"), 10, 99, 1, 10),
      bar(ny("03:00"), 10, 12, 8, 11),
      bar(ny("03:15"), 11, 14, 9, 12),
      bar(ny("03:45"), 12, 13, 7, 9),
      bar(ny("04:00"), 9, 20, 5, 6),
      bar(ny("10:00"), 6, 7, 5, 6),
    ];
    const box = crtBox(c)!;
    assert.deepEqual([box.low, box.high, box.from, box.to, box.windowEnd], [7, 14, 1, 3, 5]);
  });

  it("is absent before the box has formed", () => {
    assert.equal(crtBox([bar(ny("01:00"), 1, 2, 0, 1)]), null);
  });
});

describe("zoneFromText", () => {
  it("reads a price zone from a scenario's words", () => {
    assert.deepEqual(zoneFromText("4136-4181 range into NFP"), { low: 4136, high: 4181 });
    assert.deepEqual(zoneFromText("Rejection 4181–4162.5 + M15 MSS"), { low: 4162.5, high: 4181 });
  });

  it("ignores dates, times and pairs too far apart to be a zone", () => {
    assert.equal(zoneFromText("NFP 2026-10-02"), null);
    assert.equal(zoneFromText("08:30-10:00 NY"), null);
    assert.equal(zoneFromText("4000-4500 macro range"), null);
    assert.equal(zoneFromText("Sweep of 4146 + MSS"), null);
  });
});

describe("priceDomain", () => {
  const c = [bar(0, 100, 110, 100, 105), bar(1, 105, 108, 102, 104)];

  it("stretches to take in near levels, but not far ones", () => {
    const [lo, hi] = priceDomain(c, [95, 200], 0.8, 0);
    assert.equal(lo, 95); // 5 below the range of 10: kept on screen
    assert.equal(hi, 110); // 90 above: becomes an edge marker instead
  });

  it("measures reach from the candles, so one target can't drag the next one in", () => {
    // Range 100–110, reach 8: 95 is in; 88 is 12 below the candles, even though only 7 below 95.
    const [lo] = priceDomain(c, [95, 88], 0.8, 0);
    assert.equal(lo, 95);
  });
});

describe("parseFeed", () => {
  it("reads the JSONP feed oldest-first and drops broken rows", () => {
    const body = "_cb([[2000,2,3,1,2.5,0.1],[1000,1,2,0.5,1.5,0.2],[3000,1,0,2,1,0]]);";
    assert.deepEqual(parseFeed(body), [
      { t: 1000, o: 1, h: 2, l: 0.5, c: 1.5 },
      { t: 2000, o: 2, h: 3, l: 1, c: 2.5 },
    ]);
  });
});

describe("key levels", () => {
  it("groups each kind by what it does to price", () => {
    assert.equal(levelRole("liquidity"), "liquidity");
    assert.equal(levelRole("fvg"), "imbalance");
    assert.equal(levelRole("orderblock"), "imbalance");
    for (const k of ["support", "resistance", "round", "open"] as const) assert.equal(levelRole(k), "reaction");
  });

  it("words the hold/break call for the kind of level, so it never contradicts it", () => {
    assert.match(verdictEffect("break", "liquidity"), /taken/);
    assert.match(verdictEffect("hold", "liquidity"), /untouched/);
    assert.match(verdictEffect("break", "fvg"), /fails/);
    assert.match(verdictEffect("hold", "resistance"), /holds/);
  });

  it("names the side of liquidity relative to price", () => {
    assert.match(levelEffect("liquidity", true), /^Buy-side/);
    assert.match(levelEffect("liquidity", false), /^Sell-side/);
  });
});

describe("stackLabels", () => {
  it("leaves spaced labels alone and pushes crowded ones apart, keeping order", () => {
    assert.deepEqual(stackLabels([10, 50, 90], 12, 0, 200), [10, 50, 90]);
    assert.deepEqual(stackLabels([50, 44, 52], 12, 0, 200), [56, 44, 68]);
  });

  it("slides a stack up when it would run off the bottom", () => {
    const ys = stackLabels([95, 96, 97], 10, 0, 100);
    assert.deepEqual(ys, [80, 90, 100]);
  });
});

describe("timeMarks", () => {
  const at = (hhmm: string, day = "2026-09-30") => bar(ny(hhmm, day), 1, 1, 1, 1);

  it("marks every three hours on 15m, without crowding", () => {
    const c = ["08:45", "09:00", "09:15", "12:00", "12:15", "15:00"].map((t) => at(t));
    assert.deepEqual(timeMarks(c, "15m", 1), [1, 3, 5]);
    assert.deepEqual(timeMarks(c, "15m", 3), [1, 5]);
  });

  it("marks each New York midnight on 1h", () => {
    const c = [at("22:00", "2026-09-28"), at("00:00", "2026-09-29"), at("12:00", "2026-09-29"), at("00:00", "2026-09-30")];
    assert.deepEqual(timeMarks(c, "1h", 1), [1, 3]);
  });
});
