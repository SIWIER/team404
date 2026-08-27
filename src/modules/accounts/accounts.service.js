// src/modules/accounts/accounts.service.js — 账户与个人画像业务逻辑
'use strict';
const { getDb } = require('../../core/db');
const { hashPassword, verifyPassword, issueToken } = require('../../core/auth');

function now() { return new Date().toISOString(); }
function safeJson(s, d) { try { const v = JSON.parse(s); return v === null ? d : v; } catch { return d; } }

// 家庭布局清洗：最多 36 个房间，每房间最多 20 个放置点；
// 坐标 x/y 为户型图网格位置（0-9，10×10 细网格）；cells 为多格形状（任何房间都可占多格，
// 大房间多格、小房间少格；走廊为连通链），x/y 恒等于 cells[0]
// 同名房间自动编号区分（卧室、卧室2、卧室3…），避免同类型房间被当作同一房间
// w/h 为房间内部布局尺寸（1-12 格，仅当输入提供时保留）；furn 为房间内家具格（仅当输入提供时保留）
const MAX_ROOMS = 36;
const GRID = 10;
// 用户可拥有的硬件设备类型（注册时"有无设备"提问）；空数组/未填 = 无硬件
const HARDWARE_ALLOWED = ['uhf_reader', 'case_locator'];
function sanitizeLayout(layout) {
  if (!Array.isArray(layout)) return [];
  const seen = new Set();
  const uniqueName = (base) => {
    if (!seen.has(base)) { seen.add(base); return base; }
    let n = 2;
    while (seen.has(base + n)) n++;
    seen.add(base + n);
    return base + n;
  };
  const num = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
  const clampCell = (v) => Math.min(GRID - 1, Math.max(0, Math.round(v)));
  return layout.slice(0, MAX_ROOMS).map((r) => {
    const raw = String((r && r.name) || '').trim().slice(0, 20);
    const desc = String((r && r.desc) || '').trim().slice(0, 100);
    const spots = Array.isArray(r && r.spots) ? r.spots.slice(0, 20).map((s) => String(s).trim().slice(0, 30)).filter(Boolean) : [];
    let x = num(r && r.x);
    let y = num(r && r.y);
    let cells;
    if (Array.isArray(r && r.cells) && r.cells.length) {
      // 多格形状：去重、裁剪到网格内（10×10=100 格封顶）
      const seenCells = new Set();
      cells = r.cells.slice(0, GRID * GRID).map((c) => {
        const cx = num(c && c.x);
        const cy = num(c && c.y);
        if (cx === null || cy === null) return null;
        return { x: clampCell(cx), y: clampCell(cy) };
      }).filter((c) => {
        if (!c) return false;
        const k = c.x + ',' + c.y;
        if (seenCells.has(k)) return false;
        seenCells.add(k);
        return true;
      });
      if (cells.length) { x = cells[0].x; y = cells[0].y; } else { cells = []; }
    } else if (x !== null && y !== null) {
      cells = [{ x: clampCell(x), y: clampCell(y) }];
      x = cells[0].x;
      y = cells[0].y;
    } else {
      cells = [];
    }
    // 融合两条线：保留 cells 多格形状 + uniqueName 同名编号（走廊链与户型识别依赖），
    // 同时并入房间内部布局的 w/h/furn
    const room = { name: raw ? uniqueName(raw) : '', desc, spots, x, y, cells };
    // 房间内部布局尺寸：仅在客户端提供时保留，四舍五入并夹在 [1,12]
    const w = num(r && r.w);
    const h = num(r && r.h);
    if (w !== null) room.w = Math.min(12, Math.max(1, Math.round(w)));
    if (h !== null) room.h = Math.min(12, Math.max(1, Math.round(h)));
    // 家具格：name 非空、坐标整数且落在房间尺寸范围内，最多 144 格
    const furn = Array.isArray(r && r.furn) ? r.furn.map((f) => {
      const fx = num(f && f.x);
      const fy = num(f && f.y);
      const fname = String((f && f.name) || '').trim().slice(0, 10);
      if (!fname || fx === null || fy === null) return null;
      const rx = Math.round(fx);
      const ry = Math.round(fy);
      if (rx < 0 || ry < 0 || rx > 11 || ry > 11) return null;
      if (room.w !== undefined && rx >= room.w) return null;
      if (room.h !== undefined && ry >= room.h) return null;
      return { name: fname, x: rx, y: ry };
    }).filter(Boolean).slice(0, 144) : [];
    if (furn.length) room.furn = furn;
    return room;
  }).filter((r) => r.name);
}

