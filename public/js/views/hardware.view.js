// js/views/hardware.view.js — 硬件设备接入（设备管理 + 实时事件 + 协议文档）
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast, roomEmoji } from '../ui.js';

let ws = null;
let wsRetry = 0;
let disposed = false;

const TYPE_ICON = { locator: '📡', nfc: '🔊', tag: '🏷️' };

export async function renderHardware(root) {
  disposed = false;
  let d;
  try { d = await api('/hardware/devices'); } catch (e) { root.innerHTML = `<div class="card soon"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`; return; }
  root.innerHTML = `
    <div class="page-title">📡 硬件设备接入</div>
    <p class="page-sub">硬件数据接入端口：REST 上行/下行 + WebSocket 实时推送（当前为模拟设备演示）</p>

    <div class="toolbar">
      <span class="ws-status"><span id="ws-dot" class="dot off"></span><span id="ws-text">实时通道：连接中…</span></span>
      <button class="btn sm" id="hw-sim">🎲 模拟一次设备事件</button>
      <button class="btn ghost sm" id="hw-reg-toggle">＋ 注册新设备</button>
    </div>

    <div class="card hidden" id="hw-reg-form">
      <div class="chart-title">注册新设备（真实硬件接入第一步）</div>
      <div class="grid two">
        <div class="field"><label>设备名称</label><input id="hw-name" class="input" placeholder="如：我的定位器"></div>
        <div class="field"><label>设备类型</label>
          <select id="hw-type" class="input">
            <option value="locator">📡 定位器（上报位置/距离）</option>
            <option value="nfc">🔊 近场呼唤器（近距离蜂鸣应答）</option>
            <option value="tag">🏷️ 防丢标签（寻物标签）</option>
          </select>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn sm" id="hw-reg-do">注册</button>
        <button class="btn ghost sm" id="hw-reg-cancel">取消</button>
      </div>
    </div>

    <div id="dev-list" class="dev-list"></div>

    <div class="card">
      <div class="chart-title">📟 设备事件流（实时）</div>
      <div id="dev-events" class="terminal">等待事件…（模拟器每 8 秒自动产生一条，也可点上方按钮手动触发）</div>
    </div>

    <div class="card">
      <div class="chart-title">🔌 接入协议（供真实硬件对接）</div>
      <div class="terminal">
<span class="c">── 上行（设备 → 服务）────────────────────────</span>
POST /api/hardware/devices/{id}/report
  Body: { "room": "卧室", "distance_m": 2.3, "rssi_dbm": -58, "battery": 86 }
  鉴权: Authorization: Bearer &lt;token&gt;
<span class="c">── 下行（服务 → 设备，设备侧订阅执行）──────────</span>
POST /api/hardware/devices/{id}/command
  Body: { "command": "locate" | "ping" | "beep" }
<span class="c">── 实时通道 ──────────────────────────────────</span>
WS   /ws?token=&lt;token&gt;
  推送: {"type":"device_event", event} / {"type":"device_update", device}
<span class="c">── 管理 ──────────────────────────────────────</span>
GET    /api/hardware/devices          设备列表 + 最近事件
POST   /api/hardware/devices          注册设备 {id?,name,type,room}
DELETE /api/hardware/devices/{id}     删除设备</div>
    </div>`;

  root.querySelector('#hw-sim').onclick = async () => {
    try { const r = await api('/hardware/simulate', { method: 'POST' }); toast(r.message); } catch (e) { toast(e.message); }
  };
  const regForm = root.querySelector('#hw-reg-form');
  root.querySelector('#hw-reg-toggle').onclick = () => regForm.classList.toggle('hidden');
  root.querySelector('#hw-reg-cancel').onclick = () => regForm.classList.add('hidden');
  root.querySelector('#hw-reg-do').onclick = async () => {
    const name = root.querySelector('#hw-name').value.trim();
    const type = root.querySelector('#hw-type').value;
    try {
      const r = await api('/hardware/devices', { method: 'POST', body: { name, type } });
      toast(`设备已注册：${r.device.id} ✓`);
      regForm.classList.add('hidden');
      await refresh(root);
    } catch (e) { toast(e.message); }
  };

  renderDevices(root, d.devices);
  renderEvents(root, d.events);
  connectWs(root);
}

