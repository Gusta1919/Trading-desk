import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "trade-assistant.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
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
  );

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
  );
`);

export function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) as c FROM trades").get() as {
    c: number;
  };
  if (count.c > 0) return;

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO trades (
      id, symbol, direction, entry_date, exit_date, entry_price, exit_price,
      quantity, stop_loss, strategy, setup_type, session, timeframe,
      emotional_state, execution_grade, followed_plan, notes, tags,
      pnl, pnl_percent, r_multiple, fees, status, created_at, updated_at
    ) VALUES (
      @id, @symbol, @direction, @entry_date, @exit_date, @entry_price, @exit_price,
      @quantity, @stop_loss, @strategy, @setup_type, @session, @timeframe,
      @emotional_state, @execution_grade, @followed_plan, @notes, @tags,
      @pnl, @pnl_percent, @r_multiple, @fees, 'closed', @created_at, @updated_at
    )
  `);

  const demos = [
    {
      id: crypto.randomUUID(),
      symbol: "NVDA",
      direction: "long",
      entry_date: new Date(Date.now() - 86400000 * 2).toISOString(),
      exit_date: new Date(Date.now() - 86400000 * 2 + 3600000).toISOString(),
      entry_price: 875.5,
      exit_price: 882.3,
      quantity: 10,
      stop_loss: 872,
      strategy: "Breakout",
      setup_type: "VWAP reclaim",
      session: "regular",
      timeframe: "5m",
      emotional_state: 4,
      execution_grade: "A",
      followed_plan: 1,
      notes: "Czysty setup, cierpliwe wejście na retest.",
      tags: JSON.stringify(["momentum", "tech"]),
      pnl: 68,
      pnl_percent: 0.78,
      r_multiple: 1.95,
      fees: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: crypto.randomUUID(),
      symbol: "TSLA",
      direction: "short",
      entry_date: new Date(Date.now() - 86400000).toISOString(),
      exit_date: new Date(Date.now() - 86400000 + 1800000).toISOString(),
      entry_price: 245.8,
      exit_price: 248.2,
      quantity: 20,
      stop_loss: 247.5,
      strategy: "Mean reversion",
      setup_type: "Failed breakout",
      session: "regular",
      timeframe: "15m",
      emotional_state: 2,
      execution_grade: "C",
      followed_plan: 0,
      notes: "Wszedłem za wcześnie.",
      tags: JSON.stringify(["mistake", "fomo"]),
      pnl: -48,
      pnl_percent: -0.98,
      r_multiple: -1.37,
      fees: 0,
      created_at: now,
      updated_at: now,
    },
  ];

  for (const d of demos) insert.run(d);

  db.prepare(`
    INSERT INTO journal_entries (id, title, content, entry_type, mood, tags, created_at, updated_at)
    VALUES (@id, @title, @content, @entry_type, @mood, @tags, @created_at, @updated_at)
  `).run({
    id: crypto.randomUUID(),
    title: "Refleksja tygodniowa",
    content:
      "Najlepsze trady pochodzą z cierpliwości na retest. Gdy wchodzę na FOMO, wyniki są gorsze.",
    entry_type: "reflection",
    mood: 4,
    tags: JSON.stringify(["weekly", "mindset"]),
    created_at: now,
    updated_at: now,
  });
}
