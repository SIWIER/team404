// test/m6.wxauth.test.js — 微信一键登录 / 账号绑定端到端测试（mock 微信接口）
// 覆盖：① 绑定登录（已绑定 openid）② 自动注册 ③ needBind 后正确密码绑定 ④ 错误 code ⑤ 重复绑定
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18087; // 测试专用端口
const TEST_DB = 'data/test_wxauth.db';
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
    // WX_MOCK_OPENID + LLM_ENABLED=false + SIMULATOR_ENABLED=false：完全离线可跑
    env: {
      ...process.env, PORT: String(PORT), DB_FILE: TEST_DB,
      LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false',
      WX_MOCK_OPENID: 'mock_openid_for_test_zzz',
      WX_AUTO_REGISTER: 'true'
    },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await req('/api/health'); if (r.status === 200) return; } catch {}
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('测试服务器启动超时');
});

after(() => { if (serverProc) serverProc.kill(); });

// ---------- 基础探测 ----------
test('wxconfig 探测：mock 启用时返回 enabled=true', async () => {
  const r = await req('/api/auth/wxconfig');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.ok, true);
  assert.strictEqual(r.json.enabled, true);
  assert.strictEqual(r.json.autoRegister, true);
});

test('wxlogin：缺 code 返回 422', async () => {
  const r = await req('/api/auth/wxlogin', { method: 'POST', body: {} });
  assert.strictEqual(r.status, 422);
  assert.ok(r.json.errors && r.json.errors.code);
});

test('wxlogin：错误 code 由 code2session 透传（这里 mock 永远 ok）', async () => {
  // 由于我们走 WX_MOCK_OPENID，不走真实 code2session，无法直接验证微信错误
  // 这里验证一个 happy path：code 任意值，mock 下都成功
  const r = await req('/api/auth/wxlogin', { method: 'POST', body: { code: 'fake_code' } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.token);
  assert.strictEqual(r.json.mode, 'autoRegister');
  assert.ok(r.json.user && r.json.user.id > 0);
  // 昵称应符合「微信用户xxxx」
  assert.ok(/^微信用户/.test(r.json.user.nickname));
});

// ---------- 场景 ① 绑定登录（已绑定 openid） ----------
test('场景①：未绑定 openid + WX_AUTO_REGISTER=false → needBind → wxbind 成功后 wxlogin → mode=login', async () => {
  // 独立子服务（mock_openid_first_bind）：完整跑一遍 bind 流程并验证"已绑定后 wxlogin 直接登录"
  const fs = require('node:fs');
  const subPort = 18092;
  const subDb = 'data/test_wxauth_bound.db';
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch {}
  }
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(subPort), DB_FILE: subDb, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false', WX_MOCK_OPENID: 'mock_already_bound', WX_AUTO_REGISTER: 'false' },
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await new Promise((res, rej) => {
        const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/health' }, (resp) => { resp.resume(); resp.on('end', () => res({ status: resp.statusCode })); });
        rq.on('error', rej); rq.end();
      }); if (r.status === 200) break; } catch {}
      await new Promise((res) => setTimeout(res, 100));
    }
    const post = (path, body) => new Promise((res, rej) => {
      const data = JSON.stringify(body);
      const rq = http.request({ host: '127.0.0.1', port: subPort, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });

    const uname = 'bindme_' + Date.now().toString(36);
    const reg = await post('/api/auth/register', { username: uname, password: 'abcd1234', nickname: '待绑' });
    assert.strictEqual(reg.status, 200);

    // 1) wxlogin → needBind
    const login1 = await post('/api/auth/wxlogin', { code: 'any' });
    assert.strictEqual(login1.status, 200);
    assert.strictEqual(login1.json.needBind, true);
    assert.ok(login1.json.bindToken);

    // 2) wxbind 绑定
    const bind = await post('/api/auth/wxbind', { bindToken: login1.json.bindToken, username: uname, password: 'abcd1234' });
    assert.strictEqual(bind.status, 200);
    assert.ok(bind.json.token);
    assert.strictEqual(bind.json.user.username, uname);

    // 3) 再次 wxlogin：openid 已绑定 → mode=login 直接登录
    const login2 = await post('/api/auth/wxlogin', { code: 'any' });
    assert.strictEqual(login2.status, 200);
    assert.strictEqual(login2.json.mode, 'login');
    assert.strictEqual(login2.json.user.username, uname);
    assert.ok(login2.json.token);
  } finally {
    proc.kill();
  }
});

