// test/m1.accounts.test.js — M1 账户模块端到端测试（node --test）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18081; // 测试专用端口，避免与开发端口冲突
const TEST_DB = 'data/test_accounts.db';
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
    env: { ...process.env, PORT: String(PORT), DB_FILE: TEST_DB },
    stdio: 'ignore'
  });
  // 等待启动
  for (let i = 0; i < 50; i++) {
    try {
      const r = await req('/api/health');
      if (r.status === 200) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('测试服务器启动超时');
});

after(() => {
  if (serverProc) serverProc.kill();
});

test('健康检查', async () => {
  const r = await req('/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
});

test('登录成功返回令牌与中文画像', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456', remember: true } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.nickname, '小明');
  assert.strictEqual(r.json.user.profile.agentName, '小明的小镜助手');
  assert.ok(r.json.token.length > 50);
  assert.strictEqual(r.json.expiresInHours, 720);
  global.token = r.json.token;
});

test('错误密码返回 401', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: 'wrong' } });
  assert.strictEqual(r.status, 401);
});

test('注册校验：字段级错误 422', async () => {
  const r = await req('/api/auth/register', { method: 'POST', body: { username: 'a', password: '1', nickname: '' } });
  assert.strictEqual(r.status, 422);
  assert.ok(r.json.errors.username);
  assert.ok(r.json.errors.password);
});

test('注册 + 中文数据完整往返（无编码损坏）', async () => {
  const uname = 'test_' + Date.now().toString(36);
  const reg = await req('/api/auth/register', { method: 'POST', body: { username: uname, password: 'abcd1234', nickname: '张三' } });
  assert.strictEqual(reg.status, 200);
  assert.strictEqual(reg.json.user.nickname, '张三');
  assert.strictEqual(reg.json.user.profile.agentName, '张三的小镜助手');

  const login = await req('/api/auth/login', { method: 'POST', body: { username: uname, password: 'abcd1234' } });
  assert.strictEqual(login.status, 200);

  const pf = await req('/api/auth/profile', {
    method: 'PUT', token: login.json.token,
    body: { agentName: '张三专属智能体', agentStyle: '幽默又靠谱', habits: ['睡前刷手机'], favoritePlaces: ['床头柜'], notes: '近视 300 度' }
  });
  assert.strictEqual(pf.status, 200);
  assert.strictEqual(pf.json.user.profile.agentName, '张三专属智能体');
  assert.deepStrictEqual(pf.json.user.profile.favoritePlaces, ['床头柜']);

  // 再次读取，验证持久化
  const me = await req('/api/auth/me', { token: login.json.token });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.user.profile.agentName, '张三专属智能体');
  assert.strictEqual(me.json.user.profile.notes, '近视 300 度');
});

test('未登录访问受保护接口返回 401', async () => {
  const r = await req('/api/auth/me');
  assert.strictEqual(r.status, 401);
});

test('伪造令牌返回 401', async () => {
  const r = await req('/api/auth/me', { token: 'fake.token.here' });
  assert.strictEqual(r.status, 401);
});

test('家庭布局坐标 x/y 保存并往返（含四舍五入）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [
      { name: '卧室', spots: ['床头柜'], x: 2, y: 3 },
      { name: '卫生间', spots: [], x: 1.6, y: 0.2 },
      { name: '客厅', spots: [] }
    ] }
  });
  assert.strictEqual(r.status, 200);
  const hl = r.json.user.profile.homeLayout;
  assert.strictEqual(hl[0].x, 2);
  assert.strictEqual(hl[0].y, 3);
  assert.deepStrictEqual(hl[0].cells, [{ x: 2, y: 3 }]);
  assert.strictEqual(hl[1].x, 2);   // 1.6 四舍五入
  assert.strictEqual(hl[1].y, 0);   // 0.2 四舍五入
  assert.deepStrictEqual(hl[1].cells, [{ x: 2, y: 0 }]);
  assert.strictEqual(hl[2].x, null); // 未放置
  assert.strictEqual(hl[2].y, null);
  assert.deepStrictEqual(hl[2].cells, []);
});

