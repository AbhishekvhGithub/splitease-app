// server.js — Main Express server for the Splitwise-like app

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';
import { calculateBalances } from './balanceCalculator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the project root directory (parent of backend directory)
const projectRoot = path.resolve(__dirname, '..');

function resolveFrontendPaths() {
  const candidatePaths = [
    path.join(projectRoot, 'frontend', 'public'),
    path.join(process.cwd(), 'frontend', 'public'),
    path.join(projectRoot, 'public'),
    path.join(process.cwd(), 'public')
  ];

  const uniquePaths = [...new Set(candidatePaths)];
  const validPaths = uniquePaths.filter((candidate) => fs.existsSync(path.join(candidate, 'index.html')));

  if (validPaths.length > 0) return validPaths;

  console.warn('⚠️ No valid frontend path found from candidates:');
  for (const candidate of uniquePaths) {
    console.warn(`   - ${candidate} (index.html exists: ${fs.existsSync(path.join(candidate, 'index.html'))})`);
  }
  return uniquePaths;
}

// Set SERVE_FRONTEND=false on the host to deploy API-only (no static UI)
const serveFrontend = process.env.SERVE_FRONTEND !== 'false';
const frontendPaths = serveFrontend ? resolveFrontendPaths() : [];
const frontendPath = frontendPaths[0];

