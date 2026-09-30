import cors from "cors";
import express from "express";
import { readBias } from "./bias.js";
import { db } from "./db.js";
import { getCalendar, getHeadlines, startCalendarRefresh } from "./news.js";

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
  };
}

function validate(body: Row): string | null {
  if (!body.date) return "Date is required";
  if (!String(body.symbol ?? "").trim()) return "Symbol is required";
  if (body.skipped) return null; // nothing was risked
  const risk = Number(body.riskPct);
  if (!Number.isFinite(risk) || risk <= 0) return "Risk % must be above 0";
  return null;
}

const COLUMNS = [
  "date", "symbol", "direction", "session", "setup", "strategy_id", "htf", "entry_model", "risk_pct",
  "planned_rr", "result_r", "followed_plan", "grade", "emotion", "mistakes",
  "checklist", "checklist_total", "cost_pct", "box_size", "pnl_usd", "notes", "screenshot",
  "news", "planned_risk_pct", "setup_snapshot", "flags", "flag_note", "skipped", "hypothetical_r",
  "expected_minutes",
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
 *
 * Trades with no dollar figure keep whatever R they already have, so anything typed
 * in by hand before this existed still counts toward the running balance.
 */
function recomputeResults() {
  const start = Number(
    (db.prepare("SELECT start_balance FROM limits WHERE id = 1").get() as Row | undefined)
      ?.start_balance ?? 200000,
  );
  const rows = db
    // Skipped setups never touched the account.
    .prepare(
      "SELECT id, date, risk_pct, result_r, pnl_usd FROM trades WHERE skipped = 0 ORDER BY date, created_at",
    )
    .all() as Row[];

  const update = db.prepare("UPDATE trades SET result_r = ? WHERE id = ?");
  let balance = start;

  const apply = db.transaction(() => {
    for (const r of rows) {
      const pnl = r.pnl_usd == null ? null : Number(r.pnl_usd);
      const risk = Number(r.risk_pct) || 0;

      if (pnl == null) {
        // No dollars: trust the stored R and let it move the balance anyway.
        const pct = (Number(r.result_r) || 0) * risk;
        balance += (balance * pct) / 100;
        continue;
      }
      const pct = balance > 0 ? (pnl / balance) * 100 : 0;
      const resultR = risk > 0 ? pct / risk : 0;
      update.run(Number(resultR.toFixed(6)), r.id);
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

const rowToLimits = (row: Row) => ({
  enabled: Boolean(row.enabled),
  startBalance: Number(row.start_balance ?? 200000),
  maxRiskPct: Number(row.max_risk_pct ?? 1),
  dailyStopPct: Number(row.daily_stop_pct ?? 1),
  dailyLossPct: Number(row.daily_loss_pct),
  maxLossPct: Number(row.max_loss_pct),
});

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

/* The morning's gold bias, written by a scheduled Claude task — see server/bias.ts. */
app.get("/api/bias", (_req, res) => {
  res.json(readBias());
});

app.get("/api/limits", (_req, res) => {
  res.json(rowToLimits(db.prepare("SELECT * FROM limits WHERE id = 1").get() as Row));
});

app.put("/api/limits", (req, res) => {
  const pct = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 100 ? n : fallback;
  };
  const current = db.prepare("SELECT * FROM limits WHERE id = 1").get() as Row;
  const balance = Number(req.body?.startBalance);
  db.prepare(`
    UPDATE limits SET enabled = ?, start_balance = ?, max_risk_pct = ?, daily_stop_pct = ?,
      daily_loss_pct = ?, max_loss_pct = ?, updated_at = ?
    WHERE id = 1
  `).run(
    req.body?.enabled === false ? 0 : 1,
    Number.isFinite(balance) && balance > 0 ? balance : Number(current.start_balance),
    pct(req.body?.maxRiskPct, Number(current.max_risk_pct)),
    pct(req.body?.dailyStopPct, Number(current.daily_stop_pct)),
    pct(req.body?.dailyLossPct, Number(current.daily_loss_pct)),
    pct(req.body?.maxLossPct, Number(current.max_loss_pct)),
    new Date().toISOString(),
  );
  // Every percentage in the journal is measured from this number.
  recomputeResults();
  res.json(rowToLimits(db.prepare("SELECT * FROM limits WHERE id = 1").get() as Row));
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Trade Assistant API → http://127.0.0.1:${PORT}`);
  console.log(`Baza danych → data/trade-assistant.db`);
});
