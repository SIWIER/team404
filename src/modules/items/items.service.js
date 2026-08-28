// src/modules/items/items.service.js — 物品数字化管理：拍照录入 → 三级位置 → 检索（P1 文字检索；P2 图图/文图向量）
'use strict';
const { getDb } = require('../../core/db');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;   // base64 解码后上限（对齐全局 2MB 请求体）
const MIME_WHITELIST = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const LIST_LIMIT = 100;

function now() { return new Date().toISOString(); }
function s(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

function extOf(mime) {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

function uploadPath(userId, itemId, mime) {
  const dir = path.join(config.root, 'data', 'uploads', String(userId));
  fs.mkdirSync(dir, { recursive: true });
  return { dir, file: path.join(dir, String(itemId) + extOf(mime)) };
}

// 位置链："家→书房→书架→二层" 的末三级（room→furn→sub_pos）
function locationText(row) {
  return [row.room, row.furn, row.sub_pos].filter(Boolean).join('→');
}

function toPublic(row) {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    desc: row.desc || '',
    room: row.room || '',
    furn: row.furn || '',
    subPos: row.sub_pos || '',
    location: locationText(row),
    hasImage: !!row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getRow(userId, id) {
  return getDb().prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(Number(id), userId) || null;
}

// 录入物品：文字字段 + 图片（base64 → 本地文件，多端同步存储于后端）
function addItem(userId, input) {
  const db = getDb();
  const name = s(input.name, 40);
  const desc = s(input.desc, 200);
  const room = s(input.room, 20);
  const furn = s(input.furn, 20);
  const subPos = s(input.subPos, 20);
  const spaceId = input.spaceId != null && Number.isFinite(Number(input.spaceId)) ? Number(input.spaceId) : null;
  const info = db.prepare(`INSERT INTO items
    (user_id, space_id, name, desc, image_path, room, furn, sub_pos, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, spaceId, name, desc, null, room, furn, subPos, now(), now());
  const itemId = Number(info.lastInsertRowid);

  if (input.image && MIME_WHITELIST.includes(String(input.mimeType || '').toLowerCase())) {
    try {
      const b64 = String(input.image).replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      if (buf.length > 0 && buf.length <= IMAGE_MAX_BYTES) {
        const { file } = uploadPath(userId, itemId, String(input.mimeType).toLowerCase());
        fs.writeFileSync(file, buf);
        const rel = 'data/uploads/' + userId + '/' + itemId + extOf(String(input.mimeType).toLowerCase());
        db.prepare('UPDATE items SET image_path = ? WHERE id = ?').run(rel, itemId);
      }
    } catch { /* 图片保存失败不阻断录入，仅无图 */ }
  }
  return toPublic(getRow(userId, itemId));
}

// 文字检索：LIKE 匹配 名称/描述/位置（P2 再叠加向量检索）
function listItems(userId, { q = '', spaceId } = {}) {
  const db = getDb();
  const kw = s(q, 40);
  let sql = 'SELECT * FROM items WHERE user_id = ?';
  const args = [userId];
  if (spaceId != null && Number.isFinite(Number(spaceId))) { sql += ' AND space_id = ?'; args.push(Number(spaceId)); }
  if (kw) {
    sql += ' AND (name LIKE ? OR desc LIKE ? OR room LIKE ? OR furn LIKE ? OR sub_pos LIKE ?)';
    const like = '%' + kw + '%';
    args.push(like, like, like, like, like);
  }
  sql += ' ORDER BY id DESC LIMIT ' + LIST_LIMIT;
  return db.prepare(sql).all(...args).map(toPublic);
}

// 图片 base64 回读（前端 data URL 渲染；核心 http 仅支持 JSON 响应）
function imageBase64(userId, id) {
  const row = getRow(userId, id);
  if (!row || !row.image_path) return null;
  try {
    const buf = fs.readFileSync(path.join(config.root, row.image_path));
    return { mimeType: path.extname(row.image_path) === '.png' ? 'image/png' : path.extname(row.image_path) === '.webp' ? 'image/webp' : 'image/jpeg', image: buf.toString('base64') };
  } catch { return null; }
}

// 删除物品（同时删除图片文件）
function deleteItem(userId, id) {
  const row = getRow(userId, id);
  if (!row) return false;
  getDb().prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(Number(id), userId);
  if (row.image_path) { try { fs.unlinkSync(path.join(config.root, row.image_path)); } catch { /* 文件不存在忽略 */ } }
  return true;
}

module.exports = { addItem, listItems, getRow, imageBase64, deleteItem, toPublic };
