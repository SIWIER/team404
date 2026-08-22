// src/modules/accounts/accounts.service.js — 账户与个人画像业务逻辑
'use strict';
const { getDb } = require('../../core/db');
const { hashPassword, verifyPassword, issueToken } = require('../../core/auth');

function now() { return new Date().toISOString(); }
function safeJson(s, d) { try { const v = JSON.parse(s); return v === null ? d : v; } catch { return d; } }

// 家庭布局清洗：最多 10 个房间，每房间最多 20 个放置点；坐标 x/y 为户型图网格位置（0-5）；w/h 为房间内部布局尺寸（1-12 格，仅当输入提供时保留）；furn 为房间内家具格（仅当输入提供时保留）
function sanitizeLayout(layout) {
  if (!Array.isArray(layout)) return [];
  return layout.slice(0, 10).map((r) => {
    const num = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
    const x = num(r && r.x);
    const y = num(r && r.y);
    const w = num(r && r.w);
    const h = num(r && r.h);
    const room = {
      name: String((r && r.name) || '').trim().slice(0, 20),
      desc: String((r && r.desc) || '').trim().slice(0, 100),
      spots: Array.isArray(r && r.spots) ? r.spots.slice(0, 20).map((s) => String(s).trim().slice(0, 30)).filter(Boolean) : [],
      x: x === null ? null : Math.min(5, Math.max(0, Math.round(x))),
      y: y === null ? null : Math.min(5, Math.max(0, Math.round(y)))
    };
    // 房间尺寸：仅在客户端提供时保留，四舍五入并夹在 [1,12]
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
  db.prepare(`INSERT INTO profiles (user_id, agent_name, agent_style, habits, favorite_places, home_layout, notes, updated_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(userId, `${nick}的小镜助手`, '温和耐心，擅长生活常识与逻辑推理', '[]', '[]', '[]', '', now());
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
  db.prepare(`
    INSERT INTO profiles (user_id, agent_name, agent_style, habits, favorite_places, home_layout, notes, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      agent_name=excluded.agent_name, agent_style=excluded.agent_style,
      habits=excluded.habits, favorite_places=excluded.favorite_places,
      home_layout=excluded.home_layout, notes=excluded.notes, updated_at=excluded.updated_at
  `).run(userId, agentName, agentStyle, habits, favoritePlaces, homeLayout, notes, now());
  return getPublicUser(userId);
}

module.exports = { getPublicUser, register, login, updateProfile, sanitizeLayout };
