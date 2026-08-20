// test/m3.data.test.js — M3 数据统计与分析模块端到端测试（LLM 关闭）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18083;
const TEST_DB = 'data/test_data.db';
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
    env: { ...process.env, PORT: String(PORT), DB_FILE: TEST_DB, LLM_ENABLED: 'false' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await req('/api/health'); if (r.status === 200) return; } catch {}
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('测试服务器启动超时');
});

after(() => { if (serverProc) serverProc.kill(); });

test('统计接口：指标与图表数据完整', async () => {
  const token = await loginAs('xiaoming');
  const r = await req('/api/data/stats', { token });
  assert.strictEqual(r.status, 200);
  const m = r.json.mine;
  assert.strictEqual(m.total, 10);       // 种子记录
  assert.strictEqual(m.successRate, 100);
  assert.ok(m.topLocations.length >= 3);
  assert.ok(m.roomDist.length >= 3);
  assert.ok(m.timeline.length >= 3);
  assert.ok(m.timeDist.length >= 1);
  assert.ok(Array.isArray(m.insights) && m.insights.length >= 1);
  assert.ok(r.json.global.total >= 10);
});

test('记录分页', async () => {
  const token = await loginAs('xiaoming');
  const p1 = await req('/api/data/records?limit=5&offset=0', { token });
  assert.strictEqual(p1.json.total, 10);
  assert.strictEqual(p1.json.items.length, 5);
  const p2 = await req('/api/data/records?limit=5&offset=5', { token });
  assert.strictEqual(p2.json.items.length, 5);
  // 默认倒序（最新在前）
  assert.ok(p1.json.items[0].id > p2.json.items[0].id);
});

test('删除本人记录成功，删除他人记录 404', async () => {
  const token = await loginAs('xiaoming');
  const token2 = await loginAs('xiaohong');
  const list = await req('/api/data/records?limit=1', { token });
  const id = list.json.items[0].id;

  const delOther = await req(`/api/data/records/${id}`, { method: 'DELETE', token: token2 });
  assert.strictEqual(delOther.status, 404);

  const delOwn = await req(`/api/data/records/${id}`, { method: 'DELETE', token });
  assert.strictEqual(delOwn.status, 200);
  const stats = await req('/api/data/stats', { token });
  assert.strictEqual(stats.json.mine.total, 9);
});

test('导出：完整 JSON 快照', async () => {
  const token = await loginAs('xiaoming');
  const r = await req('/api/data/export', { token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.app, 'find-my-glasses');
  assert.ok(Array.isArray(r.json.records) && r.json.records.length >= 9);
  assert.strictEqual(r.json.user.username, 'xiaoming');
});

test('导入：合法记录入库并反映到统计', async () => {
  const token = await loginAs('xiaohong');
  const r = await req('/api/data/import', {
    method: 'POST', token,
    body: { records: [
      { startedAt: '2026-08-01T08:00:00', foundLocation: '洗衣机顶部', foundRoom: '卫生间', confidence: 70, success: true, durationSec: 100 },
      { startedAt: '2026-08-02T21:00:00', foundLocation: '', success: true }
    ] }
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.imported, 1);
  assert.strictEqual(r.json.skipped, 1);
  const stats = await req('/api/data/stats', { token });
  assert.strictEqual(stats.json.mine.total, 7); // 6 种子 + 1 导入
});

test('导入：非法输入 422', async () => {
  const token = await loginAs('xiaohong');
  const r1 = await req('/api/data/import', { method: 'POST', token, body: { records: 'bad' } });
  assert.strictEqual(r1.status, 422);
  const r2 = await req('/api/data/import', { method: 'POST', token, body: { records: new Array(300).fill({ foundLocation: 'x' }) } });
  assert.strictEqual(r2.status, 422);
});
