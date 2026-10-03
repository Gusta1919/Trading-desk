/**
 * Starts the desk clean.
 *
 *   npm run reset
 *
 * The database is moved whole into data/archive/ — nothing is deleted — and a demo
 * briefing goes with it. The next start opens an empty desk: no trades, no check-ins,
 * and the GOLD Model rulebook as it ships. Stop the desk first.
 */
import fs from "node:fs";
import path from "node:path";
import { DB_PATH, DATA_DIR, archive, dropDemoBriefing } from "../server/db";

async function running() {
  try {
    await fetch("http://127.0.0.1:3848/api/checkins");
    return true;
  } catch {
    return false;
  }
}

if (await running()) {
  console.error("The desk is still running. Close it first (Ctrl+C in its terminal window), then run `npm run reset` again.");
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.log("Nothing to reset: there is no database yet. The next start opens an empty desk.");
} else {
  const kept = archive(DB_PATH);
  dropDemoBriefing(DATA_DIR);
  console.log(`The old database is kept in ${path.relative(path.dirname(DATA_DIR), kept)}.`);
  console.log("The next start opens an empty desk with the GOLD Model rulebook.");
}
