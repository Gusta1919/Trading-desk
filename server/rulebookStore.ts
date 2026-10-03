/**
 * The rulebook in the database: one row per version, the newest is the one in force.
 *
 * A version is never edited after it is written — a change is always a new row, so a
 * trade graded under one version keeps pointing at exactly what it said. The versions
 * stay out of sight in the desk; the changelog shows their dates and reasons.
 */
import type Database from "better-sqlite3";
import { FIRST_VERSION, defaultRulebook } from "../src/lib/goldModel.js";
import { compareVersions, nextVersion, rulebookErrors, type Rulebook, type RulebookVersion } from "../src/lib/rulebook.js";

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

/** Every version with its document, newest first. */
export function listVersions(db: Db): RulebookVersion[] {
  return (db.prepare("SELECT * FROM rulebook_versions").all() as Row[])
    .map(rowToVersion)
    .sort((a, b) => compareVersions(a.version, b.version));
}

export function getVersion(db: Db, version: string): RulebookVersion | null {
  const row = db.prepare("SELECT * FROM rulebook_versions WHERE version = ?").get(version) as Row | undefined;
  return row ? rowToVersion(row) : null;
}

/** The version in force — the GOLD Model itself on an empty database, so nothing ever has to handle "none". */
export function currentRulebook(db: Db): RulebookVersion {
  return listVersions(db)[0] ?? { version: FIRST_VERSION, reason: "", createdAt: new Date(0).toISOString(), doc: defaultRulebook() };
}

export function insertVersion(db: Db, version: string, reason: string, doc: Rulebook, createdAt: string) {
  const { version: _drop, ...stored } = doc;
  db.prepare("INSERT INTO rulebook_versions (version, reason, doc, created_at) VALUES (?, ?, ?, ?)").run(
    version,
    reason,
    JSON.stringify(stored),
    createdAt,
  );
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
export function saveRulebook(db: Db, doc: Rulebook, reason: string): RulebookVersion {
  const why = String(reason ?? "").trim();
  if (!why) throw new RulebookError(["Every change needs a one-line reason"]);
  let problems: string[];
  try {
    problems = rulebookErrors(doc);
  } catch {
    problems = ["The rulebook is malformed"];
  }
  if (problems.length) throw new RulebookError(problems);

  const version = nextVersion(currentRulebook(db).version);
  insertVersion(db, version, why, doc, new Date().toISOString());
  return getVersion(db, version)!;
}

/** Lines an earlier rulebook used while the check-in still closed the day, and what they say now. */
const CHECKIN_TEXT: [string, string][] = [
  [
    '**The check-in comes first.** "Stand down" means no trade today.',
    "**The check-in advises, it doesn't decide.** \"Trade with care\" or \"Better to leave the charts\" are warnings to take seriously; the choice is yours.",
  ],
  [
    'Anything but "Cleared to trade" ends the day before it starts.',
    "It says how ready you are; if it warns you, take it seriously — the decision stays yours.",
  ],
];

/**
 * Brings the rulebook in force up to what this version of the desk reads, as one new
 * version with a reason — every edit you made stays. Runs on each start; does nothing
 * once the rulebook is current.
 */
export function upgradeRulebook(db: Db, now = new Date()): RulebookVersion | null {
  const cur = currentRulebook(db);
  const doc = structuredClone(cur.doc);
  const why: string[] = [];

  const l = doc.limits as Partial<Rulebook["limits"]>;
  if (l.accountName == null || l.linked == null) {
    const d = defaultRulebook().limits;
    doc.limits = { ...doc.limits, accountName: l.accountName ?? d.accountName, linked: l.linked ?? d.linked };
    why.push(`${doc.limits.linked.map((a) => a.name).join(", ") || "Linked accounts"} shown next to ${doc.limits.accountName}`);
  }

  const gates = doc.flow.gates.filter((g) => !/^check-in: cleared to trade\?$/i.test(g.trim()));
  let text = false;
  const sections = doc.sections.map((s) => {
    let body = s.body;
    for (const [old, next] of CHECKIN_TEXT) body = body.split(old).join(next);
    if (body !== s.body) text = true;
    return { ...s, body };
  });
  if (gates.length !== doc.flow.gates.length || text) {
    doc.flow = { ...doc.flow, gates };
    doc.sections = sections;
    why.push("the check-in advises instead of closing the day");
  }

  if (!why.length) return null;
  const reason = why.join("; ").replace(/^./, (c) => c.toUpperCase());
  const version = nextVersion(cur.version);
  insertVersion(db, version, reason, doc, now.toISOString());
  return getVersion(db, version);
}
