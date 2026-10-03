import cors from "cors";
import express from "express";
import { readBias } from "./bias.js";
import { getCandles } from "./candles.js";
import { gmailStatus, syncBias } from "./gmailBias.js";
import { evaluateHistory } from "../src/lib/discipline.js";
import { atLeast } from "../src/lib/rulebook.js";
import { ALL_FLAGS, type Trade } from "../src/lib/types.js";
import { db } from "./db.js";
import { getCalendar, getHeadlines, startCalendarRefresh } from "./news.js";
import {
  RulebookError,
  currentRulebook,
  getVersion,
  listVersions,
  saveRulebook,
} from "./rulebookStore.js";

const app = express();
const PORT = 3848;

app.use(cors());
app.use(express.json());

type Row = Record<string, unknown>;

const parseJson = <T>(raw: unknown, fallback: T): T => {
  try {
    return raw == null || raw === "" ? fallback : (JSON.parse(String(raw)) as T);
  } catch {
    return fallback;
  }
};

const FLAGS = new Set<string>(ALL_FLAGS);

/** A nullable yes/no column, read back as true, false or null. */
const bool = (v: unknown) => (v == null ? null : Boolean(v));
/** Only one of a fixed set of words, or "". */
const oneOf = (v: unknown, allowed: string[]) => (allowed.includes(String(v)) ? String(v) : "");

