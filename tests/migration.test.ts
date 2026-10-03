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
import { RulebookError, currentRulebook, getVersion, listVersions, saveRulebook } from "../server/rulebookStore";

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

describe("migration to the rulebook", () => {
  /** The old database with the demo rows and real check-ins the live desk had. */
  function withDemo() {
    const db = oldDatabase();
    setupSchema(db);
    db.exec("DELETE FROM meta WHERE key LIKE 'rulebook:%'; DELETE FROM rulebook_versions; DELETE FROM open_items;");
    const now = "2026-10-01T00:00:00.000Z";
    const trade = db.prepare(
      "INSERT INTO trades (id, date, symbol, direction, risk_pct, notes, created_at, updated_at) VALUES (?, ?, 'XAUUSD', 'long', 0.5, ?, ?, ?)",
    );
    trade.run("demo-1", "2026-09-01T04:30", "[demo] A setup", now, now);
    trade.run("real-1", "2026-09-02T04:30", "my own [demo] note", now, now);
    const checkin = db.prepare(
      "INSERT INTO checkins (date, answers, note, score, verdict, created_at) VALUES (?, '{}', ?, 90, 'ready', ?)",
    );
    checkin.run("2026-09-01", "[demo]", now);
    checkin.run("2026-10-02", "", now);
    return db;
  }

  it("removes only the tagged demo rows and keeps real ones", () => {
    const db = withDemo();
    setupSchema(db);
    const ids = (db.prepare("SELECT id FROM trades ORDER BY id").all() as Row[]).map((r) => r.id);
    assert.deepEqual(ids, ["real-1", "trade-1"]);
    const days = (db.prepare("SELECT date FROM checkins").all() as Row[]).map((r) => r.date);
    assert.deepEqual(days, ["2026-10-02"]);
  });

  it("writes v1.2 once, with the limits carried over and the new defaults only where untouched", () => {
    const db = withDemo();
    db.prepare("UPDATE limits SET daily_stop_pct = 0.75 WHERE id = 1").run(); // changed by you
    setupSchema(db);
    setupSchema(db);
    const rows = db.prepare("SELECT version, reason FROM rulebook_versions ORDER BY version").all() as Row[];
    // v1.2, v1.3 retiring the written plan, v1.4 condensing the text, 2.0 the fresh start,
    // 2.1 the entry window ticked by hand — each once.
    assert.deepEqual(rows.map((r) => r.version), ["1.2", "1.3", "1.4", "2.0", "2.1"]);
    const doc = getVersion(db, "1.2")!.doc;
    assert.equal(doc.limits.maxRiskPct, 0.5); // was the old default of 1
    assert.equal(doc.limits.dailyStopPct, 0.75); // yours, kept
    assert.equal(doc.limits.weeklyStopPct, 2);
    assert.equal(doc.limits.openingBalance, 193_933.27);
    assert.equal(doc.history.length, 2);
  });

  it("adds the trade columns and the new tables, and seeds the open items once", () => {
    const db = withDemo();
    setupSchema(db);
    setupSchema(db);
    const cols = (db.prepare("PRAGMA table_info(trades)").all() as Row[]).map((c) => c.name);
    for (const c of ["rulebook_version", "stop_price", "mfe_price", "exit_reason", "screenshot_after"]) {
      assert.ok(cols.includes(c), c);
    }
    for (const t of ["plans", "rulebook_versions", "open_items"]) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t);
    }
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM open_items").get() as Row).n, 5);
  });

  it("never touches the strategies, limits, news-rules or legacy tables", () => {
    const db = withDemo();
    const before = db.prepare("SELECT * FROM strategies ORDER BY id").all();
    const limits = db.prepare("SELECT * FROM limits").all();
    setupSchema(db);
    assert.deepEqual(db.prepare("SELECT * FROM strategies ORDER BY id").all(), before);
    assert.deepEqual(db.prepare("SELECT * FROM limits").all(), limits);
  });
});

describe("rulebook versions", () => {
  it("saves a change as the next version, with its reason", () => {
    const db = oldDatabase();
    setupSchema(db);
    const doc = currentRulebook(db).doc;
    doc.grades[1].riskPct = 0.25;
    const saved = saveRulebook(db, doc, "A down to a quarter while the edge is unproven");
    assert.equal(saved.version, "2.2");
    assert.equal(currentRulebook(db).doc.grades[1].riskPct, 0.25);
    assert.equal(getVersion(db, "2.1")!.doc.grades[1].riskPct, 0.5); // the old one is untouched
    assert.equal(saveRulebook(db, doc, "big change", "major").version, "3.0");
  });

  it("refuses a change without a reason, or with a broken document", () => {
    const db = oldDatabase();
    setupSchema(db);
    const doc = currentRulebook(db).doc;
    assert.throws(() => saveRulebook(db, doc, "  "), RulebookError);
    assert.throws(() => saveRulebook(db, { ...doc, sections: [{ id: "x", title: "X", body: "{{nope}}" }] }, "why"), RulebookError);
    assert.equal(listVersions(db).length, 5);
  });

  it("a trade keeps the version it was graded under after the rulebook is edited", () => {
    const db = oldDatabase();
    setupSchema(db);
    db.prepare(
      "INSERT INTO trades (id, date, symbol, direction, risk_pct, rulebook_version, created_at, updated_at) VALUES ('t', '2026-10-05T04:30', 'XAUUSD', 'long', 0.5, '1.2', 'x', 'x')",
    ).run();
    saveRulebook(db, currentRulebook(db).doc, "a wording change");
    assert.equal((db.prepare("SELECT rulebook_version FROM trades WHERE id = 't'").get() as Row).rulebook_version, "1.2");
  });
});

