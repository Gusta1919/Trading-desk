/**
 * Demo history for trying out the Risk lab, the Coach and Compare.
 *
 *   npm run demo:add      adds ~9 weeks of GOLD Model trades and check-ins
 *   npm run demo:remove   removes every one of them again
 *
 * Everything goes through the running app's own API, so percentages and R are worked
 * out exactly as for real trades. Each demo trade's notes start with "[demo]" and each
 * demo check-in's note is "[demo]" — that tag is how `remove` finds them, and nothing
 * without it is ever touched. Days that already have a real check-in are skipped.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUESTIONS, evaluate } from "../src/lib/checkin";
import { computeGrade } from "../src/lib/grading";
import { allowedRisk, dayBudget, flagsFor, gradeCard, gradeRisk } from "../src/lib/risk";
import type { ChoiceFactor, Limits, Strategy, Trade, TradeInput } from "../src/lib/types";

const API = "http://127.0.0.1:3848/api";
const TAG = "[demo]";
const LAST_DAY = "2026-09-28"; // the day before your first real trade
const TRADING_DAYS = 45;

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, "..", "data", "trade-assistant.db");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${url}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : res.json()) as T;
}

/** Same numbers every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260930);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
const chance = (p: number) => rand() < p;
const round = (x: number, d = 2) => Number(x.toFixed(d));

/** The weekdays before LAST_DAY, oldest first. */
function weekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${LAST_DAY}T12:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

/** How each grade tends to play out: chance of a win, and the size of wins. */
const PROFILE: Record<string, { win: number; lo: number; hi: number }> = {
  // B is set up to lose slightly, so the Coach's "this rung is losing money" check has something to find.
  "A+": { win: 0.52, lo: 1.3, hi: 3.0 },
  A: { win: 0.45, lo: 1.0, hi: 2.3 },
  B: { win: 0.28, lo: 1.0, hi: 1.8 },
  C: { win: 0.3, lo: 1.0, hi: 2.0 },
};
/** One scripted day: an A+ stops out for the full 1%, then one more trade after the stop. */
const STOP_DAY = 30;

function outcomeR(grade: string) {
  const p = PROFILE[grade];
  const r = rand();
  if (r < 0.06) return round(between(-0.1, 0.1)); // scratched at breakeven
  if (r < 0.06 + p.win) return round(between(p.lo, p.hi));
  return chance(0.15) ? round(between(-0.7, -0.4)) : round(between(-1.05, -0.95)); // early cut, or full stop
}

