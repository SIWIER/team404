// src/modules/accounts/accounts.wx.service.js — 微信一键登录 / 账号绑定业务逻辑
// 零依赖：使用 Node 内置 fetch 调 jscode2session；code2session 抽出为可注入函数便于测试。
'use strict';
const crypto = require('node:crypto');
const { getDb } = require('../../core/db');
const config = require('../../config');
const logger = require('../../core/logger');
const { hashPassword, verifyPassword, issueToken } = require('../../core/auth');
const accounts = require('./accounts.service');

function now() { return new Date().toISOString(); }

// 微信开放平台昵称随机后缀：6 位 base36，避免撞名
function randomNickSuffix() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---------- code2session：与微信服务器交互（可注入） ----------
// 默认实现：调 https://api.weixin.qq.com/sns/jscode2session
// 测试可通过 setCode2Session() 注入一个返回固定 openid 的实现，无需联网
let code2sessionImpl = defaultCode2Session;

async function defaultCode2Session(code) {
  if (!code || typeof code !== 'string') {
    return { ok: false, error: 'code 缺失' };
  }
  if (!config.wx.appId || !config.wx.secret) {
    return { ok: false, error: '后端未配置微信 AppID/Secret' };
  }
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', config.wx.appId);
  url.searchParams.set('secret', config.wx.secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), config.wx.code2sessionTimeoutMs);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    const data = await resp.json().catch(() => ({}));
    if (data.errcode) return { ok: false, error: data.errmsg || `微信接口错误 ${data.errcode}` };
    if (!data.openid) return { ok: false, error: '微信返回数据无 openid' };
    return { ok: true, openid: String(data.openid), unionid: data.unionid ? String(data.unionid) : null };
  } catch (e) {
    return { ok: false, error: '调微信接口失败：' + (e && e.message ? e.message : 'unknown') };
  } finally {
    clearTimeout(t);
  }
}

// 注入入口（测试用）；返回当前实现便于排查
function setCode2Session(fn) {
  code2sessionImpl = typeof fn === 'function' ? fn : defaultCode2Session;
  return code2sessionImpl;
}

function getCode2Session() { return code2sessionImpl; }

// ---------- 内部：解析 jscode2session ----------
// 优先级：WX_MOCK_OPENID 非空 → 直接返回 mockOpenid；否则走注入实现
async function resolveOpenid(code) {
  if (config.wx.mockOpenid) {
    // mock 模式下允许自定义 openid 区分场景（code 可携带后缀）
    // 例：code='mock-existing' 仍返回同一个 mockOpenid，便于复用
    return { ok: true, openid: config.wx.mockOpenid, mock: true };
  }
  const r = await code2sessionImpl(code);
  if (!r.ok) return r;
  return { ok: true, openid: r.openid, unionid: r.unionid || null, mock: false };
}

// ---------- bindToken：短时效一次性凭证（HMAC 签名） ----------
// payload: { o: openid, exp }；不绑定任何用户；用于"未注册微信用户→绑定已有账号"流程
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function signBindToken(openid, ttlMs) {
  const body = b64url(JSON.stringify({ o: openid, exp: Date.now() + ttlMs }));
  const sig = crypto.createHmac('sha256', config.token.secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyBindToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = crypto.createHmac('sha256', config.token.secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (!payload.o) return null;
    return payload; // { o: openid, exp }
  } catch { return null; }
}

// ---------- 自动注册 ----------
// 极简生成不冲突的 username：以 'wx_' + 时间戳 base36 + 4 位随机；冲突重试
function generateUsername() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `wx_${ts}_${rand}`;
}

