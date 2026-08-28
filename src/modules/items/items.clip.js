// src/modules/items/items.clip.js — 图图/文图向量检索：Chinese-CLIP 客户端 + SQLite 向量存储 + 暴力余弦
// 团队决策②：图图（拍照→找相同物品）/ 文图（文字→匹配物品图片）走 Chinese-CLIP 本地部署。
// 起步方案：向量存 items.clip_vec（JSON 数组字符串），检索用暴力余弦（用户量级几百条完全够用），
//          后续量大再换向量索引。向量服务为独立进程（参考实现 scripts/clip-server/，契约见 docs/SDD.md §5.6）。
//
// 懒回填策略：录入时不阻塞等向量（CLIP 在 CPU 上要几秒），首次向量检索时把"无向量"的物品补齐
//          （每次最多 BACKFILL_CAP 条）：有照片用图片编码；纯文字物品用「名称+描述」文本编码，
//          保证没有照片的物品也能被 文图/图图 检索命中。向量服务未配置/不可用时优雅降级。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');
const { getDb } = require('../../core/db');

const TOP_N = 10;          // 检索返回条数
const BACKFILL_CAP = 20;   // 每次检索最多回填的向量条数（防第一次检索打爆慢速 CPU 服务）
const MAX_TEXT_LEN = 100;  // 文图检索文字上限（CLIP 文本塔通常 52 token 左右，截断即可）

// 上传目录根（与 items.service.js 的落盘目录一致；读取时做路径校验防目录穿越）
const UPLOAD_ROOT = path.join(config.root, 'data', 'uploads');

// 能力探测：配置了 baseUrl 才算就绪（未配置 → 接口 503，前端按钮置灰）
function ready(cfg) {
  return !!(cfg && cfg.enabled && cfg.baseUrl);
}

// POST JSON 到向量服务；任何网络/协议错误返回 null（由上层转友好错误）
async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 调用向量服务并规范化向量：契约 {vector:[...]}（兼容包一层 data 的返回）
// 向量统一裁剪/补齐到 cfg.dim，非法条目记 0
async function encode(cfg, endpoint, body) {
  const url = String(cfg.baseUrl || '').replace(/\/+$/, '') + endpoint;
  const data = await postJson(url, body, cfg.timeoutMs);
  const vec = data && Array.isArray(data.vector)
    ? data.vector
    : (data && data.data && Array.isArray(data.data.vector) ? data.data.vector : null);
  if (!vec || !vec.length) return null;
  const dim = Number.isFinite(cfg.dim) && cfg.dim > 0 ? cfg.dim : 512;
  return Array.from({ length: dim }, (_, i) => {
    const n = Number(vec[i]);
    return Number.isFinite(n) ? n : 0;
  });
}

// 图片 → 向量（image 为裸 base64）
function embedImage(cfg, imageBase64) {
  return encode(cfg, '/encode/image', { image: String(imageBase64) });
}

// 文字 → 向量（文图检索）
function embedText(cfg, text) {
  return encode(cfg, '/encode/text', { text: String(text || '').slice(0, MAX_TEXT_LEN) });
}

// 余弦相似度（两个向量按较短者对齐）
function cosine(a, b) {
  const n = Math.min((a || []).length, (b || []).length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function parseVec(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.length ? v.map(Number) : null;
  } catch { return null; }
}

// 读取物品图片文件（路径必须落在上传目录内，防目录穿越）→ base64
function readItemImage(imagePath) {
  if (!imagePath) return null;
  const abs = path.resolve(config.root, imagePath);
  if (!abs.startsWith(UPLOAD_ROOT + path.sep)) return null;
  try {
    const buf = fs.readFileSync(abs);
    return buf.length ? buf.toString('base64') : null;
  } catch { return null; }
}

// 给单件物品算向量并写回 items.clip_vec；失败返回 false（不抛，检索照常降级）
async function embedItem(cfg, row) {
  const image = readItemImage(row && row.image_path);
  if (!image) return false;
  const vec = await embedImage(cfg, image);
  if (!vec) return false;
  getDb().prepare('UPDATE items SET clip_vec = ? WHERE id = ?').run(JSON.stringify(vec), row.id);
  return true;
}

// 无照片物品 → 用「名称 + 描述」文本编码（CLIP 图文跨模态：文图检索直接命中，图图也能比对到）
async function embedItemText(cfg, row) {
  const text = [row && row.name, row && row.desc].filter(Boolean).join('，');
  if (!text) return false;
  const vec = await embedText(cfg, text);
  if (!vec) return false;
  getDb().prepare('UPDATE items SET clip_vec = ? WHERE id = ?').run(JSON.stringify(vec), row.id);
  return true;
}

// 懒回填：该用户"无向量"的物品补齐向量（每次两类各最多 BACKFILL_CAP 条）——
// 有照片的用图片编码；没照片但有名称/描述的用文本编码，保证纯文字录入的物品也能被向量检索命中
async function backfill(cfg, userId) {
  const db = getDb();
  const withImage = db.prepare(`SELECT * FROM items
    WHERE user_id = ? AND image_path IS NOT NULL AND image_path != ''
      AND (clip_vec IS NULL OR clip_vec = '')
    ORDER BY id LIMIT ${BACKFILL_CAP}`).all(userId);
  const textOnly = db.prepare(`SELECT * FROM items
    WHERE user_id = ? AND (image_path IS NULL OR image_path = '')
      AND (name != '' OR (desc IS NOT NULL AND desc != ''))
      AND (clip_vec IS NULL OR clip_vec = '')
    ORDER BY id LIMIT ${BACKFILL_CAP}`).all(userId);
  for (const row of withImage) {
    await embedItem(cfg, row);        // 失败静默跳过，下次检索再试
  }
  for (const row of textOnly) {
    await embedItemText(cfg, row);    // 同上
  }
  return withImage.length + textOnly.length;
}

// 向量检索：回填缺失向量 → 暴力余弦 → 按分数降序取前 topN。
// 返回 [{row(含 space_name), score}]，由路由层转公开字段（避免跨模块引用 service 内部实现）。
async function searchRaw(cfg, userId, vec, spaceId, topN) {
  const db = getDb();
  await backfill(cfg, userId);

  let sql = `SELECT i.*, s.name AS space_name
    FROM items i LEFT JOIN spaces s ON s.id = i.space_id
    WHERE i.user_id = ? AND i.clip_vec IS NOT NULL AND i.clip_vec != ''`;
  const args = [userId];
  if (spaceId != null && Number.isFinite(Number(spaceId))) {
    sql += ' AND i.space_id = ?';
    args.push(Number(spaceId));
  }
  const rows = db.prepare(sql).all(...args);
  return rows
    .map((row) => ({ row, score: cosine(vec, parseVec(row.clip_vec) || []) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN || TOP_N);
}

module.exports = { ready, embedImage, embedText, cosine, parseVec, searchRaw, backfill, TOP_N, BACKFILL_CAP };
