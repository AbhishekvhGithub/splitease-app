// server.js — Main Express server for the Splitwise-like app

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { calculateBalances } from './balanceCalculator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the project root directory (parent of backend directory)
const projectRoot = path.resolve(__dirname, '..');

// Allow frontend path to be overridden via environment variable
// Useful for deployments with non-standard directory structures
const frontendPath = process.env.FRONTEND_PATH || path.join(projectRoot, 'frontend', 'public');

// Log paths for debugging deployment issues
console.log(`📁 Current working directory: ${process.cwd()}`);
console.log(`📁 __dirname (backend): ${__dirname}`);
console.log(`📁 projectRoot: ${projectRoot}`);
console.log(`📁 Frontend static files: ${frontendPath}`);
console.log(`📁 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());                          // Allow frontend to call backend
app.use(express.json());                  // Parse JSON request bodies

// Serve static frontend files from the frontend/public folder
app.use(express.static(frontendPath));


// ═══════════════════════════════════════════════════════════════
//  USER ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/users — List all users
app.get('/api/users', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users ORDER BY name').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — Add a new user
app.post('/api/users', (req, res) => {
  const { name } = req.body;

  // Validation
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const stmt = db.prepare('INSERT INTO users (name) VALUES (?)');
    const result = stmt.run(name.trim());
    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newUser);
  } catch (err) {
    // Duplicate name error
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A user with this name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  GROUP ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/groups — List all groups with member count
app.get('/api/groups', (req, res) => {
  try {
    const groups = db.prepare(`
      SELECT g.*,
        COUNT(DISTINCT gm.user_id) AS member_count,
        COUNT(DISTINCT e.id) AS expense_count,
        COALESCE(SUM(e.amount), 0) AS total_amount
      FROM groups g
      LEFT JOIN group_members gm ON g.id = gm.group_id
      LEFT JOIN expenses e ON g.id = e.group_id
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `).all();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id — Get a single group with members
app.get('/api/groups/:id', (req, res) => {
  try {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    // Get members of the group
    const members = db.prepare(`
      SELECT u.* FROM users u
      JOIN group_members gm ON u.id = gm.user_id
      WHERE gm.group_id = ?
    `).all(req.params.id);

    res.json({ ...group, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups — Create a new group
app.post('/api/groups', (req, res) => {
  const { name, description, memberIds } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Group name is required' });
  }
  if (!memberIds || memberIds.length < 1) {
    return res.status(400).json({ error: 'Select at least one member' });
  }

  try {
    const groupId = db.transaction(() => {
      const groupResult = db.prepare(
        'INSERT INTO groups (name, description) VALUES (?, ?)'
      ).run(name.trim(), description || '');

      const groupId = groupResult.lastInsertRowid;

      const addMember = db.prepare(
        'INSERT INTO group_members (group_id, user_id) VALUES (?, ?)'
      );

      for (const userId of memberIds) {
        addMember.run(groupId, userId);
      }

      return groupId;
    });

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id — Delete a group
app.delete('/api/groups/:id', (req, res) => {
  try {
    db.transaction(() => {
      const groupId = req.params.id;
      
      // Get all expense IDs for this group
      const expenses = db.prepare('SELECT id FROM expenses WHERE group_id = ?').all(groupId);
      
      // Delete splits for all those expenses
      for (const exp of expenses) {
        db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(exp.id);
      }
      
      // Delete all expenses for this group
      db.prepare('DELETE FROM expenses WHERE group_id = ?').run(groupId);
      
      // Delete all group members
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
      
      // Delete the group itself
      db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  EXPENSE ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/groups/:id/expenses — Get all expenses in a group
app.get('/api/groups/:id/expenses', (req, res) => {
  try {
    const expenses = db.prepare(`
      SELECT e.*,
        u.name AS paid_by_name
      FROM expenses e
      JOIN users u ON e.paid_by = u.id
      WHERE e.group_id = ?
      ORDER BY e.created_at DESC
    `).all(req.params.id);

    // For each expense, get who shares it
    const getSplits = db.prepare(`
      SELECT es.*, u.name AS user_name
      FROM expense_splits es
      JOIN users u ON es.user_id = u.id
      WHERE es.expense_id = ?
    `);

    const expensesWithSplits = expenses.map(exp => ({
      ...exp,
      splits: getSplits.all(exp.id)
    }));

    res.json(expensesWithSplits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/expenses — Add a new expense
app.post('/api/groups/:id/expenses', (req, res) => {
  const { description, amount, paidBy, splitAmong } = req.body;
  const groupId = parseInt(req.params.id);

  // Validation
  if (!description || description.trim() === '') {
    return res.status(400).json({ error: 'Description is required' });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }
  if (!paidBy) {
    return res.status(400).json({ error: 'Please select who paid' });
  }
  if (!splitAmong || splitAmong.length === 0) {
    return res.status(400).json({ error: 'Select at least one person to split with' });
  }

  // Calculate equal split — divide total by number of participants
  const sharePerPerson = Math.round((amount / splitAmong.length) * 100) / 100;

  const addExpense = db.transaction(() => {
    // Insert the expense
    const expResult = db.prepare(`
      INSERT INTO expenses (group_id, description, amount, paid_by)
      VALUES (?, ?, ?, ?)
    `).run(groupId, description.trim(), amount, paidBy);

    const expenseId = expResult.lastInsertRowid;

    // Insert each person's split
    const addSplit = db.prepare(
      'INSERT INTO expense_splits (expense_id, user_id, share) VALUES (?, ?, ?)'
    );

    for (const userId of splitAmong) {
      addSplit.run(expenseId, userId, sharePerPerson);
    }

    return expenseId;
  });

  try {
    const expenseId = addExpense();
    const expense = db.prepare(`
      SELECT e.*, u.name AS paid_by_name FROM expenses e
      JOIN users u ON e.paid_by = u.id
      WHERE e.id = ?
    `).get(expenseId);

    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/expenses/:id — Delete an expense
app.delete('/api/expenses/:id', (req, res) => {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(req.params.id);
      db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  BALANCE ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /api/groups/:id/balances — Compute who owes whom
app.get('/api/groups/:id/balances', (req, res) => {
  try {
    // Get all expenses with their splits
    const expenses = db.prepare(`
      SELECT e.* FROM expenses e WHERE e.group_id = ?
    `).all(req.params.id);

    const getSplits = db.prepare(
      'SELECT * FROM expense_splits WHERE expense_id = ?'
    );

    const expensesWithSplits = expenses.map(e => ({
      ...e,
      splits: getSplits.all(e.id)
    }));

    // Calculate balances using our algorithm
    const { netBalances, transactions } = calculateBalances(expensesWithSplits);

    // Enrich transactions with user names
    const getUserName = db.prepare('SELECT name FROM users WHERE id = ?');

    const enrichedTransactions = transactions.map(t => ({
      ...t,
      fromName: getUserName.get(t.from)?.name || 'Unknown',
      toName: getUserName.get(t.to)?.name || 'Unknown'
    }));

    // Enrich net balances with names
    const enrichedBalances = Object.entries(netBalances).map(([userId, balance]) => ({
      userId: parseInt(userId),
      name: getUserName.get(userId)?.name || 'Unknown',
      balance: Math.round(balance * 100) / 100
    }));

    res.json({
      netBalances: enrichedBalances,
      transactions: enrichedTransactions
    });
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
});


// ─── Catch-all: serve frontend for any unmatched route ─────────
app.get('*', (req, res, next) => {
  const indexPath = path.join(frontendPath, 'index.html');
  console.log(`🔍 Serving index.html from: ${indexPath}`);
  
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error(`❌ Error serving frontend: ${err.message}`);
      console.error(`   Attempted path: ${indexPath}`);
      res.status(404).json({ 
        error: 'Frontend files not found',
        attemptedPath: indexPath,
        workingDir: process.cwd()
      });
    }
  });
});


// ─── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}`);
  console.log(`   Open your browser and go to http://localhost:${PORT}\n`);
});
