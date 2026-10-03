/**
 * Your money across accounts: you log the main account's dollars, each linked account
 * takes the same % of its own balance, and everything counts from the journal's start.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ledger } from "../src/lib/limits";
import { doc, ruledTrade } from "./fixtures";

const limits = { ...doc.limits, accountName: "Main", openingBalance: 200_000, linked: [{ name: "Half", opening: 100_000 }] };

describe("the ledger", () => {
  it("starts every account at its opening balance, with nothing gained or lost", () => {
    const l = ledger([], limits);
    assert.deepEqual(l.accounts.map((a) => [a.name, a.balance, a.pnl]), [["Main", 200_000, 0], ["Half", 100_000, 0]]);
    assert.equal(l.total.balance, 300_000);
    assert.equal(l.total.pnl, 0);
  });

  it("gives a linked account the same % as the main one, trade by trade", () => {
    const a = ruledTrade("2026-10-05T04:30", { pnlUsd: 2_000, resultR: 2 }); // +1% of 200K
    const b = ruledTrade("2026-10-06T04:30", { pnlUsd: -1_010, resultR: -1 }); // −0.5% of 202K
    const l = ledger([a, b], limits);
    assert.deepEqual(l.byTrade.get(a.id), [2_000, 1_000]);
    const [main, half] = l.byTrade.get(b.id)!;
    assert.equal(main, -1_010);
    assert.ok(Math.abs(half - -505) < 1e-9);
    assert.ok(Math.abs(l.total.pnl - (2_000 + 1_000 - 1_010 - 505)) < 1e-9);
    assert.ok(Math.abs(l.accounts[1].pnlPct - l.accounts[0].pnlPct) < 1e-9);
  });

  it("leaves open trades and setups not taken out", () => {
    const open = ruledTrade("2026-10-05T04:30", { pnlUsd: null, resultR: null });
    const passed = ruledTrade("2026-10-05T05:30", { skipped: true, pnlUsd: null, hypotheticalR: 2 });
    assert.equal(ledger([open, passed], limits).total.pnl, 0);
  });
});