// ---------- 场景 ② 自动注册 ----------
test('场景②：未绑定 openid + WX_AUTO_REGISTER=true → mode=autoRegister 自动建号', async () => {
  // 用一个独立的测试服务器实例（不同 WX_MOCK_OPENID + 独立 DB）
  // 这里直接验证场景①之前的"fake_code"调用：mode=autoRegister 即为该场景
  // 为更清晰，本测试启动一个独立子进程
  const fs = require('node:fs');
  const subPort = 18088;
  const subDb = 'data/test_wxauth_auto.db';
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch {}
  }
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(subPort), DB_FILE: subDb, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false', WX_MOCK_OPENID: 'mock_for_auto', WX_AUTO_REGISTER: 'true' },
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await new Promise((res, rej) => {
        const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/health' }, (resp) => { resp.resume(); resp.on('end', () => res({ status: resp.statusCode })); });
        rq.on('error', rej); rq.end();
      }); if (r.status === 200) break; } catch {}
      await new Promise((res) => setTimeout(res, 100));
    }
    const r = await new Promise((res, rej) => {
      const data = JSON.stringify({ code: 'any' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxlogin', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.mode, 'autoRegister');
    assert.ok(r.json.user);
    assert.ok(/^wx_/.test(r.json.user.username));
    // 再次调用，openid 已绑定 → 应转为 login
    const r2 = await new Promise((res, rej) => {
      const data = JSON.stringify({ code: 'any' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxlogin', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.json.mode, 'login');
    assert.strictEqual(r2.json.user.username, r.json.user.username);
  } finally {
    proc.kill();
  }
});

// ---------- 场景 ③ needBind → 正确密码绑定 ----------
test('场景③：未绑定 openid + WX_AUTO_REGISTER=false → needBind + 正确密码绑定成功', async () => {
  const fs = require('node:fs');
  const subPort = 18089;
  const subDb = 'data/test_wxauth_bind.db';
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch {}
  }
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(subPort), DB_FILE: subDb, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false', WX_MOCK_OPENID: 'mock_for_bind', WX_AUTO_REGISTER: 'false' },
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await new Promise((res, rej) => {
        const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/health' }, (resp) => { resp.resume(); resp.on('end', () => res({ status: resp.statusCode })); });
        rq.on('error', rej); rq.end();
      }); if (r.status === 200) break; } catch {}
      await new Promise((res) => setTimeout(res, 100));
    }
    // 准备：先注册一个老用户
    const uname = 'olduser_' + Date.now().toString(36);
    const reg = await new Promise((res, rej) => {
      const data = JSON.stringify({ username: uname, password: 'abcd1234', nickname: '老用户' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/register', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(reg.status, 200);

    // 1) wxlogin → needBind
    const login1 = await new Promise((res, rej) => {
      const data = JSON.stringify({ code: 'any' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxlogin', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(login1.status, 200);
    assert.strictEqual(login1.json.needBind, true);
    assert.ok(login1.json.bindToken);
    assert.ok(login1.json.bindTokenExpiresInSec > 0);

    // 2) wxbind 用错误密码 → 401
    const bindBad = await new Promise((res, rej) => {
      const data = JSON.stringify({ bindToken: login1.json.bindToken, username: uname, password: 'wrong-pw' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxbind', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(bindBad.status, 401);
    assert.ok(/密码错误/.test(bindBad.json.error || ''));

    // 3) wxbind 用正确密码 → 200 + token + user
    const bindOk = await new Promise((res, rej) => {
      const data = JSON.stringify({ bindToken: login1.json.bindToken, username: uname, password: 'abcd1234' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxbind', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(bindOk.status, 200);
    assert.ok(bindOk.json.token);
    assert.strictEqual(bindOk.json.user.username, uname);

    // 4) 再次 wxlogin → mode=login（openid 已绑该用户）
    const login2 = await new Promise((res, rej) => {
      const data = JSON.stringify({ code: 'any' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxlogin', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(login2.status, 200);
    assert.strictEqual(login2.json.mode, 'login');
    assert.strictEqual(login2.json.user.username, uname);
  } finally {
    proc.kill();
  }
});

// ---------- 场景 ④ bindToken 无效/过期 ----------
test('场景④：bindToken 伪造或缺失 → 422；缺字段 → 422', async () => {
  const bad1 = await req('/api/auth/wxbind', { method: 'POST', body: { bindToken: 'fake.token', username: 'x', password: 'x' } });
  assert.strictEqual(bad1.status, 422);
  const bad2 = await req('/api/auth/wxbind', { method: 'POST', body: { username: 'x', password: '1234' } });
  assert.strictEqual(bad2.status, 422);
  const bad3 = await req('/api/auth/wxbind', { method: 'POST', body: { bindToken: 'a.b', username: 'no-such-user-zzz', password: '1234' } });
  assert.strictEqual(bad3.status, 422);
});

// ---------- 场景 ⑤ 重复绑定：openid 被另一用户占用时，wxbind 拒绝 ----------
test('场景⑤：openid 已被用户 A 绑定，用户 B 再用同一 openid 的 bindToken 绑定 → 409', async () => {
  const fs = require('node:fs');
  const subPort = 18090;
  const subDb = 'data/test_wxauth_dup.db';
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch {}
  }
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(subPort), DB_FILE: subDb, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false', WX_MOCK_OPENID: 'mock_dup', WX_AUTO_REGISTER: 'false' },
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await new Promise((res, rej) => {
        const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/health' }, (resp) => { resp.resume(); resp.on('end', () => res({ status: resp.statusCode })); });
        rq.on('error', rej); rq.end();
      }); if (r.status === 200) break; } catch {}
      await new Promise((res) => setTimeout(res, 100));
    }
    // 注册两个用户 A、B
    const ua = 'usera_' + Date.now().toString(36);
    const ub = 'userb_' + Date.now().toString(36);
    const regPost = (path, body) => new Promise((res, rej) => {
      const data = JSON.stringify(body);
      const rq = http.request({ host: '127.0.0.1', port: subPort, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    const ra = await regPost('/api/auth/register', { username: ua, password: 'abcd1234', nickname: 'A' });
    const rb = await regPost('/api/auth/register', { username: ub, password: 'abcd1234', nickname: 'B' });
    assert.strictEqual(ra.status, 200);
    assert.strictEqual(rb.status, 200);

    // 1) 第一次 wxlogin → needBind
    const login1 = await regPost('/api/auth/wxlogin', { code: 'any' });
    assert.strictEqual(login1.json.needBind, true);
    const token1 = login1.json.bindToken;

    // 2) A 绑定
    const bindA = await regPost('/api/auth/wxbind', { bindToken: token1, username: ua, password: 'abcd1234' });
    assert.strictEqual(bindA.status, 200);

    // 3) 重新 wxlogin（因为 A 已绑定该 openid） → mode=login，但仍能拿到 bindToken
    //    构造"再请求一次拿新 bindToken"是不行的：A 已绑，二次 wxlogin 直接 login；换一种方式验证重复绑定：
    //    通过 service 直接拿一个 bindToken 用于 openid=mock_dup，然后用 B 绑定
    const wxSvc = require('../src/modules/accounts/accounts.wx.service');
    const fakeBindToken = wxSvc.signBindToken('mock_dup', 60000);
    const bindB = await regPost('/api/auth/wxbind', { bindToken: fakeBindToken, username: ub, password: 'abcd1234' });
    assert.strictEqual(bindB.status, 409);
    assert.ok(/已被其他账号绑定|已绑定其他微信/.test(bindB.json.error || ''));
  } finally {
    proc.kill();
  }
});

// ---------- 场景 ⑥ 错误 code：未配置 AppID 且未启用 mock → 503 ----------
test('场景⑥：后端未配置 WX_APPID 且未启用 mock → /wxlogin 返回 503 + WX_NOT_CONFIGURED', async () => {
  const fs = require('node:fs');
  const subPort = 18091;
  const subDb = 'data/test_wxauth_noconfig.db';
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch {}
  }
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    // 不设 WX_* 环境变量：显式置空，防止本机 .env（如 WX_MOCK_OPENID/WX_APPID）被继承导致"未配置"场景失真
    env: {
      ...process.env, PORT: String(subPort), DB_FILE: subDb, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false',
      WX_APPID: '', WX_SECRET: '', WX_MOCK_OPENID: '', WX_AUTO_REGISTER: ''
    },
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await new Promise((res, rej) => {
        const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/health' }, (resp) => { resp.resume(); resp.on('end', () => res({ status: resp.statusCode })); });
        rq.on('error', rej); rq.end();
      }); if (r.status === 200) break; } catch {}
      await new Promise((res) => setTimeout(res, 100));
    }
    // 探测返回 enabled=false
    const cfg = await new Promise((res, rej) => {
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxconfig' }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.end();
    });
    assert.strictEqual(cfg.status, 200);
    assert.strictEqual(cfg.json.enabled, false);

    // 调 wxlogin 返回 503
    const r = await new Promise((res, rej) => {
      const data = JSON.stringify({ code: 'any' });
      const rq = http.request({ host: '127.0.0.1', port: subPort, path: '/api/auth/wxlogin', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (resp) => {
        let buf = ''; resp.on('data', (c) => { buf += c; });
        resp.on('end', () => { try { res({ status: resp.statusCode, json: JSON.parse(buf) }); } catch { res({ status: resp.statusCode, json: {} }); } });
      });
      rq.on('error', rej); rq.write(data); rq.end();
    });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.code, 'WX_NOT_CONFIGURED');
  } finally {
    proc.kill();
  }
});
