import cors from "cors";
import express from "express";
import { readBias } from "./bias.js";
import { getCandles } from "./candles.js";
import { gmailStatus, syncBias } from "./gmailBias.js";
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

const FLAGS = new Set(["over_risk", "non_traded_grade", "after_daily_stop"]);

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
    strategyId: row.strategy_id ?? null,
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
    expectedMinutes: row.expected_minutes ?? null,
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
    strategy_id: body.strategyId ? String(body.strategyId) : null,
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
    expected_minutes: num(body.expectedMinutes),
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
  // Graded under the rulebook: R, lots and the excursions all rest on the initial stop.
  if (body.rulebookVersion && (body.stopPrice == null || body.stopPrice === "")) return "Add the initial stop";
  return null;
}

const COLUMNS = [
  "date", "symbol", "direction", "session", "setup", "strategy_id", "htf", "entry_model", "risk_pct",
  "planned_rr", "result_r", "followed_plan", "grade", "emotion", "mistakes",
  "checklist", "checklist_total", "cost_pct", "box_size", "pnl_usd", "notes", "screenshot",
  "news", "planned_risk_pct", "setup_snapshot", "flags", "flag_note", "skipped", "hypothetical_r",
  "expected_minutes", "rulebook_version", "box_high", "box_low", "sweep_extreme", "sweep_depth",
  "took_15m_swing", "htf_reason_type", "poi_tests", "level_sweep", "desk_agreed", "entry_type",
  "entry_price", "stop_price", "target_price", "lots", "atr", "mss_beyond", "exit_time", "exit_price",
  "exit_reason", "early_stop_move", "release_at_be", "mfe_price", "mae_price", "target_before_stop",
  "max_fav_price", "screenshot_after",
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

  recomputeResults();
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

  recomputeResults();
  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(req.params.id) as Row;
  res.json(rowToTrade(row));
});

app.delete("/api/trades/:id", (req, res) => {
  db.prepare("DELETE FROM trades WHERE id = ?").run(req.params.id);
  // Removing a trade changes the balance every later trade was measured against.
  recomputeResults();
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
  const row = db.prepare("SELECT * FROM checkins WHERE date = ?").get(req.params.date) as Row;
  res.json(rowToCheckIn(row));
});

/* ── Strategies ──────────────────────────────────────────────────────── */

const GRADES = ["A+", "A", "B", "C"] as const;
const DEFAULT_GRADES = [
  { grade: "A+", riskPct: 1, traded: true, description: "" },
  { grade: "A", riskPct: 0.5, traded: true, description: "" },
  { grade: "B", riskPct: 0.25, traded: true, description: "" },
  { grade: "C", riskPct: 0, traded: false, description: "" },
];

/** Always the four cards in ladder order, whatever was stored or sent. */
function gradeCards(raw: unknown) {
  const list = Array.isArray(raw) ? (raw as Row[]) : [];
  return DEFAULT_GRADES.map((d) => {
    const found = list.find((c) => c && c.grade === d.grade);
    const risk = Number(found?.riskPct);
    return {
      grade: d.grade,
      riskPct: Number.isFinite(risk) && risk >= 0 ? risk : d.riskPct,
      traded: typeof found?.traded === "boolean" ? found.traded : d.traded,
      description: typeof found?.description === "string" ? found.description : "",
    };
  });
}

const isGrade = (g: unknown) => GRADES.includes(g as (typeof GRADES)[number]);

/** Keeps a factor list to the two known shapes, dropping anything malformed. */
function factorList(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as Row[]).flatMap((f): Row[] => {
    if (!f || typeof f.id !== "string") return [];
    const base = { id: f.id, name: String(f.name ?? "").trim(), hint: String(f.hint ?? "") };
    if (f.kind === "choice" && Array.isArray(f.options)) {
      const options = (f.options as Row[])
        .filter((o) => o && typeof o.id === "string" && isGrade(o.cap))
        .map((o) => ({ id: o.id, label: String(o.label ?? "").trim(), cap: o.cap }));
      return [{ ...base, kind: "choice", options }];
    }
    if (f.kind === "number" && Array.isArray(f.cuts) && Array.isArray(f.caps)) {
      const cuts = (f.cuts as Row[])
        .map((c) => ({ value: Number(c?.value), lowerGetsIt: Boolean(c?.lowerGetsIt) }))
        .filter((c) => Number.isFinite(c.value));
      const ascending = cuts.every((c, i) => i === 0 || c.value > cuts[i - 1].value);
      const caps = (f.caps as unknown[]).filter(isGrade);
      if (!ascending || caps.length !== cuts.length + 1) return [];
      return [{ ...base, kind: "number", unit: String(f.unit ?? ""), cuts, caps }];
    }
    return [];
  });
}

