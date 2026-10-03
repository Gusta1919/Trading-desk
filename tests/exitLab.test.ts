/** The Exit lab: targets replayed from MFE, unknowns left out, breakeven at 1R. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exitLab } from "../src/lib/exitLab";
import { ruledTrade } from "./fixtures";

// Entry 2000, stop 1996: 1R = $4. MFE price 2000 + 4×mfe.
const t = (resultR: number, mfeR: number, extra = {}) =>
  ruledTrade("2026-10-05T04:30", { resultR, mfePrice: 2000 + 4 * mfeR, ...extra });

describe("exit lab", () => {
  it("scores a smaller target as reached when MFE got there", () => {
    const lab = exitLab([t(-1, 1.2, { exitReason: "stop" }), t(2, 2, { exitReason: "target" })], 1);
    const r1 = lab.rows.find((r) => r.id === "target-1")!;
    assert.deepEqual([r1.n, r1.avgR], [2, 1]);
    assert.equal(lab.rows.find((r) => r.id === "actual")!.avgR, 0.5);
  });

  it("leaves a bigger target unknown unless the furthest price was logged", () => {
    const hit2 = t(2, 2, { exitReason: "target" });
    const ran = t(2, 2, { exitReason: "target", maxFavPrice: 2000 + 4 * 3.4 });
    const lab = exitLab([hit2, ran], 1);
    const r3 = lab.rows.find((r) => r.id === "target-3")!;
    assert.deepEqual([r3.n, r3.unknown, r3.avgR], [1, 1, 3]);
  });

  it("keeps a stopped trade's real result when the target never came", () => {
    const lab = exitLab([t(-1, 0.6, { exitReason: "stop" })], 1);
    assert.equal(lab.rows.find((r) => r.id === "target-2")!.avgR, -1);
  });

  it("turns a loser that reached 1R into a scratch with breakeven at 1R", () => {
    const lab = exitLab([t(-1, 1.1, { exitReason: "stop" }), t(-1, 0.5, { exitReason: "stop" })], 1);
    assert.equal(lab.rows.find((r) => r.id === "be-1r")!.avgR, -0.5);
  });

  it("needs enough trades with MFE before it answers", () => {
    assert.equal(exitLab([t(1, 1)], 30).enough, false);
    assert.equal(exitLab([ruledTrade("2026-10-05T04:30", { mfePrice: null })], 1).n, 0);
  });
});
