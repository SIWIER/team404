// test/m4.hardware.test.js — M4 硬件接入端口端到端测试（LLM/模拟器关闭）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18084;
const TEST_DB = 'data/test_hardware.db';
let serverProc = null;

function req(pathname, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

async function loginAs(username) {
  const r = await req('/api/auth/login', { method: 'POST', body: { username, password: '123456' } });
  return r.json.token;
}

before(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, TEST_DB + suffix), { force: true }); } catch {}
  }
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: TEST_DB, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await req('/api/health'); if (r.status === 200) return; } catch {}
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('测试服务器启动超时');
});

after(() => { if (serverProc) serverProc.kill(); });

test('预置 3 台模拟设备', async () => {
  const token = await loginAs('xiaoming');
  const r = await req('/api/hardware/devices', { token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.devices.length, 3);
  assert.ok(r.json.devices.some((d) => d.type === 'locator'));
  assert.ok(r.json.devices.some((d) => d.type === 'nfc'));
  assert.ok(r.json.devices.some((d) => d.type === 'tag'));
});

test('注册设备成功 / 非法类型 422 / 重复 ID 422', async () => {
  const token = await loginAs('xiaoming');
  const ok = await req('/api/hardware/devices', { method: 'POST', token, body: { name: '我的防丢标签', type: 'tag', room: '书房' } });
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.json.device.id.startsWith('dev-'));
  const bad = await req('/api/hardware/devices', { method: 'POST', token, body: { name: 'x', type: 'laser' } });
  assert.strictEqual(bad.status, 422);
  const dup = await req('/api/hardware/devices', { method: 'POST', token, body: { id: ok.json.device.id, type: 'tag' } });
  assert.strictEqual(dup.status, 422);
});

