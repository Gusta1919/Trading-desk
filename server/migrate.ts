/**
 * Moves strategies from the old shape — a checklist, a rules list, HTF and entry-model
 * picks, a risk per grade — to the new one: base rules, grade factors and grade cards.
 *
 * Nothing is deleted. The old columns stay where they are, a strategy is converted
 * once (a flag on its row records it), and the GOLD Model seed runs once (a key in
 * the meta table records it) — so running any of this again changes nothing.
 */
import type Database from "better-sqlite3";
import { nextVersion } from "../src/lib/rulebook.js";
import {
  CONDENSED_REASON,
  FIRST_REASON,
  FIRST_VERSION,
  FRESH_START_REASON,
  WINDOW_BY_HAND_REASON,
  CHECKIN_CLOSES_REASON,
  JOURNAL_V23_REASON,
  ONE_DAY_OFF_REASON,
  oneDayOff,
  checkinCloses,
  journalV23,
  OPEN_ITEMS,
  PLAN_RETIRED_REASON,
  condenseRulebook,
  defaultRulebook,
  freshStart,
  retirePlan,
  windowByHand,
} from "../src/lib/rulebookText.js";
import { currentRulebook, insertVersion } from "./rulebookStore.js";

type Db = Database.Database;
type Row = Record<string, unknown>;
type Grade = "A+" | "A" | "B" | "C";

const GRADES: Grade[] = ["A+", "A", "B", "C"];
const DEFAULT_RISK: Record<Grade, { riskPct: number; traded: boolean }> = {
  "A+": { riskPct: 1, traded: true },
  A: { riskPct: 0.5, traded: true },
  B: { riskPct: 0.25, traded: true },
  C: { riskPct: 0, traded: false },
};
/** Checklist items that were the desk's own rules, not a strategy's — now handled by the daily budget. */
const DESK_ITEMS = new Set(["first", "one-a-day", "max-risk"]);

const id = () => crypto.randomUUID().slice(0, 8);
const parse = <T>(raw: unknown, fallback: T): T => {
  try {
    return raw == null || raw === "" ? fallback : (JSON.parse(String(raw)) as T);
  } catch {
    return fallback;
  }
};

