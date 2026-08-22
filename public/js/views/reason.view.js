// js/views/reason.view.js — 引导推理：问答向导 + 推理结果 + 找到/未找到闭环
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast, roomEmoji } from '../ui.js';

let S = null;

function fresh() {
  return {
    phase: 'loading',   // loading | questions | confirm | inferring | result | found | notfound
    flow: [],
    step: 0,
    answers: {},
    conversation: [],
    startTs: Date.now(),
    result: null,
    _multi: [],
    _multiStep: null
  };
}

function restart() {
  S.answers = {};
  S.conversation = [];
  S.step = 0;
  S._multi = [];
  S._multiStep = null;
  S.startTs = Date.now();
}

function visibleQuestions() {
  return S.flow.filter((q) => {
    if (!q.showWhen) return true;
    return q.showWhen.values.includes(S.answers[q.showWhen.field]);
  });
}

export async function renderReason(root) {
  S = fresh();
  root.innerHTML = centerHtml('📋', '正在准备问题清单…');
  try {
    const d = await api('/reason/flow');
    S.flow = d.flow || [];
    S.phase = 'questions';
    stepView(root);
  } catch (e) {
    root.innerHTML = centerHtml('⚠️', esc(e.message), true);
  }
}

function centerHtml(ico, text, withBack = false) {
  return `<div class="card soon"><div class="ico">${ico}</div><div class="t">${text}</div>${
    withBack ? '<div class="btn-row" style="justify-content:center;"><button class="btn ghost" onclick="location.hash=\'#/\'">← 返回首页</button></div>' : ''
  }</div>`;
}

// ---------- 房间选项按户型图排版（用户有已放置房间时） ----------
function placedLayout() {
  const layout = Array.isArray(store.user.profile.homeLayout) ? store.user.profile.homeLayout : [];
  const placed = layout.filter((r) => r.name && r.x != null && r.y != null);
  return placed.length ? { layout, placed } : null;
}

function roomOptionsHtml(q, isSelected) {
  const pl = placedLayout();
  if (!pl) return null;
  const GRID = 6;
  const byPos = new Map(pl.placed.map((r) => [r.x + ',' + r.y, r]));
  let cells = '';
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const r = byPos.get(x + ',' + y);
      cells += r
        ? '<div class="floor-cell filled"><div class="floor-tile selectable ' + (isSelected(r.name) ? 'active' : '') + '" data-val="' + esc(r.name) + '"><div class="tile-emoji">' + roomEmoji(r.name) + '</div><div class="tile-name">' + esc(r.name) + '</div></div></div>'
        : '<div class="floor-cell"></div>';
    }
  }
  const unplaced = pl.layout.filter((r) => r.name && (r.x == null || r.y == null));
  let tray = '';
  if (unplaced.length) {
    tray = '<div class="tray">' + unplaced.map((r) =>
      '<div class="floor-tile tray-tile selectable ' + (isSelected(r.name) ? 'active' : '') + '" data-val="' + esc(r.name) + '"><div class="tile-emoji">' + roomEmoji(r.name) + '</div><div class="tile-name">' + esc(r.name) + '</div></div>'
    ).join('') + '</div>';
  }
  const extras = (q.opts || []).map((o) => o[0]).filter((label) => !pl.layout.some((r) => r.name === label));
  let extra = '';
  if (extras.length) {
    extra = '<div class="opts" style="margin-top:10px;">' + extras.map((label) =>
      '<div class="opt ' + (isSelected(label) ? 'active' : '') + '" data-val="' + esc(label) + '"><span class="emoji">' + roomEmoji(label) + '</span>' + esc(label) + '</div>'
    ).join('') + '</div>';
  }
  return '<div class="floor-grid">' + cells + '</div>' + tray + extra;
}

