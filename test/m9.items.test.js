// test/m9.items.test.js — 物品管理模块测试（P1：录入/文字检索/图片/删除/越权）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18095;   // 避开 m6 18087-18092、m7 18093/18094、m8 18085
const TEST_DB = 'data/test_items.db';
let serverProc = null;

function req(pathname, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = {}; try { json = JSON.parse(data); } catch {} resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
    await wait(100);
  }
  throw new Error('测试服务器启动超时');
});

after(() => { if (serverProc) serverProc.kill(); });

test('录入物品（含图片与三级位置）→ 检索命中 → 图片回读', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;

  const add = await req('/api/items', {
    method: 'POST', token,
    body: { name: '螺丝刀套装', desc: '蓝色手柄十字一字各一把', image: TINY_PNG, mimeType: 'image/png', room: '书房', furn: '书架', subPos: '一层' }
  });
  assert.strictEqual(add.status, 200);
  const item = add.json.item;
  assert.strictEqual(item.name, '螺丝刀套装');
  assert.strictEqual(item.location, '书房→书架→一层');
  assert.strictEqual(item.hasImage, true);

  // 文字检索（按名称/位置命中）
  const search = await req('/api/items?q=' + encodeURIComponent('螺丝刀'), { token });
  assert.strictEqual(search.status, 200);
  assert.ok(search.json.items.some((x) => x.id === item.id));
  const byRoom = await req('/api/items?q=' + encodeURIComponent('书架'), { token });
  assert.ok(byRoom.json.items.some((x) => x.id === item.id));

  // 图片回读
  const img = await req(`/api/items/${item.id}/image`, { token });
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.json.mimeType, 'image/png');
  assert.strictEqual(img.json.image, TINY_PNG);
});

test('录入校验：无名称且无图片 → 422；删除物品后检索不到、图片 404', async () => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const token = login.json.token;

  const bad = await req('/api/items', { method: 'POST', token, body: { room: '书房' } });
  assert.strictEqual(bad.status, 422);

  const add = await req('/api/items', {
    method: 'POST', token,
    body: { name: '临时物品', image: TINY_PNG, mimeType: 'image/png' }
  });
  const id = add.json.item.id;
  const del = await req(`/api/items/${id}`, { method: 'DELETE', token });
  assert.strictEqual(del.status, 200);
  const search = await req('/api/items?q=' + encodeURIComponent('临时物品'), { token });
  assert.ok(!search.json.items.some((x) => x.id === id));
  const img = await req(`/api/items/${id}/image`, { token });
  assert.strictEqual(img.status, 404);
});

test('越权：用户 B 检索/删除/取图不触及用户 A 的物品', async () => {
  const la = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  const add = await req('/api/items', {
    method: 'POST', token: la.json.token,
    body: { name: '小明的充电宝', image: TINY_PNG, mimeType: 'image/png', room: '卧室', furn: '床头柜', subPos: '抽屉' }
  });
  const id = add.json.item.id;

  const lb = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaohong', password: '123456' } });
  const listB = await req('/api/items?q=' + encodeURIComponent('充电宝'), { token: lb.json.token });
  assert.ok(!listB.json.items.some((x) => x.id === id), 'B 不应检索到 A 的物品');
  const delB = await req(`/api/items/${id}`, { method: 'DELETE', token: lb.json.token });
  assert.strictEqual(delB.status, 404);
  const imgB = await req(`/api/items/${id}/image`, { token: lb.json.token });
  assert.strictEqual(imgB.status, 404);

  // 清理
  await req(`/api/items/${id}`, { method: 'DELETE', token: la.json.token });
});
