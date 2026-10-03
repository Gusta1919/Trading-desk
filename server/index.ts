/**
 * The desk's local API (port 3848): trades, check-ins and the rulebook, over SQLite —
 * plus read-only feeds for the news, the gold price and the morning briefing.
 *
 * After every write the journal is re-derived as a whole: each trade's % and R from its
 * dollar result and the balance before it, then every flag from the trades before it.
 * Nothing derived is trusted from the moment it was saved.
 */
import cors from "cors";
import express from "express";
import { toVerdict } from "../src/lib/checkin.js";
import { evaluateHistory } from "../src/lib/discipline.js";
import { ALL_FLAGS, EXIT_REASONS, type Trade } from "../src/lib/types.js";
import { readBias } from "./bias.js";
import { getCandles } from "./candles.js";
import { openDatabase } from "./db.js";
import { gmailStatus, syncBias } from "./gmailBias.js";
import { getCalendar, getHeadlines, startCalendarRefresh } from "./news.js";
import { RulebookError, currentRulebook, listVersions, saveRulebook } from "./rulebookStore.js";

const db = openDatabase();
const app = express();
const PORT = 3848;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

type Row = Record<string, unknown>;

const parseJson = <T>(raw: unknown, fallback: T): T => {
  try {
    return raw == null || raw === "" ? fallback : (JSON.parse(String(raw)) as T);
  } catch {
    return fallback;
  }
};
/** A nullable yes/no column, read back as true, false or null. */
const bool = (v: unknown) => (v == null ? null : Boolean(v));
const yesNo = (v: unknown) => (v == null || v === "" ? null : v ? 1 : 0);
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** Only one of a fixed set of words, or "". */
const oneOf = (v: unknown, allowed: string[]) => (allowed.includes(String(v)) ? String(v) : "");

const FLAGS = new Set<string>(ALL_FLAGS);
const EXITS = EXIT_REASONS.map((e) => e.value as string);

/* ── Trades ──────────────────────────────────────────────────────────── */

function rowToTrade(row: Row): Trade {
  return {
    id: String(row.id),
    date: String(row.date),
    symbol: String(row.symbol),
    direction: row.direction === "short" ? "short" : "long",
    session: String(row.session ?? ""),
    riskPct: Number(row.risk_pct) || 0,
    plannedRiskPct: num(row.planned_risk_pct),
    plannedRR: num(row.planned_rr),
    resultR: num(row.result_r),
    pnlUsd: num(row.pnl_usd),
    riskUsd: num(row.risk_usd),
    grade: (row.grade ?? "") as Trade["grade"],
    setupSnapshot: parseJson(row.setup_snapshot, null),
    rulebookVersion: String(row.rulebook_version),
    flags: parseJson<string[]>(row.flags, []).filter((f) => FLAGS.has(f)) as Trade["flags"],
    flagNote: String(row.flag_note ?? ""),
    skipped: Boolean(row.skipped),
    hypotheticalR: num(row.hypothetical_r),
    boxSize: num(row.box_size),
    sweepDepth: num(row.sweep_depth),
    took15mSwing: bool(row.took_15m_swing),
    levelSweep: bool(row.level_sweep),
    htfReasons: parseJson(row.htf_reasons, []),
    poiTests: (row.poi_tests ?? "") as Trade["poiTests"],
    biasMatch: bool(row.bias_match),
    exitTime: String(row.exit_time ?? ""),
    exitReason: (row.exit_reason ?? "") as Trade["exitReason"],
    earlyStopMove: bool(row.early_stop_move),
    releaseAtBe: bool(row.release_at_be),
    mfeR: num(row.mfe_r),
    maeR: num(row.mae_r),
    maxFavR: num(row.max_fav_r),
    targetBeforeStop: (row.target_before_stop ?? "") as Trade["targetBeforeStop"],
    emotion: num(row.emotion),
    mistakes: parseJson(row.mistakes, []),
    notes: String(row.notes ?? ""),
    screenshot: String(row.screenshot ?? ""),
    screenshotAfter: String(row.screenshot_after ?? ""),
    news: parseJson(row.news, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** The form's JSON as column values. What the server derives (R, risk $, flags) is not taken from it. */
function bodyToColumns(body: Row) {
  // A setup not taken never touched the account: no risk, no money, only what it might have made.
  const skipped = Boolean(body.skipped);
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    date: String(body.date),
    symbol: String(body.symbol ?? "").trim().toUpperCase() || currentRulebook(db).doc.instrument,
    direction: body.direction === "short" ? "short" : "long",
    session: String(body.session ?? ""),
    risk_pct: skipped ? 0 : (num(body.riskPct) ?? 0),
    planned_rr: num(body.plannedRR),
    pnl_usd: skipped ? null : num(body.pnlUsd),
    grade: oneOf(body.grade, ["A+", "A", "B", "C"]),
    setup_snapshot: body.setupSnapshot ? JSON.stringify(body.setupSnapshot) : null,
    rulebook_version: String(body.rulebookVersion || currentRulebook(db).version),
    flag_note: String(body.flagNote ?? ""),
    skipped: skipped ? 1 : 0,
    hypothetical_r: skipped ? num(body.hypotheticalR) : null,
    box_size: num(body.boxSize),
    sweep_depth: num(body.sweepDepth),
    took_15m_swing: yesNo(body.took15mSwing),
    level_sweep: yesNo(body.levelSweep),
    htf_reasons: JSON.stringify(
      list(body.htfReasons)
        .filter((r: Row) => r && oneOf(r.type, ["FVG", "OB", "VIMB"]) && oneOf(r.tf, ["1H", "4H", "D", "W"]))
        .map((r: Row) => ({ type: String(r.type), tf: String(r.tf) })),
    ),
    poi_tests: oneOf(body.poiTests, ["fresh", "once", "2+"]),
    bias_match: yesNo(body.biasMatch),
    exit_time: String(body.exitTime ?? ""),
    exit_reason: oneOf(body.exitReason, EXITS),
    early_stop_move: yesNo(body.earlyStopMove),
    release_at_be: yesNo(body.releaseAtBe),
    mfe_r: num(body.mfeR),
    mae_r: num(body.maeR),
    max_fav_r: num(body.maxFavR),
    target_before_stop: oneOf(body.targetBeforeStop, ["yes", "no", "unknown"]),
    emotion: num(body.emotion),
    mistakes: JSON.stringify(list(body.mistakes).map(String)),
    notes: String(body.notes ?? ""),
    screenshot: String(body.screenshot ?? "").trim(),
    screenshot_after: String(body.screenshotAfter ?? "").trim(),
    news: JSON.stringify(
      list(body.news)
        .filter((n: Row) => n && String(n.title ?? "").trim())
        .map((n: Row) => ({
          title: String(n.title).trim(),
          currency: String(n.currency ?? ""),
          impact: String(n.impact ?? "Manual"),
          time: String(n.time ?? ""),
        })),
    ),
  };
}
type Columns = ReturnType<typeof bodyToColumns>;
const COLUMNS = Object.keys(bodyToColumns({ date: "", direction: "long" })) as (keyof Columns)[];

function validate(body: Row): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(body.date ?? ""))) return "The entry date and time are required";
  if (body.skipped) return null; // nothing was risked
  const risk = Number(body.riskPct);
  if (!Number.isFinite(risk) || risk <= 0) return "Risk % must be above 0";
  return null;
}

