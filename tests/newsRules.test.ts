/**
 * The news rules of the rulebook: skip days, release windows, and everything that is
 * only information. Titles are Forex Factory's own.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categoryOf, newsDay, releaseWindowAt, stanceOf, type NewsItem } from "../src/lib/newsRules";
import { defaultRulebook } from "../src/lib/rulebookText";

const rules = defaultRulebook().news;
const red = (title: string, currency = "USD", minutes: number | null = 8 * 60 + 30): NewsItem => ({
  title,
  currency,
  impact: "High",
  minutes,
});
const stance = (title: string, currency = "USD", impact = "High") => stanceOf({ title, currency, impact }, rules);

describe("news stance", () => {
  it("makes NFP, CPI, FOMC and the ECB skip days", () => {
    assert.equal(stance("Non-Farm Employment Change"), "skip");
    assert.equal(stance("Average Hourly Earnings m/m"), "skip");
    assert.equal(stance("Unemployment Rate"), "skip");
    assert.equal(stance("CPI m/m"), "skip");
    assert.equal(stance("Core CPI m/m"), "skip");
    assert.equal(stance("Federal Funds Rate"), "skip");
    assert.equal(stance("Main Refinancing Rate", "EUR"), "skip");
  });

  it("opens a window for every other red USD release and for the BoE", () => {
    assert.equal(stance("ADP Non-Farm Employment Change"), "window");
    assert.equal(stance("Unemployment Claims"), "window");
    assert.equal(stance("Final GDP q/q"), "window");
    assert.equal(stance("PPI m/m"), "window");
    assert.equal(stance("Core PCE Price Index m/m"), "window");
    assert.equal(stance("Retail Sales m/m"), "window");
    assert.equal(stance("Official Bank Rate", "GBP"), "window");
  });

  it("keeps ADP and claims out of the jobs-report kind", () => {
    assert.equal(categoryOf({ title: "ADP Non-Farm Employment Change" } as never), "adp");
    assert.equal(categoryOf({ title: "Unemployment Claims" } as never), "claims");
    assert.equal(categoryOf({ title: "PPI m/m" } as never), "ppi-pce");
    assert.equal(categoryOf({ title: "CPI y/y" } as never), "cpi");
  });

  it("skips US and UK bank holidays, not German ones", () => {
    assert.equal(stance("Bank Holiday", "USD", "Holiday"), "skip");
    assert.equal(stance("Bank Holiday", "GBP", "Holiday"), "skip");
    assert.equal(stance("German Unity Day", "EUR", "Holiday"), "info");
  });

  it("leaves orange news and other currencies' red news as information", () => {
    assert.equal(stance("CPI m/m", "USD", "Medium"), "info");
    assert.equal(stance("German Prelim CPI m/m", "EUR"), "info");
    assert.equal(stance("GDP m/m", "GBP"), "info");
  });
});

describe("a news day", () => {
  it("lists why it is a skip day", () => {
    const day = newsDay("2026-10-02", [red("Non-Farm Employment Change"), red("Unemployment Rate")], rules);
    assert.deepEqual(day.skip, ["USD Non-Farm Employment Change", "USD Unemployment Rate"]);
  });

  it("skips 22 December to 2 January, across the new year", () => {
    assert.ok(newsDay("2026-12-22", [], rules).skip.length);
    assert.ok(newsDay("2026-12-31", [], rules).skip.length);
    assert.ok(newsDay("2027-01-02", [], rules).skip.length);
    assert.equal(newsDay("2027-01-04", [], rules).skip.length, 0);
    assert.equal(newsDay("2026-12-21", [], rules).skip.length, 0);
  });

  it("opens a window from 5 minutes before to 60 after, both ends inside", () => {
    const day = newsDay("2026-10-07", [red("ADP Non-Farm Employment Change", "USD", 8 * 60 + 15)], rules);
    assert.deepEqual(day.windows.map((w) => [w.start, w.end]), [[8 * 60 + 10, 9 * 60 + 15]]);
    assert.equal(releaseWindowAt(8 * 60 + 9, day), null);
    assert.ok(releaseWindowAt(8 * 60 + 10, day));
    assert.ok(releaseWindowAt(9 * 60 + 15, day));
    assert.equal(releaseWindowAt(9 * 60 + 16, day), null);
  });
});
