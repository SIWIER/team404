// src/modules/accounts/accounts.routes.js — 账户模块 HTTP 路由（REST）
'use strict';
const { validate, v } = require('../../core/auth');
const { rateLimit } = require('../../core/ratelimit');
const svc = require('./accounts.service');

const USERNAME_RE = /^[\w\u4e00-\u9fa5.-]{2,24}$/;
// 登录/注册限流：每 IP 每分钟 20 次
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

function registerRoutes(router) {
  // 注册
  router.post('/api/auth/register', authLimiter, async (ctx) => {
    const b = ctx.body || {};
    const errs = validate(b, {
      username: [v.required(), v.match(USERNAME_RE, '用户名需 2-24 位（字母/数字/中文/._-）')],
      password: [v.required(), v.minLen(4, '密码至少 4 位'), v.maxLen(64)],
      nickname: [v.maxLen(24)]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const r = svc.register(b);
    if (r.error) return ctx.res.json({ ok: false, errors: { username: r.error } }, 409);
    ctx.res.ok({ user: r.user });
  });

  // 登录
  router.post('/api/auth/login', authLimiter, async (ctx) => {
    const b = ctx.body || {};
    const errs = validate(b, {
      username: [v.required()],
      password: [v.required()]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const r = svc.login(b);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, 401);
    ctx.res.ok({ token: r.token, expiresInHours: r.expiresInHours, user: r.user });
  });

  // 登出（无状态令牌：客户端丢弃即可；接口保留用于埋点/审计）
  router.post('/api/auth/logout', async (ctx) => {
    ctx.res.ok();
  });

  // 当前用户
  router.get('/api/auth/me', async (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    ctx.res.ok({ user: svc.getPublicUser(ctx.user.id) });
  });

  // 更新个人画像（个性化智能体 + 家庭布局）
  router.put('/api/auth/profile', async (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    const b = ctx.body || {};
    const errs = validate(b, {
      agentName: [v.maxLen(40)],
      agentStyle: [v.maxLen(200)],
      notes: [v.maxLen(500)],
      homeLayout: [(val) => (val !== undefined && !Array.isArray(val) ? '家庭布局格式不正确' : null)]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const user = svc.updateProfile(ctx.user.id, {
      agentName: b.agentName,
      agentStyle: b.agentStyle,
      habits: b.habits,
      favoritePlaces: b.favoritePlaces,
      homeLayout: b.homeLayout,
      notes: b.notes
    });
    ctx.res.ok({ user });
  });
}

module.exports = { registerRoutes };
