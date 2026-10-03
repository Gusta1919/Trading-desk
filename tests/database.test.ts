/**
 * The database: a fresh start seeds the GOLD Model as 1.0, an older database is moved
 * whole into data/archive/ with your own check-ins carried over, and every rulebook
 * change is saved as the next version with its reason.
 */
import Database from "better-sqlite3";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "../server/db";
import { RulebookError, currentRulebook, listVersions, saveRulebook } from "../server/rulebookStore";
import { isCurrentSchema, setupSchema } from "../server/schema";
import { FIRST_REASON, FIRST_VERSION, defaultRulebook } from "../src/lib/goldModel";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "desk-"));

describe("a fresh database", () => {
  it("starts with the GOLD Model as version 1.0, and only once", () => {
    const db = new Database(":memory:");
    setupSchema(db);
    setupSchema(db);
    const versions = listVersions(db);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].version, FIRST_VERSION);
    assert.equal(versions[0].reason, FIRST_REASON);
    assert.deepEqual(versions[0].doc, { ...defaultRulebook(), version: FIRST_VERSION });
    assert.ok(isCurrentSchema(db));
  });
});

describe("rulebook versions", () => {
  it("saves each change as the next version, with its reason", () => {
    const db = new Database(":memory:");
    setupSchema(db);
    const doc = currentRulebook(db).doc;
    const saved = saveRulebook(db, { ...doc, timeStop: "11:30" }, "Flat earlier");
    assert.equal(saved.version, "1.1");
    assert.equal(currentRulebook(db).doc.timeStop, "11:30");
    assert.deepEqual(listVersions(db).map((v) => [v.version, v.reason]), [["1.1", "Flat earlier"], ["1.0", FIRST_REASON]]);
  });

  it("refuses a change without a reason, or one that breaks the text", () => {
    const db = new Database(":memory:");
    setupSchema(db);
    const doc = currentRulebook(db).doc;
    assert.throws(() => saveRulebook(db, doc, "  "), RulebookError);
    const broken = { ...doc, sections: doc.sections.map((s, i) => (i === 0 ? { ...s, body: "{{nope}}" } : s)) };
    assert.throws(() => saveRulebook(db, broken, "typo"), RulebookError);
    assert.equal(listVersions(db).length, 1);
  });
});

describe("an older database", () => {
  function oldDatabase(dir: string) {
    const file = path.join(dir, "trade-assistant.db");
    const old = new Database(file);
    old.pragma("journal_mode = WAL");
    old.exec(`
      CREATE TABLE trades (id TEXT PRIMARY KEY, date TEXT, notes TEXT);
      CREATE TABLE checkins (date TEXT PRIMARY KEY, answers TEXT, note TEXT, score INTEGER, verdict TEXT, reflection TEXT, created_at TEXT);
    `);
    old.prepare("INSERT INTO trades VALUES ('t1', '2026-09-01T04:30', '[demo] A setup')").run();
    const add = old.prepare("INSERT INTO checkins VALUES (?, '{}', ?, ?, ?, '', '2026-09-30T08:00:00Z')");
    add.run("2026-09-30", "", 90, "ready");
    add.run("2026-10-01", "slept badly", 70, "caution");
    add.run("2026-09-29", "[demo]", 95, "ready");
    old.close();
    fs.writeFileSync(path.join(dir, "daily-bias.json"), JSON.stringify({ demo: true, date: "2026-10-01" }));
    return file;
  }

  it("is moved whole into data/archive/, never changed", () => {
    const dir = tmp();
    const file = oldDatabase(dir);
    const db = openDatabase(file);
    const archived = fs.readdirSync(path.join(dir, "archive"));
    assert.equal(archived.length, 1);
    assert.ok(archived[0].endsWith(".db"));
    const old = new Database(path.join(dir, "archive", archived[0]), { readonly: true });
    assert.equal((old.prepare("SELECT COUNT(*) AS n FROM trades").get() as { n: number }).n, 1);
    old.close();
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM trades").get() as { n: number }).n, 0);
    db.close();
  });

  it("carries your own check-ins over, a Caution as a stand-down, and leaves the demo ones behind", () => {
    const dir = tmp();
    const db = openDatabase(oldDatabase(dir));
    const rows = db.prepare("SELECT date, verdict, note FROM checkins ORDER BY date").all();
    assert.deepEqual(rows, [
      { date: "2026-09-30", verdict: "ready", note: "" },
      { date: "2026-10-01", verdict: "sit-out", note: "slept badly" },
    ]);
    db.close();
  });

  it("takes a demo briefing away with it", () => {
    const dir = tmp();
    openDatabase(oldDatabase(dir)).close();
    assert.equal(fs.existsSync(path.join(dir, "daily-bias.json")), false);
  });

  it("opens a current database as it is", () => {
    const dir = tmp();
    const file = path.join(dir, "trade-assistant.db");
    openDatabase(file).close();
    openDatabase(file).close();
    assert.equal(fs.existsSync(path.join(dir, "archive")), false);
  });
});
