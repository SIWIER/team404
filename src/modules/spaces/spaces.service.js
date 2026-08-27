// src/modules/spaces/spaces.service.js — 物品管理"目录"（家/公司/宿舍…）业务逻辑
// 每个目录独立一份户型图（layout JSON，格式与 profiles.home_layout 一致）；
// 其中"当前目录"（active_space_id）的户型图同步到 profiles.home_layout，兼容推理引擎与旧接口
'use strict';
const { getDb } = require('../../core/db');

const MAX_SPACES = 20;
const NAME_MAX = 20;

function now() { return new Date().toISOString(); }
function safeJson(s, d) { try { const v = JSON.parse(s); return v === null ? d : v; } catch { return d; } }

function sanitizeName(name) {
  return String(name || '').trim().slice(0, NAME_MAX);
}

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    layout: safeJson(row.layout, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listSpaces(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM spaces WHERE user_id = ? ORDER BY sort_order, id')
    .all(userId).map(toPublic);
}

function getSpace(userId, id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM spaces WHERE id = ? AND user_id = ?').get(Number(id), userId);
  return row ? toPublic(row) : null;
}

// 当前目录：无 active_space_id 或已失效时回退到第一个目录；连目录都没有则兜底建「家」
function getActiveSpace(userId) {
  const db = getDb();
  const p = db.prepare('SELECT active_space_id FROM profiles WHERE user_id = ?').get(userId);
  let row = (p && p.active_space_id != null)
    ? db.prepare('SELECT * FROM spaces WHERE id = ? AND user_id = ?').get(p.active_space_id, userId)
    : null;
  if (!row) {
    row = db.prepare('SELECT * FROM spaces WHERE user_id = ? ORDER BY sort_order, id LIMIT 1').get(userId);
    if (!row) {
      const info = db.prepare(
        'INSERT INTO spaces (user_id, name, sort_order, layout, created_at, updated_at) VALUES (?,?,?,?,?,?)'
      ).run(userId, '家', 0, '[]', now(), now());
      row = db.prepare('SELECT * FROM spaces WHERE id = ?').get(Number(info.lastInsertRowid));
      db.prepare('UPDATE profiles SET active_space_id = ? WHERE user_id = ?').run(row.id, userId);
    }
  }
  return toPublic(row);
}

function activeSpaceIdOf(userId) {
  const active = getActiveSpace(userId);
  return active ? active.id : null;
}

function createSpace(userId, name) {
  const db = getDb();
  const n = sanitizeName(name);
  if (!n) return { error: '目录名称不能为空' };
  const count = db.prepare('SELECT COUNT(*) AS c FROM spaces WHERE user_id = ?').get(userId).c;
  if (count >= MAX_SPACES) return { error: '目录数量已达上限（' + MAX_SPACES + ' 个）' };
  const exists = db.prepare('SELECT id FROM spaces WHERE user_id = ? AND name = ?').get(userId, n);
  if (exists) return { error: '同名目录已存在' };
  const info = db.prepare(
    'INSERT INTO spaces (user_id, name, sort_order, layout, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(userId, n, count, '[]', now(), now());
  const space = getSpace(userId, Number(info.lastInsertRowid));
  // 新目录自动设为当前目录，方便立刻编辑
  db.prepare('UPDATE profiles SET active_space_id = ? WHERE user_id = ?').run(space.id, userId);
  return { space };
}

function renameSpace(userId, id, name) {
  const db = getDb();
  if (!getSpace(userId, id)) return { error: '目录不存在' };
  const n = sanitizeName(name);
  if (!n) return { error: '目录名称不能为空' };
  const exists = db.prepare('SELECT id FROM spaces WHERE user_id = ? AND name = ? AND id != ?')
    .get(userId, n, Number(id));
  if (exists) return { error: '同名目录已存在' };
  db.prepare('UPDATE spaces SET name = ?, updated_at = ? WHERE id = ?').run(n, now(), Number(id));
  return { space: getSpace(userId, id) };
}

function deleteSpace(userId, id) {
  const db = getDb();
  if (!getSpace(userId, id)) return { error: '目录不存在' };
  const count = db.prepare('SELECT COUNT(*) AS c FROM spaces WHERE user_id = ?').get(userId).c;
  if (count <= 1) return { error: '至少保留一个目录' };
  const p = db.prepare('SELECT active_space_id FROM profiles WHERE user_id = ?').get(userId);
  db.prepare('DELETE FROM spaces WHERE id = ?').run(Number(id));
  // 删除的是当前目录 → 自动切到第一个目录
  if (p && p.active_space_id === Number(id)) {
    const next = db.prepare('SELECT id FROM spaces WHERE user_id = ? ORDER BY sort_order, id LIMIT 1').get(userId);
    if (next) {
      const nextSpace = db.prepare('SELECT * FROM spaces WHERE id = ?').get(next.id);
      db.prepare('UPDATE profiles SET active_space_id = ?, home_layout = ? WHERE user_id = ?')
        .run(next.id, nextSpace.layout, userId);
    }
  }
  return { ok: true };
}

// 保存目录户型图；当前目录同时同步 profiles.home_layout（推理引擎/旧前端仍读该字段）
function saveSpaceLayout(userId, id, layout) {
  const db = getDb();
  const space = getSpace(userId, id);
  if (!space) return { error: '目录不存在' };
  const { sanitizeLayout } = require('../accounts/accounts.service');
  const json = JSON.stringify(sanitizeLayout(layout));
  db.prepare('UPDATE spaces SET layout = ?, updated_at = ? WHERE id = ?').run(json, now(), Number(id));
  const p = db.prepare('SELECT active_space_id FROM profiles WHERE user_id = ?').get(userId);
  if (p && p.active_space_id === Number(id)) {
    db.prepare('UPDATE profiles SET home_layout = ? WHERE user_id = ?').run(json, userId);
  }
  return { space: getSpace(userId, id) };
}

function setActiveSpace(userId, id) {
  const db = getDb();
  const space = getSpace(userId, id);
  if (!space) return { error: '目录不存在' };
  db.prepare('UPDATE profiles SET active_space_id = ?, home_layout = ? WHERE user_id = ?')
    .run(Number(id), JSON.stringify(space.layout), userId);
  return { space };
}

module.exports = {
  listSpaces, getSpace, getActiveSpace, activeSpaceIdOf,
  createSpace, renameSpace, deleteSpace, saveSpaceLayout, setActiveSpace,
  sanitizeName, MAX_SPACES
};