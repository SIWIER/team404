// src/modules/items/items.routes.js — 物品管理 HTTP 路由（REST）
'use strict';
const { validate, v } = require('../../core/auth');
const svc = require('./items.service');

function requireUser(ctx) {
  if (!ctx.user) { ctx.res.error('请先登录', 401); ctx.ended = true; return false; }
  return true;
}

function registerRoutes(router) {
  // 录入物品（图片 base64 + 三级位置；名称可空，由前端图文识别预填）
  router.post('/api/items', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    const errs = validate(b, {
      name: [v.maxLen(40)],
      desc: [v.maxLen(200)],
      room: [v.maxLen(20)],
      furn: [v.maxLen(20)],
      subPos: [v.maxLen(20)]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    if (!b.name && !b.image) return ctx.res.error('请填写物品名称或上传照片', 422);
    const item = svc.addItem(ctx.user.id, b);
    ctx.res.ok({ item });
  });

  // 检索（文字）：?q=关键词&space_id=可选目录
  router.get('/api/items', (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.res.ok({ items: svc.listItems(ctx.user.id, { q: ctx.query.q, spaceId: ctx.query.space_id }) });
  });

  // 物品图片（base64 JSON，前端拼 data URL）
  router.get('/api/items/:id/image', (ctx) => {
    if (!requireUser(ctx)) return;
    const img = svc.imageBase64(ctx.user.id, ctx.params.id);
    if (!img) return ctx.res.error('物品不存在或无图片', 404);
    ctx.res.ok(img);
  });

  // 删除物品（连同图片文件）
  router.delete('/api/items/:id', (ctx) => {
    if (!requireUser(ctx)) return;
    if (!svc.deleteItem(ctx.user.id, ctx.params.id)) return ctx.res.error('物品不存在', 404);
    ctx.res.ok();
  });
}

module.exports = { registerRoutes };
