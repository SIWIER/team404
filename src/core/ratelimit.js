// src/core/ratelimit.js — 内存滑动窗口限流（登录/注册等敏感接口防爆破）
'use strict';

const buckets = new Map();

// 定期清理过期窗口
const cleaner = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.start > b.windowMs) buckets.delete(k);
  }
}, 60 * 1000);
if (cleaner.unref) cleaner.unref();

function clientIp(ctx) {
  const fwd = ctx.req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return ctx.req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs = 60 * 1000, max = 20, keyFn } = {}) {
  return (ctx) => {
    const key = keyFn ? keyFn(ctx) : clientIp(ctx);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.start > windowMs) {
      b = { start: now, count: 0, windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      ctx.res.error('请求过于频繁，请稍后再试', 429);
      ctx.ended = true;
    }
  };
}

module.exports = { rateLimit };
