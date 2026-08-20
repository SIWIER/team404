// src/modules/hardware/hardware.service.js — 硬件接入业务逻辑（设备/上报/指令/事件/模拟器）
'use strict';
const { getDb } = require('../../core/db');
const config = require('../../config');
const logger = require('../../core/logger');
const ws = require('../../core/ws');

const DEVICE_TYPES = { locator: '定位器', nfc: '近场呼唤器', tag: '防丢标签' };
const ROOMS = ['卧室', '卫生间', '客厅', '厨房/餐厅', '书房', '玄关', '走廊'];

function now() { return new Date().toISOString(); }
function publicDevice(d) {
  return {
    id: d.id, name: d.name, type: d.type, typeLabel: DEVICE_TYPES[d.type] || d.type,
    room: d.room, battery: d.battery, status: d.status,
    lastSeen: d.last_seen, lastSignal: d.last_signal, registeredAt: d.registered_at
  };
}

// ---------- 设备管理 ----------
function seedDevices() {
  const db = getDb();
  if (db.prepare('SELECT COUNT(*) AS c FROM devices').get().c > 0) return;
  const defaults = [
    { id: 'loc-01', name: '眼镜定位器 GL-Finder Pro', type: 'locator', room: '卧室', battery: 86 },
    { id: 'nfc-01', name: '近场呼唤器 NFC-Buzz', type: 'nfc', room: '卧室', battery: 72 },
    { id: 'tag-01', name: '防丢标签 Tag-Beep', type: 'tag', room: '客厅', battery: 64, status: 'offline' }
  ];
  const ins = db.prepare(`INSERT INTO devices (id, name, type, room, battery, status, last_seen, registered_at)
                          VALUES (?,?,?,?,?,?,?,?)`);
  for (const d of defaults) ins.run(d.id, d.name, d.type, d.room, d.battery, d.status || 'online', now(), now());
  logger.info('[hardware] 已预置 3 台模拟设备');
}

function listDevices() {
  const db = getDb();
  return db.prepare('SELECT * FROM devices ORDER BY type, id').all().map(publicDevice);
}

function getDevice(id) {
  const db = getDb();
  const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  return d ? publicDevice(d) : null;
}

function registerDevice({ id, name, type, room }) {
  const db = getDb();
  if (!DEVICE_TYPES[type]) return { error: '设备类型必须是 locator/nfc/tag 之一' };
  const devId = String(id || '').trim() || ('dev-' + Math.random().toString(36).slice(2, 8));
  if (!/^[\w-]{2,32}$/.test(devId)) return { error: '设备 ID 需 2-32 位（字母/数字/-/_）' };
  const exists = db.prepare('SELECT id FROM devices WHERE id = ?').get(devId);
  if (exists) return { error: '设备 ID 已存在' };
  const ts = now();
  db.prepare(`INSERT INTO devices (id, name, type, room, battery, status, last_seen, registered_at)
              VALUES (?,?,?,?,100,'online',?,?)`)
    .run(devId, String(name || '').trim().slice(0, 40) || devId, type, String(room || '').trim() || null, ts, ts);
  return { device: getDevice(devId) };
}

function removeDevice(id) {
  const db = getDb();
  const info = db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  return info.changes > 0;
}

// ---------- 事件 ----------
function addEvent(deviceId, type, payload) {
  const db = getDb();
  const info = db.prepare('INSERT INTO device_events (device_id, ts, type, payload) VALUES (?,?,?,?)')
    .run(deviceId, now(), type, JSON.stringify(payload));
  const event = db.prepare('SELECT * FROM device_events WHERE id = ?').get(Number(info.lastInsertRowid));
  return event;
}

function listEvents(limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM device_events ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 50, 1), 200));
}

function broadcastEvent(event) {
  ws.broadcast({ type: 'device_event', event: { ...event, payload: (() => { try { return JSON.parse(event.payload); } catch { return {}; } })() } });
}
function broadcastDevice(device) {
  ws.broadcast({ type: 'device_update', device });
}

// ---------- 上行：设备数据上报（真实硬件的接入契约） ----------
// report: { room?, distance_m?, rssi_dbm?, battery? }
function applyReport(deviceId, report) {
  const db = getDb();
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return { ok: false, error: '设备不存在' };
  const room = String(report.room || '').trim() || dev.room || '未知';
  const distance = Number(report.distance_m);
  const rssi = Number(report.rssi_dbm);
  const battery = Number(report.battery);
  const ts = now();
  db.prepare(`UPDATE devices SET room=?, battery=?, status='online', last_seen=?, last_signal=? WHERE id=?`)
    .run(room, Number.isFinite(battery) ? Math.min(100, Math.max(0, Math.round(battery))) : dev.battery, ts,
         Number.isFinite(distance) ? Math.round(distance * 10) / 10 : null, deviceId);
  const event = addEvent(deviceId, 'report', {
    room, distance_m: Number.isFinite(distance) ? Math.round(distance * 10) / 10 : null,
    rssi_dbm: Number.isFinite(rssi) ? Math.round(rssi) : null,
    battery: Number.isFinite(battery) ? Math.round(battery) : null
  });
  const device = getDevice(deviceId);
  broadcastEvent(event);
  broadcastDevice(device);
  const msg = `📡 ${dev.name} 上报：位于「${room}」${Number.isFinite(distance) ? `，距离约 ${Math.round(distance * 10) / 10} 米` : ''}`;
  return { ok: true, message: msg, event: { ...event, payload: JSON.parse(event.payload) }, device };
}

