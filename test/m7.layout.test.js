// test/m7.layout.test.js — 户型图照片识别模块测试
// 全程离线：normalizeLayout 是纯函数；HTTP 部分显式清空 LLM_VISION_* 模拟"未配置"场景
// （清空环境变量的手法参考 m6.wxauth.test.js，避免读到本机 .env 导致测试结果失真）
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const svc = require('../src/modules/layout/layout.service');

const ROOT = path.resolve(__dirname, '..');
// 端口需与其他测试文件互不重叠：node --test 并行跑各文件，抢同一端口会串到别人的服务器上
// （m1-m5 占 18081-18086、ws 占 18085、m6 占 18087 及 18088-18092 子服务器）
const PORT = 18093;
const TEST_DB = 'data/test_layout.db';
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
        try { json = JSON.parse(data); } catch { /* 非 JSON 响应保持空对象 */ }
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

// 1×1 像素 png 的合法 base64（仅用于走通参数校验，不会真的发给模型）
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

before(async () => {
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, TEST_DB + suffix), { force: true }); } catch { /* 不存在则忽略 */ }
  }
  // 显式清空 LLM_VISION_*：模拟"后端未配置视觉模型"，保证 CI 与本机结果一致且不产生真实调用。
  // 注意必须赋空串而不能用 delete：src/config.js 的 loadEnvFile 只跳过"已存在于 process.env"的键
  // （`!(m[1] in process.env)`），delete 掉的键会被本机 .env 里的真实配置重新填上，
  // 导致这条用例变成真实的付费调用并返回 502 而不是 503。空串仍算 in process.env，故能拦住覆盖。
  const env = {
    ...process.env,
    PORT: String(PORT),
    DB_FILE: TEST_DB,
    LLM_ENABLED: 'false',
    SIMULATOR_ENABLED: 'false',
    LLM_VISION_ENABLED: '',
    LLM_VISION_BASE_URL: '',
    LLM_VISION_API_KEY: '',
    LLM_VISION_MODEL: ''
  };
  serverProc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await req('/api/health'); if (r.status === 200) return; } catch { /* 还没起来 */ }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('测试服务器启动超时');
});

after(() => { if (serverProc) serverProc.kill(); });

// ---------- HTTP 层 ----------

test('未登录调用识别接口 → 401', async () => {
  const r = await req('/api/layout/recognize', { method: 'POST', body: { image: TINY_PNG, mimeType: 'image/png' } });
  assert.strictEqual(r.status, 401);
});

test('探测接口：未配置视觉模型时 visionEnabled=false', async () => {
  const r = await req('/api/layout/config');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.visionEnabled, false);
});

test('未配置视觉模型 → 503 且提示可手动编辑', async () => {
  const token = await loginAs('xiaoming');
  const r = await req('/api/layout/recognize', {
    method: 'POST', token, body: { image: TINY_PNG, mimeType: 'image/png' }
  });
  assert.strictEqual(r.status, 503);
  assert.match(r.json.error, /未配置|手动/);
});

// ---------- normalizeLayout 纯函数（识别结果清洗，主要防线） ----------

test('坐标越界被裁进 0-5 网格', () => {
  const out = svc.normalizeLayout({ rooms: [{ name: '卧室', cells: [{ x: 99, y: -4 }] }] });
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].cells, [{ x: 5, y: 0 }]);
  assert.strictEqual(out[0].x, 5);
  assert.strictEqual(out[0].y, 0);
});

test('x/y 恒等于 cells[0]（兼容 Web 版与推理引擎）', () => {
  const out = svc.normalizeLayout({
    rooms: [{ name: '走廊', cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }] }]
  });
  assert.strictEqual(out[0].x, out[0].cells[0].x);
  assert.strictEqual(out[0].y, out[0].cells[0].y);
});

test('同一房间内重复格子去重', () => {
  const out = svc.normalizeLayout({
    rooms: [{ name: '走廊', cells: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }] }]
  });
  assert.strictEqual(out[0].cells.length, 2);
});

test('跨房间抢同一格 → 先到先得，后来者让位', () => {
  const out = svc.normalizeLayout({
    rooms: [
      { name: '卧室', cells: [{ x: 3, y: 3 }] },
      { name: '客厅', cells: [{ x: 3, y: 3 }] }   // 与卧室冲突，无其他格 → 被丢弃
    ]
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].name, '卧室');
});

