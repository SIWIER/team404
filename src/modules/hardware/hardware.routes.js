// src/modules/hardware/hardware.routes.js — 硬件接入端口 HTTP 路由
'use strict';
const svc = require('./hardware.service');

function requireUser(ctx) {
  if (!ctx.user) { ctx.res.error('请先登录', 401); ctx.ended = true; return false; }
  return true;
}

function registerRoutes(router) {
  // 设备列表 + 最近事件
  router.get('/api/hardware/devices', (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.res.ok({ devices: svc.listDevices(), events: svc.listEvents(50) });
  });

  // 注册设备（真实硬件接入第一步）
  router.post('/api/hardware/devices', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    const r = svc.registerDevice({ id: b.id, name: b.name, type: b.type, room: b.room });
    if (r.error) return ctx.res.error(r.error, 422);
    ctx.res.ok({ device: r.device });
  });

  // 删除设备
  router.delete('/api/hardware/devices/:id', (ctx) => {
    if (!requireUser(ctx)) return;
    if (!svc.removeDevice(ctx.params.id)) return ctx.res.error('设备不存在', 404);
    ctx.res.ok();
  });

  // 【上行端口】设备数据上报：真实设备 POST {room, distance_m, rssi_dbm, battery}
  router.post('/api/hardware/devices/:id/report', (ctx) => {
    if (!requireUser(ctx)) return;
    const r = svc.applyReport(ctx.params.id, ctx.body || {});
    if (!r.ok) return ctx.res.error(r.error, 404);
    ctx.res.ok({ message: r.message, event: r.event, device: r.device });
  });

  // 【下行端口】指令下发：{command: 'locate'|'ping'|'beep'}
  router.post('/api/hardware/devices/:id/command', (ctx) => {
    if (!requireUser(ctx)) return;
    const r = svc.sendCommand(ctx.params.id, (ctx.body || {}).command);
    if (!r.ok) return ctx.res.error(r.error, 404);
    ctx.res.ok({ message: r.message, event: r.event, device: r.device });
  });

  // 【设备轮询】真实设备拉取待执行指令
  router.get('/api/hardware/devices/:id/pending', (ctx) => {
    if (!requireUser(ctx)) return;
    if (!svc.getDevice(ctx.params.id)) return ctx.res.error('设备不存在', 404);
    const command = svc.getPendingCommand(ctx.params.id);
    ctx.res.ok({ command });
  });

  // 【设备确认】设备执行完指令后回报
  router.post('/api/hardware/devices/:id/ack', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    if (!svc.ackCommand(ctx.params.id, b.eventId)) return ctx.res.error('指令不存在', 404);
    ctx.res.ok();
  });

  // 事件日志
  router.get('/api/hardware/events', (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.res.ok({ events: svc.listEvents(Number(ctx.query.limit) || 50) });
  });

  // 演示用：触发一次模拟事件
  router.post('/api/hardware/simulate', (ctx) => {
    if (!requireUser(ctx)) return;
    const r = svc.simulateTick();
    if (!r) return ctx.res.error('没有可用设备', 404);
    ctx.res.ok({ message: r.message, event: r.event });
  });
}

module.exports = { registerRoutes };