// ---------- 问答向导 ----------
function stepView(root) {
  const vs = visibleQuestions();
  if (S.step >= vs.length) { confirmView(root); return; }
  const q = vs[S.step];
  const agent = store.user.profile.agentName;

  let body;
  if (q.type === 'text') {
    body = `
      <textarea id="q-text" class="input" placeholder="例如：昨晚睡前还在刷手机…">${esc(S.answers[q.id] || '')}</textarea>
      <div class="btn-row">
        <button class="btn ghost" id="q-back">← 上一步</button>
        <button class="btn" id="q-next">${S.answers[q.id] ? '下一步 →' : '跳过 →'}</button>
      </div>`;
  } else if (q.type === 'multi') {
    // 多选：临时选择存在 S._multi
    if (S._multiStep !== q.id) {
      S._multiStep = q.id;
      S._multi = [...(Array.isArray(S.answers[q.id]) ? S.answers[q.id] : [])];
    }
    const isRoomQ = q.id === 'room' || q.id === 'passedRooms' || q.id === 'checkedRooms';
    const roomHtml = isRoomQ ? roomOptionsHtml(q, (v) => S._multi.includes(v)) : null;
    const optionsBody = roomHtml !== null
      ? roomHtml
      : '<div class="opts">' + (q.opts || []).map(([label, emoji]) => {
          const on = S._multi.includes(label);
          return '<div class="opt ' + (on ? 'active' : '') + '" data-val="' + esc(label) + '"><span class="emoji">' + emoji + '</span>' + esc(label) + (on ? ' ✓' : '') + '</div>';
        }).join('') + '</div>';
    body = optionsBody + '<div class="btn-row"><button class="btn ghost" id="q-back">← 上一步</button><button class="btn" id="q-next">' + (S._multi.length ? '下一步 →（已选 ' + S._multi.length + ' 个）' : (q.id === 'passedRooms' ? '没路过，跳过 →' : '都还没检查，跳过 →')) + '</button></div>';
  } else {
    const isRoomQ = q.id === 'room' || q.id === 'passedRooms' || q.id === 'checkedRooms';
    const roomHtml = isRoomQ ? roomOptionsHtml(q, (v) => S.answers[q.id] === v) : null;
    const optionsBody = roomHtml !== null
      ? roomHtml
      : '<div class="opts">' + (q.opts || []).map(([label, emoji]) =>
          '<div class="opt ' + (S.answers[q.id] === label ? 'active' : '') + '" data-val="' + esc(label) + '"><span class="emoji">' + emoji + '</span>' + esc(label) + '</div>'
        ).join('') + '</div>';
    body = optionsBody + '<div class="btn-row"><button class="btn ghost" id="q-back">← 上一步</button></div>';
  }

  root.innerHTML = `
    <div class="page-title">🔍 引导推理 · 找眼镜</div>
    <p class="page-sub">${esc(agent)} 正在引导你回忆关键线索</p>
    <div class="steps">${vs.map((_, i) => `<i class="${i < S.step ? 'done' : (i === S.step ? 'cur' : '')}"></i>`).join('')}</div>
    <div class="card">
      <div class="q-head">
        <span class="q-no">第 ${S.step + 1} / ${vs.length} 问</span>
        <span class="q-text">${esc(q.q)}</span>
      </div>
      ${body}
    </div>`;

  const back = root.querySelector('#q-back');
  if (back) back.onclick = () => { if (S.step > 0) { S.step--; stepView(root); } };

  if (q.type === 'text') {
    const next = root.querySelector('#q-next');
    next.onclick = () => {
      const v = root.querySelector('#q-text').value.trim();
      if (v) { S.answers[q.id] = v; S.conversation.push({ q: q.q, a: v }); }
      S.step++;
      stepView(root);
    };
  } else if (q.type === 'multi') {
    root.querySelectorAll('.opt, .floor-tile.selectable').forEach((el) => {
      el.onclick = () => {
        const val = el.getAttribute('data-val');
        const i = S._multi.indexOf(val);
        if (i >= 0) S._multi.splice(i, 1); else S._multi.push(val);
        stepView(root); // 重绘选中态
      };
    });
    const next = root.querySelector('#q-next');
    next.onclick = () => {
      S.answers[q.id] = [...S._multi];
      S.conversation.push({ q: q.q, a: S._multi.length ? S._multi.join('、') : (q.id === 'passedRooms' ? '没路过' : '还没检查过') });
      S._multiStep = null;
      S.step++;
      stepView(root);
    };
  } else {
    root.querySelectorAll('.opt, .floor-tile.selectable').forEach((el) => {
      el.onclick = () => {
        const val = el.getAttribute('data-val');
        S.answers[q.id] = val;
        S.conversation.push({ q: q.q, a: val });
        S.step++;
        stepView(root);
      };
    });
  }
}

