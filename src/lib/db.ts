import type { JournalEntry, JournalInput, Trade, TradeInput } from "@/types";
import { computePnl, computeRMultiple } from "./stats";
import { generateId } from "./utils";

const STORAGE_KEY = "trade_assistant_data_v1";

interface StoredData {
  trades: Trade[];
  journal: JournalEntry[];
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readLocal(): StoredData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { trades: [], journal: [] };
  return JSON.parse(raw) as StoredData;
}

function writeLocal(data: StoredData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

let db: import("@tauri-apps/plugin-sql").default | null = null;

async function getDb() {
  if (!isTauri()) return null;
  if (!db) {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    db = await Database.load("sqlite:trade_assistant.db");
    await migrate(db);
  }
  return db;
}

async function migrate(database: import("@tauri-apps/plugin-sql").default) {
  await database.execute(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      market TEXT DEFAULT 'US',
      direction TEXT NOT NULL,
      status TEXT DEFAULT 'closed',
      session TEXT DEFAULT 'regular',
      timeframe TEXT DEFAULT '',
      setup_type TEXT DEFAULT '',
      strategy TEXT DEFAULT '',
      entry_date TEXT NOT NULL,
      exit_date TEXT,
      entry_price REAL NOT NULL,
      exit_price REAL,
      quantity REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL,
      pnl REAL,
      pnl_percent REAL,
      r_multiple REAL,
      fees REAL DEFAULT 0,
      emotional_state INTEGER,
      execution_grade TEXT,
      followed_plan INTEGER,
      notes TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      trade_id TEXT,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      entry_type TEXT DEFAULT 'general',
      mood INTEGER,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL
    )
  `);
}

function rowToTrade(row: Record<string, unknown>): Trade {
  return {
    id: row.id as string,
    symbol: row.symbol as string,
    market: (row.market as string) ?? "US",
    direction: row.direction as Trade["direction"],
    status: row.status as Trade["status"],
    session: row.session as Trade["session"],
    timeframe: (row.timeframe as string) ?? "",
    setupType: (row.setup_type as string) ?? "",
    strategy: (row.strategy as string) ?? "",
    entryDate: row.entry_date as string,
    exitDate: (row.exit_date as string) ?? null,
    entryPrice: row.entry_price as number,
    exitPrice: (row.exit_price as number) ?? null,
    quantity: row.quantity as number,
    stopLoss: (row.stop_loss as number) ?? null,
    takeProfit: (row.take_profit as number) ?? null,
    pnl: (row.pnl as number) ?? null,
    pnlPercent: (row.pnl_percent as number) ?? null,
    rMultiple: (row.r_multiple as number) ?? null,
    fees: (row.fees as number) ?? 0,
    emotionalState: (row.emotional_state as number) ?? null,
    executionGrade: (row.execution_grade as string) ?? null,
    followedPlan:
      row.followed_plan == null ? null : Boolean(row.followed_plan),
    notes: (row.notes as string) ?? "",
    tags: JSON.parse((row.tags as string) ?? "[]") as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function enrichTrade(input: TradeInput, existing?: Trade): Trade {
  const now = new Date().toISOString();
  const exitPrice = input.exitPrice ?? existing?.exitPrice ?? null;
  const direction = input.direction ?? existing?.direction ?? "long";
  const entryPrice = input.entryPrice ?? existing?.entryPrice ?? 0;
  const quantity = input.quantity ?? existing?.quantity ?? 0;
  const stopLoss = input.stopLoss ?? existing?.stopLoss ?? null;
  const fees = input.fees ?? existing?.fees ?? 0;

  const pnl =
    input.pnl ??
    computePnl({ direction, entryPrice, exitPrice, quantity, fees });
  const rMultiple = computeRMultiple({
    direction,
    entryPrice,
    exitPrice,
    stopLoss,
  });
  const pnlPercent =
    pnl != null && entryPrice > 0
      ? (pnl / (entryPrice * quantity)) * 100
      : null;

  return {
    id: existing?.id ?? generateId(),
    symbol: input.symbol ?? existing?.symbol ?? "",
    market: input.market ?? existing?.market ?? "US",
    direction,
    status: input.status ?? existing?.status ?? "closed",
    session: input.session ?? existing?.session ?? "regular",
    timeframe: input.timeframe ?? existing?.timeframe ?? "",
    setupType: input.setupType ?? existing?.setupType ?? "",
    strategy: input.strategy ?? existing?.strategy ?? "",
    entryDate: input.entryDate ?? existing?.entryDate ?? now,
    exitDate: input.exitDate ?? existing?.exitDate ?? null,
    entryPrice,
    exitPrice,
    quantity,
    stopLoss,
    takeProfit: input.takeProfit ?? existing?.takeProfit ?? null,
    pnl,
    pnlPercent,
    rMultiple,
    fees,
    emotionalState: input.emotionalState ?? existing?.emotionalState ?? null,
    executionGrade: input.executionGrade ?? existing?.executionGrade ?? null,
    followedPlan: input.followedPlan ?? existing?.followedPlan ?? null,
    notes: input.notes ?? existing?.notes ?? "",
    tags: input.tags ?? existing?.tags ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export async function getAllTrades(): Promise<Trade[]> {
  const database = await getDb();
  if (database) {
    const rows = await database.select<Record<string, unknown>[]>(
      "SELECT * FROM trades ORDER BY entry_date DESC",
    );
    return (rows ?? []).map(rowToTrade);
  }
  return readLocal().trades.sort(
    (a, b) =>
      new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime(),
  );
}

export async function getTrade(id: string): Promise<Trade | null> {
  const database = await getDb();
  if (database) {
    const rows = await database.select<Record<string, unknown>[]>(
      "SELECT * FROM trades WHERE id = $1",
      [id],
    );
    return rows?.[0] ? rowToTrade(rows[0]) : null;
  }
  return readLocal().trades.find((t) => t.id === id) ?? null;
}

export async function createTrade(input: TradeInput): Promise<Trade> {
  const trade = enrichTrade(input);

  const database = await getDb();
  if (database) {
    await database.execute(
      `INSERT INTO trades (
        id, symbol, market, direction, status, session, timeframe, setup_type,
        strategy, entry_date, exit_date, entry_price, exit_price, quantity,
        stop_loss, take_profit, pnl, pnl_percent, r_multiple, fees,
        emotional_state, execution_grade, followed_plan, notes, tags,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        trade.id,
        trade.symbol,
        trade.market,
        trade.direction,
        trade.status,
        trade.session,
        trade.timeframe,
        trade.setupType,
        trade.strategy,
        trade.entryDate,
        trade.exitDate,
        trade.entryPrice,
        trade.exitPrice,
        trade.quantity,
        trade.stopLoss,
        trade.takeProfit,
        trade.pnl,
        trade.pnlPercent,
        trade.rMultiple,
        trade.fees,
        trade.emotionalState,
        trade.executionGrade,
        trade.followedPlan == null ? null : trade.followedPlan ? 1 : 0,
        trade.notes,
        JSON.stringify(trade.tags),
        trade.createdAt,
        trade.updatedAt,
      ],
    );
    return trade;
  }

  const data = readLocal();
  data.trades.unshift(trade);
  writeLocal(data);
  return trade;
}