test('上行上报：更新设备状态并产生事件', async () => {
  const token = await loginAs('xiaoming');
  const r = await req('/api/hardware/devices/loc-01/report', {
    method: 'POST', token,
    body: { room: '卫生间', distance_m: 1.2, rssi_dbm: -45, battery: 80 }
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.device.room, '卫生间');
  assert.strictEqual(r.json.device.lastSignal, 1.2);
  const ev = await req('/api/hardware/events?limit=5', { token });
  assert.ok(ev.json.events.some((e) => e.type === 'report' && e.device_id === 'loc-01'));
});

test('下行指令：locate 返回定位消息并更新设备', async () => {
  const token = await loginAs('xiaoming');
  const r = await req('/api/hardware/devices/loc-01/command', { method: 'POST', token, body: { command: 'locate' } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.message.includes('上报'));
  assert.ok(r.json.device.room);
});

test('下行指令：未知指令 404；未知设备 404', async () => {
  const token = await loginAs('xiaoming');
  const r1 = await req('/api/hardware/devices/nfc-01/command', { method: 'POST', token, body: { command: 'fly' } });
  assert.strictEqual(r1.status, 404);
  const r2 = await req('/api/hardware/devices/nope/command', { method: 'POST', token, body: { command: 'ping' } });
  assert.strictEqual(r2.status, 404);
});

test('删除设备成功，再删 404', async () => {
  const token = await loginAs('xiaoming');
  const reg = await req('/api/hardware/devices', { method: 'POST', token, body: { type: 'tag' } });
  const id = reg.json.device.id;
  const del = await req(`/api/hardware/devices/${id}`, { method: 'DELETE', token });
  assert.strictEqual(del.status, 200);
  const again = await req(`/api/hardware/devices/${id}`, { method: 'DELETE', token });
  assert.strictEqual(again.status, 404);
});

test('未登录访问硬件端口 → 401', async () => {
  const r = await req('/api/hardware/devices');
  assert.strictEqual(r.status, 401);
});

test('推理联动：定位器报告卧室 → 本地引擎以卧室位置居首', async () => {
  const token = await loginAs('xiaoming');
  await req('/api/hardware/devices/loc-01/report', { method: 'POST', token, body: { room: '卧室', distance_m: 2.3 } });
  const r = await req('/api/reason/infer', { method: 'POST', token, body: { facts: { activity: '不确定/忘记了' } } });
  assert.strictEqual(r.status, 200);
  const result = r.json.result;
  assert.strictEqual(result.engine, 'local-fallback');
  const top3Rooms = result.ranked.slice(0, 3).map((x) => x.room);
  assert.ok(top3Rooms.every((room) => room === '卧室'));
  assert.ok(result.ranked[0].reasons.some((t) => t.includes('定位器')));
});

test('真实设备指令轮询：下发 → pending → ack → 清空', async () => {
  const token = await loginAs('xiaoming');
  // 注册真实设备（is_mock=false）
  const reg = await req('/api/hardware/devices', {
    method: 'POST', token,
    body: { id: 'tag-real-01', name: '真实防丢标签', type: 'tag' }
  });
  assert.strictEqual(reg.status, 200);
  assert.strictEqual(reg.json.device.isMock, false);

  // 模拟设备：指令即时执行，pending 为空
  await req('/api/hardware/devices/nfc-01/command', { method: 'POST', token, body: { command: 'ping' } });
  const pendMock = await req('/api/hardware/devices/nfc-01/pending', { token });
  assert.strictEqual(pendMock.status, 200);
  assert.strictEqual(pendMock.json.command, null);

  // 真实设备：下发 beep → pending 返回该指令
  const cmd = await req('/api/hardware/devices/tag-real-01/command', { method: 'POST', token, body: { command: 'beep' } });
  assert.strictEqual(cmd.status, 200);
  assert.ok(cmd.json.message.includes('等待设备执行'));
  const pend1 = await req('/api/hardware/devices/tag-real-01/pending', { token });
  assert.ok(pend1.json.command);
  assert.strictEqual(pend1.json.command.command, 'beep');

  // ack 后 pending 清空
  const ack = await req('/api/hardware/devices/tag-real-01/ack', {
    method: 'POST', token, body: { eventId: pend1.json.command.id }
  });
  assert.strictEqual(ack.status, 200);
  const pend2 = await req('/api/hardware/devices/tag-real-01/pending', { token });
  assert.strictEqual(pend2.json.command, null);

  // 未知设备 404 / 错误 eventId 404
  const p404 = await req('/api/hardware/devices/nope/pending', { token });
  assert.strictEqual(p404.status, 404);
  const a404 = await req('/api/hardware/devices/tag-real-01/ack', { method: 'POST', token, body: { eventId: 999999 } });
  assert.strictEqual(a404.status, 404);
});

test('无硬件设备场景：清空设备后接口优雅降级', async () => {
  const token = await loginAs('xiaoming');
  // 清空全部设备
  const list = await req('/api/hardware/devices', { token });
  for (const d of list.json.devices) {
    const r = await req(`/api/hardware/devices/${d.id}`, { method: 'DELETE', token });
    assert.strictEqual(r.status, 200);
  }
  const empty = await req('/api/hardware/devices', { token });
  assert.strictEqual(empty.status, 200);
  assert.deepStrictEqual(empty.json.devices, []);
  // 模拟触发 → 404 无可用设备
  const sim = await req('/api/hardware/simulate', { method: 'POST', token });
  assert.strictEqual(sim.status, 404);
  assert.ok(sim.json.error.includes('没有可用设备'));
  // 上报不存在的设备 → 404
  const rep = await req('/api/hardware/devices/loc-01/report', { method: 'POST', token, body: { room: '卧室' } });
  assert.strictEqual(rep.status, 404);
  // 无设备时推理不受影响（无 deviceHint 注入，正常返回）
  const infer = await req('/api/reason/infer', { method: 'POST', token, body: { facts: { activity: '刚起床' } } });
  assert.strictEqual(infer.status, 200);
  assert.ok(infer.json.result.ranked.length >= 3);
});
