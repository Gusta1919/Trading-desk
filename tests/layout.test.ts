/** Coach cards: every row shares its width evenly, whatever the card count. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { balancedSpans } from "../src/lib/layout";

describe("balancedSpans", () => {
  it("shares a row evenly instead of stretching the first card", () => {
    assert.deepEqual(balancedSpans(2), ["lg:col-span-3", "lg:col-span-3"]);
    // Three share a desktop row; on two columns the third takes a row of its own.
    assert.deepEqual(balancedSpans(3), ["lg:col-span-2", "lg:col-span-2", "lg:col-span-2 md:col-span-2"]);
  });

  it("balances rows: 4 → 2 + 2, 5 → 3 + 2, 7 → 3 + 2 + 2", () => {
    assert.deepEqual(balancedSpans(4), Array(4).fill("lg:col-span-3"));
    assert.deepEqual(balancedSpans(5).map((s) => s.split(" ")[0]), [
      "lg:col-span-2", "lg:col-span-2", "lg:col-span-2", "lg:col-span-3", "lg:col-span-3",
    ]);
    assert.equal(balancedSpans(7).filter((s) => s.startsWith("lg:col-span-3")).length, 4);
  });

  it("lets an odd last card fill the row on two columns", () => {
    assert.equal(balancedSpans(1)[0], "lg:col-span-6 md:col-span-2");
    assert.ok(balancedSpans(5)[4].endsWith("md:col-span-2"));
  });
});