/**
 * Re-derives every taken trade's result from its dollar P/L, in date order, starting
 * from the opening balance:
 *
 *   percent = pnl ÷ balance before the trade × 100
 *   R       = percent ÷ the risk that was taken
 *   risk $  = balance before the trade × the risk %
 *
 * The account compounds, so each trade's percentage depends on every trade before it —
 * which is why this runs over the whole journal after any write.
 */
function recomputeResults() {
  const rows = db
    .prepare("SELECT id, risk_pct, pnl_usd FROM trades WHERE skipped = 0 ORDER BY date, created_at")
    .all() as Row[];
  const update = db.prepare("UPDATE trades SET result_r = ?, risk_usd = ? WHERE id = ?");
  let balance = currentRulebook(db).doc.limits.openingBalance;
  db.transaction(() => {
    for (const r of rows) {
      const pnl = num(r.pnl_usd);
      const risk = Number(r.risk_pct) || 0;
      const riskUsd = Number(((balance * risk) / 100).toFixed(2));
      const resultR = pnl == null ? null : balance > 0 && risk > 0 ? Number((((pnl / balance) * 100) / risk).toFixed(6)) : 0;
      update.run(resultR, riskUsd, r.id);
      if (pnl != null) balance += pnl;
    }
  })();
}

/** Every rulebook version's document, by version — what each trade is judged under. */
function rulebookOfDb() {
  const versions = new Map(listVersions(db).map((v) => [v.version, v.doc]));
  const current = currentRulebook(db).doc;
  return (v: string | null) => (v && versions.get(v)) || current;
}

/**
 * Re-judges every taken trade, in date order: a trade's flags depend on the trades
 * before it (a second trade, a stop already hit, a day off still running), so a change
 * to one can change the flags of every trade after it.
 */
function recomputeFlags() {
  const trades = (db.prepare("SELECT * FROM trades").all() as Row[]).map(rowToTrade);
  const checkins = (db.prepare("SELECT date, verdict FROM checkins").all() as Row[]).map((r) => ({
    date: String(r.date),
    verdict: toVerdict(r.verdict),
  }));
  const { byId } = evaluateHistory({ trades, checkins, rulebookOf: rulebookOfDb() });
  const update = db.prepare("UPDATE trades SET flags = ?, planned_risk_pct = ? WHERE id = ?");
  db.transaction(() => {
    for (const t of trades) {
      const j = byId.get(t.id);
      const flags = JSON.stringify(j?.flags ?? []);
      const allowed = j ? j.allowed : null;
      if (flags !== JSON.stringify(t.flags) || allowed !== t.plannedRiskPct) update.run(flags, allowed, t.id);
    }
  })();
}

/** Everything derived from the journal as a whole: the results, then the flags that read them. */
function recompute() {
  recomputeResults();
  recomputeFlags();
}