// Log paths for debugging deployment issues
console.log(`📁 Current working directory: ${process.cwd()}`);
console.log(`📁 __dirname (backend): ${__dirname}`);
console.log(`📁 projectRoot: ${projectRoot}`);
console.log(`📁 Serve frontend (static): ${serveFrontend}`);
if (serveFrontend) {
  console.log(`📁 Frontend static files: ${frontendPath}`);
  console.log(`📁 Frontend path candidates: ${frontendPaths.join(', ')}`);
}
console.log(`📁 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

const app = express();
const PORT = process.env.PORT || 3001;
const EPSILON = 0.01;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());                          // Allow frontend to call backend
app.use(express.json());                  // Parse JSON request bodies

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

function buildShares({ amount, splitType, splitAmong, customSplits }) {
  const totalAmount = Number(amount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (splitType === 'unequal') {
    if (!Array.isArray(customSplits) || customSplits.length === 0) {
      throw new Error('Provide custom split amounts');
    }
    const shares = customSplits.map((s) => ({
      userId: Number(s.userId),
      share: round2(Number(s.amount))
    }));
    if (shares.some((s) => !s.userId || s.share <= 0)) {
      throw new Error('Invalid custom split amounts');
    }
    const totalShare = round2(shares.reduce((sum, s) => sum + s.share, 0));
    if (Math.abs(totalShare - round2(totalAmount)) > EPSILON) {
      throw new Error('Custom split total must match expense amount');
    }
    return shares;
  }

  if (splitType === 'percentage') {
    if (!Array.isArray(customSplits) || customSplits.length === 0) {
      throw new Error('Provide split percentages');
    }
    const percentages = customSplits.map((s) => ({
      userId: Number(s.userId),
      percentage: Number(s.percentage)
    }));
    if (percentages.some((p) => !p.userId || p.percentage <= 0)) {
      throw new Error('Invalid split percentages');
    }
    const totalPercentage = round2(percentages.reduce((sum, p) => sum + p.percentage, 0));
    if (Math.abs(totalPercentage - 100) > EPSILON) {
      throw new Error('Split percentages must total 100');
    }

    const shares = percentages.map((p) => ({
      userId: p.userId,
      share: round2((totalAmount * p.percentage) / 100)
    }));

    // Adjust the final share to avoid rounding drift
    const totalShare = round2(shares.reduce((sum, s) => sum + s.share, 0));
    const diff = round2(totalAmount - totalShare);
    if (Math.abs(diff) > 0 && shares.length > 0) {
      shares[shares.length - 1].share = round2(shares[shares.length - 1].share + diff);
    }
    return shares;
  }

  if (!Array.isArray(splitAmong) || splitAmong.length === 0) {
    throw new Error('Select at least one person to split with');
  }
  const equalShare = round2(totalAmount / splitAmong.length);
  const shares = splitAmong.map((userId) => ({
    userId: Number(userId),
    share: equalShare
  }));
  const totalShare = round2(shares.reduce((sum, s) => sum + s.share, 0));
  const diff = round2(totalAmount - totalShare);
  if (Math.abs(diff) > 0) {
    shares[shares.length - 1].share = round2(shares[shares.length - 1].share + diff);
  }
  return shares;
}

// Lightweight health endpoint for platform health checks
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Serve static frontend only when not in API-only mode
if (serveFrontend) {
  for (const staticPath of frontendPaths) {
    app.use(express.static(staticPath));
  }
}


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
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.is_admin = 1) AS admin_count,
        (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id) AS expense_count,
        (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.group_id = g.id) AS total_amount
      FROM groups g
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
      SELECT u.*, gm.is_admin FROM users u
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
  const { name, description, memberIds, adminUserId } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Group name is required' });
  }
  if (!memberIds || memberIds.length < 1) {
    return res.status(400).json({ error: 'Select at least one member' });
  }

  try {
    const groupId = db.transaction(() => {
      const groupResult = db.prepare(
        'INSERT INTO groups (name, description, created_by) VALUES (?, ?, ?)'
      ).run(name.trim(), description || '', adminUserId || memberIds[0]);

      const groupId = groupResult.lastInsertRowid;
      const selectedAdminId = Number(adminUserId || memberIds[0]);
      if (!memberIds.includes(selectedAdminId)) {
        throw new Error('Selected admin must be a group member');
      }

      const addMember = db.prepare(
        'INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, ?)'
      );

      for (const userId of memberIds) {
        const isAdmin = Number(userId) === selectedAdminId ? 1 : 0;
        addMember.run(groupId, userId, isAdmin);
      }

      return groupId;
    });

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/members — Add a member to group
app.post('/api/groups/:id/members', (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.body.userId);
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const existing = db.prepare('SELECT 1 as exists_flag FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (existing) return res.status(400).json({ error: 'User is already in this group' });

    db.transaction(() => {
      db.prepare('INSERT INTO group_members (group_id, user_id, is_admin) VALUES (?, ?, 0)').run(groupId, userId);
    });

    res.status(201).json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/groups/:id/members/:userId — Remove a member
app.delete('/api/groups/:id/members/:userId', (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.params.userId);

  try {
    const member = db.prepare('SELECT is_admin FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!member) return res.status(404).json({ error: 'Member not found in group' });

    const membersCount = db.prepare('SELECT COUNT(*) as count FROM group_members WHERE group_id = ?').get(groupId).count;
    if (Number(membersCount) <= 1) {
      return res.status(400).json({ error: 'Group must have at least one member' });
    }

    db.transaction(() => {
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);

      if (member.is_admin === 1) {
        const nextAdmin = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? LIMIT 1').get(groupId);
        if (nextAdmin) {
          db.prepare('UPDATE group_members SET is_admin = 1 WHERE group_id = ? AND user_id = ?').run(groupId, nextAdmin.user_id);
        }
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/groups/:id/admin — Assign group admin
app.patch('/api/groups/:id/admin', (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.body.userId);
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const targetMember = db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!targetMember) return res.status(400).json({ error: 'Selected user is not in this group' });

    db.transaction(() => {
      db.prepare('UPDATE group_members SET is_admin = 0 WHERE group_id = ?').run(groupId);
      db.prepare('UPDATE group_members SET is_admin = 1 WHERE group_id = ? AND user_id = ?').run(groupId, userId);
      db.prepare('UPDATE groups SET created_by = ? WHERE id = ?').run(userId, groupId);
    });

    res.json({ success: true });
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
  const { description, amount, paidBy, splitAmong, category, notes, splitType, customSplits } = req.body;
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
  const addExpense = db.transaction(() => {
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
    const memberSet = new Set(members.map((m) => Number(m.user_id)));
    if (!memberSet.has(Number(paidBy))) {
      throw new Error('Payer must be a group member');
    }

    const shares = buildShares({
      amount: Number(amount),
      splitType: splitType || 'equal',
      splitAmong: splitAmong || [],
      customSplits: customSplits || []
    });

    if (shares.some((s) => !memberSet.has(Number(s.userId)))) {
      throw new Error('All split members must belong to the group');
    }

    // Insert the expense
    const expResult = db.prepare(`
      INSERT INTO expenses (group_id, description, amount, paid_by, category, notes, split_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupId,
      description.trim(),
      Number(amount),
      Number(paidBy),
      (category || 'other').toLowerCase(),
      notes?.trim() || null,
      (splitType || 'equal').toLowerCase()
    );

    const expenseId = expResult.lastInsertRowid;

    // Insert each person's split
    const addSplit = db.prepare(
      'INSERT INTO expense_splits (expense_id, user_id, share) VALUES (?, ?, ?)'
    );

    for (const item of shares) {
      addSplit.run(expenseId, item.userId, item.share);
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
    res.status(400).json({ error: err.message });
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

// GET /api/groups/:id/suggestions — Suggest split pattern from history
app.get('/api/groups/:id/suggestions', (req, res) => {
  const groupId = Number(req.params.id);
  const paidBy = Number(req.query.paidBy);
  const category = String(req.query.category || '').toLowerCase();

  if (!paidBy) return res.status(400).json({ error: 'paidBy is required' });

  try {
    const rows = db.prepare(`
      SELECT e.id, e.split_type, e.category, es.user_id
      FROM expenses e
      JOIN expense_splits es ON es.expense_id = e.id
      WHERE e.group_id = ? AND e.paid_by = ?
      ORDER BY e.created_at DESC
    `).all(groupId, paidBy);

    if (rows.length === 0) {
      return res.json({ found: false });
    }

    const byExpense = new Map();
    for (const row of rows) {
      const key = row.id;
      if (!byExpense.has(key)) {
        byExpense.set(key, {
          splitType: row.split_type || 'equal',
          category: (row.category || 'other').toLowerCase(),
          userIds: []
        });
      }
      byExpense.get(key).userIds.push(Number(row.user_id));
    }

    const splitTypeCounts = {};
    const participantPatternCounts = {};

    for (const exp of byExpense.values()) {
      if (category && exp.category !== category) continue;
      splitTypeCounts[exp.splitType] = (splitTypeCounts[exp.splitType] || 0) + 1;
      const signature = [...new Set(exp.userIds)].sort((a, b) => a - b).join(',');
      participantPatternCounts[signature] = (participantPatternCounts[signature] || 0) + 1;
    }

    const splitType = Object.entries(splitTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const participantSignature = Object.entries(participantPatternCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!splitType || !participantSignature) return res.json({ found: false });

    res.json({
      found: true,
      splitType,
      splitAmong: participantSignature.split(',').filter(Boolean).map((id) => Number(id))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/messages — Fetch chat messages
app.get('/api/groups/:id/messages', (req, res) => {
  const groupId = Number(req.params.id);
  try {
    const messages = db.prepare(`
      SELECT gm.id, gm.group_id, gm.user_id, gm.message, gm.created_at, u.name AS user_name
      FROM group_messages gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY gm.created_at ASC
      LIMIT 200
    `).all(groupId);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/messages — Send a chat message
app.post('/api/groups/:id/messages', (req, res) => {
  const groupId = Number(req.params.id);
  const userId = Number(req.body.userId);
  const message = String(req.body.message || '').trim();
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  if (!message) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    const member = db.prepare('SELECT 1 as ok FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!member) return res.status(400).json({ error: 'Sender must be a group member' });

    const result = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO group_messages (group_id, user_id, message)
        VALUES (?, ?, ?)
      `).run(groupId, userId, message);

      return db.prepare(`
        SELECT gm.id, gm.group_id, gm.user_id, gm.message, gm.created_at, u.name AS user_name
        FROM group_messages gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.id = ?
      `).get(insert.lastInsertRowid);
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/export/excel — Download report as CSV (Excel compatible)
app.get('/api/groups/:id/export/excel', (req, res) => {
  const groupId = Number(req.params.id);
  try {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const expenses = db.prepare(`
      SELECT e.*, u.name AS paid_by_name
      FROM expenses e
      JOIN users u ON u.id = e.paid_by
      WHERE e.group_id = ?
      ORDER BY e.created_at DESC
    `).all(groupId);

    const lines = [
      ['Group', group.name],
      ['Description', group.description || ''],
      [],
      ['Description', 'Amount', 'Paid By', 'Category', 'Split Type', 'Notes', 'Created At']
    ];
    for (const e of expenses) {
      lines.push([
        e.description,
        round2(e.amount),
        e.paid_by_name,
        e.category || 'other',
        e.split_type || 'equal',
        e.notes || '',
        e.created_at
      ]);
    }

    const csv = lines
      .map((row) => row.map((col) => csvEscape(col)).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="group-${groupId}-report.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/export/pdf — Printable HTML report (Save as PDF in browser)
app.get('/api/groups/:id/export/pdf', (req, res) => {
  const groupId = Number(req.params.id);
  try {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const expenses = db.prepare(`
      SELECT e.*, u.name AS paid_by_name
      FROM expenses e
      JOIN users u ON u.id = e.paid_by
      WHERE e.group_id = ?
      ORDER BY e.created_at DESC
    `).all(groupId);
    const total = round2(expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0));

    const rows = expenses.map((e) => `
      <tr>
        <td>${e.description || ''}</td>
        <td>₹${round2(e.amount).toFixed(2)}</td>
        <td>${e.paid_by_name || ''}</td>
        <td>${e.category || 'other'}</td>
        <td>${e.split_type || 'equal'}</td>
        <td>${e.notes || ''}</td>
        <td>${e.created_at || ''}</td>
      </tr>
    `).join('');

    const html = `
      <!doctype html>
      <html><head><meta charset="utf-8" />
      <title>Group Report</title>
      <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      table { border-collapse: collapse; width: 100%; margin-top: 16px; }
      th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
      th { background: #f4f4f4; text-align: left; }
      .meta { margin-bottom: 10px; }
      </style></head>
      <body>
        <h2>${group.name}</h2>
        <div class="meta">Description: ${group.description || '-'}</div>
        <div class="meta"><strong>Total Expense:</strong> ₹${total.toFixed(2)}</div>
        <table>
          <thead><tr><th>Description</th><th>Amount</th><th>Paid By</th><th>Category</th><th>Split</th><th>Notes</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── Catch-all: SPA in full mode; 404 JSON in API-only mode ────
app.get('*', (req, res) => {
  if (!serveFrontend) {
    return res.status(404).json({ error: 'Not found' });
  }

  const indexPath = frontendPaths
    .map((p) => path.join(p, 'index.html'))
    .find((candidate) => fs.existsSync(candidate));

  if (!indexPath) {
    console.error('❌ Error serving frontend: no index.html found in any frontend path');
    return res.status(404).json({
      error: 'Frontend files not found',
      attemptedPaths: frontendPaths,
      workingDir: process.cwd()
    });
  }

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