function rowToTrade(row: Row) {
  return {
    id: row.id,
    date: row.date,
    symbol: row.symbol,
    direction: row.direction,
    session: row.session ?? "",
    setup: row.setup ?? "",
    htf: row.htf ?? "",
    entryModel: row.entry_model ?? "",
    riskPct: row.risk_pct,
    plannedRiskPct: row.planned_risk_pct ?? null,
    plannedRR: row.planned_rr ?? null,
    resultR: row.result_r ?? null,
    followedPlan: row.followed_plan == null ? null : Boolean(row.followed_plan),
    grade: row.grade ?? "",
    emotion: row.emotion ?? null,
    mistakes: JSON.parse((row.mistakes as string) || "[]"),
    checklist: JSON.parse((row.checklist as string) || "[]"),
    checklistTotal: row.checklist_total ?? 0,
    setupSnapshot: parseJson(row.setup_snapshot, null),
    flags: parseJson(row.flags, []),
    flagNote: row.flag_note ?? "",
    skipped: Boolean(row.skipped),
    hypotheticalR: row.hypothetical_r ?? null,
    costPct: row.cost_pct ?? null,
    boxSize: row.box_size ?? null,
    pnlUsd: row.pnl_usd ?? null,
    news: JSON.parse((row.news as string) || "[]"),
    notes: row.notes ?? "",
    screenshot: row.screenshot ?? "",
    rulebookVersion: row.rulebook_version ?? null,
    boxHigh: row.box_high ?? null,
    boxLow: row.box_low ?? null,
    sweepExtreme: row.sweep_extreme ?? null,
    sweepDepth: row.sweep_depth ?? null,
    took15mSwing: bool(row.took_15m_swing),
    htfReasonType: row.htf_reason_type ?? "",
    poiTests: row.poi_tests ?? "",
    levelSweep: bool(row.level_sweep),
    deskAgreed: row.desk_agreed ?? "",
    entryType: row.entry_type ?? "",
    entryPrice: row.entry_price ?? null,
    stopPrice: row.stop_price ?? null,
    targetPrice: row.target_price ?? null,
    lots: row.lots ?? null,
    riskUsd: row.risk_usd ?? null,
    atr: row.atr ?? null,
    mssBeyond: row.mss_beyond ?? null,
    exitTime: row.exit_time ?? "",
    exitPrice: row.exit_price ?? null,
    exitReason: row.exit_reason ?? "",
    earlyStopMove: bool(row.early_stop_move),
    releaseAtBe: bool(row.release_at_be),
    mfePrice: row.mfe_price ?? null,
    maePrice: row.mae_price ?? null,
    targetBeforeStop: row.target_before_stop ?? "",
    maxFavPrice: row.max_fav_price ?? null,
    mfeR: row.mfe_r ?? null,
    maeR: row.mae_r ?? null,
    maxFavR: row.max_fav_r ?? null,
    screenshotAfter: row.screenshot_after ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Turns the JSON body from the form into database column values. */
function bodyToColumns(body: Row) {
  const num = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : Number(v);
  // A skipped setup was never traded: no risk, no money, no result — only what it might have made.
  const skipped = Boolean(body.skipped);
  return {
    date: String(body.date),
    symbol: String(body.symbol ?? "").trim().toUpperCase(),
    direction: body.direction === "short" ? "short" : "long",
    session: String(body.session ?? ""),
    setup: String(body.setup ?? "").trim(),
    htf: String(body.htf ?? ""),
    entry_model: String(body.entryModel ?? ""),
    risk_pct: skipped ? 0 : (num(body.riskPct) ?? 0),
    planned_risk_pct: num(body.plannedRiskPct),
    planned_rr: num(body.plannedRR),
    result_r: num(body.resultR),
    followed_plan: body.followedPlan == null ? null : body.followedPlan ? 1 : 0,
    grade: String(body.grade ?? ""),
    emotion: num(body.emotion),
    mistakes: JSON.stringify(Array.isArray(body.mistakes) ? body.mistakes : []),
    checklist: JSON.stringify(Array.isArray(body.checklist) ? body.checklist : []),
    checklist_total: Number(body.checklistTotal) || 0,
    setup_snapshot: body.setupSnapshot ? JSON.stringify(body.setupSnapshot) : null,
    flags: JSON.stringify(
      Array.isArray(body.flags) ? [...new Set(body.flags.map(String))].filter((f) => FLAGS.has(f)) : [],
    ),
    flag_note: String(body.flagNote ?? ""),
    skipped: skipped ? 1 : 0,
    hypothetical_r: skipped ? num(body.hypotheticalR) : null,
    cost_pct: num(body.costPct),
    box_size: num(body.boxSize),
    pnl_usd: skipped ? null : num(body.pnlUsd),
    news: JSON.stringify(
      Array.isArray(body.news)
        ? body.news
            .filter((n: Row) => n && String(n.title ?? "").trim())
            .map((n: Row) => ({
              title: String(n.title).trim(),
              currency: String(n.currency ?? ""),
              impact: String(n.impact ?? "Manual"),
              time: String(n.time ?? ""),
            }))
        : [],
    ),
    notes: String(body.notes ?? ""),
    screenshot: String(body.screenshot ?? "").trim(),
    rulebook_version: body.rulebookVersion ? String(body.rulebookVersion) : null,
    box_high: num(body.boxHigh),
    box_low: num(body.boxLow),
    sweep_extreme: num(body.sweepExtreme),
    sweep_depth: num(body.sweepDepth),
    took_15m_swing: yesNo(body.took15mSwing),
    htf_reason_type: oneOf(body.htfReasonType, ["FVG", "OB", "VIMB"]),
    poi_tests: oneOf(body.poiTests, ["fresh", "once", "2+"]),
    level_sweep: yesNo(body.levelSweep),
    desk_agreed: oneOf(body.deskAgreed, ["yes", "no", "none"]),
    entry_type: oneOf(body.entryType, ["market", "limit"]),
    entry_price: num(body.entryPrice),
    stop_price: num(body.stopPrice),
    target_price: num(body.targetPrice),
    lots: num(body.lots),
    atr: num(body.atr),
    mss_beyond: num(body.mssBeyond),
    exit_time: String(body.exitTime ?? ""),
    exit_price: num(body.exitPrice),
    exit_reason: oneOf(body.exitReason, ["target", "stop", "trail", "time", "release", "other"]),
    early_stop_move: yesNo(body.earlyStopMove),
    release_at_be: yesNo(body.releaseAtBe),
    mfe_price: num(body.mfePrice),
    mae_price: num(body.maePrice),
    target_before_stop: oneOf(body.targetBeforeStop, ["yes", "no", "unknown"]),
    max_fav_price: num(body.maxFavPrice),
    mfe_r: num(body.mfeR),
    mae_r: num(body.maeR),
    max_fav_r: num(body.maxFavR),
    screenshot_after: String(body.screenshotAfter ?? "").trim(),
  };
}

const yesNo = (v: unknown) => (v == null || v === "" ? null : v ? 1 : 0);

function validate(body: Row): string | null {
  if (!body.date) return "Date is required";
  if (!String(body.symbol ?? "").trim()) return "Symbol is required";
  if (body.skipped) return null; // nothing was risked
  const risk = Number(body.riskPct);
  if (!Number.isFinite(risk) || risk <= 0) return "Risk % must be above 0";
  // Graded under 1.2–1.x, R, lots and the excursions rested on the initial stop. Since 2.0
  // nothing is logged as a price: the R:R and the excursions are typed in R.
  const version = body.rulebookVersion ? String(body.rulebookVersion) : null;
  if (version && !atLeast(version, "2.0") && (body.stopPrice == null || body.stopPrice === "")) return "Add the initial stop";
  return null;
}

const COLUMNS = [
  // strategy_id is deliberately absent: it is never written again, and an edit keeps the old link as it was.
  "date", "symbol", "direction", "session", "setup", "htf", "entry_model", "risk_pct",
  "planned_rr", "result_r", "followed_plan", "grade", "emotion", "mistakes",
  "checklist", "checklist_total", "cost_pct", "box_size", "pnl_usd", "notes", "screenshot",
  "news", "planned_risk_pct", "setup_snapshot", "flags", "flag_note", "skipped", "hypothetical_r",
  "rulebook_version", "box_high", "box_low", "sweep_extreme", "sweep_depth",
  "took_15m_swing", "htf_reason_type", "poi_tests", "level_sweep", "desk_agreed", "entry_type",
  "entry_price", "stop_price", "target_price", "lots", "atr", "mss_beyond", "exit_time", "exit_price",
  "exit_reason", "early_stop_move", "release_at_be", "mfe_price", "mae_price", "target_before_stop",
  "max_fav_price", "mfe_r", "mae_r", "max_fav_r", "screenshot_after",
];

/**
 * Re-derives every trade's result from its dollar P/L.
 *
 * The account compounds, so a $1,000 loss is a bigger percentage after a drawdown
 * than before one. That makes each trade's percentage depend on every trade before
 * it — which is why this runs over the whole journal, in date order, after any
 * write rather than being computed per row.
 *
 *   percent = pnl / balance before the trade × 100
 *   R       = percent / the risk that was taken
 *   risk $  = balance before the trade × the risk %
 *
 * It starts from the opening balance — what the account held when this journal
 * began — not from the size the account was opened with.
 *
 * Trades with no dollar figure keep whatever R they already have, so anything typed
 * in by hand before this existed still counts toward the running balance.
 */
function recomputeResults() {
  const start = currentRulebook(db).doc.limits.openingBalance;
  const rows = db
    // Skipped setups never touched the account.
    .prepare(
      "SELECT id, date, risk_pct, result_r, pnl_usd FROM trades WHERE skipped = 0 ORDER BY date, created_at",
    )
    .all() as Row[];

  const update = db.prepare("UPDATE trades SET result_r = ?, risk_usd = ? WHERE id = ?");
  const sized = db.prepare("UPDATE trades SET risk_usd = ? WHERE id = ?");
  let balance = start;

  const apply = db.transaction(() => {
    for (const r of rows) {
      const pnl = r.pnl_usd == null ? null : Number(r.pnl_usd);
      const risk = Number(r.risk_pct) || 0;
      const riskUsd = Number(((balance * risk) / 100).toFixed(2));

      if (pnl == null) {
        // No dollars: trust the stored R and let it move the balance anyway.
        sized.run(riskUsd, r.id);
        const pct = (Number(r.result_r) || 0) * risk;
        balance += (balance * pct) / 100;
        continue;
      }
      const pct = balance > 0 ? (pnl / balance) * 100 : 0;
      const resultR = risk > 0 ? pct / risk : 0;
      update.run(Number(resultR.toFixed(6)), riskUsd, r.id);
      balance += pnl;
    }
  });
  apply();
  return balance;
}

/**
 * Re-judges every trade graded under the rulebook, in date order, after any write.
 *
 * A trade's flags depend on the trades before it — a second trade today, a stop
 * already hit, a day off still running — so changing or deleting one trade can
 * change the flags of every trade after it. Like the results above, they are worked
 * out over the whole journal rather than trusted from the moment of saving.
 */
function recomputeFlags() {
  const trades = (db.prepare("SELECT * FROM trades").all() as Row[]).map(rowToTrade) as unknown as Trade[];
  const checkins = (db.prepare("SELECT date, verdict FROM checkins").all() as Row[]).map((r) => ({
    date: String(r.date),
    verdict: r.verdict as "ready" | "caution" | "sit-out",
  }));
  const current = currentRulebook(db);
  const docs = new Map<string, ReturnType<typeof currentRulebook>["doc"]>();
  const rulebookOf = (v: string | null) => {
    if (!v) return current.doc;
    if (!docs.has(v)) docs.set(v, getVersion(db, v)?.doc ?? current.doc);
    return docs.get(v)!;
  };
  const { byId } = evaluateHistory({ trades, checkins, rulebookOf });
  const update = db.prepare("UPDATE trades SET flags = ?, planned_risk_pct = ? WHERE id = ?");
  db.transaction(() => {
    for (const t of trades) {
      const j = byId.get(t.id);
      if (!j?.ruled) continue;
      const flags = JSON.stringify(j.flags);
      if (flags !== JSON.stringify(t.flags) || j.allowed !== t.plannedRiskPct) update.run(flags, j.allowed, t.id);
    }
  })();
}

/** Everything derived from the journal as a whole: the results, then the flags that read them. */
function recompute() {
  recomputeResults();
  recomputeFlags();
}

app.get("/api/trades", (_req, res) => {
  const rows = db.prepare("SELECT * FROM trades ORDER BY date DESC").all() as Row[];
  res.json(rows.map(rowToTrade));
});

app.post("/api/trades", (req, res) => {
  const error = validate(req.body);
  if (error) return void res.status(400).json({ error });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO trades (id, ${COLUMNS.join(", ")}, created_at, updated_at)
    VALUES (@id, ${COLUMNS.map((c) => "@" + c).join(", ")}, @created_at, @updated_at)
  `).run({ id, ...bodyToColumns(req.body), created_at: now, updated_at: now });

  recompute();
  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(id) as Row;
  res.status(201).json(rowToTrade(row));
});

app.put("/api/trades/:id", (req, res) => {
  const error = validate(req.body);
  if (error) return void res.status(400).json({ error });

  const result = db.prepare(`
    UPDATE trades SET ${COLUMNS.map((c) => `${c} = @${c}`).join(", ")},
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: req.params.id,
    ...bodyToColumns(req.body),
    updated_at: new Date().toISOString(),
  });
  if (result.changes === 0) return void res.status(404).json({ error: "Not found" });

  recompute();
  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(req.params.id) as Row;
  res.json(rowToTrade(row));
});