export async function updateTrade(
  id: string,
  input: Partial<TradeInput>,
): Promise<Trade | null> {
  const existing = await getTrade(id);
  if (!existing) return null;
  const trade = enrichTrade(
    {
      symbol: input.symbol ?? existing.symbol,
      direction: input.direction ?? existing.direction,
      entryDate: input.entryDate ?? existing.entryDate,
      entryPrice: input.entryPrice ?? existing.entryPrice,
      quantity: input.quantity ?? existing.quantity,
      ...input,
    },
    existing,
  );

  const database = await getDb();
  if (database) {
    await database.execute(
      `UPDATE trades SET
        symbol=$2, market=$3, direction=$4, status=$5, session=$6,
        timeframe=$7, setup_type=$8, strategy=$9, entry_date=$10,
        exit_date=$11, entry_price=$12, exit_price=$13, quantity=$14,
        stop_loss=$15, take_profit=$16, pnl=$17, pnl_percent=$18,
        r_multiple=$19, fees=$20, emotional_state=$21, execution_grade=$22,
        followed_plan=$23, notes=$24, tags=$25, updated_at=$26
      WHERE id=$1`,
      [
        trade.id,
        trade.symbol,
        trade.market,
        trade.direction,
        trade.status,
        trade.session,
        trade.timeframe,
        trade.setupType,
        trade.strategy,
        trade.entryDate,
        trade.exitDate,
        trade.entryPrice,
        trade.exitPrice,
        trade.quantity,
        trade.stopLoss,
        trade.takeProfit,
        trade.pnl,
        trade.pnlPercent,
        trade.rMultiple,
        trade.fees,
        trade.emotionalState,
        trade.executionGrade,
        trade.followedPlan == null ? null : trade.followedPlan ? 1 : 0,
        trade.notes,
        JSON.stringify(trade.tags),
        trade.updatedAt,
      ],
    );
    return trade;
  }

  const data = readLocal();
  const idx = data.trades.findIndex((t) => t.id === id);
  if (idx >= 0) data.trades[idx] = trade;
  writeLocal(data);
  return trade;
}

