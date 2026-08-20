// src/modules/reason/reason.routes.js — 引导推理模块 HTTP 路由
'use strict';
const { FLOW } = require('./knowledge');
const accounts = require('../accounts/accounts.service');
const svc = require('./reason.service');

const ROOM_EMOJI = {
  '卧室': '🛏️', '卫生间': '🛁', '客厅': '🛋️', '厨房': '🍳', '餐厅': '🍽️',
  '厨房/餐厅': '🍳', '书房': '📚', '玄关': '🚪', '走廊': '🚶', '阳台': '🪴', '衣帽间': '👔', '储物间': '📦'
};

function requireUser(ctx) {
  if (!ctx.user) { ctx.res.error('请先登录', 401); ctx.ended = true; return false; }
  return true;
}

function registerRoutes(router) {
  // 引导问答流程定义（含条件化问题；房间/路过房间选项按用户户型动态化）
  router.get('/api/reason/flow', (ctx) => {
    if (!requireUser(ctx)) return;
    const flow = FLOW.map((q) => ({ ...q }));
    const profile = accounts.getPublicUser(ctx.user.id).profile;
    const layout = Array.isArray(profile.homeLayout) ? profile.homeLayout : [];
    if (layout.length) {
      const roomQ = flow.find((q) => q.id === 'room');
      if (roomQ) {
        roomQ.opts = layout
          .map((r) => [r.name, ROOM_EMOJI[r.name] || '🏠'])
          .concat([['不确定', '🤔']]);
      }
      const passedQ = flow.find((q) => q.id === 'passedRooms');
      if (passedQ) {
        passedQ.opts = layout.map((r) => [r.name, ROOM_EMOJI[r.name] || '🏠']);
      }
    }
    ctx.res.ok({ flow });
  });

  // 推理：facts 为问答收集的事实
  router.post('/api/reason/infer', async (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    const facts = b.facts && typeof b.facts === 'object' ? b.facts : {};
    // 事实字段大小限制，防止异常输入
    for (const k of Object.keys(facts)) {
      if (typeof facts[k] === 'string' && facts[k].length > 500) facts[k] = facts[k].slice(0, 500);
    }
    if (Array.isArray(facts.passedRooms)) {
      facts.passedRooms = facts.passedRooms.slice(0, 10).map((s) => String(s).slice(0, 30));
    }
    const result = await svc.infer(ctx.user.id, facts);
    ctx.res.ok({ result });
  });

  // 记录找回结果（成功/失败）
  router.post('/api/reason/record', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    if (b.success && !b.foundLocation) return ctx.res.error('成功找回时必须填写位置', 422);
    const r = svc.record(ctx.user.id, {
      startedAt: b.startedAt,
      foundLocation: b.foundLocation,
      foundRoom: b.foundRoom,
      confidence: b.confidence,
      success: !!b.success,
      facts: b.facts,
      reasoning: b.reasoning,
      durationSec: b.durationSec,
      conversation: b.conversation
    });
    ctx.res.ok({ id: r.id });
  });
}

module.exports = { registerRoutes };
