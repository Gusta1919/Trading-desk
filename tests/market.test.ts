/** Gold's trading hours on New York's clock: Sunday 18:00 to Friday 17:00, a break 17:00–18:00. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goldMarket, inLabel } from "../src/lib/market";

// 4 October 2026 is a Sunday.
const at = (day: string, time: string) => goldMarket(`2026-10-${day}T${time}`);

describe("gold's trading hours", () => {
  it("is shut all Saturday and on Sunday until 18:00", () => {
    assert.deepEqual([at("03", "12:00").open, at("03", "12:00").closedFor], [false, "weekend"]);
    assert.equal(at("03", "12:00").next.day, "Sunday");
    assert.equal(at("04", "17:59").open, false);
    assert.deepEqual(at("04", "17:30").next, { what: "opens", day: "today", time: "18:00", inMinutes: 30 });
  });

  it("opens Sunday 18:00 and runs to Monday 17:00", () => {
    assert.equal(at("04", "18:00").open, true);
    assert.deepEqual(at("04", "18:00").next, { what: "closes", day: "tomorrow", time: "17:00", inMinutes: 23 * 60 });
    assert.equal(at("05", "09:30").open, true);
  });

  it("breaks every weekday evening from 17:00 to 18:00", () => {
    assert.deepEqual([at("06", "17:00").open, at("06", "17:00").closedFor], [false, "daily break"]);
    assert.equal(at("06", "17:45").next.inMinutes, 15);
    assert.equal(at("06", "18:00").open, true);
  });

  it("closes for the weekend on Friday at 17:00", () => {
    assert.equal(at("09", "16:59").open, true);
    assert.deepEqual([at("09", "17:00").open, at("09", "17:00").closedFor], [false, "weekend"]);
    assert.equal(at("09", "17:00").next.inMinutes, 2 * 24 * 60 + 60);
  });

  it("says how long in words", () => {
    assert.equal(inLabel(25), "25m");
    assert.equal(inLabel(125), "2h 05m");
    assert.equal(inLabel(2 * 24 * 60 + 60), "2d 1h");
  });
});