describe("v1.3 — the written plan retired", () => {
  it("writes v1.3 from the version in force, once, and keeps v1.2 and every plan row", () => {
    const db = oldDatabase();
    setupSchema(db);
    db.prepare("INSERT INTO plans (date, bias, created_at, updated_at) VALUES ('2026-10-01', 'bullish', 'x', 'x')").run();
    setupSchema(db);
    const v13 = getVersion(db, "1.3")!;
    assert.ok(v13.reason.startsWith("Written daily plan retired"));
    assert.ok(v13.doc.baseRules.some((r) => r.id === "bias-decided"));
    assert.equal(v13.doc.planBy, undefined);
    assert.ok(getVersion(db, "1.2")!.doc.baseRules.some((r) => r.id === "plan")); // history untouched
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM plans").get() as Row).n, 1);
    assert.equal(listVersions(db).length, 5); // and v1.4, 2.0 and 2.1 on top
  });

  it("carries your own edits from the version in force into v1.3", () => {
    const db = oldDatabase();
    // Stop after v1.2, edit it, then let the plan migration run.
    setupSchema(db);
    db.prepare("DELETE FROM rulebook_versions WHERE version IN ('1.3', '1.4', '2.0', '2.1')").run();
    db.prepare(
      "DELETE FROM meta WHERE key IN ('rulebook:v1.3-plan-retired', 'rulebook:v1.4-condensed', 'rulebook:v2.0-fresh-start', 'rulebook:entry-window-by-hand')",
    ).run();
    const doc = currentRulebook(db).doc;
    doc.limits.dailyStopPct = 0.8;
    saveRulebook(db, doc, "tighter day"); // v1.3 by you
    setupSchema(db);
    const retired = getVersion(db, "1.4")!;
    assert.ok(retired.reason.startsWith("Written daily plan retired"));
    assert.equal(retired.doc.limits.dailyStopPct, 0.8);
    assert.ok(!retired.doc.baseRules.some((r) => r.id === "plan"));
  });
});

describe("v1.4 — the rulebook condensed", () => {
  it("writes v1.4 from the version in force, once, with every value unchanged", () => {
    const db = oldDatabase();
    setupSchema(db);
    setupSchema(db);
    const v13 = getVersion(db, "1.3")!.doc;
    const v14 = getVersion(db, "1.4")!;
    assert.ok(v14.reason.startsWith("Rulebook condensed"));
    assert.ok(v14.doc.sections.some((s) => s.reference));
    const { sections: _a, flow: _b, version: _c, ...valuesNow } = v14.doc;
    const { sections: _d, flow: _e, version: _f, ...valuesBefore } = v13;
    assert.deepEqual(valuesNow, valuesBefore);
    assert.equal(listVersions(db).length, 5);
  });

  it("carries a change you saved on v1.3 into v1.4", () => {
    const db = oldDatabase();
    setupSchema(db);
    db.prepare("DELETE FROM rulebook_versions WHERE version IN ('1.4', '2.0', '2.1')").run();
    db.prepare("DELETE FROM meta WHERE key IN ('rulebook:v1.4-condensed', 'rulebook:v2.0-fresh-start', 'rulebook:entry-window-by-hand')").run();
    const doc = currentRulebook(db).doc;
    doc.limits.weeklyStopPct = 1.5;
    saveRulebook(db, doc, "tighter week"); // v1.4 by you
    setupSchema(db);
    const condensed = getVersion(db, "1.5")!;
    assert.ok(condensed.reason.startsWith("Rulebook condensed"));
    assert.equal(condensed.doc.limits.weeklyStopPct, 1.5);
    assert.ok(condensed.doc.sections.some((s) => s.id === "glance"));
  });
});

describe("2.0 — a fresh start", () => {
  it("writes 2.0 once, as a major version, and starts the changelog there", () => {
    const db = oldDatabase();
    setupSchema(db);
    setupSchema(db);
    const fresh = getVersion(db, "2.0")!;
    assert.ok(fresh.reason.startsWith("Fresh start"));
    assert.equal(fresh.doc.changelogFrom, "2.0");
    assert.equal(fresh.doc.consequences.anyBreak, true);
    assert.ok(getVersion(db, "1.4")!.doc.factors.some((f) => f.id === "fvg")); // history untouched
    assert.equal(listVersions(db).length, 5);
  });

  it("then has you tick the entry window yourself, keeping the automatic check on what came before", () => {
    const db = oldDatabase();
    setupSchema(db);
    setupSchema(db);
    const current = currentRulebook(db);
    assert.equal(current.version, "2.1");
    assert.ok(current.reason.includes("entry window"));
    assert.equal(current.doc.baseRules.find((r) => r.id === "window")!.auto, undefined);
    assert.equal(getVersion(db, "2.0")!.doc.baseRules.find((r) => r.id === "window")!.auto, "entry-window");
  });
});
