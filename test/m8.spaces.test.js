// test/m8.spaces.test.js — M8 目录（家/公司/宿舍…）模块端到端测试（node --test）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18085;
const TEST_DB = 'data/test_spaces.db';
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
  const fs = require('node:fs');
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, TEST_DB + suffix), { force: true }); } catch {}
  }
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: TEST_DB },
    stdio: 'ignore'
  });
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

async function registerUser(name) {
  const r = await req('/api/auth/register', {
    method: 'POST',
    body: { username: name, password: '123456', nickname: name }
  });
  assert.strictEqual(r.status, 200, '注册失败: ' + JSON.stringify(r.json));
  return r.json.user;
}

const rooms = (extra) => [{ name: '卧室', desc: '', spots: ['床头柜'], x: 0, y: 0, ...(extra || {}) }];

test('注册自动创建默认目录「家」并设为当前目录', async () => {
  const user = await registerUser('spaces_a');
  const p = user.profile;
  assert.ok(Array.isArray(p.spaces) && p.spaces.length === 1);
  assert.strictEqual(p.spaces[0].name, '家');
  assert.strictEqual(p.activeSpaceId, p.spaces[0].id);
  assert.deepStrictEqual(p.homeLayout, []);
});

test('未登录访问目录接口返回 401', async () => {
  const r = await req('/api/spaces');
  assert.strictEqual(r.status, 401);
});

async function login(name) {
  const r = await req('/api/auth/login', { method: 'POST', body: { username: name, password: '123456' } });
  assert.strictEqual(r.status, 200);
  return r.json.token;
}

