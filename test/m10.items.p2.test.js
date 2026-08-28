// test/m10.items.p2.test.js — 物品管理 P2 测试：图文识别（recognize）+ 图图/文图向量检索（search-image）
// 全程离线、零付费调用：视觉模型与 Chinese-CLIP 都用本地 mock 服务（协议与真实服务一致）。
// 端口：主服务器 18100、mock 视觉 18101、mock CLIP 18102、无配置服务器 18103
// （m8 已占 18096、m9 占 18095，本文件全部在 18100 之后，互不重叠）。
// 隔离：每个用例组用独立注册用户，避免物品/向量互相串扰。
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// 纯函数（不触库）：可直接在测试进程内 require
const { cosine, parseVec } = require('../src/modules/items/items.clip');
const { extractItemJson } = require('../src/modules/items/items.vision');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18100;               // 主测试服务器（视觉+CLIP 都指向 mock）
const PORT_VISION = 18101;        // mock 视觉模型（OpenAI 兼容 /chat/completions）
const PORT_CLIP = 18102;          // mock Chinese-CLIP（/encode/image、/encode/text）
const PORT_NOCFG = 18103;         // 无视觉/无 CLIP 配置的服务器（测 503 降级）
const TEST_DB = 'data/test_items_p2.db';
const TEST_DB_NOCFG = 'data/test_items_p2_noclip.db';
const CLIP_DIM = 8;               // mock 向量维度（与主服务器 CLIP_DIM 一致）

let serverProc = null;
let visionProc = null;
let clipProc = null;
let nocfgProc = null;

function req(port, pathname, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch { /* 非 JSON 保持空对象 */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 三张"合法 base64 图片"（mock 只按字符串算向量，不解析图片内容）
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAFhAJgGf4C9wAAAABJRU5ErkJggg==';

// FNV-1a 哈希 + sin 伪随机 → 确定性向量（同输入必同向量，不同输入几乎必不同向量）
function mockVec(seed, dim) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const v = [];
  for (let i = 0; i < dim; i++) v.push(Math.sin((h + i * 2654435761) * 0.001));
  return v;
}

function startMockVision(port) {
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/chat/completions') {
        const item = JSON.stringify({
          name: '黑色折叠雨伞', desc: '长柄黑色雨伞，把手有挂绳',
          room: '玄关', furn: '壁橱', subPos: '一层', note: '照片中的物品是雨伞'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: item } }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function startMockClip(port) {
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'GET') return send(200, { ok: true });
      if (req.method === 'POST' && req.url === '/encode/image') {
        try {
          const body = JSON.parse(data);
          const vec = mockVec('img:' + (body.image || ''), CLIP_DIM);
          return send(200, { vector: vec, dim: CLIP_DIM });
        } catch { return send(400, { error: 'bad json' }); }
      }
      if (req.method === 'POST' && req.url === '/encode/text') {
        try {
          const body = JSON.parse(data);
          const vec = mockVec('txt:' + (body.text || ''), CLIP_DIM);
          return send(200, { vector: vec, dim: CLIP_DIM });
        } catch { return send(400, { error: 'bad json' }); }
      }
      send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function waitHealthy(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await req(port, '/api/health');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    await wait(100);
  }
  throw new Error('测试服务器启动超时 port=' + port);
}

before(async () => {
  for (const db of [TEST_DB, TEST_DB_NOCFG]) {
    for (const suffix of ['', '-shm', '-wal']) {
      try { fs.rmSync(path.join(ROOT, db + suffix), { force: true }); } catch { /* 不存在忽略 */ }
    }
  }
  visionProc = await startMockVision(PORT_VISION);
  clipProc = await startMockClip(PORT_CLIP);

  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: TEST_DB,
      LLM_ENABLED: 'false',
      SIMULATOR_ENABLED: 'false',
      LLM_VISION_ENABLED: 'true',
      LLM_VISION_BASE_URL: 'http://127.0.0.1:' + PORT_VISION,
      LLM_VISION_API_KEY: 'test-key',
      LLM_VISION_MODEL: 'mock-vision',
      CLIP_ENABLED: 'true',
      CLIP_BASE_URL: 'http://127.0.0.1:' + PORT_CLIP,
      CLIP_DIM: String(CLIP_DIM),
      CLIP_TIMEOUT_MS: '5000'
    },
    stdio: 'ignore'
  });
  await waitHealthy(PORT);

  // 无视觉/无 CLIP 配置的服务器：验证 503 降级路径（显式赋空串防止本机 .env 填回真实配置）
  nocfgProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT_NOCFG),
      DB_FILE: TEST_DB_NOCFG,
      LLM_ENABLED: 'false',
      SIMULATOR_ENABLED: 'false',
      LLM_VISION_ENABLED: '',
      LLM_VISION_BASE_URL: '',
      LLM_VISION_API_KEY: '',
      LLM_VISION_MODEL: '',
      CLIP_BASE_URL: ''
    },
    stdio: 'ignore'
  });
  await waitHealthy(PORT_NOCFG);
});

