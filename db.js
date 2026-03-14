'use strict';

require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tickets.db');
const MAX_RETRIES = parseInt(process.env.DB_MAX_RETRIES || '5', 10);
const RETRY_DELAY_MS = parseInt(process.env.DB_RETRY_DELAY_MS || '1000', 10);

let db = null;

/**
 * Open the SQLite database, retrying on transient errors.
 * @param {number} attempt - current attempt number (1-based)
 * @returns {DatabaseSync} the connected DatabaseSync instance
 */
function connectWithRetry(attempt = 1) {
  try {
    const instance = new DatabaseSync(DB_PATH);

    // Enable WAL mode for better concurrent read performance and foreign-key enforcement
    instance.exec('PRAGMA journal_mode = WAL');
    instance.exec('PRAGMA foreign_keys = ON');

    console.log(`[DB] Connected to database at ${DB_PATH}`);
    return instance;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.error(
        `[DB] Connection attempt ${attempt} failed: ${err.message}. ` +
        `Retrying in ${RETRY_DELAY_MS}ms… (${MAX_RETRIES - attempt} retries left)`
      );
      // Synchronous sleep — acceptable at startup only; requires SharedArrayBuffer
      // (enabled by default in Node.js workers and same-origin cross-origin-isolated contexts)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS);
      return connectWithRetry(attempt + 1);
    }
    console.error(`[DB] All ${MAX_RETRIES} connection attempts failed.`);
    throw new Error(`Database connection failed after ${MAX_RETRIES} attempts: ${err.message}`);
  }
}

/**
 * Return the singleton database connection, creating it if necessary.
 * @returns {DatabaseSync}
 */
function getDb() {
  if (!db) {
    db = connectWithRetry();
    initSchema();
  }
  return db;
}

/**
 * Create tables if they do not already exist.
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      event     TEXT    NOT NULL,
      owner     TEXT    NOT NULL,
      price     REAL    NOT NULL DEFAULT 0,
      purchased INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
  console.log('[DB] Schema initialized.');
}

/**
 * Gracefully close the database connection.
 */
function closeDb() {
  if (db) {
    try {
      db.close();
      console.log('[DB] Connection closed.');
    } catch (err) {
      console.error(`[DB] Error closing connection: ${err.message}`);
    } finally {
      db = null;
    }
  }
}

// Close the connection when the process exits
process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = { getDb, closeDb };