app.delete("/api/trades/:id", (req, res) => {
  db.prepare("DELETE FROM trades WHERE id = ?").run(req.params.id);
  // Removing a trade changes the balance every later trade was measured against.
  recompute();
  res.status(204).end();
});

function rowToCheckIn(row: Row) {
  return {
    date: row.date,
    answers: JSON.parse((row.answers as string) || "{}"),
    note: row.note ?? "",
    score: row.score,
    verdict: row.verdict,
    reflection: row.reflection ?? "",
    createdAt: row.created_at,
  };
}

app.get("/api/checkins", (_req, res) => {
  const rows = db.prepare("SELECT * FROM checkins ORDER BY date DESC").all() as Row[];
  res.json(rows.map(rowToCheckIn));
});

/** One check-in per day — saving again the same day replaces it. */
app.put("/api/checkins/:date", (req, res) => {
  const { answers, note, score, verdict, reflection } = req.body ?? {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    return void res.status(400).json({ error: "Bad date" });
  }
  db.prepare(`
    INSERT OR REPLACE INTO checkins (date, answers, note, score, verdict, reflection, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.date,
    JSON.stringify(answers ?? {}),
    String(note ?? ""),
    Number(score) || 0,
    String(verdict ?? "caution"),
    String(reflection ?? ""),
    new Date().toISOString(),
  );
  // The check-in decides which grades are tradable that day.
  recomputeFlags();
  const row = db.prepare("SELECT * FROM checkins WHERE date = ?").get(req.params.date) as Row;
  res.json(rowToCheckIn(row));
});

/*
 * The strategies table stays in the database untouched — its rows were the GOLD Model
 * before the rulebook — but nothing reads or writes it any more.
 */

/*
 * News is fetched by the server, never the browser: the calendar feed sends no CORS
 * headers, and a server can cache one copy instead of every tab fetching its own.
 */
/* The news rules live in the rulebook; the old news_rules row is kept, unread. */
app.get("/api/news/rules", (_req, res) => {
  res.json(currentRulebook(db).doc.news);
});

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
 * The morning's gold bias. Each read also nudges a Gmail check while today's briefing
 * is missing (throttled in gmailBias.ts), so the page's polling is what collects it.
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

/*
 * The limits live in the rulebook now. The old limits row stays in the database,
 * untouched, but is no longer read or written.
 */
app.get("/api/limits", (_req, res) => {
  res.json(currentRulebook(db).doc.limits);
});

/** A change to a limit is a rule change: it becomes a new rulebook version. */
app.put("/api/limits", (req, res) => {
  const current = currentRulebook(db).doc;
  const pct = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
  };
  const money = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const b = req.body ?? {};
  const l = current.limits;
  const limits = {
    ...l,
    enabled: b.enabled === false ? false : true,
    startBalance: money(b.startBalance, l.startBalance),
    openingBalance: money(b.openingBalance, l.openingBalance),
    secondAccount: money(b.secondAccount, l.secondAccount),
    maxRiskPct: pct(b.maxRiskPct, l.maxRiskPct),
    dailyStopPct: pct(b.dailyStopPct, l.dailyStopPct),
    weeklyStopPct: pct(b.weeklyStopPct, l.weeklyStopPct),
    dailyLossPct: pct(b.dailyLossPct, l.dailyLossPct),
    maxLossPct: pct(b.maxLossPct, l.maxLossPct),
    phase1TargetPct: pct(b.phase1TargetPct, l.phase1TargetPct),
    phase2TargetPct: pct(b.phase2TargetPct, l.phase2TargetPct),
  };
  if (JSON.stringify(limits) === JSON.stringify(l)) return void res.json(l);
  try {
    saveRulebook(db, { ...current, limits }, String(b.reason ?? ""), "minor");
  } catch (err) {
    return void res.status(400).json({ error: (err as Error).message, problems: (err as RulebookError).problems });
  }
  // Every percentage in the journal is measured from the opening balance.
  recompute();
  res.json(currentRulebook(db).doc.limits);
});

/* ── The rulebook ────────────────────────────────────────────────────── */

app.get("/api/rulebook", (_req, res) => {
  res.json(currentRulebook(db));
});

app.get("/api/rulebook/versions", (_req, res) => {
  res.json(listVersions(db));
});

app.get("/api/rulebook/versions/:version", (req, res) => {
  const v = getVersion(db, req.params.version);
  if (!v) return void res.status(404).json({ error: "No such version" });
  res.json(v);
});

/** Saving is always a new version, with a reason. Nothing that was saved is ever rewritten. */
app.put("/api/rulebook", (req, res) => {
  try {
    const saved = saveRulebook(db, req.body?.doc, String(req.body?.reason ?? ""), req.body?.bump === "major" ? "major" : "minor");
    recompute();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, problems: (err as RulebookError).problems ?? [] });
  }
});

/* ── Open items ──────────────────────────────────────────────────────── */

const rowToItem = (row: Row) => ({
  id: row.id,
  text: row.text,
  done: Boolean(row.done),
  doneAt: row.done_at ?? null,
});

app.get("/api/open-items", (_req, res) => {
  res.json((db.prepare("SELECT * FROM open_items ORDER BY sort, created_at").all() as Row[]).map(rowToItem));
});

app.put("/api/open-items/:id", (req, res) => {
  const done = Boolean(req.body?.done);
  const result = db
    .prepare("UPDATE open_items SET done = ?, done_at = ? WHERE id = ?")
    .run(done ? 1 : 0, done ? new Date().toISOString() : null, req.params.id);
  if (result.changes === 0) return void res.status(404).json({ error: "Not found" });
  res.json(rowToItem(db.prepare("SELECT * FROM open_items WHERE id = ?").get(req.params.id) as Row));
});

// The rules change between versions (v1.3 retired the daily plan), so every start
// re-judges the flags once — the same walk every write runs.
recompute();

startCalendarRefresh();
// Opening the desk starts the server — collect a waiting briefing straight away.
syncBias();

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Trade Assistant API → http://127.0.0.1:${PORT}`);
  console.log(`Baza danych → data/trade-assistant.db`);
});
