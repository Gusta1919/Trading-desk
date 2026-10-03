/**
 * The database's shape: three tables and a version marker.
 *
 *  - trades             every trade and every setup logged as not taken
 *  - checkins           one morning check-in per New York day
 *  - rulebook_versions  the rulebook, one row per saved version; the newest is in force
 *
 * Kept apart from opening the file so the tests can run it against an in-memory
 * database. Safe to run on every start: nothing here rewrites what is already there.
 */
import type Database from "better-sqlite3";
import { FIRST_REASON, FIRST_VERSION, defaultRulebook } from "../src/lib/goldModel.js";
import { insertVersion, listVersions } from "./rulebookStore.js";

/** Written into `meta` by this version of the desk; a database without it is from an older one. */
export const SCHEMA_VERSION = "3";

export function setupSchema(db: Database.Database, now = new Date()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id                 TEXT PRIMARY KEY,
      date               TEXT NOT NULL,              -- New York wall clock, "YYYY-MM-DDTHH:mm"
      symbol             TEXT NOT NULL,
      direction          TEXT NOT NULL,              -- long | short
      session            TEXT NOT NULL DEFAULT '',
      risk_pct           REAL NOT NULL DEFAULT 0,
      planned_risk_pct   REAL,                       -- what the rules allowed (derived)
      planned_rr         REAL,
      result_r           REAL,                       -- derived from pnl_usd
      pnl_usd            REAL,
      risk_usd           REAL,                       -- derived
      grade              TEXT NOT NULL DEFAULT '',
      setup_snapshot     TEXT,                       -- the rules and answers it was graded with (JSON)
      rulebook_version   TEXT NOT NULL,
      flags              TEXT NOT NULL DEFAULT '[]', -- derived
      flag_note          TEXT NOT NULL DEFAULT '',
      skipped            INTEGER NOT NULL DEFAULT 0, -- logged, not taken
      hypothetical_r     REAL,
      box_size           REAL,
      sweep_depth        REAL,
      took_15m_swing     INTEGER,
      level_sweep        INTEGER,
      htf_reasons        TEXT NOT NULL DEFAULT '[]',
      poi_tests          TEXT NOT NULL DEFAULT '',
      bias_match         INTEGER,
      exit_time          TEXT NOT NULL DEFAULT '',
      exit_reason        TEXT NOT NULL DEFAULT '',
      early_stop_move    INTEGER,
      release_at_be      INTEGER,
      mfe_r              REAL,
      mae_r              REAL,
      max_fav_r          REAL,
      target_before_stop TEXT NOT NULL DEFAULT '',
      emotion            INTEGER,
      mistakes           TEXT NOT NULL DEFAULT '[]',
      notes              TEXT NOT NULL DEFAULT '',
      screenshot         TEXT NOT NULL DEFAULT '',
      screenshot_after   TEXT NOT NULL DEFAULT '',
      news               TEXT NOT NULL DEFAULT '[]',
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trades_date ON trades(date);

    CREATE TABLE IF NOT EXISTS checkins (
      date       TEXT PRIMARY KEY,                   -- New York day, "YYYY-MM-DD"
      answers    TEXT NOT NULL DEFAULT '{}',
      note       TEXT NOT NULL DEFAULT '',
      score      INTEGER NOT NULL,
      verdict    TEXT NOT NULL,                      -- ready | careful | sit-out (advice only)
      reflection TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rulebook_versions (
      version    TEXT PRIMARY KEY,
      reason     TEXT NOT NULL,
      doc        TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', ?)").run(SCHEMA_VERSION);

  // A new desk starts with the GOLD Model as its first version.
  if (!listVersions(db).length) insertVersion(db, FIRST_VERSION, FIRST_REASON, defaultRulebook(), now.toISOString());
}

/** Whether an open database was made by this version of the desk. */
export function isCurrentSchema(db: Database.Database): boolean {
  const meta = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (!meta) return false;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined;
  return row?.value === SCHEMA_VERSION;
}
