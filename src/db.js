// Persistencia con el módulo SQLite integrado de Node (node:sqlite).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash     TEXT NOT NULL,
      salt          TEXT NOT NULL,
      cash          REAL NOT NULL,
      initial_cash  REAL NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holdings (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol     TEXT NOT NULL,
      qty        REAL NOT NULL,
      avg_price  REAL NOT NULL,
      PRIMARY KEY (user_id, symbol)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol      TEXT NOT NULL,
      side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
      qty         REAL NOT NULL,
      price       REAL NOT NULL,
      fee         REAL NOT NULL,
      realized    REAL NOT NULL DEFAULT 0,
      order_id    INTEGER,
      bot_id      INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol      TEXT NOT NULL,
      side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
      type        TEXT NOT NULL CHECK (type IN ('limit','stop')),
      qty         REAL NOT NULL,
      price       REAL NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled','rejected')),
      note        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS bots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol        TEXT NOT NULL,
      timeframe     TEXT NOT NULL,
      strategy      TEXT NOT NULL,
      params        TEXT NOT NULL,
      amount        REAL NOT NULL,
      stop_loss     REAL NOT NULL DEFAULT 0,
      take_profit   REAL NOT NULL DEFAULT 0,
      active        INTEGER NOT NULL DEFAULT 1,
      qty           REAL NOT NULL DEFAULT 0,
      entry_price   REAL,
      realized      REAL NOT NULL DEFAULT 0,
      trade_count   INTEGER NOT NULL DEFAULT 0,
      last_candle   INTEGER,
      last_signal   TEXT,
      last_event    TEXT,
      last_run      TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(status, symbol);
  `);
  // Migración para bases de datos creadas con la versión anterior.
  const cols = db.prepare('PRAGMA table_info(trades)').all().map((c) => c.name);
  if (!cols.includes('bot_id')) db.exec('ALTER TABLE trades ADD COLUMN bot_id INTEGER');
  return db;
}

// Ejecuta fn dentro de una transacción; hace rollback si lanza.
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, tx };
