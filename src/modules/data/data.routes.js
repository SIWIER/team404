// src/modules/data/data.routes.js — 数据分析模块 HTTP 路由
'use strict';
const svc = require('./data.service');

function requireUser(ctx) {
  if (!ctx.user) { ctx.res.error('请先登录', 401); ctx.ended = true; return false; }
  return true;
}

function registerRoutes(router) {
  // 个人统计 + 全局统计
  router.get('/api/data/stats', (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.res.ok({ mine: svc.userStats(ctx.user.id), global: svc.globalStats() });
  });

  // 记录分页列表
  router.get('/api/data/records', (ctx) => {
    if (!requireUser(ctx)) return;
    const r = svc.listRecords(ctx.user.id, {
      limit: Number(ctx.query.limit) || 10,
      offset: Number(ctx.query.offset) || 0
    });
    ctx.res.ok(r);
  });

  // 删除单条记录（仅本人）
  router.delete('/api/data/records/:id', (ctx) => {
    if (!requireUser(ctx)) return;
    const ok = svc.deleteRecord(ctx.user.id, Number(ctx.params.id));
    if (!ok) return ctx.res.error('记录不存在', 404);
    ctx.res.ok();
  });

  // 数据导出（JSON 快照）
  router.get('/api/data/export', (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.res.json(svc.exportData(ctx.user.id));
  });

  // 数据导入
  router.post('/api/data/import', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    const r = svc.importData(ctx.user.id, b.records);
    if (r.error) return ctx.res.error(r.error, 422);
    ctx.res.ok(r);
  });
}

module.exports = { registerRoutes };
