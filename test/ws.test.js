// test/ws.test.js — WebSocket 实时通道测试（原始 socket 握手 + 广播接收）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18085;
const TEST_DB = 'data/test_ws.db';
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

// 极简 WS 测试客户端：握手 + 解析服务端文本帧
function wsClient(token) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const queue = [];
    const waiters = [];
    let frameCb = null;
    const api = {
      next: () => new Promise((res) => { if (queue.length) res(queue.shift()); else waiters.push(res); }),
      close: () => sock.destroy()
    };
    const push = (msg) => { if (waiters.length) waiters.shift()(msg); else queue.push(msg); };

    sock.on('connect', () => {
      sock.write(
        `GET /ws?token=${token} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString('utf8');
        if (!head.startsWith('HTTP/1.1 101')) { reject(new Error('握手被拒绝: ' + head.split('\r\n')[0])); sock.destroy(); return; }
        upgraded = true;
        buf = buf.subarray(idx + 4);
        resolve(api);
      }
      while (true) {
        if (buf.length < 2) break;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) break;
        const payload = buf.subarray(off, off + len).toString('utf8');
        buf = buf.subarray(off + len);
        if (opcode === 1) push(payload);
      }
    });
    sock.on('error', (e) => { if (!upgraded) reject(e); });
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

test('有效令牌：握手 101 并收到设备事件广播', async () => {
  const token = await loginAs('xiaoming');
  const client = await wsClient(token);
  // 触发一次模拟事件 → 服务端应广播 device_event
  await req('/api/hardware/simulate', { method: 'POST', token });
  const msg = await Promise.race([
    client.next(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('等待广播超时')), 5000))
  ]);
  const data = JSON.parse(msg);
  assert.strictEqual(data.type, 'device_event');
  assert.ok(data.event && data.event.device_id);
  client.close();
});

test('无效令牌：握手返回 401', async () => {
  await assert.rejects(wsClient('bad.token.here'), /握手被拒绝|401/);
});
