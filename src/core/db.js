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
  },
  {
    version: 6,
    name: 'hardware-command-ack',
    up: `
      ALTER TABLE device_events ADD COLUMN acked INTEGER DEFAULT 0;
      ALTER TABLE devices ADD COLUMN is_mock INTEGER DEFAULT 1;
    `
  },
  {
    version: 7,
    name: 'wechat-openid',
    // 微信一键登录/绑定：openid 与用户一一绑定（NULL 表示未绑定）
    up: `
      ALTER TABLE users ADD COLUMN wechat_openid TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wechat_openid ON users(wechat_openid) WHERE wechat_openid IS NOT NULL;
    `
  },
  {
    version: 8,
    name: 'profile-hardware',
    // 注册时的"有无硬件设备"提问：用户拥有的设备清单（JSON 数组，如 ["uhf_reader","case_locator"]）
    // 空数组/未填 = 无硬件（推理引擎启用无硬件补偿）
    up: `ALTER TABLE profiles ADD COLUMN hardware TEXT;`
  },
  {
    version: 9,
    name: 'spaces-directories',
    // 物品管理目录：每个用户可有多个空间（家/公司/宿舍…），每个空间独立户型图
    // 存量数据自动回填：为每个已有画像的用户建默认空间「家」，并把原 home_layout 迁入
    up(db) {
      db.exec("CREATE TABLE spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), UNIQUE(user_id, name)); ALTER TABLE profiles ADD COLUMN active_space_id INTEGER;");
      const ts = new Date().toISOString();
      const rows = db.prepare('SELECT user_id, home_layout FROM profiles').all();
      const ins = db.prepare('INSERT INTO spaces (user_id, name, sort_order, layout, created_at, updated_at) VALUES (?,?,?,?,?,?)');
      for (const r of rows) {
        const info = ins.run(r.user_id, '家', 0, r.home_layout || '[]', ts, ts);
        db.prepare('UPDATE profiles SET active_space_id = ? WHERE user_id = ?').run(Number(info.lastInsertRowid), r.user_id);
      }
    }
  },
  {
    version: 10,
    name: 'items-storage',
    // 物品管理：三级位置链 = space(目录) → room(房间) → furn(收纳家具) → sub_pos(家具内子位置，如"一层")
    up: `CREATE TABLE items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      space_id INTEGER,
      name TEXT NOT NULL,
      desc TEXT,
      image_path TEXT,
      room TEXT,
      furn TEXT,
      sub_pos TEXT,
      clip_vec TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );`
  }
  // 后续模块在此追加 v11、v12…
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
      if (typeof m.up === 'function') {
        m.up(db);
      } else {
        db.exec(m.up);
      }
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
