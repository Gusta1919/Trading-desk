/**
 * Collects the morning's gold bias from Gmail.
 *
 * A cloud routine writes the briefing at 9:46 as a Gmail draft — never sent — with
 * the subject "[Trading Desk] Daily Bias YYYY-MM-DD". This module picks it up and
 * saves it as data/daily-bias.json, which the tab already reads. So the Claude app
 * can be closed and the Mac asleep at 9:46; opening the desk is enough.
 *
 * The app password could open the whole mailbox, so the code holds itself to less:
 * - it opens only the Drafts folder, found by its special-use flag rather than its
 *   name (a Polish Gmail calls it "Wersje robocze"), and reads nothing else. Only
 *   the account itself can put a draft there — mail from outside never lands in it;
 * - it takes only drafts whose subject matches the pattern exactly;
 * - once the file is safely on disk it moves those drafts to Trash, which Gmail
 *   empties by itself after 30 days — nothing is deleted outright;
 * - it connects only while today's briefing is missing.
 *
 * The password lives in the macOS Keychain, never in a file or in git.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { RUN_AT_MIN, amsterdamClock, type GmailStatus } from "../src/lib/dailyBias.js";
import { savedDate, writeBias } from "./bias.js";

const run = promisify(execFile);

/** The Keychain item holding the Gmail address (account) and app password. */
export const KEYCHAIN_SERVICE = "trading-desk-gmail";

const SUBJECT_PREFIX = "[Trading Desk] Daily Bias";
const SUBJECT = /^\[Trading Desk\] Daily Bias (\d{4}-\d{2}-\d{2})$/;

let status: GmailStatus = { state: "off" };
let lastTry = 0;
let running = false;

export const gmailStatus = () => status;

/* ── Pure pieces (tested) ────────────────────────────────────────────── */

/** The date in a briefing draft's subject, or null for any other subject. */
export function briefingDate(subject: string | undefined): string | null {
  return subject?.trim().match(SUBJECT)?.[1] ?? null;
}

/** The JSON object inside a mail body — clients add signatures and stray spacing. */
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1).replace(/ /g, " ") : null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/**
 * The briefing text from a parsed draft. The plain-text part comes first; failing
 * that, the HTML with its tags stripped by hand — mailparser's own HTML-to-text
 * wraps long lines, which would break JSON strings apart.
 */
export function briefingText(mail: Pick<ParsedMail, "text" | "html">): string | null {
  const candidates = [
    mail.text ?? "",
    typeof mail.html === "string"
      ? decodeEntities(mail.html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
      : "",
  ];
  let first: string | null = null;
  for (const c of candidates) {
    const json = extractJson(c);
    if (!json) continue;
    first ??= json;
    try {
      JSON.parse(json);
      return json;
    } catch {
      /* try the next rendering */
    }
  }
  // Unparseable, but still worth showing: the tab falls back to plain text.
  return first;
}

/**
 * How long to wait between checks. After 9:46 on a weekday a briefing is due, so
 * look every two minutes; otherwise nothing new can be there — every half hour.
 */
export function checkGapMs(now: Date): number {
  const c = amsterdamClock(now);
  return !c.weekend && c.minutes >= RUN_AT_MIN ? 2 * 60_000 : 30 * 60_000;
}

/* ── Talking to Gmail ────────────────────────────────────────────────── */

async function credentials(): Promise<{ user: string; pass: string } | null> {
  try {
    const { stdout: pass } = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
    const { stdout: attrs } = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE]);
    const user = attrs.match(/"acct"<blob>="([^"]+)"/)?.[1];
    // Google shows app passwords in groups of four ("abcd efgh …"); IMAP wants them joined.
    const joined = pass.replace(/\s+/g, "");
    return user && joined ? { user, pass: joined } : null;
  } catch {
    return null; // no Keychain item yet — Gmail simply isn't set up
  }
}

/** Starts a check in the background when today's briefing is missing and it's time. */
export function syncBias(now = new Date()) {
  if (running || savedDate() === amsterdamClock(now).date) return;
  if (Date.now() - lastTry < checkGapMs(now)) return;
  lastTry = Date.now();
  running = true;
  collect()
    .then((collected) => {
      status = collected === undefined ? { state: "off" } : { state: "ok", checkedAt: new Date().toISOString(), collected };
    })
    .catch((err: Error) => {
      status = { state: "error", checkedAt: new Date().toISOString(), message: err.message || "Gmail check failed" };
    })
    .finally(() => {
      running = false;
    });
}

/** Returns the date collected, null when there was nothing, undefined when not set up. */
async function collect(): Promise<string | null | undefined> {
  const auth = await credentials();
  if (!auth) return undefined;

  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth, logger: false });
  await client.connect();
  try {
    const folders = await client.list();
    const drafts = folders.find((f) => f.specialUse === "\\Drafts");
    const trash = folders.find((f) => f.specialUse === "\\Trash");
    if (!drafts) throw new Error("No Drafts folder found in Gmail");

    const lock = await client.getMailboxLock(drafts.path);
    try {
      const uids = await client.search({ subject: SUBJECT_PREFIX }, { uid: true });
      if (!uids || !uids.length) return null;

      // IMAP's subject search is a loose substring match; keep only exact briefing subjects.
      const found = (await client.fetchAll(uids, { uid: true, envelope: true }, { uid: true }))
        .map((m) => ({ uid: m.uid, date: briefingDate(m.envelope?.subject) }))
        .filter((m): m is { uid: number; date: string } => m.date != null)
        .sort((a, b) => b.date.localeCompare(a.date));
      if (!found.length) return null;

      const newest = found[0];
      const local = savedDate();
      // Never replace a newer briefing on disk with an older draft.
      if (!local || newest.date >= local) {
        const msg = await client.fetchOne(String(newest.uid), { source: true }, { uid: true });
        if (!msg || !msg.source) throw new Error("Couldn't download the briefing draft");
        const text = briefingText(await simpleParser(msg.source));
        if (!text) throw new Error("The briefing draft had no briefing in it");
        writeBias(text);
      }

      // Tidy up only after the file is written: a failure above leaves the drafts in place.
      if (trash) {
        await client.messageMove(found.map((m) => m.uid), trash.path, { uid: true });
      }
      return newest.date;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