// 对外暴露的用户信息（不含密码哈希等敏感字段）
function getPublicUser(userId) {
  const db = getDb();
  const u = db.prepare('SELECT id, username, nickname, created_at FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) || {};
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    createdAt: u.created_at,
    profile: {
      agentName: p.agent_name || `${u.nickname}的小镜助手`,
      agentStyle: p.agent_style || '温和耐心，擅长生活常识与逻辑推理',
      habits: safeJson(p.habits, []),
      favoritePlaces: safeJson(p.favorite_places, []),
      homeLayout: safeJson(p.home_layout, []),
      notes: p.notes || '',
      hardware: safeJson(p.hardware, []).filter((h) => HARDWARE_ALLOWED.includes(h)),
      updatedAt: p.updated_at || null
    }
  };
}

function register({ username, password, nickname }) {
  const db = getDb();
  const uname = String(username || '').trim();
  const nick = String(nickname || '').trim() || uname;
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) return { error: '该用户名已被注册' };
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, nickname, created_at) VALUES (?,?,?,?)'
  ).run(uname, hashPassword(password), nick, now());
  const userId = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO profiles (user_id, agent_name, agent_style, habits, favorite_places, home_layout, notes, hardware, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(userId, `${nick}的小镜助手`, '温和耐心，擅长生活常识与逻辑推理', '[]', '[]', '[]', '', '[]', now());
  return { user: getPublicUser(userId) };
}

function login({ username, password, remember }) {
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    return { error: '用户名或密码错误' };
  }
  const { token, expiresInHours } = issueToken(u.id, !!remember);
  return { token, expiresInHours, user: getPublicUser(u.id) };
}

function updateProfile(userId, patch) {
  const db = getDb();
  const cur = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) || {};
  const clamp = (v, max) => String(v ?? '').slice(0, max);
  const agentName = patch.agentName !== undefined ? clamp(patch.agentName, 40) || `${getPublicUser(userId).nickname}的小镜助手` : cur.agent_name;
  const agentStyle = patch.agentStyle !== undefined ? clamp(patch.agentStyle, 200) : cur.agent_style;
  const habits = patch.habits !== undefined ? JSON.stringify(Array.isArray(patch.habits) ? patch.habits.slice(0, 20) : []) : cur.habits;
  const favoritePlaces = patch.favoritePlaces !== undefined ? JSON.stringify(Array.isArray(patch.favoritePlaces) ? patch.favoritePlaces.slice(0, 20) : []) : cur.favorite_places;
  const homeLayout = patch.homeLayout !== undefined ? JSON.stringify(sanitizeLayout(patch.homeLayout)) : cur.home_layout;
  const notes = patch.notes !== undefined ? clamp(patch.notes, 500) : cur.notes;
  const hardware = patch.hardware !== undefined
    ? JSON.stringify(Array.isArray(patch.hardware)
      ? [...new Set(patch.hardware.filter((h) => HARDWARE_ALLOWED.includes(h)))].slice(0, 10)
      : [])
    : (cur.hardware ?? '[]');
  db.prepare(`
    INSERT INTO profiles (user_id, agent_name, agent_style, habits, favorite_places, home_layout, notes, hardware, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      agent_name=excluded.agent_name, agent_style=excluded.agent_style,
      habits=excluded.habits, favorite_places=excluded.favorite_places,
      home_layout=excluded.home_layout, notes=excluded.notes, hardware=excluded.hardware, updated_at=excluded.updated_at
  `).run(userId, agentName, agentStyle, habits, favoritePlaces, homeLayout, notes, hardware, now());
  return getPublicUser(userId);
}

module.exports = { getPublicUser, register, login, updateProfile, sanitizeLayout, MAX_ROOMS };
