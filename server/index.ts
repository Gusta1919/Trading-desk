import cors from "cors";
import express from "express";
import { db, seedIfEmpty } from "./db.js";
import { computePnl, computeRMultiple } from "./stats.js";

seedIfEmpty();

const app = express();
const PORT = 3848;

app.use(cors());
app.use(express.json());

function rowToTrade(row: Record<string, unknown>) {
  return {
    id: row.id,
    symbol: row.symbol,
    market: row.market ?? "US",
    direction: row.direction,
    status: row.status,
    session: row.session,
    timeframe: row.timeframe ?? "",
    setupType: row.setup_type ?? "",
    strategy: row.strategy ?? "",
    entryDate: row.entry_date,
    exitDate: row.exit_date ?? null,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price ?? null,
    quantity: row.quantity,
    stopLoss: row.stop_loss ?? null,
    takeProfit: row.take_profit ?? null,
    pnl: row.pnl ?? null,
    pnlPercent: row.pnl_percent ?? null,
    rMultiple: row.r_multiple ?? null,
    fees: row.fees ?? 0,
    emotionalState: row.emotional_state ?? null,
    executionGrade: row.execution_grade ?? null,
    followedPlan: row.followed_plan == null ? null : Boolean(row.followed_plan),
    notes: row.notes ?? "",
    tags: JSON.parse((row.tags as string) ?? "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function enrich(input: Record<string, unknown>, existing?: Record<string, unknown>) {
  const direction = (input.direction ?? existing?.direction ?? "long") as string;
  const entryPrice = Number(input.entryPrice ?? existing?.entry_price ?? 0);
  const exitPrice =
    input.exitPrice !== undefined
      ? input.exitPrice
      : existing?.exit_price ?? null;
  const quantity = Number(input.quantity ?? existing?.quantity ?? 0);
  const stopLoss =
    input.stopLoss !== undefined ? input.stopLoss : existing?.stop_loss ?? null;
  const fees = Number(input.fees ?? existing?.fees ?? 0);

  const pnl =
    input.pnl ??
    computePnl({
      direction,
      entryPrice,
      exitPrice: exitPrice as number | null,
      quantity,
      fees,
    });
  const rMultiple = computeRMultiple({
    direction,
    entryPrice,
    exitPrice: exitPrice as number | null,
    stopLoss: stopLoss as number | null,
  });
  const pnlPercent =
    pnl != null && entryPrice > 0 ? (pnl / (entryPrice * quantity)) * 100 : null;

  return { pnl, pnlPercent, rMultiple };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/trades", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM trades ORDER BY entry_date DESC")
    .all() as Record<string, unknown>[];
  res.json(rows.map(rowToTrade));
});

app.get("/api/trades/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM trades WHERE id = ?")
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(rowToTrade(row));
});

app.post("/api/trades", (req, res) => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const body = req.body;
  const { pnl, pnlPercent, rMultiple } = enrich(body);

  db.prepare(`
    INSERT INTO trades (
      id, symbol, market, direction, status, session, timeframe, setup_type,
      strategy, entry_date, exit_date, entry_price, exit_price, quantity,
      stop_loss, take_profit, pnl, pnl_percent, r_multiple, fees,
      emotional_state, execution_grade, followed_plan, notes, tags,
      created_at, updated_at
    ) VALUES (
      @id, @symbol, @market, @direction, @status, @session, @timeframe, @setup_type,
      @strategy, @entry_date, @exit_date, @entry_price, @exit_price, @quantity,
      @stop_loss, @take_profit, @pnl, @pnl_percent, @r_multiple, @fees,
      @emotional_state, @execution_grade, @followed_plan, @notes, @tags,
      @created_at, @updated_at
    )
  `).run({
    id,
    symbol: body.symbol,
    market: body.market ?? "US",
    direction: body.direction,
    status: body.status ?? "closed",
    session: body.session ?? "regular",
    timeframe: body.timeframe ?? "",
    setup_type: body.setupType ?? "",
    strategy: body.strategy ?? "",
    entry_date: body.entryDate,
    exit_date: body.exitDate ?? null,
    entry_price: body.entryPrice,
    exit_price: body.exitPrice ?? null,
    quantity: body.quantity,
    stop_loss: body.stopLoss ?? null,
    take_profit: body.takeProfit ?? null,
    pnl,
    pnl_percent: pnlPercent,
    r_multiple: rMultiple,
    fees: body.fees ?? 0,
    emotional_state: body.emotionalState ?? null,
    execution_grade: body.executionGrade ?? null,
    followed_plan:
      body.followedPlan == null ? null : body.followedPlan ? 1 : 0,
    notes: body.notes ?? "",
    tags: JSON.stringify(body.tags ?? []),
    created_at: now,
    updated_at: now,
  });

  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(id);
  res.status(201).json(rowToTrade(row as Record<string, unknown>));
});