// ---------- 确认页 ----------
function confirmView(root) {
  const rows = S.conversation.map((c) => `
    <div class="ans-row"><span class="muted">${esc(c.q)}</span><b>${esc(c.a)}</b></div>`).join('');
  root.innerHTML = `
    <div class="page-title">🔍 引导推理 · 找眼镜</div>
    <p class="page-sub">线索已收集，确认后开始推理</p>
    <div class="card">${rows}</div>
    <div class="btn-row">
      <button class="btn ghost" id="r-restart">↺ 重新填写</button>
      <button class="btn" id="r-infer">🧠 开始推理</button>
    </div>`;
  root.querySelector('#r-restart').onclick = () => { restart(); stepView(root); };
  root.querySelector('#r-infer').onclick = () => doInfer(root);
}

// ---------- 推理 ----------
async function doInfer(root) {
  S.phase = 'inferring';
  root.innerHTML = `
    <div class="card soon">
      <div class="ico">🤔</div>
      <div class="t">正在推理…</div>
      <div class="d">结合生活常识、逻辑推理与你的历史数据（若大模型不可用将自动回退内置引擎）</div>
    </div>`;
  try {
    const d = await api('/reason/infer', { method: 'POST', body: { facts: S.answers } });
    S.result = d.result;
    S.phase = 'result';
    resultView(root);
  } catch (e) {
    S.phase = 'questions';
    toast(e.message);
    stepView(root);
  }
}

function engineTag(r) {
  if (r.engine === 'llm') return '<span class="engine-tag">🤖 大模型推理</span>';
  if (r.engine === 'local-fallback') return '<span class="engine-tag">🧩 内置引擎（LLM 回退）</span>';
  return '<span class="engine-tag">🧩 内置常识引擎</span>';
}