after(() => {
  if (serverProc) serverProc.kill();
  if (nocfgProc) nocfgProc.kill();
  if (visionProc) visionProc.close();
  if (clipProc) clipProc.close();
});

async function register(port, name) {
  const r = await req(port, '/api/auth/register', {
    method: 'POST',
    body: { username: name, password: '123456', nickname: name }
  });
  assert.strictEqual(r.status, 200, '注册失败: ' + JSON.stringify(r.json));
  return login(port, name);   // 注册接口只返回 user，token 需再登录获取
}
async function login(port, username) {
  const r = await req(port, '/api/auth/login', { method: 'POST', body: { username, password: '123456' } });
  assert.strictEqual(r.status, 200, '登录失败: ' + JSON.stringify(r.json));
  return r.json.token;
}

// ---------- 纯函数（不联网、不触库） ----------

test('余弦：同向量为 1、正交为 0、非法向量串返回 null', () => {
  assert.strictEqual(cosine([1, 2, 3], [1, 2, 3]), 1);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  assert.strictEqual(parseVec('not-json'), null);
  assert.deepStrictEqual(parseVec('[1,2,3]'), [1, 2, 3]);
});

test('extractItemJson：容忍 markdown 代码块与前后废话', () => {
  assert.deepStrictEqual(
    extractItemJson('```json\n{"name":"雨伞","room":"玄关"}\n```'),
    { name: '雨伞', room: '玄关' }
  );
  assert.strictEqual(extractItemJson('前置说明 {"name":"雨伞"} 后置').name, '雨伞');
});

// ---------- 能力探测 ----------

test('能力探测：配置齐时 recognizeEnabled/clipEnabled 均为 true', async () => {
  const r = await req(PORT, '/api/items/config');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.recognizeEnabled, true);
  assert.strictEqual(r.json.clipEnabled, true);
});

test('无视觉/无 CLIP 配置：config 双 false、recognize 503、search-image 503(CLIP_NOT_CONFIGURED)', async () => {
  const c = await req(PORT_NOCFG, '/api/items/config');
  assert.strictEqual(c.json.recognizeEnabled, false);
  assert.strictEqual(c.json.clipEnabled, false);

  const token = await login(PORT_NOCFG, 'xiaoming');
  const rc = await req(PORT_NOCFG, '/api/items/recognize', {
    method: 'POST', token, body: { image: PNG_A, mimeType: 'image/png' }
  });
  assert.strictEqual(rc.status, 503);

  const si = await req(PORT_NOCFG, '/api/items/search-image', {
    method: 'POST', token, body: { text: '眼镜' }
  });
  assert.strictEqual(si.status, 503);
  assert.strictEqual(si.json.code, 'CLIP_NOT_CONFIGURED');
});

// ---------- 图文识别（recognize，mock 视觉模型） ----------