function renderDevices(root, devices) {
  const list = root.querySelector('#dev-list');
  list.innerHTML = devices.map((x) => {    const on = x.status === 'online';
    const actions = x.type === 'locator'
      ? `<button class="btn warn sm" data-id="${esc(x.id)}" data-cmd="locate">📡 定位扫描</button>`
      : x.type === 'nfc'
        ? `<button class="btn good sm" data-id="${esc(x.id)}" data-cmd="ping">🔊 呼唤</button>`
        : `<button class="btn good sm" data-id="${esc(x.id)}" data-cmd="ping">🔊 呼叫</button><button class="btn ghost sm" data-id="${esc(x.id)}" data-cmd="beep">🔔 蜂鸣</button>`;
    return `
      <div class="device-card">
        <div class="dev-ico">${TYPE_ICON[x.type] || '📟'}</div>
        <div class="dev-main">
          <div class="dev-name">${esc(x.name)} <span class="dev-id">#${esc(x.id)}</span></div>
          <div class="dev-meta">
            <span class="dot ${on ? 'on' : 'off'}"></span>${on ? '在线' : '离线'}
            · ${esc(x.typeLabel)} · ${roomEmoji(x.room || '')} ${esc(x.room || '未定位')}
            ${x.lastSignal != null ? ` · 最近信号 ${x.lastSignal}m` : ''}
          </div>
          <div class="battery"><i style="width:${x.battery || 0}%"></i></div>
        </div>
        <div class="dev-actions">${actions}<button class="btn ghost sm del" data-id="${esc(x.id)}">删除</button></div>
      </div>`;
  }).join('') || `
    <div class="card soon">
      <div class="ico">📭</div>
      <div class="t">你还没有接入任何设备</div>
      <div class="d">没有硬件设备也完全不影响使用——引导推理已足够。若想获得实时定位强证据：<br>
        点右上「＋ 注册新设备」接入你的设备；重启服务可恢复预置的 3 台演示设备。</div>
      <div class="btn-row" style="justify-content:center;">
        <button class="btn sm" onclick="document.getElementById('hw-reg-toggle').click()">＋ 注册新设备</button>
      </div>
    </div>`;

  list.querySelectorAll('[data-cmd]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api(`/hardware/devices/${b.dataset.id}/command`, { method: 'POST', body: { command: b.dataset.cmd } });
        toast(r.message);
        await refresh(root);
      } catch (e) { toast(e.message); }
      b.disabled = false;
    };
  });
  list.querySelectorAll('.del').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('确认删除该设备？')) return;
      try { await api('/hardware/devices/' + b.dataset.id, { method: 'DELETE' }); toast('已删除 ✓'); await refresh(root); } catch (e) { toast(e.message); }
    };
  });
}

function renderEvents(root, events) {
  const box = root.querySelector('#dev-events');
  if (!box) return;
  if (!events.length) { box.innerHTML = '暂无事件'; return; }
  box.innerHTML = events.map((e) => formatEvent(e)).join('\n');
  box.scrollTop = 0;
}

function formatEvent(e) {
  let p = '';
  try { p = JSON.stringify(JSON.parse(e.payload)); } catch { p = e.payload; }
  const icon = e.type === 'report' ? '📡' : e.type === 'command' ? '⬇️' : e.type === 'ping_result' ? '🔊' : '🔔';
  return `<span class="ts">[${esc((e.ts || '').slice(11, 19))}]</span> <span class="ok">${esc(e.device_id)}</span> ${icon} ${esc(e.type)} ${esc(p)}`;
}

async function refresh(root) {
  const d = await api('/hardware/devices');
  renderDevices(root, d.devices);
  renderEvents(root, d.events);
}

function connectWs(root) {
  if (disposed) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(store.token)}`);
  } catch {
    setWsStatus(root, false);
    return;
  }
  ws.onopen = () => { wsRetry = 0; setWsStatus(root, true); };
  ws.onclose = () => {
    setWsStatus(root, false);
    if (!disposed && wsRetry < 3) {
      wsRetry++;
      setTimeout(() => connectWs(root), 2000 * wsRetry);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    if (data.type === 'device_event' && data.event) {
      prependEvent(root, data.event);
    } else if (data.type === 'device_update') {
      refresh(root);
    }
  };
}

function prependEvent(root, event) {
  const box = root.querySelector('#dev-events');
  if (!box) return;
  if (box.textContent.includes('等待事件')) box.innerHTML = '';
  const line = document.createElement('div');
  line.innerHTML = formatEvent(event);
  box.prepend(line);
  while (box.children.length > 60) box.removeChild(box.lastChild);
}

function setWsStatus(root, ok) {
  const dot = root.querySelector('#ws-dot');
  const txt = root.querySelector('#ws-text');
  if (!dot) return;
  dot.className = 'dot ' + (ok ? 'on' : 'off');
  txt.textContent = ok ? '实时通道：已连接' : '实时通道：断开，自动重连中…';
}

export function disposeHardware() {
  disposed = true;
  if (ws) { try { ws.close(); } catch {} ws = null; }
}