function resultView(root) {
  const r = S.result;
  const ranked = (r.ranked || []).map((it, i) => {
    const pct = Math.round(it.probability * 10) / 10;
    const reasons = (it.reason ? [it.reason] : (it.reasons || [])).map((x) => `<li>${esc(x)}</li>`).join('');
    return `
      <div class="rank-item">
        <div class="rank-num">${i + 1}</div>
        <div class="rank-main">
          <div class="rank-name">${esc(it.name)} <span class="rank-room">· ${esc(it.room)}</span></div>
          <div class="rank-bar"><i style="width:${Math.min(100, pct)}%"></i></div>
          ${reasons ? `<ul class="reasons">${reasons}</ul>` : ''}
        </div>
        <div class="rank-right">
          <div class="rank-pct">${pct}%</div>
          <button class="btn good sm" data-loc="${esc(it.name)}" data-room="${esc(it.room)}">在这里找到了 ✓</button>
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="page-title">🔍 推理结果</div>
    <p class="page-sub">${esc(store.user.profile.agentName)} 的分析结果 ${engineTag(r)}</p>
    <div class="result-top">
      <div class="big">🎯</div>
      <div>
        <div class="rt-name">最可能在：${esc(r.topLocation)} <span class="muted rt-room">（${esc(r.topRoom)}）</span></div>
        <div class="muted rt-conf">置信度约 ${Math.round(r.confidence * 10) / 10}%${r.timeHint ? ' · ' + esc(r.timeHint) : ''}</div>
      </div>
    </div>
    <div class="summary-box">💡 ${esc(r.summary || '')}</div>
    ${ranked}
    <div class="card">
      <div class="chart-title">📡 设备协助（硬件端口联动）</div>
      <div id="dev-panel"><span class="muted">正在检查你的设备…</span></div>
    </div>
    <div class="card">
      <div class="chart-title">还是没找到？</div>
      <div class="btn-row">
        <button class="btn ghost" id="nf-restart">↺ 换个思路重新回答</button>
        <button class="btn warn" id="nf-save">📝 记录本次未找到</button>
      </div>
    </div>`;

  root.querySelectorAll('[data-loc]').forEach((btn) => {
    btn.onclick = () => foundIt(btn.getAttribute('data-loc'), btn.getAttribute('data-room'), root);
  });
  root.querySelector('#nf-restart').onclick = () => { restart(); stepView(root); };
  root.querySelector('#nf-save').onclick = () => saveNotFound(root);

  // 设备协助：按实际接入的设备自适应（无设备时给出引导而非报错）
  renderDevicePanel(root);
}

// 设备面板：无硬件设备 → 友好提示；有设备 → 对应操作按钮
async function renderDevicePanel(root) {
  const box = root.querySelector('#dev-panel');
  if (!box) return;
  let devices = [];
  try {
    const d = await api('/hardware/devices');
    devices = d.devices || [];
  } catch {
    box.innerHTML = '<p class="muted">设备状态获取失败，稍后可到「硬件设备接入」页查看。</p>';
    return;
  }
  const locator = devices.find((x) => x.type === 'locator');
  const nfc = devices.find((x) => x.type === 'nfc');

  if (!locator && !nfc) {
    box.innerHTML = `
      <p class="muted" style="margin:0;">💡 你还没有接入硬件设备——没有设备也不影响，内置推理已给出候选；接入定位器后可用实时信号作强证据。</p>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn ghost sm" onclick="location.hash='#/hardware'">📡 去接入设备</button>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="btn-row">
      ${locator
        ? `<button class="btn warn" id="dv-locate">📡 定位器扫描（${esc(locator.name)}）</button>`
        : '<button class="btn warn" disabled title="未接入定位器">📡 定位器（未接入）</button>'}
      ${nfc
        ? `<button class="btn good" id="dv-ping">🔊 近场呼唤（${esc(nfc.name)}）</button>`
        : '<button class="btn good" disabled title="未接入近场设备">🔊 近场（未接入）</button>'}
      <button class="btn ghost" id="dv-reinfer">🔄 用设备结果重新推理</button>
    </div>
    <div id="dev-out" class="terminal hidden" style="margin-top:12px;"></div>
    <p class="hint" style="margin-top:8px;">定位器扫描后会自动把"最近定位报告"作为强证据注入推理；无对应设备时会提示去接入。</p>`;

  if (locator) box.querySelector('#dv-locate').onclick = () => deviceAction(root, locator.id, 'locate');
  if (nfc) box.querySelector('#dv-ping').onclick = () => deviceAction(root, nfc.id, 'ping');
  box.querySelector('#dv-reinfer').onclick = () => doInfer(root);
}

async function deviceAction(root, deviceId, command) {
  const out = root.querySelector('#dev-out');
  out.classList.remove('hidden');
  out.innerHTML = '<span class="ts">[发送指令…]</span>';
  try {
    const r = await api(`/hardware/devices/${deviceId}/command`, { method: 'POST', body: { command } });
    out.innerHTML = `<span class="ts">[${new Date().toTimeString().slice(0, 8)}]</span> <span class="ok">${esc(r.message)}</span>`;
    toast('设备结果已就绪，可点击「重新推理」');
  } catch (e) {
    out.innerHTML = `<span class="ts">[错误]</span> <span class="warn">${esc(e.message)}</span>`;
  }
}

async function foundIt(location, room, root) {
  const durationSec = Math.round((Date.now() - S.startTs) / 1000);
  try {
    await api('/reason/record', {
      method: 'POST',
      body: {
        startedAt: new Date(S.startTs).toISOString(),
        foundLocation: location,
        foundRoom: room,
        confidence: S.result.confidence,
        success: true,
        facts: S.answers,
        reasoning: S.result.summary,
        durationSec,
        conversation: S.conversation
      }
    });
    S.phase = 'found';
    root.innerHTML = `
      <div class="card center" style="padding:44px 20px;">
        <div style="font-size:54px;">🎉</div>
        <div style="font-weight:800;font-size:22px;margin:14px 0 6px;">找到啦！就在「${esc(location)}」</div>
        <p class="muted" style="font-size:14px;">本次找回用时约 ${durationSec} 秒，记录已保存，个人数据已更新。</p>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn" onclick="location.hash='#/'">🏠 返回首页</button>
        </div>
      </div>`;
  } catch (e) { toast(e.message); }
}

async function saveNotFound(root) {
  const durationSec = Math.round((Date.now() - S.startTs) / 1000);
  try {
    await api('/reason/record', {
      method: 'POST',
      body: {
        startedAt: new Date(S.startTs).toISOString(),
        success: false,
        facts: S.answers,
        reasoning: S.result.summary,
        durationSec,
        conversation: S.conversation
      }
    });
    S.phase = 'notfound';
    root.innerHTML = `
      <div class="card center" style="padding:44px 20px;">
        <div style="font-size:54px;">🤗</div>
        <div style="font-weight:800;font-size:22px;margin:14px 0 6px;">别着急，这次没找到也没关系</div>
        <p class="muted" style="font-size:14px;">未找到的情况已记录，系统会持续学习你的习惯。换个思路再试一次，或稍后借助硬件设备定位。</p>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn" id="nf2-restart">↺ 换个思路再试</button>
          <button class="btn ghost" onclick="location.hash='#/'">🏠 返回首页</button>
        </div>
      </div>`;
    root.querySelector('#nf2-restart').onclick = () => { restart(); stepView(root); };
  } catch (e) { toast(e.message); }
}