test('图文识别：未登录 401；缺图片 422', async () => {
  const noauth = await req(PORT, '/api/items/recognize', { method: 'POST', body: { image: PNG_A, mimeType: 'image/png' } });
  assert.strictEqual(noauth.status, 401);

  const token = await login(PORT, 'xiaoming');
  const bad = await req(PORT, '/api/items/recognize', { method: 'POST', token, body: {} });
  assert.strictEqual(bad.status, 422);
});

test('图文识别：照片 → 名称/描述/建议位置（mock 返回）', async () => {
  const token = await login(PORT, 'xiaoming');
  const r = await req(PORT, '/api/items/recognize', {
    method: 'POST', token, body: { image: PNG_A, mimeType: 'image/png' }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.item.name, '黑色折叠雨伞');
  assert.strictEqual(r.json.item.room, '玄关');
  assert.strictEqual(r.json.item.furn, '壁橱');
  assert.strictEqual(r.json.item.subPos, '一层');
  assert.ok(r.json.note);
});

// ---------- 录入 + 完整位置链（spaceName / locationFull） ----------

test('录入物品：location 保持 P1 契约，locationFull 含目录前缀', async () => {
  const token = await register(PORT, 'p2_loc');
  const sp = await req(PORT, '/api/spaces', { token });
  const spaceId = sp.json.activeSpaceId;
  assert.ok(spaceId, '应有默认目录');

  const add = await req(PORT, '/api/items', {
    method: 'POST', token,
    body: { spaceId, name: '折叠雨伞', image: PNG_A, mimeType: 'image/png', room: '玄关', furn: '壁橱', subPos: '一层' }
  });
  assert.strictEqual(add.status, 200);
  assert.strictEqual(add.json.item.location, '玄关→壁橱→一层');        // P1 契约不变
  assert.strictEqual(add.json.item.locationFull, '家→玄关→壁橱→一层'); // 完整位置链
  assert.strictEqual(add.json.item.spaceName, '家');

  const list = await req(PORT, '/api/items?q=' + encodeURIComponent('雨伞'), { token });
  const hit = list.json.items.find((x) => x.id === add.json.item.id);
  assert.ok(hit, '文字检索应命中');
  assert.strictEqual(hit.locationFull, '家→玄关→壁橱→一层');
});

// ---------- 图图/文图向量检索（mock CLIP，懒回填 + 暴力余弦） ----------

async function setupItems(token) {
  const add1 = await req(PORT, '/api/items', {
    method: 'POST', token,
    body: { name: '黑色折叠雨伞', desc: '长柄黑色雨伞', image: PNG_A, mimeType: 'image/png', room: '玄关', furn: '壁橱', subPos: '一层' }
  });
  assert.strictEqual(add1.status, 200);
  const add2 = await req(PORT, '/api/items', {
    method: 'POST', token,
    body: { name: '手机数据线', desc: '白色 USB-C 数据线', image: PNG_B, mimeType: 'image/png', room: '书房', furn: '书桌', subPos: '抽屉' }
  });
  assert.strictEqual(add2.status, 200);
  return { id1: add1.json.item.id, id2: add2.json.item.id };
}

test('图图检索：同一张照片排在首位且相似度为 1（懒回填生效）', async () => {
  const token = await register(PORT, 'p2_vec');
  const { id1 } = await setupItems(token);

  const r = await req(PORT, '/api/items/search-image', {
    method: 'POST', token, body: { image: PNG_A, mimeType: 'image/png' }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.matchBy, 'image');
  assert.ok(Array.isArray(r.json.results) && r.json.results.length >= 2, '两件有照片的物品都应被回填并参与比对');
  assert.strictEqual(r.json.results[0].item.id, id1, '同图物品应排第一');
  assert.strictEqual(r.json.results[0].score, 1);
  for (const x of r.json.results) {
    assert.ok(x.score >= -1 && x.score <= 1, '分数应在余弦范围');
    assert.ok(x.item.locationFull, '结果应带完整位置链');
  }
});

test('文图检索：文字描述返回按相似度降序的结果', async () => {
  const token = await login(PORT, 'p2_vec');
  const r = await req(PORT, '/api/items/search-image', {
    method: 'POST', token, body: { text: '黑色折叠雨伞' }
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.matchBy, 'text');
  assert.ok(r.json.results.length >= 2);
  const scores = r.json.results.map((x) => x.score);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1] >= scores[i], '应按相似度降序');
  }
});

