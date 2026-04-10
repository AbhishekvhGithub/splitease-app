// db.js — Sets up SQLite database and creates tables if they don't exist

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'splitwise.db');

const SQL = await initSqlJs();

let db;
try {
  const fileData = fs.readFileSync(dbPath);
  db = new SQL.Database(new Uint8Array(fileData));
} catch (err) {
  db = new SQL.Database();
}

function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

const wrappedDb = {
  prepare(sql) {
    return {
      run(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
        const result = db.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = result?.[0]?.values?.[0]?.[0] ?? null;
        return { lastInsertRowid };
      },

      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const result = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return result;
      },

      all(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  },

  transaction(fn) {
    try {
      db.exec('BEGIN TRANSACTION');
      const result = fn();
      db.exec('COMMIT');
      saveDatabase();
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (e) {}
      throw err;
    }
  },

  exec(sql) {
    db.exec(sql);
    saveDatabase();
  }
};

wrappedDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    is_admin INTEGER DEFAULT 0,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    paid_by INTEGER NOT NULL,
    category TEXT DEFAULT 'other',
    notes TEXT,
    split_type TEXT DEFAULT 'equal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (paid_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS expense_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    share REAL NOT NULL,
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

function hasColumn(tableName, columnName) {
  const cols = wrappedDb.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((c) => c.name === columnName);
}

function runMigrations() {
  if (!hasColumn('groups', 'created_by')) {
    wrappedDb.exec('ALTER TABLE groups ADD COLUMN created_by INTEGER');
  }
  if (!hasColumn('group_members', 'is_admin')) {
    wrappedDb.exec('ALTER TABLE group_members ADD COLUMN is_admin INTEGER DEFAULT 0');
  }
  if (!hasColumn('expenses', 'category')) {
    wrappedDb.exec("ALTER TABLE expenses ADD COLUMN category TEXT DEFAULT 'other'");
  }
  if (!hasColumn('expenses', 'notes')) {
    wrappedDb.exec('ALTER TABLE expenses ADD COLUMN notes TEXT');
  }
  if (!hasColumn('expenses', 'split_type')) {
    wrappedDb.exec("ALTER TABLE expenses ADD COLUMN split_type TEXT DEFAULT 'equal'");
  }
}

runMigrations();

export default wrappedDb;
