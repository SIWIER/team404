// src/core/db.js — SQLite 数据库（Node 内置 node:sqlite）+ 迁移机制
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const logger = require('./logger');

let db = null;

// 迁移列表：按版本号顺序执行（只增不改，保证可升级）
const MIGRATIONS = [
  {
    version: 1,
    name: 'init-accounts',
    up: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nickname TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE profiles (
        user_id INTEGER PRIMARY KEY,
        agent_name TEXT,
        agent_style TEXT,
        habits TEXT,
        favorite_places TEXT,
        notes TEXT,
        updated_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE loss_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        found_location TEXT,
        found_room TEXT,
        confidence REAL,
        success INTEGER DEFAULT 0,
        clues TEXT,
        reasoning TEXT,
        duration_sec REAL
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        room TEXT,
        battery INTEGER DEFAULT 100,
        status TEXT DEFAULT 'offline',
        last_seen TEXT,
        last_signal REAL
      );
      CREATE TABLE device_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT
      );
    `
  },
  {
    version: 2,
    name: 'reason-conversation',
    up: `ALTER TABLE loss_records ADD COLUMN conversation TEXT;`
  },
  {
    version: 3,
    name: 'profile-home-layout',
    up: `ALTER TABLE profiles ADD COLUMN home_layout TEXT;`
  },
  {
    version: 4,
    name: 'stats-indexes',
    up: `
      CREATE INDEX IF NOT EXISTS idx_loss_user_time ON loss_records(user_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_loss_user_success ON loss_records(user_id, success);
    `
  },
  {
    version: 5,
    name: 'hardware-device-fields',
    up: `
      ALTER TABLE devices ADD COLUMN registered_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_dev_events_device ON device_events(device_id, id);
    `
  }
  // 后续模块在此追加 v6、v7…
];

function init() {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  db = new DatabaseSync(config.dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`);

  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
  const current = row ? Number(row.value) : 0;
  for (const m of MIGRATIONS.sort((a, b) => a.version - b.version)) {
    if (m.version > current) {
      db.exec('BEGIN');
      try {
        db.exec(m.up);
        db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
          .run('schema_version', String(m.version));
        db.exec('COMMIT');
        logger.info(`[db] 迁移完成 v${m.version} (${m.name})`);
      } catch (e) {
        db.exec('ROLLBACK');
        logger.error(`[db] 迁移失败 v${m.version} (${m.name}):`, e.message);
        throw e;
      }
    }
  }
  const latestRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
  logger.info(`[db] 数据库就绪: ${config.dbFile} (schema v${latestRow ? latestRow.value : 0})`);
  return db;
}

function getDb() {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}

module.exports = { init, getDb, MIGRATIONS };