test('非走廊房间塌缩为单格，走廊保留多格链', () => {
  const out = svc.normalizeLayout({
    rooms: [
      { name: '客厅', cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }] },
      { name: '走廊', cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }] }
    ]
  });
  const living = out.find((r) => r.name === '客厅');
  const corridor = out.find((r) => r.name === '走廊');
  assert.strictEqual(living.cells.length, 1);
  assert.strictEqual(corridor.cells.length, 3);
});

test('走廊断开的飞地格被剔除（只保留连通部分）', () => {
  const out = svc.normalizeLayout({
    rooms: [{ name: '走廊', cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 5, y: 5 }] }]
  });
  assert.strictEqual(out[0].cells.length, 2);
  assert.ok(!out[0].cells.some((c) => c.x === 5 && c.y === 5));
});

test('超过 10 个房间被截断', () => {
  const rooms = [];
  for (let i = 0; i < 14; i++) rooms.push({ name: '卧室', cells: [{ x: i % 6, y: Math.floor(i / 6) }] });
  const out = svc.normalizeLayout({ rooms });
  assert.strictEqual(out.length, 10);
});

test('房间名别名对齐到标准词表', () => {
  assert.strictEqual(svc.alignRoomName('主卧'), '卧室');
  assert.strictEqual(svc.alignRoomName('洗手间'), '卫生间');
  assert.strictEqual(svc.alignRoomName('过道'), '走廊');
  assert.strictEqual(svc.alignRoomName('起居室'), '客厅');
  assert.strictEqual(svc.alignRoomName('主卧室A'), '卧室');   // 包含匹配
  assert.strictEqual(svc.alignRoomName('健身房'), '健身房');   // 词表外保留原名
});

test('非法/空输入返回空数组，不抛异常', () => {
  assert.deepStrictEqual(svc.normalizeLayout(null), []);
  assert.deepStrictEqual(svc.normalizeLayout({}), []);
  assert.deepStrictEqual(svc.normalizeLayout({ rooms: [] }), []);
  assert.deepStrictEqual(svc.normalizeLayout({ rooms: [{ name: '' }] }), []);
  assert.deepStrictEqual(svc.normalizeLayout({ rooms: [{ name: '卧室', cells: [{ x: 'a', y: null }] }] }), []);
});

test('无 cells 但有 x/y → 退化为单格', () => {
  const out = svc.normalizeLayout({ rooms: [{ name: '书房', x: 4, y: 1 }] });
  assert.deepStrictEqual(out[0].cells, [{ x: 4, y: 1 }]);
});

test('spots 与 desc 被保留并截断', () => {
  const out = svc.normalizeLayout({
    rooms: [{ name: '卧室', cells: [{ x: 0, y: 0 }], desc: 'x'.repeat(200), spots: ['床头柜', '  书桌  ', ''] }]
  });
  assert.strictEqual(out[0].desc.length, 100);
  assert.deepStrictEqual(out[0].spots, ['床头柜', '书桌']);
});

test('extractJson 容忍 markdown 代码块与前后废话', () => {
  assert.deepStrictEqual(svc.extractJson('```json\n{"rooms":[]}\n```'), { rooms: [] });
  assert.deepStrictEqual(svc.extractJson('好的，结果如下：{"rooms":[]} 完毕'), { rooms: [] });
  assert.deepStrictEqual(svc.extractJson('{"rooms":[]}'), { rooms: [] });
});

test('visionReady：缺任一配置项都视为未就绪', () => {
  assert.strictEqual(svc.visionReady(null), false);
  assert.strictEqual(svc.visionReady({ enabled: true, apiKey: 'k', baseUrl: 'u', model: '' }), false);
  assert.strictEqual(svc.visionReady({ enabled: true, apiKey: '', baseUrl: 'u', model: 'm' }), false);
  assert.strictEqual(svc.visionReady({ enabled: false, apiKey: 'k', baseUrl: 'u', model: 'm' }), false);
  assert.strictEqual(svc.visionReady({ enabled: true, apiKey: 'k', baseUrl: 'u', model: 'm' }), true);
});

