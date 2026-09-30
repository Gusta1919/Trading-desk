/**
 * The migration, on a throwaway in-memory database shaped like the old app: existing
 * trades must survive, strategies must convert, and the GOLD seed must be safe to run
 * twice — no duplicates, and no overwriting edits made after it.
 */
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GOLD_SEED_KEY } from "../server/migrate";
import { setupSchema } from "../server/schema";

type Row = Record<string, unknown>;

/** A database as the previous version left it: old strategy columns, a trade, two strategies. */
function oldDatabase() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE trades (
      id TEXT PRIMARY KEY, date TEXT NOT NULL, symbol TEXT NOT NULL, direction TEXT NOT NULL,
      session TEXT DEFAULT '', setup TEXT DEFAULT '', htf TEXT DEFAULT '', entry_model TEXT DEFAULT '',
      risk_pct REAL NOT NULL, planned_rr REAL, result_r REAL, followed_plan INTEGER, grade TEXT DEFAULT '',
      emotion INTEGER, mistakes TEXT DEFAULT '[]', checklist TEXT DEFAULT '[]', notes TEXT DEFAULT '',
      screenshot TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      strategy_id TEXT, pnl_usd REAL
    );
    CREATE TABLE strategies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, instrument TEXT DEFAULT '', description TEXT DEFAULT '',
      hours_from TEXT DEFAULT '', hours_to TEXT DEFAULT '', session TEXT DEFAULT '', htf TEXT DEFAULT '',
      entry_models TEXT DEFAULT '[]', rules TEXT DEFAULT '[]', invalidation TEXT DEFAULT '',
      target_rr REAL, risk_pct REAL, archived INTEGER DEFAULT 0, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, htfs TEXT DEFAULT '[]', checklist TEXT DEFAULT '[]',
      grade_risk TEXT DEFAULT '{}', reduced_factor REAL
    );
  `);
  const now = "2026-09-29T00:00:00.000Z";
  db.prepare(
    `INSERT INTO strategies (id, name, instrument, entry_models, rules, htfs, checklist, grade_risk, reduced_factor, risk_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "gold-1", "GOLD Model", "XAUUSD", '["BOS","MSS 5m"]', "[]", '["1H","4H","Daily"]',
    JSON.stringify([
      { id: "sweep", label: "HTF reason — tested max twice" },
      { id: "first", label: "First Position Today" },
    ]),
    '{"A+":1,"A":0.5,"B":null,"C":null}', 0.5, 1, now, now,
  );
  db.prepare(
    `INSERT INTO strategies (id, name, instrument, entry_models, rules, htfs, checklist, grade_risk, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "ldn-1", "London sweep", "EURUSD", '["CISD"]', '["Asia range swept","Asia range swept again"]', '["1H"]',
    JSON.stringify([{ id: "asia", label: "Asia range swept", hint: "before 03:00" }]),
    '{"A+":0.75,"B":null}', now, now,
  );
  db.prepare(
    `INSERT INTO trades (id, date, symbol, direction, entry_model, htf, risk_pct, result_r, grade, strategy_id, pnl_usd, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("trade-1", "2026-09-25T04:30", "XAUUSD", "long", "CISD", "1H", 0.5, 1.2, "A", "gold-1", 1200, now, now);
  return db;
}

const strategy = (db: Database.Database, id: string) =>
  db.prepare("SELECT * FROM strategies WHERE id = ?").get(id) as Row;
const json = (v: unknown) => JSON.parse(String(v));

describe("migration", () => {
  it("keeps every existing trade, untouched", () => {
    const db = oldDatabase();
    setupSchema(db);
    const t = db.prepare("SELECT * FROM trades").all() as Row[];
    assert.equal(t.length, 1);
    assert.equal(t[0].entry_model, "CISD"); // legacy value kept
    assert.equal(t[0].grade, "A");
    assert.equal(t[0].pnl_usd, 1200);
    assert.equal(t[0].skipped, 0);
    assert.equal(t[0].flags, "[]");
  });

  it("converts a strategy's checklist, rules, pickers and grade risks", () => {
    const db = oldDatabase();
    setupSchema(db);
    const s = strategy(db, "ldn-1");
    // Checklist first, then old rules it did not already cover (the duplicate is dropped).
    assert.deepEqual(
      json(s.base_rules).map((r: Row) => r.text),
      ["Asia range swept", "Asia range swept again"],
    );
    assert.deepEqual(json(s.factors).map((f: Row) => f.name), ["HTF reason", "Entry model"]);
    assert.deepEqual(
      json(s.grades).map((g: Row) => [g.grade, g.riskPct, g.traded]),
      [
        ["A+", 0.75, true],
        ["A", 0.5, true],
        ["B", 0, false],
        ["C", 0, false],
      ],
    );
  });

  it("fills in the GOLD Model in place — same row, full definition", () => {
    const db = oldDatabase();
    setupSchema(db);
    const all = db.prepare("SELECT id FROM strategies WHERE lower(name) = 'gold model'").all();
    assert.equal(all.length, 1);
    const s = strategy(db, "gold-1");
    assert.equal(json(s.base_rules).length, 7);
    assert.equal(json(s.factors).length, 6);
    assert.equal(s.hours_from, "04:00");
    assert.equal(s.hours_to, "16:00");
    assert.equal(json(s.grades)[2].riskPct, 0.25);
    assert.ok(json(s.base_rules).some((r: Row) => r.auto === "daily-budget"));
  });

  it("is idempotent — running it again changes nothing and duplicates nothing", () => {
    const db = oldDatabase();
    setupSchema(db);
    const before = db.prepare("SELECT * FROM strategies ORDER BY id").all();
    setupSchema(db);
    setupSchema(db);
    assert.deepEqual(db.prepare("SELECT * FROM strategies ORDER BY id").all(), before);
    assert.equal((db.prepare("SELECT count(*) AS n FROM trades").get() as Row).n, 1);
    assert.equal((db.prepare("SELECT count(*) AS n FROM meta WHERE key = ?").get(GOLD_SEED_KEY) as Row).n, 1);
  });

  it("never overwrites edits made after the seed", () => {
    const db = oldDatabase();
    setupSchema(db);
    db.prepare("UPDATE strategies SET base_rules = ? WHERE id = ?").run('[{"id":"x","text":"Mine","hint":""}]', "gold-1");
    setupSchema(db);
    assert.equal(json(strategy(db, "gold-1").base_rules)[0].text, "Mine");
  });

  it("adds your two lines to the limits: 1% per trade, 1% a day", () => {
    const db = oldDatabase();
    setupSchema(db);
    const l = db.prepare("SELECT * FROM limits WHERE id = 1").get() as Row;
    assert.equal(l.max_risk_pct, 1);
    assert.equal(l.daily_stop_pct, 1);
    assert.equal(l.daily_loss_pct, 5); // the firm's line is untouched
  });
});
