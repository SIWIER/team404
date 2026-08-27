// test/m5.integration.test.js — M5 全流程端到端集成测试（注册→画像→推理→记录→统计→硬件→导出→限流）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18086;
const TEST_DB = 'data/test_integration.db';
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

test('完整旅程：注册→画像户型→推理→记录→统计→导出', async () => {
  // 1 注册
  const uname = 'wangwu_' + Date.now().toString(36);
  const reg = await req('/api/auth/register', { method: 'POST', body: { username: uname, password: 'abcd1234', nickname: '王五' } });
  assert.strictEqual(reg.status, 200);
  const uid = reg.json.user.id;

  // 2 登录
  const login = await req('/api/auth/login', { method: 'POST', body: { username: uname, password: 'abcd1234' } });
  assert.strictEqual(login.status, 200);
  const token = login.json.token;

  // 3 更新画像（含户型：只有卧室+卫生间+玄关）
  const pf = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: {
      agentName: '王五的寻镜助手',
      habits: ['睡前把眼镜放玄关鞋柜上'],
      favoritePlaces: ['玄关/鞋柜'],
      homeLayout: [
        { name: '卧室', desc: '', spots: ['床头柜'] },
        { name: '卫生间', desc: '', spots: [] },
        { name: '玄关', desc: '有鞋柜', spots: ['鞋柜'] }
      ]
    }
  });
  assert.strictEqual(pf.status, 200);
  assert.strictEqual(pf.json.user.profile.agentName, '王五的寻镜助手');

  // 4 流程：房间选项来自户型（无客厅）
  const flow = await req('/api/reason/flow', { token });
  const roomOpts = flow.json.flow.find((q) => q.id === 'room').opts.map((o) => o[0]);
  assert.ok(!roomOpts.includes('客厅'));
  assert.ok(roomOpts.includes('玄关'));

  // 5 推理（本地引擎）
  const infer = await req('/api/reason/infer', { method: 'POST', token, body: { facts: { activity: '回家进门', room: '玄关' } } });
  assert.strictEqual(infer.status, 200);
  const result = infer.json.result;
  assert.ok(result.ranked.length >= 3);
  assert.ok(result.topLocation); // 回家进门+玄关 → 玄关/鞋柜 类位置靠前
  assert.ok(result.ranked.slice(0, 3).some((x) => x.name === '玄关/鞋柜' || x.name === '鞋柜'));

  // 6 记录找回成功（含对话转录）
  const rec = await req('/api/reason/record', {
    method: 'POST', token,
    body: {
      startedAt: new Date().toISOString(),
      foundLocation: '玄关/鞋柜', foundRoom: '玄关', confidence: result.confidence,
      success: true, facts: { activity: '回家进门' }, reasoning: result.summary, durationSec: 88,
      conversation: [{ q: '你最后记得在做什么？', a: '回家进门' }]
    }
  });
  assert.strictEqual(rec.status, 200);
  assert.ok(rec.json.id > 0);

  // 7 统计反映本次记录
  const stats = await req('/api/data/stats', { token });
  assert.strictEqual(stats.json.mine.total, 1);
  assert.strictEqual(stats.json.mine.topLocations[0].name, '玄关/鞋柜');
  assert.ok(stats.json.mine.insights.length >= 1);

  // 8 导出包含该记录
  const exp = await req('/api/data/export', { token });
  assert.strictEqual(exp.json.records.length, 1);
  assert.strictEqual(exp.json.user.username, uname);

  // 9 硬件联动：用户登记硬件后，定位器上报卫生间 → 推理以卫生间位置居首（强证据优先）
  await req('/api/auth/profile', { method: 'PUT', token, body: { hardware: ['case_locator'] } });
  await req('/api/hardware/devices/loc-01/report', { method: 'POST', token, body: { room: '卫生间', distance_m: 1.5 } });
  const infer2 = await req('/api/reason/infer', { method: 'POST', token, body: { facts: { activity: '不确定/忘记了' } } });
  const rooms = infer2.json.result.ranked.slice(0, 3).map((x) => x.room);
  assert.ok(rooms.every((r) => r === '卫生间'));

  // 10 删除记录 → 统计归零
  const list = await req('/api/data/records?limit=1', { token });
  const del = await req(`/api/data/records/${list.json.items[0].id}`, { method: 'DELETE', token });
  assert.strictEqual(del.status, 200);
  const stats2 = await req('/api/data/stats', { token });
  assert.strictEqual(stats2.json.mine.total, 0);
});

test('登录限流：连续错误尝试后返回 429', async () => {
  let saw429 = false;
  for (let i = 0; i < 30; i++) {
    const r = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: 'wrong-' + i } });
    if (r.status === 429) { saw429 = true; break; }
    assert.strictEqual(r.status, 401); // 错误密码 → 401
  }
  assert.ok(saw429, '应在连续尝试后触发 429 限流');
});
