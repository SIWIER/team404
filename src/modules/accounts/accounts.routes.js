// src/modules/accounts/accounts.routes.js — 账户模块 HTTP 路由（REST）
'use strict';
const { validate, v } = require('../../core/auth');
const { rateLimit } = require('../../core/ratelimit');
const svc = require('./accounts.service');
const wxSvc = require('./accounts.wx.service');
const config = require('../../config');

const USERNAME_RE = /^[\w\u4e00-\u9fa5.-]{2,24}$/;
// 登录/注册限流：每 IP 每分钟 20 次
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
// 微信登录/绑定独立限流：略宽，避免误伤扫码交互
const wxAuthLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

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
      homeLayout: [(val) => (val !== undefined && !Array.isArray(val) ? '家庭布局格式不正确' : null)],
      hardware: [(val) => (val !== undefined && !Array.isArray(val) ? '硬件设备清单格式不正确' : null)]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const user = svc.updateProfile(ctx.user.id, {
      agentName: b.agentName,
      agentStyle: b.agentStyle,
      habits: b.habits,
      favoritePlaces: b.favoritePlaces,
      homeLayout: b.homeLayout,
      notes: b.notes,
      hardware: b.hardware
    });
    ctx.res.ok({ user });
  });

  // ========== 微信登录（小程序 wx.login） ==========
  // 入参：{ code: string }
  // 返回 3 种 mode：
  //   - login       : openid 已绑定 → 颁发 token + user
  //   - autoRegister: 未绑定但 WX_AUTO_REGISTER=true → 自动建号后颁发 token + user
  //   - needBind    : 未绑定且 WX_AUTO_REGISTER=false → 一次性 bindToken，前端弹窗收集账号密码
  router.post('/api/auth/wxlogin', wxAuthLimiter, async (ctx) => {
    const b = ctx.body || {};
    const errs = validate(b, { code: [v.required('code 必填'), v.minLen(1)] });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    // 后端未配置 WX_APPID 且未启用 mock → 提示前端按钮置灰
    if (!config.wx.appId && !config.wx.mockOpenid) {
      return ctx.res.json({ ok: false, error: '后端未配置微信登录（缺少 WX_APPID）', code: 'WX_NOT_CONFIGURED' }, 503);
    }
    const r = await wxSvc.wxlogin(String(b.code));
    if (!r.ok) return ctx.res.json({ ok: false, error: r.error }, r.status || 400);
    if (r.mode === 'needBind') {
      return ctx.res.ok({ needBind: true, bindToken: r.bindToken, bindTokenExpiresInSec: r.bindTokenExpiresInSec });
    }
    ctx.res.ok({ mode: r.mode, token: r.token, expiresInHours: r.expiresInHours, user: r.user });
  });

  // ========== 微信绑定（已有账号与 openid 绑定） ==========
  // 入参：{ bindToken, username, password }
  // 仅在 wxlogin 返回 needBind 时调用
  router.post('/api/auth/wxbind', wxAuthLimiter, async (ctx) => {
    const b = ctx.body || {};
    const errs = validate(b, {
      bindToken: [v.required('bindToken 必填')],
      username: [v.required(), v.match(USERNAME_RE, '用户名需 2-24 位（字母/数字/中文/._-）')],
      password: [v.required(), v.minLen(4, '密码至少 4 位'), v.maxLen(64)]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const r = wxSvc.wxbind(b.bindToken, b.username, b.password);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, r.status || 400);
    ctx.res.ok({ token: r.token, expiresInHours: r.expiresInHours, user: r.user });
  });

  // ========== 前端能力探测：返回当前后端是否启用微信登录 ==========
  // 用于小程序启动时一次性探测，决定按钮置灰还是可点
  router.get('/api/auth/wxconfig', (ctx) => {
    const enabled = !!(config.wx.appId || config.wx.mockOpenid);
    ctx.res.ok({ enabled, autoRegister: config.wx.autoRegister });
  });
}

module.exports = { registerRoutes };
