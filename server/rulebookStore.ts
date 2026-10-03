/**
 * The rulebook in the database: one row per version, the newest is the one in force.
 *
 * Kept apart from the routes so the tests can run it against an in-memory database.
 * A version is never edited after it is written — a change is always a new row, so
 * any trade's "graded under 1.2" keeps pointing at exactly what 1.2 said.
 */
import type Database from "better-sqlite3";
import {
  compareVersions,
  nextVersion,
  parseVersion,
  rulebookErrors,
  type Rulebook,
  type RulebookVersion,
  type VersionRow,
} from "../src/lib/rulebook.js";
import { defaultRulebook } from "../src/lib/rulebookText.js";

type Db = Database.Database;
type Row = Record<string, unknown>;

function rowToVersion(row: Row): RulebookVersion {
  const doc = JSON.parse(String(row.doc)) as Rulebook;
  return {
    version: String(row.version),
    reason: String(row.reason ?? ""),
    createdAt: String(row.created_at),
    doc: { ...doc, version: String(row.version) },
  };
}

export function listVersions(db: Db): VersionRow[] {
  const rows = db.prepare("SELECT version, reason, created_at FROM rulebook_versions").all() as Row[];
  return rows
    .map((r) => ({ version: String(r.version), reason: String(r.reason ?? ""), createdAt: String(r.created_at) }))
    .sort((a, b) => compareVersions(a.version, b.version));
}

export function getVersion(db: Db, version: string): RulebookVersion | null {
  const row = db.prepare("SELECT * FROM rulebook_versions WHERE version = ?").get(version) as Row | undefined;
  return row ? rowToVersion(row) : null;
}

/**
 * The version in force. A database the migration has not reached yet still gets a
 * rulebook — the built-in v1.2 — so nothing downstream ever has to handle "none".
 */
export function currentRulebook(db: Db): RulebookVersion {
  const newest = listVersions(db)[0];
  const found = newest ? getVersion(db, newest.version) : null;
  return found ?? { version: "1.2", reason: "", createdAt: new Date(0).toISOString(), doc: defaultRulebook() };
}

export function insertVersion(db: Db, version: string, reason: string, doc: Rulebook, createdAt: string) {
  const [major, minor] = parseVersion(version) ?? [1, 0];
  const { version: _drop, ...stored } = doc;
  db.prepare(
    "INSERT INTO rulebook_versions (version, major, minor, reason, doc, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(version, major, minor, reason, JSON.stringify(stored), createdAt);
}

export class RulebookError extends Error {
  constructor(public problems: string[]) {
    super(problems[0] ?? "The rulebook can't be saved");
  }
}

/**
 * Saves a change as the next version. Needs a one-line reason; a document with
 * problems (an unknown token, a window that ends before it starts) is refused whole.
 */
export function saveRulebook(db: Db, doc: Rulebook, reason: string, bump: "minor" | "major" = "minor"): RulebookVersion {
  const why = String(reason ?? "").trim();
  if (!why) throw new RulebookError(["Every change needs a one-line reason"]);
  let problems: string[];
  try {
    problems = rulebookErrors(doc);
  } catch {
    problems = ["The rulebook is malformed"];
  }
  if (problems.length) throw new RulebookError(problems);

  const version = nextVersion(currentRulebook(db).version, bump);
  insertVersion(db, version, why, doc, new Date().toISOString());
  return getVersion(db, version)!;
}
