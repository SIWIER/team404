// scripts/smoke.js — 演示前一键自检：启动服务并跑通全部关键链路（含真实 LLM 验证）
// 用法：node scripts/smoke.js   （npm run smoke）
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 18099);
const DB = 'data/smoke.db';
let proc = null;

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

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

async function boot() {
  for (const s of ['', '-shm', '-wal']) {
    try { fs.rmSync(path.join(ROOT, DB + s), { force: true }); } catch {}
  }
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB, SIMULATOR_ENABLED: 'false' }, // LLM 按 .env 真实配置
    stdio: ['ignore', 'ignore', 'pipe']
  });
  for (let i = 0; i < 100; i++) {
    try { const r = await req('/api/health'); if (r.status === 200) return; } catch {}
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('服务启动超时');
}

// ---------- 检查项 ----------
check('健康检查', async () => {
  const r = await req('/api/health');
  if (r.status !== 200 || !r.json.ok) throw new Error('health 失败');
  return '服务在线 v' + r.json.version;
});

check('登录（演示账号）', async () => {
  const r = await req('/api/auth/login', { method: 'POST', body: { username: 'xiaoming', password: '123456' } });
  if (r.status !== 200) throw new Error('登录失败: ' + (r.json.error || r.status));
  global.token = r.json.token;
  return `欢迎 ${r.json.user.nickname}，令牌 ${r.json.token.length} 字符`;
});

check('引导问答流程', async () => {
  const r = await req('/api/reason/flow', { token: global.token });
  if (r.status !== 200 || !Array.isArray(r.json.flow)) throw new Error('flow 失败');
  const room = r.json.flow.find((q) => q.id === 'room');
  return `${r.json.flow.length} 个问题，房间选项按户型生成（${room.opts.map((o) => o[0]).join('/')}）`;
});

check('推理（含大模型）', async () => {
  const r = await req('/api/reason/infer', {
    method: 'POST', token: global.token,
    body: { facts: { activity: '洗澡/冲凉', room: '卫生间', timeOfDay: '晚上' } }
  });
  if (r.status !== 200) throw new Error('infer 失败');
  const res = r.json.result;
  global.result = res;
  return `engine=${res.engine}${res.model ? '(' + res.model + ')' : ''}，top=${res.topLocation}（${res.topRoom}）${res.confidence}%`;
});

check('找回记录保存', async () => {
  const r = await req('/api/reason/record', {
    method: 'POST', token: global.token,
    body: {
      startedAt: new Date().toISOString(), foundLocation: global.result.topLocation, foundRoom: global.result.topRoom,
      confidence: global.result.confidence, success: true, facts: {}, reasoning: 'smoke', durationSec: 60
    }
  });
  if (r.status !== 200) throw new Error('record 失败');
  return `记录 id=${r.json.id}`;
});

check('统计与智能洞察', async () => {
  const r = await req('/api/data/stats', { token: global.token });
  if (r.status !== 200) throw new Error('stats 失败');
  const m = r.json.mine;
  if (!m.total || !Array.isArray(m.insights)) throw new Error('stats 数据不完整');
  return `累计 ${m.total} 条记录，生成 ${m.insights.length} 条洞察`;
});

check('硬件设备列表', async () => {
  const r = await req('/api/hardware/devices', { token: global.token });
  if (r.status !== 200 || !r.json.devices.length) throw new Error('devices 失败');
  return `${r.json.devices.length} 台设备在线`;
});

check('硬件定位上报 + 指令', async () => {
  const rep = await req('/api/hardware/devices/loc-01/report', {
    method: 'POST', token: global.token, body: { room: '卧室', distance_m: 1.1 }
  });
  if (rep.status !== 200) throw new Error('report 失败');
  const cmd = await req('/api/hardware/devices/nfc-01/command', { method: 'POST', token: global.token, body: { command: 'ping' } });
  if (cmd.status !== 200) throw new Error('command 失败');
  return rep.json.message;
});

check('数据导出', async () => {
  const r = await req('/api/data/export', { token: global.token });
  if (r.status !== 200 || !Array.isArray(r.json.records)) throw new Error('export 失败');
  return `导出 ${r.json.records.length} 条记录`;
});

// ---------- 主流程 ----------
(async () => {
  console.log('👓 找眼镜助手 · 一键自检（演示前预检）');
  console.log('----------------------------------------------');
  let pass = 0;
  try {
    await boot();
    for (const c of checks) {
      try {
        const detail = await c.fn();
        pass++;
        console.log(`  ✔ [${pass}/${checks.length}] ${c.name}${detail ? '：' + detail : ''}`);
      } catch (e) {
        console.log(`  ✘ ${c.name}：${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  ✘ 自检无法进行：${e.message}`);
  } finally {
    if (proc) proc.kill();
  }
  console.log('----------------------------------------------');
  if (pass === checks.length) {
    console.log(`✅ ${pass}/${checks.length} 全部通过 —— 可以开始演示！`);
    process.exit(0);
  } else {
    console.log(`⚠️ ${pass}/${checks.length} 通过 —— 请检查上方失败项（大模型不可用时推理会自动回退，属正常降级）。`);
    process.exit(1);
  }
})();