test('纯文字物品（无照片）：文本编码懒回填后，文图/图图都能命中', async () => {
  const token = await register(PORT, 'p2_textonly');
  // 录入一件完全没有照片的物品
  const add = await req(PORT, '/api/items', {
    method: 'POST', token,
    body: { name: '黑色折叠雨伞', desc: '长柄黑色雨伞，把手有挂绳', room: '玄关', furn: '壁橱', subPos: '一层' }
  });
  assert.strictEqual(add.status, 200);
  assert.strictEqual(add.json.item.hasImage, false);
  const id = add.json.item.id;

  // 文图：查询文字 = 物品的「名称，描述」拼接文本 → 文本编码同源，相似度应为 1 且排首位
  const itemText = '黑色折叠雨伞，长柄黑色雨伞，把手有挂绳';
  const sTxt = await req(PORT, '/api/items/search-image', {
    method: 'POST', token, body: { text: itemText }
  });
  assert.strictEqual(sTxt.status, 200, JSON.stringify(sTxt.json));
  assert.strictEqual(sTxt.json.matchBy, 'text');
  const hit = sTxt.json.results.find((x) => x.item.id === id);
  assert.ok(hit, '文图检索应命中纯文字物品');
  assert.strictEqual(hit.score, 1);

  // 文图：随便什么文字，纯文字物品都应出现在结果里（有向量才可被检索）
  const sAny = await req(PORT, '/api/items/search-image', {
    method: 'POST', token, body: { text: '雨伞' }
  });
  assert.ok(sAny.json.results.some((x) => x.item.id === id), '任意文字检索都应包含该物品');

  // 图图：拍照检索也能把它带进结果（跨模态：查询图片 vs 物品文本向量）
  const sImg = await req(PORT, '/api/items/search-image', {
    method: 'POST', token, body: { image: PNG_A, mimeType: 'image/png' }
  });
  assert.strictEqual(sImg.status, 200, JSON.stringify(sImg.json));
  assert.ok(sImg.json.results.some((x) => x.item.id === id), '图图检索也应命中纯文字物品');
});

test('向量检索参数校验：图片与文字都没有/都有 → 422', async () => {
  const token = await login(PORT, 'p2_vec');
  const none = await req(PORT, '/api/items/search-image', { method: 'POST', token, body: {} });
  assert.strictEqual(none.status, 422);
  const both = await req(PORT, '/api/items/search-image', {
    method: 'POST', token, body: { image: PNG_A, mimeType: 'image/png', text: '雨伞' }
  });
  assert.strictEqual(both.status, 422);
});

test('越权：用户 B 的向量检索不触及用户 A 的物品', async () => {
  const tokenA = await register(PORT, 'p2_own_a');
  const { id1, id2 } = await setupItems(tokenA);
  // 触发一次检索完成回填（A 的物品进入向量库）
  await req(PORT, '/api/items/search-image', { method: 'POST', token: tokenA, body: { text: '雨伞' } });

  const tokenB = await register(PORT, 'p2_own_b');
  const r = await req(PORT, '/api/items/search-image', {
    method: 'POST', token: tokenB, body: { text: '黑色折叠雨伞' }
  });
  assert.strictEqual(r.status, 200);
  const ids = r.json.results.map((x) => x.item.id);
  assert.ok(!ids.includes(id1) && !ids.includes(id2), 'B 不应检索到 A 的物品');
});
