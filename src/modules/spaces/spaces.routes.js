// src/modules/spaces/spaces.routes.js — 目录（家/公司/宿舍…）HTTP 路由（REST）
'use strict';
const { validate, v } = require('../../core/auth');
const svc = require('./spaces.service');

function registerRoutes(router) {
  // 目录列表（含每份户型图）
  router.get('/api/spaces', (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    ctx.res.ok({ spaces: svc.listSpaces(ctx.user.id), activeSpaceId: svc.activeSpaceIdOf(ctx.user.id) });
  });

  // 新建目录（自动设为当前目录）
  router.post('/api/spaces', (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    const b = ctx.body || {};
    const errs = validate(b, { name: [v.required('目录名称必填'), v.maxLen(20)] });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const r = svc.createSpace(ctx.user.id, b.name);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, 409);
    ctx.res.ok({ space: r.space });
  });

  // 重命名目录
  router.put('/api/spaces/:id', (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    const b = ctx.body || {};
    const errs = validate(b, { name: [v.required('目录名称必填'), v.maxLen(20)] });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const r = svc.renameSpace(ctx.user.id, ctx.params.id, b.name);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, r.error === '目录不存在' ? 404 : 409);
    ctx.res.ok({ space: r.space });
  });

  // 删除目录（至少保留一个；删除当前目录自动切换）
  router.delete('/api/spaces/:id', (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    const r = svc.deleteSpace(ctx.user.id, ctx.params.id);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, r.error === '目录不存在' ? 404 : 409);
    ctx.res.ok();
  });

  // 保存目录户型图（layout 与 homeLayout 同构：房间数组）
  router.put('/api/spaces/:id/layout', (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    const b = ctx.body || {};
    const errs = validate(b, { homeLayout: [(val) => (val !== undefined && !Array.isArray(val) ? '户型图格式不正确' : null)] });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    const r = svc.saveSpaceLayout(ctx.user.id, ctx.params.id, b.homeLayout);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, 404);
    ctx.res.ok({ space: r.space });
  });

  // 切换当前目录（首页/画像页共用；返回最新用户信息供前端刷新）
  router.put('/api/spaces/:id/active', (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);
    const r = svc.setActiveSpace(ctx.user.id, ctx.params.id);
    if (r.error) return ctx.res.json({ ok: false, error: r.error }, 404);
    const accounts = require('../accounts/accounts.service');
    ctx.res.ok({ space: r.space, user: accounts.getPublicUser(ctx.user.id) });
  });
}

module.exports = { registerRoutes };