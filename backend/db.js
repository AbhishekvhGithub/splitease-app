// db.js — Sets up SQLite database and creates tables if they don't exist

const Database = require('better-sqlite3');
const path = require('path');

// Create (or open) the database file in the backend folder
const db = new Database(path.join(__dirname, 'splitwise.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create all tables
db.exec(`
  -- Users table: stores each person
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Groups table: a collection of users sharing expenses
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Group members: which users belong to which group
  CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Expenses: a single expense in a group
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    paid_by INTEGER NOT NULL,           -- user_id of who paid
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (paid_by) REFERENCES users(id)
  );

  -- Expense splits: how each expense is divided among users
  CREATE TABLE IF NOT EXISTS expense_splits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,           -- who owes this share
    share REAL NOT NULL,               -- amount this user owes
    FOREIGN KEY (expense_id) REFERENCES expenses(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

module.exports = db;
