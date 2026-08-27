// test/m2.reason.test.js — M2 引导推理模块端到端测试（LLM 关闭，确定性验证）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18082;
const TEST_DB = 'data/test_reason.db';
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
    try { require('node:fs').rmSync(path.join(ROOT, TEST_DB + suffix), { force: true }); } catch {}
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

test('流程定义可获取且条件为声明式', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/flow', { token });
  assert.strictEqual(r.status, 200);
  const flow = r.json.flow;
  assert.ok(Array.isArray(flow) && flow.length >= 5);
  const bath = flow.find((q) => q.id === 'bathPlace');
  assert.deepStrictEqual(bath.showWhen, { field: 'activity', values: ['洗澡/冲凉', '洗漱/洗脸', '化妆/护肤'] });
});

test('流程房间选项按用户户型动态化（小明家无玄关/走廊）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/flow', { token });
  const roomQ = r.json.flow.find((q) => q.id === 'room');
  const rooms = roomQ.opts.map((o) => o[0]);
  assert.ok(rooms.includes('卧室'));
  assert.ok(rooms.includes('厨房/餐厅'));
  assert.ok(!rooms.includes('玄关'));
  assert.ok(!rooms.includes('走廊'));
  assert.ok(rooms.includes('不确定'));
});

test('无户型新用户：房间选项为默认全集（含走廊）', async () => {
  const uname = 'noroom_' + Date.now().toString(36);
  await req('/api/auth/register', { method: 'POST', body: { username: uname, password: 'abcd1234', nickname: '无户型' } });
  const login = await req('/api/auth/login', { method: 'POST', body: { username: uname, password: 'abcd1234' } });
  const r = await req('/api/reason/flow', { token: login.json.token });
  const roomQ = r.json.flow.find((q) => q.id === 'room');
  const rooms = roomQ.opts.map((o) => o[0]);
  assert.ok(rooms.includes('走廊'));
  assert.ok(rooms.includes('玄关'));
});

test('流程包含「路过房间」多选且选项来自户型', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/flow', { token });
  const q = r.json.flow.find((x) => x.id === 'passedRooms');
  assert.ok(q, '应存在 passedRooms 问题');
  assert.strictEqual(q.type, 'multi');
  const rooms = q.opts.map((o) => o[0]);
  assert.deepStrictEqual(rooms, ['卧室', '卫生间', '客厅', '厨房/餐厅', '书房']);
});

test('画像写入家庭布局并往返', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaohong', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [{ name: '阳台', desc: '封闭阳台', spots: ['晾衣架', '花架'] }] }
  });
  assert.strictEqual(r.status, 200);
  const me = await req('/api/auth/me', { token });
  assert.deepStrictEqual(me.json.user.profile.homeLayout, [{ name: '阳台', desc: '封闭阳台', spots: ['晾衣架', '花架'], x: null, y: null, cells: [] }]);
});

test('家庭布局格式非法 → 422', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaohong', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', { method: 'PUT', token, body: { homeLayout: '不是数组' } });
  assert.strictEqual(r.status, 422);
});

test('推理（本地引擎）：洗澡场景卫生间位置靠前', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/infer', {
    method: 'POST', token,
    body: { facts: { activity: '洗澡/冲凉', room: '卫生间', timeOfDay: '晚上', bathPlace: '置物架/镜柜' } }
  });
  assert.strictEqual(r.status, 200);
  const result = r.json.result;
  assert.strictEqual(result.engine, 'local-fallback');
  assert.ok(result.topLocation);
  assert.ok(result.ranked.length >= 3);
  assert.ok(result.summary.length > 10);
  const top3 = result.ranked.slice(0, 3).map((x) => x.name);
  assert.ok(top3.includes('浴室置物架/镜柜'));
});

test('未登录访问流程返回 401', async () => {
  const r = await req('/api/reason/flow');
  assert.strictEqual(r.status, 401);
});

test('记录找回成功 → 数据闭环', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/record', {
    method: 'POST', token,
    body: {
      startedAt: new Date().toISOString(),
      foundLocation: '床头柜', foundRoom: '卧室', confidence: 85, success: true,
      facts: { activity: '刚起床' }, reasoning: '测试', durationSec: 120,
      conversation: [{ q: '你最后记得在做什么？', a: '刚起床' }]
    }
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.id > 0);
});

test('记录未找到（负样本）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaohong', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/record', {
    method: 'POST', token,
    body: { startedAt: new Date().toISOString(), success: false, facts: {}, reasoning: '未找到', durationSec: 600 }
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.id > 0);
});

