/**
 * The database's shape, and every step that brings an older database up to it.
 *
 * Kept apart from opening the file so the same steps can run against a throwaway
 * in-memory database in the tests. Every step here is safe to run again: a column
 * is only added when missing, and data is moved aside, never deleted.
 */
import type Database from "better-sqlite3";
import { migrateStrategyDefinitions, seedGoldModel } from "./migrate.js";

export function setupSchema(db: Database.Database) {
  /**
   * v1 of the app stored prop-firm accounts in USD. v2 is percentage-only.
   * If the old tables are still around, move them aside (never delete data).
   */
  function retireLegacySchema() {
    const cols = db.prepare("PRAGMA table_info(trades)").all() as { name: string }[];
    // v1 stored prices and quantities; v2 never has an entry_price column.
    // (Don't test for strategy_id — v2 uses that name too, for the strategy link.)
    const isLegacy = cols.some((c) => c.name === "entry_price");
    const alreadyRetired = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_trades'")
      .get();
    if (!isLegacy || alreadyRetired) return;

    db.exec(`
      ALTER TABLE trades RENAME TO legacy_trades;
      ALTER TABLE strategies RENAME TO legacy_strategies;
      ALTER TABLE journal_entries RENAME TO legacy_journal_entries;
      DROP INDEX IF EXISTS idx_trades_strategy;
      DROP INDEX IF EXISTS idx_journal_strategy;
    `);
  }

  retireLegacySchema();

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id            TEXT PRIMARY KEY,
      date          TEXT NOT NULL,
      symbol        TEXT NOT NULL,
      direction     TEXT NOT NULL,
      session       TEXT DEFAULT '',
      setup         TEXT DEFAULT '',
      htf           TEXT DEFAULT '',
      entry_model   TEXT DEFAULT '',
      risk_pct      REAL NOT NULL,
      planned_rr    REAL,
      result_r      REAL,
      followed_plan INTEGER,
      grade         TEXT DEFAULT '',
      emotion       INTEGER,
      mistakes      TEXT DEFAULT '[]',
      checklist     TEXT DEFAULT '[]',
      notes         TEXT DEFAULT '',
      screenshot    TEXT DEFAULT '',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);
  `);

  function addColumn(column: string, definition: string) {
    const cols = db.prepare("PRAGMA table_info(trades)").all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE trades ADD COLUMN ${column} ${definition}`);
    }
  }

  addColumn("htf", "TEXT DEFAULT ''");
  addColumn("entry_model", "TEXT DEFAULT ''");
  addColumn("checklist", "TEXT DEFAULT '[]'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      date       TEXT PRIMARY KEY,
      answers    TEXT NOT NULL DEFAULT '{}',
      note       TEXT DEFAULT '',
      score      INTEGER NOT NULL,
      verdict    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  {
    const cols = db.prepare("PRAGMA table_info(checkins)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "reflection")) {
      db.exec("ALTER TABLE checkins ADD COLUMN reflection TEXT DEFAULT ''");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      instrument    TEXT DEFAULT '',
      description   TEXT DEFAULT '',
      hours_from    TEXT DEFAULT '',
      hours_to      TEXT DEFAULT '',
      session       TEXT DEFAULT '',
      htf           TEXT DEFAULT '',
      entry_models  TEXT DEFAULT '[]',
      rules         TEXT DEFAULT '[]',
      invalidation  TEXT DEFAULT '',
      target_rr     REAL,
      risk_pct      REAL,
      news_filter   TEXT DEFAULT '',
      archived      INTEGER DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  addColumn("strategy_id", "TEXT");

  /** Strategy columns added after the first version. */
  function addStrategyColumn(column: string, definition: string) {
    const cols = db.prepare("PRAGMA table_info(strategies)").all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE strategies ADD COLUMN ${column} ${definition}`);
    }
  }

  addStrategyColumn("sessions", "TEXT DEFAULT '[]'");
  addStrategyColumn("htfs", "TEXT DEFAULT '[]'");
  addStrategyColumn("rr_from", "REAL");
  addStrategyColumn("rr_to", "REAL");
  addStrategyColumn("reduced_risk_pct", "REAL");
  addStrategyColumn("checklist", "TEXT DEFAULT '[]'");
  /*
   * The "box": the range a setup is measured against — the Asia range for a London
   * sweep, an opening range, a consolidation. Its size decides whether the sweep is
   * clean or whether price chops through both sides, so it is worth logging per trade.
   */
  addStrategyColumn("box_label", "TEXT DEFAULT ''");
  addStrategyColumn("box_unit", "TEXT DEFAULT ''");
  addStrategyColumn("box_min", "REAL");
  addStrategyColumn("box_max", "REAL");
  /* Max risk per setup grade, as JSON: { "A+": 1, "A": 0.5, "B": null } — null = not traded. */
  addStrategyColumn("grade_risk", "TEXT DEFAULT '{}'");
  /* Reduced risk as a share of the normal risk (0.25 / 0.5 / 0.75), so it follows the grade. */
  addStrategyColumn("reduced_factor", "REAL");
  /*
   * News rules used to live on each strategy. They are the same for every strategy
   * this desk runs, so they moved to one row here: one place to edit, no chance of
   * two strategies quietly disagreeing about whether CPI is tradeable.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_rules (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      forbidden        TEXT    NOT NULL DEFAULT '["cpi","adp","nfp","rates"]',
      block_currencies TEXT    NOT NULL DEFAULT '["USD","EUR","GBP"]',
      updated_at       TEXT    NOT NULL
    );
    INSERT OR IGNORE INTO news_rules (id, updated_at) VALUES (1, datetime('now'));
  `);

  /* Dropped from strategies: the rules are global now. */
  for (const col of ["news_block_min", "news_forbidden", "news_block_currencies", "news_filter"]) {
    const cols = db.prepare("PRAGMA table_info(strategies)").all() as { name: string }[];
    if (cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE strategies DROP COLUMN ${col}`);
    }
  }

  // A trade remembers how many checks its strategy had at the time.
  addColumn("checklist_total", "INTEGER DEFAULT 5");
  /* What commission and swap took out of this trade, as a % of the account.
     Null means it was never measured — a hand-typed trade, not a free one. */
  addColumn("cost_pct", "REAL");
  /* How wide the strategy's box was on this trade. */
  addColumn("box_size", "REAL");
  /*
   * Profit or loss in account currency, as the broker reports it. This is what gets
   * typed in; the percentage and the R multiple are derived from it against the
   * account balance at the time, so the journal compounds the way the account does.
   */
  addColumn("pnl_usd", "REAL");
  /* The news on the trade's day, copied in as JSON — the calendar feed forgets after two weeks. */
  addColumn("news", "TEXT DEFAULT '[]'");

  // One-off migration from the single-value fields to the list ones.
  db.exec(`
    UPDATE strategies SET sessions = json_array(session)
      WHERE (sessions IS NULL OR sessions = '[]') AND session != '';
    UPDATE strategies SET htfs = json_array(htf)
      WHERE (htfs IS NULL OR htfs = '[]') AND htf != '';
    UPDATE strategies SET rr_from = target_rr, rr_to = target_rr
      WHERE rr_from IS NULL AND target_rr IS NOT NULL;
  `);

  /*
   * The prop firm's two hard lines. Stored as percentages of the starting balance,
   * which is how FTMO states them and how this journal measures everything.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS limits (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      enabled        INTEGER NOT NULL DEFAULT 1,
      start_balance  REAL    NOT NULL DEFAULT 200000,
      daily_loss_pct REAL    NOT NULL DEFAULT 5,
      max_loss_pct   REAL    NOT NULL DEFAULT 10,
      updated_at     TEXT    NOT NULL
    );
    INSERT OR IGNORE INTO limits (id, enabled, daily_loss_pct, max_loss_pct, updated_at)
    VALUES (1, 1, 5, 10, datetime('now'));
  `);

  /* Older databases predate the starting balance. */
  {
    const cols = db.prepare("PRAGMA table_info(limits)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "start_balance")) {
      db.exec("ALTER TABLE limits ADD COLUMN start_balance REAL NOT NULL DEFAULT 200000");
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS weeks (
      week       TEXT PRIMARY KEY,   -- ISO week, e.g. "2026-W39"
      bias       TEXT DEFAULT '',    -- long | short | neutral | ''
      reasoning  TEXT DEFAULT '',
      levels     TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // The strategy system: base rules, grade factors, grade cards — converted once, never wiped.
  migrateStrategyDefinitions(db);
  seedGoldModel(db);
}