async function add() {
  const [strategies, trades, checkins, limits] = await Promise.all([
    api<Strategy[]>("/strategies"),
    api<Trade[]>("/trades"),
    api<{ date: string }[]>("/checkins"),
    api<Limits>("/limits"),
  ]);
  if (trades.some((t) => t.notes.startsWith(TAG))) {
    console.log("Demo trades are already in — run `npm run demo:remove` first to start over.");
    return;
  }
  const s = strategies.find((x) => x.name.trim().toLowerCase() === "gold model") ?? strategies[0];
  if (!s) throw new Error("No strategy to log demo trades against — create one first.");

  const allRules = s.baseRules.map((r) => r.id);
  const checkinDays = new Set(checkins.map((c) => c.date));

  /** Every answer at its best — an A+. */
  const best = () =>
    Object.fromEntries(s.factors.map((f) => [f.id, f.kind === "number" ? 80 : (f as ChoiceFactor).options[0].id]));

  /** A setup's answers: mostly good, sometimes not — which is what a real ladder sees. */
  function answers() {
    const a: Record<string, string | number> = {};
    for (const f of s.factors) {
      if (f.kind === "number") {
        // Mostly strong readings, with a tail of weaker ones.
        a[f.id] = Math.round(chance(0.7) ? between(66, 88) : between(48, 70));
      } else {
        const opts = (f as ChoiceFactor).options;
        // Better options are listed first; lean towards them.
        const i = rand() < 0.8 ? 0 : rand() < 0.7 ? Math.min(1, opts.length - 1) : Math.floor(rand() * opts.length);
        a[f.id] = opts[i].id;
      }
    }
    return a;
  }

  let balance = limits.startBalance;
  const made: Trade[] = [];
  let tookAfterStop = false;
  let n = 0;

  for (const [d, day] of weekdays(TRADING_DAYS).entries()) {
    const scripted = d === STOP_DAY;
    // Most days one setup; some days a second.
    const setups = scripted || chance(0.35) ? 2 : 1;
    for (let k = 0; k < setups; k++) {
      const hour = k === 0 ? pick([4, 4, 5, 5, 6, 7, 8, 9]) : pick([9, 10, 11]);
      const date = `${day}T${String(hour).padStart(2, "0")}:${String(Math.floor(between(0, 59))).padStart(2, "0")}`;
      const budget = dayBudget(made, day, limits, { before: date });
      // Once — and only once — a trade is taken after the stop, for the Coach to catch.
      if (budget.stopHit && tookAfterStop) break;

      const ticked =
        !scripted && chance(0.08) ? allRules.filter((_, i) => i !== Math.floor(rand() * allRules.length)) : allRules;
      const ans = scripted && k === 0 ? best() : answers();
      const result = computeGrade(s, { ticked, answers: ans });
      const grade = result.grade;
      const card = gradeCard(s, grade);
      const allowed = allowedRisk(gradeRisk(s, grade), budget, limits);
      const r = scripted && k === 0 ? -1 : outcomeR(grade);
      const skipped = !card?.traded;

      let risk = allowed;
      if (budget.stopHit) {
        risk = 0.5; // the one trade taken after the stop — for the Coach to catch
        tookAfterStop = true;
      } else if (!skipped && chance(0.07)) {
        risk = round(allowed + 0.25); // sized up by feel
      }
      const flags = skipped ? [] : flagsFor({ riskPct: risk, allowed, card, budget, limits });

      const fees = skipped ? 0 : round(between(12, 45));
      const pnl = skipped ? null : round((r * risk * balance) / 100 - fees);
      if (pnl != null) balance += pnl;

      const mistakes: string[] = [];
      if (!skipped && r < 0 && chance(0.2)) mistakes.push(pick(["Late entry", "Moved stop", "FOMO entry"]));
      if (!skipped && r > 0 && r < 1.5 && chance(0.25)) mistakes.push("Early exit");
      if (flags.includes("over_risk")) mistakes.push("Oversized");

      const input: TradeInput = {
        date,
        symbol: "XAUUSD",
        direction: chance(0.5) ? "long" : "short",
        session: hour < 8 ? "London" : "New York",
        setup: "",
        strategyId: s.id,
        htf: "",
        entryModel: "",
        riskPct: skipped ? 0 : risk,
        plannedRiskPct: skipped ? null : allowed,
        plannedRR: pick([1.5, 2, 2, 2.5, 3]),
        resultR: null,
        followedPlan: skipped ? null : mistakes.length === 0 && flags.length === 0,
        grade,
        emotion: pick([1, 2, 2, 2, 3, 3, 4]),
        mistakes,
        checklist: ticked,
        checklistTotal: allRules.length,
        setupSnapshot: {
          strategyName: s.name,
          baseRules: s.baseRules,
          factors: s.factors,
          grades: s.grades,
          ticked,
          answers: ans,
          grade,
        },
        flags,
        flagNote: flags.length ? pick(["felt sure about it", "wanted to make back yesterday", "setup looked cleaner than it graded"]) : "",
        skipped,
        hypotheticalR: skipped ? r : null,
        expectedMinutes: pick([60, 90, 120, 180]),
        costPct: null,
        boxSize: round(between(3.5, 14), 1),
        pnlUsd: pnl,
        news: [],
        notes: `${TAG} ${skipped ? `skipped ${grade} setup` : `${grade} setup`}`,
        screenshot: "",
      };
      const saved = await api<Trade>("/trades", { method: "POST", body: JSON.stringify(input) });
      made.push(saved);
      n++;
    }

    // A morning check-in, unless you already have a real one for that day.
    if (!checkinDays.has(day)) {
      const a: Record<string, number> = {};
      for (const q of QUESTIONS) {
        // Mostly fine answers; now and then a rough morning.
        const fine = q.options.map((o, i) => ({ o, i })).filter(({ o }) => o.risk === 0).map(({ i }) => i);
        a[q.id] = chance(0.82) && fine.length ? pick(fine) : Math.floor(rand() * q.options.length);
      }
      const { score, verdict } = evaluate(a);
      await api(`/checkins/${day}`, {
        method: "PUT",
        body: JSON.stringify({ answers: a, note: TAG, score, verdict, reflection: "" }),
      });
    }
  }

  const skippedCount = made.filter((t) => t.skipped).length;
  console.log(
    `Added ${n} demo setups over ${TRADING_DAYS} trading days (${n - skippedCount} taken, ${skippedCount} skipped) on ${s.name}, plus check-ins.`,
  );
}

async function remove() {
  const trades = await api<Trade[]>("/trades");
  const demo = trades.filter((t) => t.notes.startsWith(TAG));
  // Through the API, so the balance and every later trade's % are recalculated.
  for (const t of demo) await api(`/trades/${t.id}`, { method: "DELETE" });

  // Check-ins have no delete route; remove only the tagged ones, straight from the file.
  const db = new Database(DB_PATH);
  const gone = db.prepare("DELETE FROM checkins WHERE note = ?").run(TAG).changes;
  db.close();
  console.log(`Removed ${demo.length} demo trades and ${gone} demo check-ins.`);
}

const mode = process.argv[2];
(mode === "remove" ? remove() : mode === "add" ? add() : Promise.reject(new Error("Use: add | remove"))).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