test('成功记录缺少位置 → 422', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/record', {
    method: 'POST', token,
    body: { success: true }
  });
  assert.strictEqual(r.status, 422);
});
test('流程包含「已检查区域」多选且选项来自户型', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/flow', { token });
  const q = r.json.flow.find((x) => x.id === 'checkedRooms');
  assert.ok(q, '应存在 checkedRooms 问题');
  assert.strictEqual(q.type, 'multi');
  const rooms = q.opts.map((o) => o[0]);
  assert.deepStrictEqual(rooms, ['卧室', '卫生间', '客厅', '厨房/餐厅', '书房']);
});

test('推理勾选已检查区域 → 该房间跌出首推', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/reason/infer', {
    method: 'POST', token,
    body: { facts: { activity: '洗澡/冲凉', room: '卫生间', timeOfDay: '晚上', checkedRooms: ['卫生间'] } }
  });
  assert.strictEqual(r.status, 200);
  const result = r.json.result;
  assert.notStrictEqual(result.topRoom, '卫生间');
  assert.strictEqual(result.ranked.find((x) => x.name === '洗手台边'), undefined, '已检查卫生间后洗手台边应跌出前 8');
  assert.ok(result.summary.includes('排除'));
});
test('复数同类型房间：户型编号保存、流程含编号选项、勾选编号房间推理排除', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaohong', password: '123456' } });
  const token = login.json.token;
  const pf = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [
      { name: '卧室', spots: ['床头柜'], x: 0, y: 0 },
      { name: '卧室', spots: ['梳妆台'], x: 1, y: 0 },
      { name: '客厅', spots: [], x: 2, y: 0 }
    ] }
  });
  assert.strictEqual(pf.status, 200);
  assert.deepStrictEqual(pf.json.user.profile.homeLayout.map((r) => r.name), ['卧室', '卧室2', '客厅']);
  const flow = await req('/api/reason/flow', { token });
  const roomOpts = flow.json.flow.find((q) => q.id === 'room').opts.map((o) => o[0]);
  const checkedOpts = flow.json.flow.find((q) => q.id === 'checkedRooms').opts.map((o) => o[0]);
  assert.ok(roomOpts.includes('卧室') && roomOpts.includes('卧室2'));
  assert.ok(checkedOpts.includes('卧室2'));
  const r = await req('/api/reason/infer', {
    method: 'POST', token,
    body: { facts: { room: '卧室2', checkedRooms: ['卧室2'] } }
  });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.result.summary.includes('卧室2'));
  assert.strictEqual(r.json.result.ranked.find((x) => x.name === '梳妆台'), undefined, '卧室2 放置点应跌出前 8');
});

test('无硬件用户不注入模拟定位提示；登记了硬件的用户才注入', async () => {
  // 制造一条新鲜的定位上报（模拟设备 loc-01 在服务器启动时已预置）
  const xm = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const xmToken = xm.json.token;
  const rep = await req('/api/hardware/devices/loc-01/report', {
    method: 'POST', token: xmToken, body: { room: '客厅', distance_m: 2.5, rssi_dbm: -50, battery: 80 }
  });
  assert.strictEqual(rep.status, 200);
  const facts = { activity: '看电视', room: '卧室' };

  // xiaoming 已登记硬件（seed 注入眼镜盒定位器）→ 应注入定位提示
  const r1 = await req('/api/reason/infer', { method: 'POST', token: xmToken, body: { facts } });
  assert.strictEqual(r1.status, 200);
  const hintInjected = r1.json.result.ranked.some((x) => (x.reasons || []).some((t) => t.includes('定位器')));
  assert.strictEqual(hintInjected, true, '有硬件用户的推理应包含定位器证据');

  // 新注册无硬件用户 → 即使全局有模拟设备上报，也不应注入
  const uname = 'nohw_' + Date.now();
  await req('/api/auth/register', { method: 'POST', body: { username: uname, password: 'abcd1234' } });
  const lg = await req('/api/auth/login', { method: 'POST', body: { username: uname, password: 'abcd1234' } });
  const r2 = await req('/api/reason/infer', { method: 'POST', token: lg.json.token, body: { facts } });
  assert.strictEqual(r2.status, 200);
  const nohwHint = r2.json.result.ranked.some((x) => (x.reasons || []).some((t) => t.includes('定位器')));
  assert.strictEqual(nohwHint, false, '无硬件用户的推理不应包含定位器证据');
});