const tradeById = (id: string) => {
  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToTrade(row) : null;
};

app.get("/api/trades", (_req, res) => {
  const rows = db.prepare("SELECT * FROM trades ORDER BY date DESC, created_at DESC").all() as Row[];
  res.json(rows.map(rowToTrade));
});

app.post("/api/trades", (req, res) => {
  const error = validate(req.body ?? {});
  if (error) return void res.status(400).json({ error });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO trades (id, ${COLUMNS.join(", ")}, created_at, updated_at)
     VALUES (@id, ${COLUMNS.map((c) => "@" + c).join(", ")}, @created_at, @updated_at)`,
  ).run({ id, ...bodyToColumns(req.body), created_at: now, updated_at: now });
  recompute();
  res.status(201).json(tradeById(id));
});

app.put("/api/trades/:id", (req, res) => {
  const error = validate(req.body ?? {});
  if (error) return void res.status(400).json({ error });
  const result = db
    .prepare(`UPDATE trades SET ${COLUMNS.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @updated_at WHERE id = @id`)
    .run({ id: req.params.id, ...bodyToColumns(req.body), updated_at: new Date().toISOString() });
  if (result.changes === 0) return void res.status(404).json({ error: "Not found" });
  recompute();
  res.json(tradeById(req.params.id));
});

app.delete("/api/trades/:id", (req, res) => {
  db.prepare("DELETE FROM trades WHERE id = ?").run(req.params.id);
  // Removing a trade changes the balance every later trade was measured against.
  recompute();
  res.status(204).end();
});

/* ── Check-ins ───────────────────────────────────────────────────────── */

function rowToCheckIn(row: Row) {
  return {
    date: String(row.date),
    answers: parseJson(row.answers, {}),
    note: String(row.note ?? ""),
    score: Number(row.score) || 0,
    verdict: toVerdict(row.verdict),
    reflection: String(row.reflection ?? ""),
    createdAt: String(row.created_at),
  };
}

app.get("/api/checkins", (_req, res) => {
  const rows = db.prepare("SELECT * FROM checkins ORDER BY date DESC").all() as Row[];
  res.json(rows.map(rowToCheckIn));
});

/** One check-in per New York day — doing it again the same day replaces it. */
app.put("/api/checkins/:date", (req, res) => {
  const { answers, note, score, verdict, reflection } = req.body ?? {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return void res.status(400).json({ error: "Bad date" });
  db.prepare(
    `INSERT OR REPLACE INTO checkins (date, answers, note, score, verdict, reflection, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    req.params.date,
    JSON.stringify(answers ?? {}),
    String(note ?? ""),
    Number(score) || 0,
    toVerdict(verdict),
    String(reflection ?? ""),
    new Date().toISOString(),
  );
  res.json(rowToCheckIn(db.prepare("SELECT * FROM checkins WHERE date = ?").get(req.params.date) as Row));
});

/* ── The rulebook ────────────────────────────────────────────────────── */

/** The version in force and every version, with their documents — the whole rulebook in one read. */
app.get("/api/rulebook", (_req, res) => {
  res.json({ current: currentRulebook(db), versions: listVersions(db) });
});

/** Saving is always a new version, with a reason. Nothing that was saved is ever rewritten. */
app.put("/api/rulebook", (req, res) => {
  try {
    const saved = saveRulebook(db, req.body?.doc, String(req.body?.reason ?? ""));
    recompute();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, problems: (err as RulebookError).problems ?? [] });
  }
});

/* ── Feeds ───────────────────────────────────────────────────────────── */

/*
 * News is fetched by the server, never the browser: the calendar feed sends no CORS
 * headers, and one cached copy serves every tab.
 */
app.get("/api/news/calendar", async (_req, res) => {
  try {
    const { events, fetchedAt, stale } = await getCalendar();
    res.json({ events, total: events.length, fetchedAt, stale });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message || "Calendar unavailable" });
  }
});

app.get("/api/news/headlines", async (_req, res) => {
  try {
    res.json(await getHeadlines());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message || "Headlines unavailable" });
  }
});

/*
 * The morning's gold briefing. Each read also nudges a Gmail check while today's
 * briefing is missing (throttled in gmailBias.ts), so the page's polling collects it.
 */
app.get("/api/bias", (_req, res) => {
  syncBias();
  res.json({ ...readBias(), gmail: gmailStatus() });
});

/* Intraday spot gold for the Daily Bias chart — see server/candles.ts. */
app.get("/api/candles", async (req, res) => {
  const tf = req.query.tf === "5m" ? "5m" : req.query.tf === "1h" ? "1h" : "15m";
  try {
    res.json({ tf, source: "Dukascopy · spot bid", ...(await getCandles(tf)) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message || "Price feed unavailable" });
  }
});

// The rules decide the flags, and a start may follow a rulebook change: judge everything once.
recompute();
startCalendarRefresh();
// Opening the desk starts the server — collect a waiting briefing straight away.
syncBias();

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Trading desk API → http://127.0.0.1:${PORT}`);
  console.log(`Database → data/trade-assistant.db`);
});