function createWechatUser(openid) {
  const db = getDb();
  for (let i = 0; i < 5; i++) {
    const username = generateUsername();
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) continue;
    // 设置一个不可登录的占位密码（用随机 32 字节 hex 哈希）。该用户后续应通过 wxbind 绑定到本人账号。
    const placeholderPw = crypto.randomBytes(32).toString('hex');
    const nickname = '微信用户' + randomNickSuffix();
    const tx = db.prepare('BEGIN');
    try {
      tx.run();
      const ins = db.prepare(
        'INSERT INTO users (username, password_hash, nickname, created_at, wechat_openid) VALUES (?,?,?,?,?)'
      ).run(username, hashPassword(placeholderPw), nickname, now(), openid);
      const userId = Number(ins.lastInsertRowid);
      db.prepare(`INSERT INTO profiles (user_id, agent_name, agent_style, habits, favorite_places, home_layout, notes, updated_at)
                  VALUES (?,?,?,?,?,?,?,?)`)
        .run(userId, `${nickname}的小镜助手`, '温和耐心，擅长生活常识与逻辑推理', '[]', '[]', '[]', '通过微信登录创建，请尽快绑定账号以恢复访问。', now());
      db.exec('COMMIT');
      return { id: userId, username, nickname };
    } catch (e) {
      db.exec('ROLLBACK');
      // 唯一约束冲突（极小概率 openid 撞了已存在用户）→ 由调用方按 openid 查询
      if (e && /UNIQUE|unique/i.test(String(e.message))) {
        const exist = db.prepare('SELECT id, username, nickname FROM users WHERE wechat_openid = ?').get(openid);
        if (exist) return { id: exist.id, username: exist.username, nickname: exist.nickname };
        continue;
      }
      throw e;
    }
  }
  throw new Error('微信用户自动注册失败（重试 5 次仍冲突）');
}

// 把 openid 绑定到指定用户（用户必须存在且当前未绑定其他 openid）
function bindOpenidToUser(userId, openid) {
  const db = getDb();
  const u = db.prepare('SELECT id, wechat_openid FROM users WHERE id = ?').get(userId);
  if (!u) return { error: '用户不存在' };
  if (u.wechat_openid && u.wechat_openid === openid) return { userId }; // 已绑定同一个 openid，幂等
  if (u.wechat_openid && u.wechat_openid !== openid) {
    return { error: '该账号已绑定其他微信，请先解绑' };
  }
  // 检查 openid 已被其他用户占用
  const other = db.prepare('SELECT id FROM users WHERE wechat_openid = ? AND id != ?').get(openid, userId);
  if (other) return { error: '该微信已被其他账号绑定' };
  db.prepare('UPDATE users SET wechat_openid = ? WHERE id = ?').run(openid, userId);
  return { userId };
}

// ---------- 主流程 ----------
// wxlogin(code) → { ok, mode: 'login' | 'autoRegister' | 'needBind', token?, user?, bindToken? }
function wxlogin(code) {
  return (async () => {
    const r = await resolveOpenid(code);
    if (!r.ok) return { ok: false, error: r.error, status: 400 };
    const openid = r.openid;
    const db = getDb();
    const exist = db.prepare('SELECT id FROM users WHERE wechat_openid = ?').get(openid);
    if (exist) {
      const t = issueToken(exist.id, true); // 微信登录默认 30 天免登录
      return { ok: true, mode: 'login', token: t.token, expiresInHours: t.expiresInHours, user: accounts.getPublicUser(exist.id) };
    }
    if (config.wx.autoRegister) {
      const u = createWechatUser(openid);
      const t = issueToken(u.id, true);
      logger.info(`[wx] 自动注册并登录：uid=${u.id} mock=${!!r.mock}`);
      return { ok: true, mode: 'autoRegister', token: t.token, expiresInHours: t.expiresInHours, user: accounts.getPublicUser(u.id) };
    }
    // 需要绑定：发一次性 bindToken
    const bindToken = signBindToken(openid, config.wx.bindTokenTtlMs);
    return { ok: true, mode: 'needBind', bindToken, bindTokenExpiresInSec: Math.round(config.wx.bindTokenTtlMs / 1000) };
  })();
}

// wxbind(bindToken, username, password) → { ok, token, user }
function wxbind(bindToken, username, password) {
  const payload = verifyBindToken(bindToken);
  if (!payload) return { error: '绑定凭证无效或已过期', status: 422 };
  const db = getDb();
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) {
    return { error: '用户名或密码错误', status: 401 };
  }
  const bind = bindOpenidToUser(u.id, payload.o);
  if (bind.error) return { error: bind.error, status: 409 };
  const t = issueToken(u.id, true);
  return { ok: true, token: t.token, expiresInHours: t.expiresInHours, user: accounts.getPublicUser(u.id) };
}

// 暴露 verifyBindToken 供测试
function _verifyBindToken(t) { return verifyBindToken(t); }
function _signBindToken(openid, ttlMs) { return signBindToken(openid, ttlMs); }

module.exports = {
  wxlogin, wxbind,
  setCode2Session, getCode2Session,
  // 测试/内部用
  signBindToken: _signBindToken,
  verifyBindToken: _verifyBindToken,
  bindOpenidToUser, createWechatUser
};