test('新建目录自动设为当前目录；保存布局互不串扰', async () => {
  await registerUser('spaces_c');
  const token = await login('spaces_c');

  // 初始：只有「家」
  let r = await req('/api/spaces', { token });
  assert.strictEqual(r.status, 200);
  const homeId = r.json.spaces[0].id;
  assert.strictEqual(r.json.spaces.length, 1);

  // 给「家」保存布局
  r = await req('/api/spaces/' + homeId + '/layout', {
    method: 'PUT', token,
    body: { homeLayout: rooms({ cells: [{ x: 0, y: 0 }] }) }
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.space.layout[0].name, '卧室');

  // 新建「公司」→ 自动成为当前目录
  r = await req('/api/spaces', { method: 'POST', token, body: { name: '公司' } });
  assert.strictEqual(r.status, 200);
  const officeId = r.json.space.id;
  r = await req('/api/spaces', { token });
  assert.strictEqual(r.json.activeSpaceId, officeId);
  assert.strictEqual(r.json.spaces.length, 2);

  // 当前目录（公司）布局为空；给公司保存不同布局
  r = await req('/api/auth/me', { token });
  assert.deepStrictEqual(r.json.user.profile.homeLayout, []);
  r = await req('/api/spaces/' + officeId + '/layout', {
    method: 'PUT', token,
    body: { homeLayout: [{ name: '工位', desc: '', spots: ['显示器旁'], x: 1, y: 1, cells: [{ x: 1, y: 1 }] }] }
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.space.layout[0].name, '工位');

  // 「家」的布局不受影响
  r = await req('/api/spaces', { token });
  const home = r.json.spaces.find((s) => s.id === homeId);
  assert.strictEqual(home.layout[0].name, '卧室');
  // profile.homeLayout = 当前目录（公司）的布局
  r = await req('/api/auth/me', { token });
  assert.strictEqual(r.json.user.profile.homeLayout[0].name, '工位');
  assert.strictEqual(r.json.user.profile.activeSpaceId, officeId);
});

test('切换当前目录后 profile.homeLayout 同步', async () => {
  await registerUser('spaces_d');
  const token = await login('spaces_d');
  let r = await req('/api/spaces', { token });
  const homeId = r.json.spaces[0].id;

  // 新建「宿舍」并保存布局
  r = await req('/api/spaces', { method: 'POST', token, body: { name: '宿舍' } });
  const dormId = r.json.space.id;
  await req('/api/spaces/' + dormId + '/layout', {
    method: 'PUT', token,
    body: { homeLayout: rooms({ cells: [{ x: 5, y: 5 }] }) }
  });

  // 切回「家」
  r = await req('/api/spaces/' + homeId + '/active', { method: 'PUT', token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.profile.activeSpaceId, homeId);
  assert.deepStrictEqual(r.json.user.profile.homeLayout, []);

  // 通过旧接口 PUT /auth/profile homeLayout → 保存到当前目录（家）
  r = await req('/api/auth/profile', {
    method: 'PUT', token,
    body: { homeLayout: rooms({ cells: [{ x: 3, y: 3 }] }) }
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.profile.homeLayout[0].cells[0].x, 3);
  // 「宿舍」布局未变
  r = await req('/api/spaces', { token });
  const dorm = r.json.spaces.find((s) => s.id === dormId);
  assert.strictEqual(dorm.layout[0].cells[0].x, 5);
});

test('重命名：非法名 422、重名 409、成功改名', async () => {
  await registerUser('spaces_e');
  const token = await login('spaces_e');
  let r = await req('/api/spaces', { token });
  const id = r.json.spaces[0].id;

  r = await req('/api/spaces/' + id, { method: 'PUT', token, body: { name: '  ' } });
  assert.strictEqual(r.status, 422);

  await req('/api/spaces', { method: 'POST', token, body: { name: '办公室' } });
  r = await req('/api/spaces', { method: 'POST', token, body: { name: '办公室' } });
  assert.strictEqual(r.status, 409);

  r = await req('/api/spaces/' + id, { method: 'PUT', token, body: { name: '新家' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.space.name, '新家');
});

test('删除目录：最后一个受保护、删除当前目录自动切换、目录不存在 404', async () => {
  await registerUser('spaces_f');
  const token = await login('spaces_f');

  // 只有 1 个目录 → 删除被拒
  let r = await req('/api/spaces', { token });
  let id = r.json.spaces[0].id;
  r = await req('/api/spaces/' + id, { method: 'DELETE', token });
  assert.strictEqual(r.status, 409);

  // 新建 公司、宿舍，保存布局
  await req('/api/spaces', { method: 'POST', token, body: { name: '公司' } });
  await req('/api/spaces', { method: 'POST', token, body: { name: '宿舍' } });
  r = await req('/api/spaces', { token });
  const homeId = r.json.spaces.find((s) => s.name === '家').id;
  const officeId = r.json.spaces.find((s) => s.name === '公司').id;
  const dormId = r.json.spaces.find((s) => s.name === '宿舍').id;
  await req('/api/spaces/' + dormId + '/layout', {
    method: 'PUT', token,
    body: { homeLayout: rooms({ cells: [{ x: 7, y: 7 }] }) }
  });
  // 当前目录是宿舍（最后新建）
  r = await req('/api/spaces', { token });
  assert.strictEqual(r.json.activeSpaceId, dormId);

  // 删除当前目录（宿舍）→ 自动切到第一个（家）
  r = await req('/api/spaces/' + dormId, { method: 'DELETE', token });
  assert.strictEqual(r.status, 200);
  r = await req('/api/spaces', { token });
  assert.strictEqual(r.json.activeSpaceId, homeId);
  r = await req('/api/auth/me', { token });
  assert.deepStrictEqual(r.json.user.profile.homeLayout, []);

  // 删除不存在的目录 → 404
  r = await req('/api/spaces/99999', { method: 'DELETE', token });
  assert.strictEqual(r.status, 404);

  // 公司 可正常删除
  r = await req('/api/spaces/' + officeId, { method: 'DELETE', token });
  assert.strictEqual(r.status, 200);
});

test('注销账号同时删除全部目录', async () => {
  await registerUser('spaces_g');
  const token = await login('spaces_g');
  await req('/api/spaces', { method: 'POST', token, body: { name: '公司' } });
  let r = await req('/api/spaces', { token });
  assert.strictEqual(r.json.spaces.length, 2);

  r = await req('/api/auth/account', { method: 'DELETE', token });
  assert.strictEqual(r.status, 200);
  // 用户已删除：登录失败
  r = await req('/api/auth/login', { method: 'POST', body: { username: 'spaces_g', password: '123456' } });
  assert.strictEqual(r.status, 401);
});