test('走廊多格形状 cells 保存并往返（去重、裁剪）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [
      { name: '走廊', spots: [], cells: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }, { x: 99, y: 0 }] },
      { name: '卧室', spots: [], x: 0, y: 2 }
    ] }
  });
  assert.strictEqual(r.status, 200);
  const hl = r.json.user.profile.homeLayout;
  // 走廊：去重(2,2)与越界(99,0→5,0)处理
  assert.deepStrictEqual(hl[0].cells, [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 5, y: 0 }]);
  assert.strictEqual(hl[0].x, 1);
  assert.strictEqual(hl[0].y, 2);
  // 普通房间自动生成单格 cells
  assert.deepStrictEqual(hl[1].cells, [{ x: 0, y: 2 }]);
});

test('家庭布局超过 36 个房间被截断（与前端守卫一致）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const rooms = [];
  for (let i = 0; i < 40; i++) rooms.push({ name: '房间' + (i + 1), x: i % 6, y: Math.floor(i / 6) });
  const r = await req('/api/auth/profile', { method: 'PUT', token, body: { homeLayout: rooms } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.profile.homeLayout.length, 36);
});

test('家庭布局同名房间自动编号（卧室、卧室2…）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [
      { name: '卧室', spots: ['床头柜'], x: 0, y: 0 },
      { name: '卧室', spots: ['梳妆台'], x: 1, y: 0 },
      { name: '卫生间', spots: [] }
    ] }
  });
  assert.strictEqual(r.status, 200);
  const hl = r.json.user.profile.homeLayout;
  assert.deepStrictEqual(hl.map((x) => x.name), ['卧室', '卧室2', '卫生间']);
  assert.strictEqual(hl[0].x, 0);
  assert.strictEqual(hl[1].x, 1);
  assert.deepStrictEqual(hl[0].spots, ['床头柜']);
  assert.deepStrictEqual(hl[1].spots, ['梳妆台']);
});

test('家庭布局房间尺寸 w/h 保存并往返（仅提供时保留，夹在 1-12，四舍五入）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [
      { name: '卧室', x: 0, y: 0, w: 6, h: 8 },
      { name: '卫生间', x: 1, y: 1 },                 // 缺省 → 不返回 w/h 字段
      { name: '客厅', x: 2, y: 2, w: 99, h: 0 },      // 越界 → 夹到 12 / 1
      { name: '书房', x: 3, y: 3, w: 4.6, h: 7.4 }    // 四舍五入 → 5 / 7
    ] }
  });
  assert.strictEqual(r.status, 200);
  const hl = r.json.user.profile.homeLayout;
  assert.strictEqual(hl[0].w, 6);
  assert.strictEqual(hl[0].h, 8);
  assert.strictEqual(hl[1].w, undefined); // 缺省不注入
  assert.strictEqual(hl[1].h, undefined);
  assert.strictEqual(hl[2].w, 12); // 99 越界夹到 12
  assert.strictEqual(hl[2].h, 1);  // 0 越界夹到 1
  assert.strictEqual(hl[3].w, 5);  // 4.6 四舍五入
  assert.strictEqual(hl[3].h, 7);  // 7.4 四舍五入
});

test('家庭布局房间家具 furn 保存并往返（非法/越界剔除，无 furn 省略）', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;
  const r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: [
      { name: '卧室', x: 0, y: 0, w: 6, h: 6, furn: [
        { name: '床', x: 1, y: 1 },
        { name: '床', x: 2, y: 1 },
        { name: '柜子', x: 0, y: 0 },
        { name: '', x: 3, y: 3 },          // 空名 → 剔除
        { name: '桌子', x: 99, y: 2 },     // 越界 → 剔除
        { name: '架子', x: 1.6, y: 2.4 }   // 四舍五入 → (2,2)
      ] },
      { name: '客厅', x: 1, y: 1 }         // 无 furn → 不返回 furn 字段
    ] }
  });
  assert.strictEqual(r.status, 200);
  const hl = r.json.user.profile.homeLayout;
  assert.deepStrictEqual(hl[0].furn, [
    { name: '床', x: 1, y: 1 },
    { name: '床', x: 2, y: 1 },
    { name: '柜子', x: 0, y: 0 },
    { name: '架子', x: 2, y: 2 }
  ]);
  assert.strictEqual(hl[1].furn, undefined);
});