export async function deleteTrade(id: string): Promise<void> {
  const database = await getDb();
  if (database) {
    await database.execute("DELETE FROM trades WHERE id = $1", [id]);
    await database.execute(
      "UPDATE journal_entries SET trade_id = NULL WHERE trade_id = $1",
      [id],
    );
    return;
  }
  const data = readLocal();
  data.trades = data.trades.filter((t) => t.id !== id);
  data.journal = data.journal.map((j) =>
    j.tradeId === id ? { ...j, tradeId: null } : j,
  );
  writeLocal(data);
}

function rowToJournal(row: Record<string, unknown>): JournalEntry {
  return {
    id: row.id as string,
    tradeId: (row.trade_id as string) ?? null,
    title: row.title as string,
    content: (row.content as string) ?? "",
    entryType: row.entry_type as JournalEntry["entryType"],
    mood: (row.mood as number) ?? null,
    tags: JSON.parse((row.tags as string) ?? "[]") as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getAllJournalEntries(): Promise<JournalEntry[]> {
  const database = await getDb();
  if (database) {
    const rows = await database.select<Record<string, unknown>[]>(
      "SELECT * FROM journal_entries ORDER BY created_at DESC",
    );
    return (rows ?? []).map(rowToJournal);
  }
  return readLocal().journal.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function getJournalForTrade(
  tradeId: string,
): Promise<JournalEntry[]> {
  const all = await getAllJournalEntries();
  return all.filter((j) => j.tradeId === tradeId);
}

export async function createJournalEntry(
  input: JournalInput,
): Promise<JournalEntry> {
  const now = new Date().toISOString();
  const entry: JournalEntry = {
    id: generateId(),
    tradeId: input.tradeId ?? null,
    title: input.title,
    content: input.content,
    entryType: input.entryType ?? "general",
    mood: input.mood ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const database = await getDb();
  if (database) {
    await database.execute(
      `INSERT INTO journal_entries
        (id, trade_id, title, content, entry_type, mood, tags, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        entry.id,
        entry.tradeId,
        entry.title,
        entry.content,
        entry.entryType,
        entry.mood,
        JSON.stringify(entry.tags),
        entry.createdAt,
        entry.updatedAt,
      ],
    );
    return entry;
  }

  const data = readLocal();
  data.journal.unshift(entry);
  writeLocal(data);
  return entry;
}

export async function updateJournalEntry(
  id: string,
  input: Partial<JournalInput>,
): Promise<JournalEntry | null> {
  const database = await getDb();
  const all = await getAllJournalEntries();
  const existing = all.find((j) => j.id === id);
  if (!existing) return null;

  const entry: JournalEntry = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  if (database) {
    await database.execute(
      `UPDATE journal_entries SET
        trade_id=$2, title=$3, content=$4, entry_type=$5,
        mood=$6, tags=$7, updated_at=$8
      WHERE id=$1`,
      [
        entry.id,
        entry.tradeId,
        entry.title,
        entry.content,
        entry.entryType,
        entry.mood,
        JSON.stringify(entry.tags),
        entry.updatedAt,
      ],
    );
    return entry;
  }

  const data = readLocal();
  const idx = data.journal.findIndex((j) => j.id === id);
  if (idx >= 0) data.journal[idx] = entry;
  writeLocal(data);
  return entry;
}

export async function deleteJournalEntry(id: string): Promise<void> {
  const database = await getDb();
  if (database) {
    await database.execute("DELETE FROM journal_entries WHERE id = $1", [id]);
    return;
  }
  const data = readLocal();
  data.journal = data.journal.filter((j) => j.id !== id);
  writeLocal(data);
}

export async function seedDemoData(): Promise<void> {
  const trades = await getAllTrades();
  if (trades.length > 0) return;

  const demoTrades: TradeInput[] = [
    {
      symbol: "NVDA",
      direction: "long",
      entryDate: new Date(Date.now() - 86400000 * 2).toISOString(),
      exitDate: new Date(Date.now() - 86400000 * 2 + 3600000).toISOString(),
      entryPrice: 875.5,
      exitPrice: 882.3,
      quantity: 10,
      stopLoss: 872.0,
      strategy: "Breakout",
      setupType: "VWAP reclaim",
      session: "regular",
      timeframe: "5m",
      emotionalState: 4,
      executionGrade: "A",
      followedPlan: true,
      notes: "Czysty setup, cierpliwe wejście na retest.",
      tags: ["momentum", "tech"],
    },
    {
      symbol: "TSLA",
      direction: "short",
      entryDate: new Date(Date.now() - 86400000).toISOString(),
      exitDate: new Date(Date.now() - 86400000 + 1800000).toISOString(),
      entryPrice: 245.8,
      exitPrice: 248.2,
      quantity: 20,
      stopLoss: 247.5,
      strategy: "Mean reversion",
      setupType: "Failed breakout",
      session: "regular",
      timeframe: "15m",
      emotionalState: 2,
      executionGrade: "C",
      followedPlan: false,
      notes: "Wszedłem za wcześnie, nie poczekałem na potwierdzenie.",
      tags: ["mistake", "fomo"],
    },
    {
      symbol: "AAPL",
      direction: "long",
      entryDate: new Date(Date.now() - 3600000 * 4).toISOString(),
      exitDate: new Date(Date.now() - 3600000 * 2).toISOString(),
      entryPrice: 189.2,
      exitPrice: 190.85,
      quantity: 50,
      stopLoss: 188.5,
      strategy: "Breakout",
      setupType: "Opening range",
      session: "regular",
      timeframe: "1m",
      emotionalState: 5,
      executionGrade: "A+",
      followedPlan: true,
      notes: "Idealne wykonanie planu. Dokładnie według checklisty.",
      tags: ["opening", "discipline"],
    },
  ];

  for (const t of demoTrades) {
    await createTrade(t);
  }

  await createJournalEntry({
    title: "Refleksja tygodniowa",
    content:
      "Ten tydzień pokazał, że moje najlepsze trady pochodzą z cierpliwości na retest. Gdy wchodzę na FOMO, wyniki są gorsze. Muszę trzymać się checklisty przed każdym wejściem.",
    entryType: "reflection",
    mood: 4,
    tags: ["weekly", "mindset"],
  });
}

export async function initDatabase(): Promise<void> {
  await getDb();
}