test('未配置视觉模型时 recognizeLayout 直接返回 null（不发请求）', async () => {
  const r = await svc.recognizeLayout({ enabled: true, apiKey: '', baseUrl: '', model: '' }, TINY_PNG, 'image/png');
  assert.strictEqual(r, null);
});

// ---------- 参数校验与限流（需绕过 503，用配了假 Key 的独立子服务器） ----------
// baseUrl 指向 127.0.0.1:1（必然连不上），确保任何情况下都不会产生真实的付费调用；
// 且下面用例全部在 fetch 之前就返回，不会真的发请求。
test('参数校验与限流：缺字段/非法格式 → 422，超频 → 429', async () => {
  const subPort = 18094;   // 同上：避开 m6 的 18088-18092 子服务器
  const subDb = 'data/test_layout_sub.db';
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch { /* 不存在则忽略 */ }
  }
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(subPort), DB_FILE: subDb, LLM_ENABLED: 'false', SIMULATOR_ENABLED: 'false',
      LLM_VISION_ENABLED: 'true',
      LLM_VISION_BASE_URL: 'http://127.0.0.1:1',   // 必然连不上，杜绝真实调用
      LLM_VISION_API_KEY: 'fake-key-for-test',
      LLM_VISION_MODEL: 'fake-vision-model'
    },
    stdio: 'ignore'
  });

  const subReq = (pathname, { method = 'GET', body, token } = {}) => new Promise((resolve, reject) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: subPort, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch { /* 非 JSON 响应保持空对象 */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });

  try {
    // 等子服务器就绪
    let up = false;
    for (let i = 0; i < 50; i++) {
      try { const h = await subReq('/api/health'); if (h.status === 200) { up = true; break; } } catch { /* 还没起来 */ }
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.ok(up, '子测试服务器启动超时');

    // 配了 Key → 探测接口应报可用
    const cfg = await subReq('/api/layout/config');
    assert.strictEqual(cfg.json.visionEnabled, true);

    const lr = await subReq('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
    const token = lr.json.token;

    // 缺 image → 422
    const noImg = await subReq('/api/layout/recognize', { method: 'POST', token, body: { mimeType: 'image/png' } });
    assert.strictEqual(noImg.status, 422);
    assert.ok(noImg.json.errors.image);

    // 非法 mimeType → 422
    const badMime = await subReq('/api/layout/recognize', { method: 'POST', token, body: { image: TINY_PNG, mimeType: 'image/gif' } });
    assert.strictEqual(badMime.status, 422);
    assert.ok(badMime.json.errors.mimeType);

    // 非 base64 字符 → 422
    const badData = await subReq('/api/layout/recognize', { method: 'POST', token, body: { image: '这不是base64!!@#', mimeType: 'image/png' } });
    assert.strictEqual(badData.status, 422);
    assert.ok(badData.json.errors.image);

    // 限流：每分钟 5 次。上面已用掉 3 次，再发 3 次，最后一次应 429
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const r = await subReq('/api/layout/recognize', { method: 'POST', token, body: { mimeType: 'image/png' } });
      codes.push(r.status);
    }
    assert.strictEqual(codes[codes.length - 1], 429, `期望最后一次被限流，实际 ${codes.join(',')}`);
  } finally {
    proc.kill();
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(path.join(ROOT, subDb + suffix), { force: true }); } catch { /* 忽略 */ }
    }
  }
});

test('识别结果可直接被 accounts.sanitizeLayout 接受（契约对齐）', () => {
  const out = svc.normalizeLayout({
    rooms: [
      { name: '走廊', cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }] },
      { name: '主卧', cells: [{ x: 1, y: 2 }] }
    ]
  });
  for (const r of out) {
    assert.strictEqual(typeof r.name, 'string');
    assert.ok(r.name.length > 0 && r.name.length <= 20);
    assert.ok(Array.isArray(r.spots));
    assert.ok(Array.isArray(r.cells) && r.cells.length >= 1);
    assert.strictEqual(r.x, r.cells[0].x);
    assert.strictEqual(r.y, r.cells[0].y);
    for (const c of r.cells) {
      assert.ok(Number.isInteger(c.x) && c.x >= 0 && c.x <= 5);
      assert.ok(Number.isInteger(c.y) && c.y >= 0 && c.y <= 5);
    }
  }
});