app.put("/api/trades/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM trades WHERE id = ?")
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: "Not found" });

  const body = req.body;
  const now = new Date().toISOString();
  const merged = {
    direction: body.direction ?? existing.direction,
    entryPrice: body.entryPrice ?? existing.entry_price,
    exitPrice:
      body.exitPrice !== undefined ? body.exitPrice : existing.exit_price,
    quantity: body.quantity ?? existing.quantity,
    stopLoss:
      body.stopLoss !== undefined ? body.stopLoss : existing.stop_loss,
    fees: body.fees ?? existing.fees,
    pnl: body.pnl,
  };
  const { pnl, pnlPercent, rMultiple } = enrich(merged, existing);

  db.prepare(`
    UPDATE trades SET
      symbol=@symbol, market=@market, direction=@direction, status=@status,
      session=@session, timeframe=@timeframe, setup_type=@setup_type,
      strategy=@strategy, entry_date=@entry_date, exit_date=@exit_date,
      entry_price=@entry_price, exit_price=@exit_price, quantity=@quantity,
      stop_loss=@stop_loss, take_profit=@take_profit, pnl=@pnl,
      pnl_percent=@pnl_percent, r_multiple=@r_multiple, fees=@fees,
      emotional_state=@emotional_state, execution_grade=@execution_grade,
      followed_plan=@followed_plan, notes=@notes, tags=@tags, updated_at=@updated_at
    WHERE id=@id
  `).run({
    id: req.params.id,
    symbol: body.symbol ?? existing.symbol,
    market: body.market ?? existing.market,
    direction: body.direction ?? existing.direction,
    status: body.status ?? existing.status,
    session: body.session ?? existing.session,
    timeframe: body.timeframe ?? existing.timeframe,
    setup_type: body.setupType ?? existing.setup_type,
    strategy: body.strategy ?? existing.strategy,
    entry_date: body.entryDate ?? existing.entry_date,
    exit_date: body.exitDate !== undefined ? body.exitDate : existing.exit_date,
    entry_price: body.entryPrice ?? existing.entry_price,
    exit_price: body.exitPrice !== undefined ? body.exitPrice : existing.exit_price,
    quantity: body.quantity ?? existing.quantity,
    stop_loss: body.stopLoss !== undefined ? body.stopLoss : existing.stop_loss,
    take_profit:
      body.takeProfit !== undefined ? body.takeProfit : existing.take_profit,
    pnl,
    pnl_percent: pnlPercent,
    r_multiple: rMultiple,
    fees: body.fees ?? existing.fees,
    emotional_state:
      body.emotionalState !== undefined
        ? body.emotionalState
        : existing.emotional_state,
    execution_grade: body.executionGrade ?? existing.execution_grade,
    followed_plan:
      body.followedPlan !== undefined
        ? body.followedPlan == null
          ? null
          : body.followedPlan
            ? 1
            : 0
        : existing.followed_plan,
    notes: body.notes ?? existing.notes,
    tags: JSON.stringify(body.tags ?? JSON.parse((existing.tags as string) ?? "[]")),
    updated_at: now,
  });

  const row = db.prepare("SELECT * FROM trades WHERE id = ?").get(req.params.id);
  res.json(rowToTrade(row as Record<string, unknown>));
});

app.delete("/api/trades/:id", (req, res) => {
  db.prepare("UPDATE journal_entries SET trade_id = NULL WHERE trade_id = ?").run(
    req.params.id,
  );
  db.prepare("DELETE FROM trades WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

app.get("/api/journal", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM journal_entries ORDER BY created_at DESC")
    .all() as Record<string, unknown>[];
  res.json(
    rows.map((row) => ({
      id: row.id,
      tradeId: row.trade_id ?? null,
      title: row.title,
      content: row.content ?? "",
      entryType: row.entry_type,
      mood: row.mood ?? null,
      tags: JSON.parse((row.tags as string) ?? "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  );
});

app.post("/api/journal", (req, res) => {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const body = req.body;

  db.prepare(`
    INSERT INTO journal_entries (id, trade_id, title, content, entry_type, mood, tags, created_at, updated_at)
    VALUES (@id, @trade_id, @title, @content, @entry_type, @mood, @tags, @created_at, @updated_at)
  `).run({
    id,
    trade_id: body.tradeId ?? null,
    title: body.title,
    content: body.content ?? "",
    entry_type: body.entryType ?? "general",
    mood: body.mood ?? null,
    tags: JSON.stringify(body.tags ?? []),
    created_at: now,
    updated_at: now,
  });

  res.status(201).json({
    id,
    tradeId: body.tradeId ?? null,
    title: body.title,
    content: body.content ?? "",
    entryType: body.entryType ?? "general",
    mood: body.mood ?? null,
    tags: body.tags ?? [],
    createdAt: now,
    updatedAt: now,
  });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Trade Assistant API → http://127.0.0.1:${PORT}`);
  console.log(`Baza danych → data/trade-assistant.db`);
});