function ruleList(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return (raw as Row[])
    .filter((r) => r && typeof r.id === "string" && String(r.text ?? "").trim())
    .map((r) => ({
      id: r.id,
      text: String(r.text).trim(),
      hint: String(r.hint ?? ""),
      ...(r.auto === "daily-budget" ? { auto: "daily-budget" } : {}),
    }));
}

function rowToStrategy(row: Row) {
  return {
    id: row.id,
    name: row.name,
    instrument: row.instrument ?? "",
    description: row.description ?? "",
    hoursFrom: row.hours_from ?? "",
    hoursTo: row.hours_to ?? "",
    sessions: parseJson(row.sessions, []),
    invalidation: row.invalidation ?? "",
    rrFrom: row.rr_from ?? null,
    rrTo: row.rr_to ?? null,
    baseRules: ruleList(parseJson(row.base_rules, [])),
    factors: factorList(parseJson(row.factors, [])),
    grades: gradeCards(parseJson(row.grades, [])),
    boxLabel: row.box_label ?? "",
    boxUnit: row.box_unit ?? "",
    boxMin: row.box_min ?? null,
    boxMax: row.box_max ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STRATEGY_COLUMNS = [
  "name", "instrument", "description", "hours_from", "hours_to", "sessions", "invalidation",
  "rr_from", "rr_to", "base_rules", "factors", "grades", "box_label", "box_unit",
  "box_min", "box_max", "definition_migrated",
];

function strategyColumns(body: Row) {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    name: String(body.name ?? "").trim(),
    instrument: String(body.instrument ?? "").trim(),
    description: String(body.description ?? ""),
    hours_from: String(body.hoursFrom ?? ""),
    hours_to: String(body.hoursTo ?? ""),
    sessions: JSON.stringify(Array.isArray(body.sessions) ? body.sessions : []),
    invalidation: String(body.invalidation ?? ""),
    rr_from: num(body.rrFrom),
    rr_to: num(body.rrTo),
    base_rules: JSON.stringify(ruleList(body.baseRules)),
    factors: JSON.stringify(factorList(body.factors)),
    grades: JSON.stringify(gradeCards(body.grades)),
    box_label: String(body.boxLabel ?? "").trim(),
    box_unit: String(body.boxUnit ?? "").trim(),
    box_min: num(body.boxMin),
    box_max: num(body.boxMax),
    // Written in the new shape, so the one-off conversion must never touch it.
    definition_migrated: 1,
  };
}

app.get("/api/strategies", (_req, res) => {
  const rows = db.prepare("SELECT * FROM strategies ORDER BY name").all() as Row[];
  res.json(rows.map(rowToStrategy));
});

app.post("/api/strategies", (req, res) => {
  if (!String(req.body?.name ?? "").trim()) return void res.status(400).json({ error: "Name is required" });
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO strategies (id, ${STRATEGY_COLUMNS.join(", ")}, created_at, updated_at)
    VALUES (@id, ${STRATEGY_COLUMNS.map((c) => "@" + c).join(", ")}, @created_at, @updated_at)
  `).run({ id, ...strategyColumns(req.body), created_at: now, updated_at: now });
  res.status(201).json(rowToStrategy(db.prepare("SELECT * FROM strategies WHERE id = ?").get(id) as Row));
});

app.put("/api/strategies/:id", (req, res) => {
  if (!String(req.body?.name ?? "").trim()) return void res.status(400).json({ error: "Name is required" });
  const result = db.prepare(`
    UPDATE strategies SET ${STRATEGY_COLUMNS.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @updated_at
    WHERE id = @id
  `).run({ id: req.params.id, ...strategyColumns(req.body), updated_at: new Date().toISOString() });
  if (result.changes === 0) return void res.status(404).json({ error: "Not found" });
  res.json(rowToStrategy(db.prepare("SELECT * FROM strategies WHERE id = ?").get(req.params.id) as Row));
});

/** Deleting a strategy keeps its trades — they just lose the link. */
app.delete("/api/strategies/:id", (req, res) => {
  db.prepare("UPDATE trades SET strategy_id = NULL WHERE strategy_id = ?").run(req.params.id);
  db.prepare("DELETE FROM strategies WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

/* ── Weekly reasoning ────────────────────────────────────────────────── */

function rowToWeek(row: Row) {
  return {
    week: row.week,
    bias: row.bias ?? "",
    reasoning: row.reasoning ?? "",
    levels: row.levels ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/*
 * News is fetched by the server, never the browser: the calendar feed sends no CORS
 * headers, and a server can cache one copy instead of every tab fetching its own.
 */
const rowToNewsRules = (row: Row) => ({
  forbidden: JSON.parse((row.forbidden as string) || "[]"),
  blockCurrencies: JSON.parse((row.block_currencies as string) || "[]"),
});

app.get("/api/news/rules", (_req, res) => {
  res.json(rowToNewsRules(db.prepare("SELECT * FROM news_rules WHERE id = 1").get() as Row));
});

app.put("/api/news/rules", (req, res) => {
  const list = (v: unknown) => JSON.stringify(Array.isArray(v) ? v.map(String) : []);
  db.prepare(`
    UPDATE news_rules
    SET forbidden = ?, block_currencies = ?, updated_at = ?
    WHERE id = 1
  `).run(list(req.body?.forbidden), list(req.body?.blockCurrencies), new Date().toISOString());
  res.json(rowToNewsRules(db.prepare("SELECT * FROM news_rules WHERE id = 1").get() as Row));
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
  recomputeResults();
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
    recomputeResults();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, problems: (err as RulebookError).problems ?? [] });
  }
});

/* ── Daily plans ─────────────────────────────────────────────────────── */

function rowToPlan(row: Row) {
  return {
    date: row.date,
    bias: row.bias ?? "",
    levels: parseJson(row.levels, {}),
    pois: row.pois ?? "",
    deskCheck: row.desk_check ?? "",
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get("/api/plans", (_req, res) => {
  const rows = db.prepare("SELECT * FROM plans ORDER BY date DESC").all() as Row[];
  res.json(rows.map(rowToPlan));
});

/** One plan per New York day. Editing keeps the time it was first written — that is what "on time" means. */
app.put("/api/plans/:date", (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) return void res.status(400).json({ error: "Bad date" });
  const b = req.body ?? {};
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT created_at FROM plans WHERE date = ?").get(req.params.date) as
    | { created_at: string }
    | undefined;
  db.prepare(`
    INSERT OR REPLACE INTO plans (date, bias, levels, pois, desk_check, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.date,
    oneOf(b.bias, ["bullish", "bearish", "unclear"]),
    JSON.stringify(b.levels && typeof b.levels === "object" ? b.levels : {}),
    String(b.pois ?? ""),
    oneOf(b.deskCheck, ["agree", "disagree", "none"]),
    String(b.notes ?? ""),
    existing?.created_at ?? now,
    now,
  );
  res.json(rowToPlan(db.prepare("SELECT * FROM plans WHERE date = ?").get(req.params.date) as Row));
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

app.get("/api/weeks", (_req, res) => {
  const rows = db.prepare("SELECT * FROM weeks ORDER BY week DESC").all() as Row[];
  res.json(rows.map(rowToWeek));
});

/** One note per ISO week — saving again replaces it. */
app.put("/api/weeks/:week", (req, res) => {
  if (!/^\d{4}-W\d{2}$/.test(req.params.week)) {
    return void res.status(400).json({ error: "Bad week" });
  }
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT created_at FROM weeks WHERE week = ?").get(req.params.week) as
    | { created_at: string }
    | undefined;
  db.prepare(`
    INSERT OR REPLACE INTO weeks (week, bias, reasoning, levels, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.params.week,
    String(req.body?.bias ?? ""),
    String(req.body?.reasoning ?? ""),
    String(req.body?.levels ?? ""),
    existing?.created_at ?? now,
    now,
  );
  res.json(rowToWeek(db.prepare("SELECT * FROM weeks WHERE week = ?").get(req.params.week) as Row));
});

startCalendarRefresh();
// Opening the desk starts the server — collect a waiting briefing straight away.
syncBias();

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Trade Assistant API → http://127.0.0.1:${PORT}`);
  console.log(`Baza danych → data/trade-assistant.db`);
});
