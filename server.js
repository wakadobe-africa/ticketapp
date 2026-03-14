'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const { getDb, closeDb } = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Parse JSON request bodies
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('[Server] Health check failed:', err.message);
    res.status(503).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// ── Tickets API ───────────────────────────────────────────────────────────────

// List all tickets
app.get('/api/tickets', (_req, res) => {
  try {
    const rows = getDb().prepare('SELECT * FROM tickets ORDER BY purchased DESC').all();
    res.json(rows);
  } catch (err) {
    console.error('[API] GET /api/tickets:', err.message);
    res.status(500).json({ error: 'Failed to retrieve tickets.' });
  }
});

// Create a new ticket
app.post('/api/tickets', (req, res) => {
  const { event, owner, price } = req.body || {};

  if (!event || !owner) {
    return res.status(400).json({ error: '`event` and `owner` are required.' });
  }

  try {
    const stmt = getDb().prepare(
      'INSERT INTO tickets (event, owner, price) VALUES (?, ?, ?)'
    );
    const info = stmt.run(event, owner, parseFloat(price) || 0);
    res.status(201).json({ id: info.lastInsertRowid, event, owner, price: parseFloat(price) || 0 });
  } catch (err) {
    console.error('[API] POST /api/tickets:', err.message);
    res.status(500).json({ error: 'Failed to create ticket.' });
  }
});

// Get a single ticket by id
app.get('/api/tickets/:id', (req, res) => {
  try {
    const row = getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Ticket not found.' });
    res.json(row);
  } catch (err) {
    console.error(`[API] GET /api/tickets/${req.params.id}:`, err.message);
    res.status(500).json({ error: 'Failed to retrieve ticket.' });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
function start() {
  try {
    // Eagerly open the DB so connection errors surface at startup, not on first request
    getDb();
  } catch (err) {
    console.error('[Server] Fatal: could not connect to database.', err.message);
    process.exit(1);
  }

  let server;
  try {
    server = app.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Failed to bind port:', err.message);
    closeDb();
    process.exit(1);
  }

  server.on('error', (err) => {
    console.error('[Server] Error:', err.message);
    closeDb();
    process.exit(1);
  });
}

start();

module.exports = app; // export for testing
