// src/modules/items/items.service.js — 物品数字化管理：拍照录入 → 目录/房间/家具/子位置链 → 文字检索
// P2 的图文识别在 items.vision.js、图图/文图向量检索在 items.clip.js（路由层编排，模块边界清晰）
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

// 补目录名：三级位置链的最上级是目录（space），检索列表用 LEFT JOIN 已带出 space_name
function attachSpaceName(row) {
  if (row && row.space_id != null) {
    const s = getDb().prepare('SELECT name FROM spaces WHERE id = ?').get(Number(row.space_id));
    row.space_name = s ? s.name : '';
  } else if (row) {
    row.space_name = '';
  }
  return row;
}

function toPublic(row) {
  const spaceName = row.space_name || '';
  const location = locationText(row);
  return {
    id: row.id,
    spaceId: row.space_id,
    spaceName,
    name: row.name,
    desc: row.desc || '',
    room: row.room || '',
    furn: row.furn || '',
    subPos: row.sub_pos || '',
    location,                                    // 末三级（兼容 P1 契约）
    locationFull: [spaceName, row.room, row.furn, row.sub_pos].filter(Boolean).join('→'),  // 完整位置链
    hasImage: !!row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getRow(userId, id) {
  const row = getDb().prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(Number(id), userId) || null;
  return attachSpaceName(row);
}

// 图片绝对路径（校验必须落在 data/uploads/ 内，防目录穿越；数据库字段由服务端生成，此校验为纵深防御）
const UPLOAD_ROOT = path.join(config.root, 'data', 'uploads');
function safeImagePath(imagePath) {
  if (!imagePath) return null;
  const abs = path.resolve(config.root, imagePath);
  if (!abs.startsWith(UPLOAD_ROOT + path.sep) && abs !== UPLOAD_ROOT) return null;
  return abs;
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

// 文字检索：LIKE 匹配 名称/描述/位置；LEFT JOIN 带出目录名（完整位置链）
function listItems(userId, { q = '', spaceId } = {}) {
  const db = getDb();
  const kw = s(q, 40);
  let sql = 'SELECT i.*, s.name AS space_name FROM items i LEFT JOIN spaces s ON s.id = i.space_id WHERE i.user_id = ?';
  const args = [userId];
  if (spaceId != null && Number.isFinite(Number(spaceId))) { sql += ' AND i.space_id = ?'; args.push(Number(spaceId)); }
  if (kw) {
    sql += ' AND (i.name LIKE ? OR i.desc LIKE ? OR i.room LIKE ? OR i.furn LIKE ? OR i.sub_pos LIKE ?)';
    const like = '%' + kw + '%';
    args.push(like, like, like, like, like);
  }
  sql += ' ORDER BY i.id DESC LIMIT ' + LIST_LIMIT;
  return db.prepare(sql).all(...args).map(toPublic);
}

// 图片 base64 回读（前端 data URL 渲染；核心 http 仅支持 JSON 响应）
function imageBase64(userId, id) {
  const row = getRow(userId, id);
  const file = safeImagePath(row && row.image_path);
  if (!file) return null;
  try {
    const buf = fs.readFileSync(file);
    return { mimeType: path.extname(file) === '.png' ? 'image/png' : path.extname(file) === '.webp' ? 'image/webp' : 'image/jpeg', image: buf.toString('base64') };
  } catch { return null; }
}

// 删除物品（同时删除图片文件）
function deleteItem(userId, id) {
  const row = getRow(userId, id);
  if (!row) return false;
  getDb().prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(Number(id), userId);
  const file = safeImagePath(row.image_path);
  if (file) { try { fs.unlinkSync(file); } catch { /* 文件不存在忽略 */ } }
  return true;
}

// 物品存放统计（可视化页数据源）：总量/照片覆盖/目录分布/房间分布/收纳家具分布/近30天新增趋势
function statsItems(userId) {
  const db = getDb();
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const total = db.prepare('SELECT COUNT(*) AS c FROM items WHERE user_id = ?').get(userId).c;
  const withImage = db.prepare("SELECT COUNT(*) AS c FROM items WHERE user_id = ? AND image_path IS NOT NULL AND image_path != ''").get(userId).c;
  const bySpace = db.prepare(
    "SELECT COALESCE(s.name, '未分类') AS name, COUNT(*) AS c FROM items i LEFT JOIN spaces s ON s.id = i.space_id WHERE i.user_id = ? GROUP BY s.id ORDER BY c DESC"
  ).all(userId);
  const byRoom = db.prepare(
    "SELECT room AS name, COUNT(*) AS c FROM items WHERE user_id = ? AND room IS NOT NULL AND room != '' GROUP BY room ORDER BY c DESC LIMIT 12"
  ).all(userId);
  const byFurn = db.prepare(
    "SELECT furn AS name, COUNT(*) AS c FROM items WHERE user_id = ? AND furn IS NOT NULL AND furn != '' GROUP BY furn ORDER BY c DESC LIMIT 12"
  ).all(userId);
  const daily = db.prepare(
    'SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM items WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day'
  ).all(userId, since30);
  return {
    total,
    withImage,
    textOnly: total - withImage,
    spaceCount: bySpace.length,
    roomCoverage: byRoom.length,
    last30: daily.reduce((a, d) => a + d.c, 0),
    bySpace,
    byRoom,
    byFurn,
    daily
  };
}

module.exports = { addItem, listItems, getRow, imageBase64, deleteItem, toPublic, safeImagePath, statsItems };