// ---------- 下行：指令（真实设备可订阅此端口执行动作；演示为模拟响应） ----------
// command: 'locate' | 'ping' | 'beep'
function sendCommand(deviceId, command) {
  const db = getDb();
  const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!dev) return { ok: false, error: '设备不存在' };
  addEvent(deviceId, 'command', { command });

  if (command === 'locate') {
    const room = ROOMS[Math.floor(Math.random() * ROOMS.length)];
    const distance = Math.round((0.5 + Math.random() * 4.5) * 10) / 10;
    const rssi = Math.round(-30 - distance * 12 - Math.random() * 8);
    return applyReport(deviceId, { room, distance_m: distance, rssi_dbm: rssi, battery: Math.max(5, dev.battery - 1) });
  }
  if (command === 'ping') {
    const inRange = Math.random() > 0.25;
    const distance = inRange ? Math.round((0.3 + Math.random() * 3.5) * 10) / 10 : null;
    const ts = now();
    if (inRange) {
      db.prepare(`UPDATE devices SET status='online', last_seen=?, last_signal=? WHERE id=?`).run(ts, distance, deviceId);
    } else {
      db.prepare(`UPDATE devices SET status='online', last_seen=? WHERE id=?`).run(ts, deviceId);
    }
    const event = addEvent(deviceId, 'ping_result', { inRange, distance_m: distance });
    const device = getDevice(deviceId);
    broadcastEvent(event);
    broadcastDevice(device);
    const msg = inRange
      ? `🔊 ${dev.name} 应答：在附近约 ${distance} 米处，请循声查找！`
      : `🔇 ${dev.name} 未应答，可能超出近场范围（>5 米），建议结合引导推理继续寻找。`;
    return { ok: true, message: msg, event: { ...event, payload: JSON.parse(event.payload) }, device };
  }
  if (command === 'beep') {
    const room = dev.room || '未知';
    const event = addEvent(deviceId, 'beep', { room });
    const device = getDevice(deviceId);
    broadcastEvent(event);
    broadcastDevice(device);
    return { ok: true, message: `🔔 已向「${room}」方向发送蜂鸣指令，请静下心循声查找。`, event: { ...event, payload: JSON.parse(event.payload) }, device };
  }
  return { ok: false, error: '未知指令（支持 locate/ping/beep）' };
}

// ---------- 定位提示（供推理引擎联动） ----------
function getLastHint() {
  const db = getDb();
  const row = db.prepare(`
    SELECT e.*, d.name FROM device_events e JOIN devices d ON d.id = e.device_id
    WHERE d.type = 'locator' AND e.type = 'report'
    ORDER BY e.id DESC LIMIT 1`).get();
  if (!row) return null;
  const age = Date.now() - new Date(row.ts).getTime();
  if (age > config.hardware.hintFreshMs) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload); } catch {}
  if (!payload.room) return null;
  return { room: payload.room, distance_m: payload.distance_m, ts: row.ts, device: row.name, ageSec: Math.round(age / 1000) };
}

// ---------- 模拟器（演示用：周期性模拟设备活动） ----------
function simulateTick() {
  const devices = listDevices().filter((d) => d.type !== 'tag' || Math.random() > 0.5);
  if (!devices.length) return null;
  const dev = devices[Math.floor(Math.random() * devices.length)];
  const cmds = dev.type === 'locator' ? ['locate'] : dev.type === 'nfc' ? ['ping', 'beep'] : ['ping', 'beep'];
  const cmd = cmds[Math.floor(Math.random() * cmds.length)];
  const r = sendCommand(dev.id, cmd);
  logger.info(`[hardware][sim] ${dev.id} ${cmd} → ${r.ok ? 'ok' : r.error}`);
  return r;
}

function startSimulator() {
  if (!config.hardware.simulatorEnabled) {
    logger.info('[hardware] 模拟器未启用（SIMULATOR_ENABLED=false）');
    return;
  }
  const t = setInterval(() => {
    try { simulateTick(); } catch (e) { logger.error('[hardware][sim]', e.message); }
  }, config.hardware.simulatorIntervalMs);
  t.unref();
  logger.info(`[hardware] 模拟器已启动（每 ${config.hardware.simulatorIntervalMs}ms 一次）`);
}

module.exports = {
  DEVICE_TYPES, ROOMS, seedDevices, listDevices, getDevice, registerDevice, removeDevice,
  applyReport, sendCommand, listEvents, getLastHint, simulateTick, startSimulator
};