function columns(db: Db, table: string) {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

function addColumn(db: Db, table: string, column: string, definition: string) {
  if (!columns(db, table).has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** The columns the new strategy system needs. */
export function addStrategySystemColumns(db: Db) {
  addColumn(db, "strategies", "base_rules", "TEXT DEFAULT '[]'");
  addColumn(db, "strategies", "factors", "TEXT DEFAULT '[]'");
  addColumn(db, "strategies", "grades", "TEXT DEFAULT '[]'");
  addColumn(db, "strategies", "value_per_point", "REAL");
  addColumn(db, "strategies", "definition_migrated", "INTEGER NOT NULL DEFAULT 0");

  addColumn(db, "trades", "setup_snapshot", "TEXT");
  addColumn(db, "trades", "planned_risk_pct", "REAL");
  addColumn(db, "trades", "flags", "TEXT DEFAULT '[]'");
  addColumn(db, "trades", "flag_note", "TEXT DEFAULT ''");
  addColumn(db, "trades", "skipped", "INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "trades", "hypothetical_r", "REAL");
  addColumn(db, "trades", "expected_minutes", "INTEGER");

  // Your own two lines, shared by every strategy: 1% a trade, 1% a day.
  addColumn(db, "limits", "max_risk_pct", "REAL NOT NULL DEFAULT 1");
  addColumn(db, "limits", "daily_stop_pct", "REAL NOT NULL DEFAULT 1");

  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
}

/** Converts every strategy that has not been converted yet. */
export function migrateStrategyDefinitions(db: Db) {
  addStrategySystemColumns(db);
  const rows = db.prepare("SELECT * FROM strategies WHERE definition_migrated = 0").all() as Row[];
  const update = db.prepare(
    "UPDATE strategies SET base_rules = ?, factors = ?, grades = ?, definition_migrated = 1 WHERE id = ?",
  );

  db.transaction(() => {
    for (const row of rows) {
      // Base rules: the old checklist first, then any old rule it did not already cover.
      const checklist = parse<{ id: string; label: string; hint?: string }[]>(row.checklist, []);
      const baseRules = checklist
        .filter((c) => c && !DESK_ITEMS.has(c.id) && String(c.label ?? "").trim())
        .map((c) => ({ id: String(c.id), text: String(c.label).trim(), hint: String(c.hint ?? "") }));
      const seen = new Set(baseRules.map((r) => r.text.toLowerCase()));
      for (const text of parse<string[]>(row.rules, [])) {
        const t = String(text ?? "").trim();
        if (t && !seen.has(t.toLowerCase())) {
          baseRules.push({ id: id(), text: t, hint: "" });
          seen.add(t.toLowerCase());
        }
      }

      // The old fixed pickers become ordinary choice factors. Every option starts at A+:
      // the old data never said which answers were better, so none is assumed.
      const factors: unknown[] = [];
      const htfs = parse<string[]>(row.htfs, []);
      if (htfs.length) {
        factors.push({
          id: id(),
          name: "HTF reason",
          hint: "",
          kind: "choice",
          options: htfs.map((h) => ({ id: id(), label: h, cap: "A+" })),
        });
      }
      const models = parse<string[]>(row.entry_models, []);
      if (models.length) {
        factors.push({
          id: id(),
          name: "Entry model",
          hint: "",
          kind: "choice",
          options: models.map((m) => ({ id: id(), label: m, cap: "A+" })),
        });
      }

      // Grade cards from the old per-grade risk: a number is the risk, null is "Don't".
      const old = parse<Record<string, number | null>>(row.grade_risk, {});
      const grades = GRADES.map((g) => {
        const v = old[g];
        return {
          grade: g,
          riskPct: typeof v === "number" ? v : v === null ? 0 : DEFAULT_RISK[g].riskPct,
          traded: v === null ? false : typeof v === "number" ? true : DEFAULT_RISK[g].traded,
          description: "",
        };
      });

      update.run(JSON.stringify(baseRules), JSON.stringify(factors), JSON.stringify(grades), row.id);
    }
  })();
}

/* ── Seed: the GOLD Model, filled in once ────────────────────────────── */

export const GOLD_SEED_KEY = "seed:gold-model:v1";

const choice = (name: string, options: [string, Grade][], hint = "") => ({
  id: id(),
  name,
  hint,
  kind: "choice",
  options: options.map(([label, cap]) => ({ id: id(), label, cap })),
});

export function goldModelDefinition() {
  return {
    instrument: "XAUUSD",
    description:
      "Sweep one side of the CRT 3–4AM (NY) box and target the opposite side after proper price action.",
    sessions: ["London", "New York"],
    hoursFrom: "04:00",
    hoursTo: "16:00",
    rrFrom: 1,
    rrTo: 4,
    boxLabel: "CRT 3–4AM box",
    invalidation: "A 5m MSS in the opposite direction.",
    baseRules: [
      { id: id(), text: "Price swept one side of the CRT 3–4AM box between 04:00 and 16:00 NY", hint: "" },
      { id: id(), text: "The sweep is a wick that closes back inside the box", hint: "not a candle body closing beyond it" },
      { id: id(), text: "HTF reason (1H, 4H or Daily) tested no more than 2 times", hint: "" },
      { id: id(), text: "5m BOS or MSS after the sweep", hint: "" },
      { id: id(), text: "RR greater than 1:1 including fees", hint: "" },
      {
        id: id(),
        text: "No red news during the expected trade duration",
        hint: "exit before it if the trade runs long",
      },
      { id: id(), text: "Daily loss budget still available", hint: "checked automatically", auto: "daily-budget" },
    ],
    factors: [
      choice("HTF reason timeframe", [
        ["4H / Daily", "A+"],
        ["1H", "A"],
      ]),
      choice("Entry model", [
        ["MSS 5m", "A+"],
        ["BOS 5m", "A"],
      ]),
      choice("Displacement", [
        ["Strong", "A+"],
        ["Normal", "A"],
        ["Weak", "B"],
      ]),
      choice("Daily bias", [
        ["Matches", "A+"],
        ["Unclear", "B"],
        ["Against", "C"],
      ]),
      {
        id: id(),
        name: "Compass probability",
        hint: "",
        kind: "number",
        unit: "%",
        // <55 C · 55 to 65 B · >65 to 70 A · >70 A+
        cuts: [
          { value: 55, lowerGetsIt: false },
          { value: 65, lowerGetsIt: true },
          { value: 70, lowerGetsIt: true },
        ],
        caps: ["C", "B", "A", "A+"],
      },
      choice("Conviction", [
        ["No doubts", "A+"],
        ["Some doubt", "A"],
        ["I kind of see my setup but I'm not sure", "C"],
      ]),
    ],
    grades: [
      {
        grade: "A+",
        riskPct: 1,
        traded: true,
        description:
          "Textbook. 4H or Daily reason, clean wick sweep, 5m MSS with meaningful displacement, bias clear, Compass above 70 and zero doubt. The trade you'd take ten times out of ten. Full risk because this is where your edge is strongest.",
      },
      {
        grade: "A",
        riskPct: 0.5,
        traded: true,
        description:
          "Solid, standard setup. Every base rule holds, but something is less than perfect: a 1H reason, a BOS instead of an MSS, or normal displacement. Compass above 65. Half risk: a good trade, not a perfect one.",
      },
      {
        grade: "B",
        riskPct: 0.25,
        traded: true,
        description:
          "Valid on paper, but doubt creeps in: the daily bias is unclear, displacement is weak, or Compass is only 55–65. Quarter risk: you're mostly paying for data. If B's expectancy turns negative in Compare, switch it to Don't.",
      },
      {
        grade: "C",
        riskPct: 0,
        traded: false,
        description:
          "You kind of see your setup but can't say why it's good. CISD entry, Compass below 55, bias against you, or a base rule missing. Don't trade it. Log it, and let Compare show whether skipping was right.",
      },
    ],
  };
}

/**
 * Fills in the existing GOLD Model — matched by name, updated in place, never
 * duplicated. Runs once; after that the strategy is yours to edit.
 */
export function seedGoldModel(db: Db) {
  addStrategySystemColumns(db);
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(GOLD_SEED_KEY)) return;

  const row = db
    .prepare("SELECT id FROM strategies WHERE lower(trim(name)) = 'gold model' ORDER BY created_at LIMIT 1")
    .get() as { id: string } | undefined;

  db.transaction(() => {
    if (row) {
      const d = goldModelDefinition();
      db.prepare(`
        UPDATE strategies SET
          instrument = @instrument, description = @description, sessions = @sessions,
          hours_from = @hoursFrom, hours_to = @hoursTo, rr_from = @rrFrom, rr_to = @rrTo,
          box_label = @boxLabel, invalidation = @invalidation,
          base_rules = @baseRules, factors = @factors, grades = @grades,
          definition_migrated = 1, updated_at = @now
        WHERE id = @id
      `).run({
        ...d,
        sessions: JSON.stringify(d.sessions),
        baseRules: JSON.stringify(d.baseRules),
        factors: JSON.stringify(d.factors),
        grades: JSON.stringify(d.grades),
        now: new Date().toISOString(),
        id: row.id,
      });
    }
    // Recorded either way, so a strategy you later name "GOLD Model" is never overwritten.
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      GOLD_SEED_KEY,
      row ? `seeded ${row.id}` : "no GOLD Model found",
    );
  })();
}

/* ── The rulebook: one strategy, versioned (v1.2) ────────────────────── */

export const RULEBOOK_KEY = "rulebook:v1.2";
/** Demo rows carry this tag; nothing without it is ever removed. */
const DEMO_TAG = "[demo]";

/** What the old limits row defaulted to — a value still equal to it was never chosen by you. */
const OLD_LIMIT_DEFAULTS = {
  start_balance: 200000,
  max_risk_pct: 1,
  daily_stop_pct: 1,
  daily_loss_pct: 5,
  max_loss_pct: 10,
} as const;

/** The trade columns the rulebook's journal fields need. */
const RULEBOOK_TRADE_COLUMNS: [string, string][] = [
  ["rulebook_version", "TEXT"],
  ["box_high", "REAL"],
  ["box_low", "REAL"],
  ["sweep_extreme", "REAL"],
  ["sweep_depth", "REAL"],
  ["took_15m_swing", "INTEGER"],
  ["htf_reason_type", "TEXT DEFAULT ''"],
  ["poi_tests", "TEXT DEFAULT ''"],
  ["level_sweep", "INTEGER"],
  ["desk_agreed", "TEXT DEFAULT ''"],
  ["entry_type", "TEXT DEFAULT ''"],
  ["entry_price", "REAL"],
  ["stop_price", "REAL"],
  ["target_price", "REAL"],
  ["lots", "REAL"],
  ["risk_usd", "REAL"],
  ["atr", "REAL"],
  ["mss_beyond", "REAL"],
  ["exit_time", "TEXT DEFAULT ''"],
  ["exit_price", "REAL"],
  ["exit_reason", "TEXT DEFAULT ''"],
  ["early_stop_move", "INTEGER"],
  ["release_at_be", "INTEGER"],
  ["mfe_price", "REAL"],
  ["mae_price", "REAL"],
  ["target_before_stop", "TEXT DEFAULT ''"],
  ["max_fav_price", "REAL"],
  ["screenshot_after", "TEXT DEFAULT ''"],
  // Since 2.0 the excursions are logged in R directly; older trades keep their prices.
  ["mfe_r", "REAL"],
  ["mae_r", "REAL"],
  ["max_fav_r", "REAL"],
  // Since 2.2 the HTF reason carries its timeframe, and several can be logged; the highest counts.
  ["htf_reasons", "TEXT DEFAULT '[]'"],
];

/**
 * Moves the desk onto the rulebook, in the brief's order. The columns and tables are
 * checked every start (cheap, and safe to repeat); everything that writes data runs
 * once, recorded under RULEBOOK_KEY.
 *
 *  1. remove the demo rows (the same rows `npm run demo:remove` removes)
 *  2. write rulebook v1.2, with the changelog rows 1.0 and 1.1 inside it
 *  3. add the new trade columns
 *  4. create the plans, rulebook-versions and open-items tables
 *  5. carry your limits over, taking the new default only where the old one was untouched
 */
export function migrateRulebook(db: Db, now = new Date()) {
  addStrategySystemColumns(db);
  for (const [column, definition] of RULEBOOK_TRADE_COLUMNS) addColumn(db, "trades", column, definition);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rulebook_versions (
      version    TEXT PRIMARY KEY,
      major      INTEGER NOT NULL,
      minor      INTEGER NOT NULL,
      reason     TEXT NOT NULL DEFAULT '',
      doc        TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plans (
      date       TEXT PRIMARY KEY,   -- New York day, "YYYY-MM-DD"
      bias       TEXT DEFAULT '',    -- bullish | bearish | unclear | ''
      levels     TEXT DEFAULT '{}',
      pois       TEXT DEFAULT '',
      desk_check TEXT DEFAULT '',    -- agree | disagree | none | ''
      notes      TEXT DEFAULT '',
      created_at TEXT NOT NULL,      -- never changed by an edit: "written on time" rests on it
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS open_items (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      done_at    TEXT,
      sort       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(RULEBOOK_KEY)) return;

  const stamp = now.toISOString();
  db.transaction(() => {
    // 1. Demo rows — tagged ones only.
    const trades = db.prepare("DELETE FROM trades WHERE substr(notes, 1, ?) = ?").run(DEMO_TAG.length, DEMO_TAG).changes;
    const checkins = db.prepare("DELETE FROM checkins WHERE note = ?").run(DEMO_TAG).changes;

    // 2 + 5. Rulebook v1.2, with your limits carried over.
    const doc = defaultRulebook();
    const row = db.prepare("SELECT * FROM limits WHERE id = 1").get() as Row | undefined;
    if (row) {
      const keep = (column: keyof typeof OLD_LIMIT_DEFAULTS, fresh: number) => {
        const v = Number(row[column]);
        return Number.isFinite(v) && v !== OLD_LIMIT_DEFAULTS[column] ? v : fresh;
      };
      doc.limits = {
        ...doc.limits,
        enabled: row.enabled == null ? true : Boolean(row.enabled),
        startBalance: keep("start_balance", doc.limits.startBalance),
        maxRiskPct: keep("max_risk_pct", doc.limits.maxRiskPct),
        dailyStopPct: keep("daily_stop_pct", doc.limits.dailyStopPct),
        dailyLossPct: keep("daily_loss_pct", doc.limits.dailyLossPct),
        maxLossPct: keep("max_loss_pct", doc.limits.maxLossPct),
      };
    }
    if (!db.prepare("SELECT 1 FROM rulebook_versions WHERE version = ?").get(FIRST_VERSION)) {
      insertVersion(db, FIRST_VERSION, FIRST_REASON, doc, stamp);
    }

    // The open items, seeded once.
    if (!(db.prepare("SELECT COUNT(*) AS n FROM open_items").get() as { n: number }).n) {
      const add = db.prepare("INSERT INTO open_items (id, text, done, sort, created_at) VALUES (?, ?, 0, ?, ?)");
      OPEN_ITEMS.forEach((text, i) => add.run(id(), text, i, stamp));
    }

    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      RULEBOOK_KEY,
      `v${FIRST_VERSION} written; removed ${trades} demo trades and ${checkins} demo check-ins`,
    );
  })();
}

const PLAN_RETIRED_KEY = "rulebook:v1.3-plan-retired";

/**
 * Retires the written daily plan (rulebook v1.3): the version in force is rewritten
 * by `retirePlan` and saved as the next version, so v1.2 stays in the history exactly
 * as it was. The plans and weeks tables, and every row in them, are left alone — the
 * desk just stops reading them. Runs once, recorded under PLAN_RETIRED_KEY.
 */
export function migratePlanRetired(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(PLAN_RETIRED_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    const hasPlan = current.doc.planBy != null || current.doc.baseRules.some((r) => r.id === "plan");
    let note = "nothing to retire";
    if (hasPlan) {
      const version = nextVersion(current.version, "minor");
      insertVersion(db, version, PLAN_RETIRED_REASON, retirePlan(current.doc), now.toISOString());
      note = `v${version} written from v${current.version}`;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(PLAN_RETIRED_KEY, note);
  })();
}

const CONDENSED_KEY = "rulebook:v1.4-condensed";

/**
 * Condenses the rulebook (v1.4): the version in force is rewritten by `condenseRulebook`
 * and saved as the next version, so v1.3 stays readable in the history. Only text moves;
 * every value stays, so no trade's grade or flags change. Runs once, recorded under
 * CONDENSED_KEY.
 */
export function migrateCondensed(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(CONDENSED_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    let note = "already condensed";
    if (!current.doc.sections.some((s) => s.reference)) {
      const version = nextVersion(current.version, "minor");
      insertVersion(db, version, CONDENSED_REASON, condenseRulebook(current.doc), now.toISOString());
      note = `v${version} written from v${current.version}`;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(CONDENSED_KEY, note);
  })();
}

const FRESH_START_KEY = "rulebook:v2.0-fresh-start";

/**
 * Rulebook 2.0 (see `freshStart`): written once as the next major version, so every
 * earlier version stays readable and every trade keeps the rules it was graded under.
 * The changelog starts again here.
 */
export function migrateFreshStart(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(FRESH_START_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    let note = "already 2.0";
    if (!current.doc.changelogFrom) {
      const version = nextVersion(current.version, "major");
      insertVersion(db, version, FRESH_START_REASON, freshStart(current.doc, version), now.toISOString());
      note = `v${version} written from v${current.version}`;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(FRESH_START_KEY, note);
  })();
}

const WINDOW_BY_HAND_KEY = "rulebook:entry-window-by-hand";

/**
 * "Inside the entry window" becomes a rule you tick (see `windowByHand`). Saved as the
 * next version like any edit, so trades graded before keep the automatic check they had.
 */
export function migrateWindowByHand(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(WINDOW_BY_HAND_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    let note = "already by hand";
    if (current.doc.baseRules.some((r) => r.auto === "entry-window")) {
      const version = nextVersion(current.version, "minor");
      insertVersion(db, version, WINDOW_BY_HAND_REASON, windowByHand(current.doc), now.toISOString());
      note = `v${version} written from v${current.version}`;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(WINDOW_BY_HAND_KEY, note);
  })();
}

const CHECKIN_CLOSES_KEY = "rulebook:checkin-closes";

/**
 * A "Trade restricted" check-in closes the day (see `checkinCloses`). The next version,
 * so a trade taken on a restricted day under an older one keeps the A+ it was allowed.
 */
export function migrateCheckinCloses(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(CHECKIN_CLOSES_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    let note = "already closes the day";
    if (current.doc.checkinCaution !== "nothing") {
      const version = nextVersion(current.version, "minor");
      insertVersion(db, version, CHECKIN_CLOSES_REASON, checkinCloses(current.doc), now.toISOString());
      note = `v${version} written from v${current.version}`;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(CHECKIN_CLOSES_KEY, note);
  })();
}

const JOURNAL_V23_KEY = "rulebook:journal-v23";

/** Breakeven exits, HTF timeframes, bias against the briefing, no entry type (see `journalV23`). */
export function migrateJournalV23(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(JOURNAL_V23_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    const version = nextVersion(current.version, "minor");
    insertVersion(db, version, JOURNAL_V23_REASON, journalV23(current.doc), now.toISOString());
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(JOURNAL_V23_KEY, `v${version} written from v${current.version}`);
  })();
}

const ONE_DAY_OFF_KEY = "rulebook:one-day-off";

/** Any break costs one trading day off (see `oneDayOff`); trades before keep their two. */
export function migrateOneDayOff(db: Db, now = new Date()) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(ONE_DAY_OFF_KEY)) return;
  db.transaction(() => {
    const current = currentRulebook(db);
    let note = "already one day";
    if (current.doc.consequences.daysOff !== 1) {
      const version = nextVersion(current.version, "minor");
      insertVersion(db, version, ONE_DAY_OFF_REASON, oneDayOff(current.doc), now.toISOString());
      note = `v${version} written from v${current.version}`;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(ONE_DAY_OFF_KEY, note);
  })();
}
