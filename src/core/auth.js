// src/core/auth.js — 密码哈希（scrypt）与 HMAC 签名会话令牌（无状态）
'use strict';
const crypto = require('node:crypto');
const config = require('../config');
const { getDb } = require('./db');

// ---------- 密码 ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `v1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  try {
    const [v, saltHex, hashHex] = String(stored).split('$');
    if (v !== 'v1') return false;
    const test = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return crypto.timingSafeEqual(Buffer.from(hashHex, 'hex'), test);
  } catch { return false; }
}

// ---------- 令牌（JWT 风格，HMAC-SHA256）----------
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function signToken(payload, ttlHours) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + Math.floor(ttlHours * 3600)
  }));
  const sig = crypto.createHmac('sha256', config.token.secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expect = crypto.createHmac('sha256', config.token.secret).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function issueToken(userId, remember) {
  const ttl = remember ? config.token.ttlHoursRemember : config.token.ttlHours;
  return { token: signToken({ uid: userId }, ttl), expiresInHours: ttl };
}

// ---------- 从请求头解析令牌 ----------
function bearerToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// 中间件：解析令牌并挂载 ctx.user（公开用户信息）
function attachUser(ctx) {
  const payload = verifyToken(bearerToken(ctx.req));
  ctx.auth = payload || null;
  if (payload) {
    const db = getDb();
    const u = db.prepare('SELECT id, username, nickname, created_at FROM users WHERE id = ?').get(payload.uid);
    ctx.user = u || null;
  }
}

// 校验工具（供服务层使用）
function validate(obj, rules) {
  const errors = {};
  for (const [field, fns] of Object.entries(rules)) {
    for (const fn of fns) {
      const err = fn(obj[field], obj);
      if (err) { errors[field] = err; break; }
    }
  }
  return Object.keys(errors).length ? errors : null;
}

const v = {
  required: (msg = '不能为空') => (val) => (val === undefined || val === null || String(val).trim() === '' ? msg : null),
  minLen: (n, msg) => (val) => (val !== undefined && val !== null && String(val).length < n ? (msg || `至少 ${n} 个字符`) : null),
  maxLen: (n, msg) => (val) => (val !== undefined && val !== null && String(val).length > n ? (msg || `最多 ${n} 个字符`) : null),
  match: (re, msg) => (val) => (val !== undefined && val !== null && !re.test(String(val)) ? msg : null)
};

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, issueToken, bearerToken, attachUser, validate, v };
