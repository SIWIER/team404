// js/views/profile.view.js — 个人画像（个性化智能体）编辑，含家庭布局/户型
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast, roomEmoji } from '../ui.js';

const ROOM_PRESETS = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];

// 同类房间自动编号：卧室 → 卧室2 → 卧室3
function nextRoomName(base) {
  if (!layout.some((r) => r.name === base)) return base;
  let n = 2;
  while (layout.some((r) => r.name === base + n)) n++;
  return base + n;
}

let layout = []; // 编辑中的户型副本

export function renderProfile(root) {
  const p = store.user.profile;
  // 统一到 cells 数据源：多格房间（含走廊、视觉识别结果）与单格房间一致处理
  layout = (p.homeLayout || []).map((r) => ({
    ...r,
    spots: [...(r.spots || [])],
    furn: [...(r.furn || [])],
    cells: (Array.isArray(r.cells) && r.cells.length)
      ? r.cells.map((c) => ({ x: c.x, y: c.y }))
      : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : [])
  }));

  root.innerHTML = `
    <div class="page-title">🧠 个性化智能体</div>
    <p class="page-sub">画像越准确，后续推理越贴合你的习惯</p>
    <div class="card">
      <div class="field"><label>智能体昵称</label><input id="p-name" class="input" value="${esc(p.agentName)}"></div>
      <div class="field"><label>智能体风格</label><input id="p-style" class="input" value="${esc(p.agentStyle)}" placeholder="例如：温和、爱追问、擅长生活常识"></div>
      <div class="field"><label>生活习惯（每行一条，最多 20 条）</label><textarea id="p-habits" class="input">${esc((p.habits || []).join('\n'))}</textarea></div>
      <div class="field"><label>常用放眼镜地点（每行一条，最多 20 条）</label><textarea id="p-favs" class="input">${esc((p.favoritePlaces || []).join('\n'))}</textarea></div>
      <div class="field"><label>备注（度数 / 眼镜情况等）</label><textarea id="p-notes" class="input">${esc(p.notes || '')}</textarea></div>
      <div class="btn-row">
        <button class="btn" id="p-save">💾 保存画像</button>
        <button class="btn ghost" onclick="location.hash='#/'">← 返回首页</button>
      </div>
    </div>

    <div class="card">
      <div class="layout-head">
        <div>
      <div style="font-weight:800;font-size:17px;">🗂 户型图（按目录管理）</div>
          <p class="hint" style="margin:2px 0 0;">一个目录对应一个空间（家 / 公司 / 宿舍…），每个目录有独立的户型图；推理使用当前目录的户型。</p>
        </div>
        <button class="btn sm" id="p-save2">💾 保存布局</button>
      </div>
      <div id="space-bar" style="margin-bottom:10px;"></div>
      <div id="layout-list"></div>
      <div class="btn-row" id="layout-presets"></div>
      <div id="layout-preview" style="margin-top:14px;"></div>
    </div>`;

  root.querySelector('#p-save').onclick = () => saveBasic(root);
  root.querySelector('#p-save2').onclick = () => saveLayout(root);
  renderLayout(root);
  renderSpaces(root);
}

// ---------- 目录（家/公司/宿舍…）管理 ----------
function renderSpaces(root) {
  const bar = root.querySelector('#space-bar');
  if (!bar) return;
  const p = store.user.profile;
  const spaces = p.spaces || [];
  if (!spaces.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = `
    <span class="muted" style="font-size:12px;font-weight:600;">目录：</span>
    ${spaces.map((s) => `
      <span class="space-chip ${s.id === p.activeSpaceId ? 'on' : ''}" data-id="${s.id}">
        <b data-id="${s.id}" title="切换到该目录">${esc(s.name)}</b>
        ${s.id === p.activeSpaceId ? `<i class="space-act" data-act="rename" title="重命名">✎</i><i class="space-act" data-act="del" title="删除目录">✕</i>` : ''}
      </span>`).join('')}
    <button class="btn ghost sm" id="space-add">＋ 新建目录</button>`;
  bar.querySelectorAll('b[data-id]').forEach((el) => {
    el.onclick = () => switchSpace(root, Number(el.dataset.id));
  });
  bar.querySelectorAll('.space-act').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const id = Number(el.closest('.space-chip').dataset.id);
      if (el.dataset.act === 'rename') renameSpace(root, id);
      else deleteSpace(root, id);
    };
  });
  bar.querySelector('#space-add').onclick = () => addSpace(root);
}

async function switchSpace(root, id) {
  if (id === store.user.profile.activeSpaceId) return;
  try {
    const d = await api('/spaces/' + id + '/active', { method: 'PUT' });
    store.setUser(d.user);
    renderProfile(root);
    const name = (d.user.profile.spaces || []).find((s) => s.id === id);
    toast('已切换到「' + (name ? name.name : '') + '」');
  } catch (e) { toast(e.message); }
}

async function addSpace(root) {
  const name = (window.prompt('新建目录名称（如：家 / 公司 / 宿舍）') || '').trim();
  if (!name) return;
  try {
    const d = await api('/spaces', { method: 'POST', body: { name } });
    const fresh = await api('/auth/me');
    store.setUser(fresh.user);
    renderProfile(root);
    toast('已创建并切换到「' + d.space.name + '」');
  } catch (e) { toast(e.message); }
}

async function renameSpace(root, id) {
  const cur = (store.user.profile.spaces || []).find((s) => s.id === id);
  const name = (window.prompt('重命名目录', cur ? cur.name : '') || '').trim();
  if (!name) return;
  try {
    await api('/spaces/' + id, { method: 'PUT', body: { name } });
    const fresh = await api('/auth/me');
    store.setUser(fresh.user);
    renderProfile(root);
    toast('已重命名');
  } catch (e) { toast(e.message); }
}

async function deleteSpace(root, id) {
  if (!window.confirm('删除该目录会一并删除其户型图，确定？')) return;
  try {
    await api('/spaces/' + id, { method: 'DELETE' });
    const fresh = await api('/auth/me');
    store.setUser(fresh.user);
    renderProfile(root);
    toast('目录已删除');
  } catch (e) { toast(e.message); }
}

// ---------- 基础画像保存 ----------
async function saveBasic(root) {
  const btn = root.querySelector('#p-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 保存中…';
  try {
    const d = await api('/auth/profile', {
      method: 'PUT',
      body: {
        agentName: root.querySelector('#p-name').value.trim(),
        agentStyle: root.querySelector('#p-style').value.trim(),
        habits: lines(root.querySelector('#p-habits')),
        favoritePlaces: lines(root.querySelector('#p-favs')),
        notes: root.querySelector('#p-notes').value.trim()
      }
    });
    store.setUser(d.user);
    toast('画像已保存 ✓');
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  btn.innerHTML = '💾 保存画像';
}

// ---------- 家庭布局编辑 ----------
function renderLayout(root) {
  const list = root.querySelector('#layout-list');
  if (!layout.length) {
    list.innerHTML = '<div class="empty-layout">还没有添加房间，点下方按钮快速添加，或自定义房间名 👇</div>';
  } else {
    list.innerHTML = layout.map((r, i) => `
      <div class="room-card">
        <div class="room-card-top">
          <span class="room-emoji">${roomEmoji(r.name)}</span>
          <input class="input" data-i="${i}" data-k="name" value="${esc(r.name)}" placeholder="房间名（如 卧室 / 阳台）">
          <button class="btn ghost sm room-del" data-i="${i}" title="删除房间">✕</button>
        </div>
        <div class="room-card-row">
          <input class="input" data-i="${i}" data-k="desc" value="${esc(r.desc)}" placeholder="房间描述（可选，如：有床头柜和书桌）">
        </div>
        <div class="room-card-row">
          <input class="input" data-i="${i}" data-k="spots" value="${esc((r.spots || []).join('，'))}" placeholder="常放眼镜的位置，用逗号分隔（如：床头柜，书桌/电脑桌，窗台）">
        </div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn ghost sm room-mod" data-i="${i}" ${(r.cells || []).length ? '' : 'disabled'} title="编辑房间内部模块（书桌/书架/壁橱…）">🧩 内部模块${(r.furn || []).length ? `（${r.furn.length}）` : ''}</button>
        </div>
      </div>`).join('');
  }

  // 事件绑定
  list.querySelectorAll('.room-del').forEach((btn) => {
    btn.onclick = () => { layout.splice(Number(btn.dataset.i), 1); renderLayout(root); };
  });
  list.querySelectorAll('.room-mod').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      const room = layout[i];
      if (room && (room.cells || []).length) openRoomEditor(root, i);
    };
  });
  list.querySelectorAll('input[data-k]').forEach((inp) => {
    const commit = () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      if (!layout[i]) return;
      if (k === 'spots') {
        layout[i].spots = inp.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      } else if (k === 'name') {
        const raw = inp.value.trim();
        layout[i].name = raw;
        if (raw && layout.some((r, j) => j !== i && r.name === raw)) {
          layout[i].name = nextRoomName(raw);
          toast(`「${raw}」已存在，已自动命名为「${layout[i].name}」`);
        }
      } else {
        layout[i][k] = inp.value.trim();
      }
      renderFloor(root);
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('blur', commit);
  });

  // 快速添加预设
  const presets = root.querySelector('#layout-presets');
  const remaining = ROOM_PRESETS; // 同类房间可重复添加，添加时自动编号区分
  presets.innerHTML = [
    ...remaining.map((name) => `<button class="btn ghost sm" data-add="${esc(name)}">＋ ${roomEmoji(name)} ${esc(name)}</button>`),
    '<button class="btn ghost sm" id="add-custom">＋ ✏️ 自定义房间</button>'
  ].join('');
  presets.querySelectorAll('[data-add]').forEach((b) => {
    // 融合：保留同名自动编号 nextRoomName + 房间内部布局默认尺寸 w/h（与下方自定义房间一致）
    b.onclick = () => { layout.push({ name: nextRoomName(b.dataset.add), desc: '', spots: [], cells: [], w: 12, h: 12 }); renderLayout(root); };
  });
  presets.querySelector('#add-custom').onclick = () => {
    layout.push({ name: '', desc: '', spots: [], cells: [], w: 12, h: 12 });
    renderLayout(root);
  };

  renderFloor(root);
}

// ---------- 户型图拖曳编辑器（10×10 细网格，房间按面积占多格） ----------
const GRID = 10;
const cellKey = (x, y) => x + ',' + y;

function roomAt(x, y) {
  return layout.findIndex((r) => (r.cells || []).some((c) => c.x === x && c.y === y));
}

function renderFloor(root) {
  const box = root.querySelector('#layout-preview');
  if (!box) return;
  const placed = layout.filter((r) => r.name && (r.cells || []).length);
  const tray = layout.filter((r) => r.name && !(r.cells || []).length);
  const firstCellOf = (idx, x, y) => {
    const c = (layout[idx].cells || [])[0];
    return c && c.x === x && c.y === y ? layout[idx].name : '';
  };

  let cells = '';
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const idx = roomAt(x, y);
      cells += idx >= 0
        ? `<div class="floor-cell filled" data-x="${x}" data-y="${y}">
             <div class="floor-tile" draggable="true" data-idx="${idx}" title="拖到其他格子移动；点 ✕ 移出网格">
               <span class="tile-x" data-idx="${idx}" title="移出网格">✕</span>
               <div class="tile-emoji">${roomEmoji(layout[idx].name)}</div>
               <div class="tile-name">${esc(firstCellOf(idx, x, y))}</div>
             </div>
           </div>`
        : `<div class="floor-cell" data-x="${x}" data-y="${y}"></div>`;
    }
  }

  box.innerHTML = `
    <div class="muted" style="font-size:12px;font-weight:600;margin-bottom:8px;">户型图（拖拽房间摆放相对位置，将用于推理的距离远近计算；大房间多格、小房间少格）</div>
    ${tray.length ? `<div class="tray">待放置：${tray.map((r, i) => `
      <div class="floor-tile tray-tile" draggable="true" data-idx="${layout.indexOf(r)}" title="拖到下方网格中放置">
        <div class="tile-emoji">${roomEmoji(r.name)}</div>
        <div class="tile-name">${esc(r.name)}</div>
      </div>`).join('')}</div>` : ''}
    <div class="floor-grid">${cells}</div>
    <p class="hint" style="margin-top:8px;">相邻格子 = 相邻房间。推理时：与"最后所在房间"越近的位置权重越高；拖到 ✕ 外可移回待放置区。<b>双击房间</b>可设置该房间的大小（内部布局网格）。</p>`;

  // 拖放
  box.querySelectorAll('.floor-tile').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  // 双击已放置的房间块：打开房间内部细致布局（12×12 网格，拖右下角滑块定尺寸）
  box.querySelectorAll('.floor-cell .floor-tile').forEach((el) => {
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tile-x')) return;
      const idx = Number(el.dataset.idx);
      const room = layout[idx];
      if (room && (room.cells || []).length) openRoomEditor(root, idx);
    });
  });
  box.querySelectorAll('.floor-cell').forEach((cell) => {
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('over'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('over'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('over');
      const idx = Number(e.dataTransfer.getData('text/plain'));
      if (!Number.isInteger(idx) || !layout[idx]) return;
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      const r = layout[idx];
      if (!r.cells || !r.cells.length) return;
      if (r.cells.length === 1) {
        // 单格房间：原交换逻辑（仅与单格房间交换）
        const existing = roomAt(x, y);
        if (existing >= 0 && existing !== idx) {
          const other = layout[existing];
          if (!other.cells || other.cells.length !== 1) {
            toast('目标被多格房间占用，请先把它移开');
            renderFloor(root);
            return;
          }
          const old = { x: r.cells[0].x, y: r.cells[0].y };
          r.cells = [{ x, y }];
          other.cells = [old];
          toast('与「' + other.name + '」交换了位置');
        } else {
          r.cells = [{ x, y }];
        }
      } else {
        // 多格房间：整块平移，校验不出界、不重叠
        const dx = x - r.cells[0].x;
        const dy = y - r.cells[0].y;
        if (dx === 0 && dy === 0) return;
        const cand = r.cells.map((c) => ({ x: c.x + dx, y: c.y + dy }));
        const occupied = new Set();
        layout.forEach((o, j) => {
          if (j === idx) return;
          (o.cells || []).forEach((c) => occupied.add(cellKey(c.x, c.y)));
        });
        const ok = cand.every((c) =>
          c.x >= 0 && c.x < GRID && c.y >= 0 && c.y < GRID && !occupied.has(cellKey(c.x, c.y)));
        if (!ok) { toast('移不过去：会出界或与其他房间重叠'); renderFloor(root); return; }
        r.cells = cand;
      }
      renderFloor(root);
    });
  });
  // 移出网格（整间回托盘）
  box.querySelectorAll('.tile-x').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(el.dataset.idx);
      if (layout[idx]) { layout[idx].cells = []; layout[idx].x = null; layout[idx].y = null; }
      renderFloor(root);
    };
  });
}

// ---------- 房间内部细致布局（12×12 网格，左上角为起点，拖右下角滑块定尺寸，可放置家具） ----------
const ROOM_GRID = 12;
// 家具分类：通用家具任何房间都有；特定房间类型再附加专属家具；自定义/其他房间给全部家具
const FURN_COMMON = ['柜子', '架子', '窗台', '桌子'];
const FURN_BY_TYPE = {
  '卧室': ['床'],
  '卫生间': ['洗手池', '便池', '浴池'],
  '客厅': ['沙发', '电视'],
  '厨房': ['灶台', '冰箱', '洗手池']
};
const FURN_ALL = [...new Set([...FURN_COMMON, ...Object.values(FURN_BY_TYPE).flat()])];
const FURN_EMOJI = {
  '床': '🛏️', '柜子': '🗄️', '架子': '📦', '桌子': '🪑', '窗台': '🪟',
  '洗手池': '🚰', '便池': '🚽', '浴池': '🛁',
  '沙发': '🛋️', '电视': '📺',
  '灶台': '🍳', '冰箱': '🧊'
};
const FURN_PALETTE = [
  ['#e8f0ff', '#5b8def'],
  ['#fff3e0', '#e8963a'],
  ['#eaf7ed', '#4caf6d'],
  ['#fdeef3', '#e05c8e'],
  ['#e6f7f7', '#2fa3a3'],
  ['#e0f2ff', '#2f80c9'],
  ['#f3f0ff', '#7a5fe0'],
  ['#e0f6ff', '#2a9ec9'],
  ['#fdf0e6', '#d98a4a'],
  ['#eef1f6', '#5b7285'],
  ['#fff5e6', '#d9a03a'],
  ['#eaf4ff', '#4a90c9']
];
function furnEmoji(name) { return FURN_EMOJI[name] || '🪑'; }
function furnColors(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) % 997;
  const [bg, bd] = FURN_PALETTE[hash % FURN_PALETTE.length];
  return { bg, bd };
}
// 根据房间名返回家具选项（未匹配到特定类型 → 全部家具）
function furnOptionsFor(roomName) {
  const n = String(roomName || '');
  if (n.includes('卧室')) return [...FURN_COMMON, ...FURN_BY_TYPE['卧室']];
  if (n.includes('卫生间') || n.includes('厕所') || n.includes('洗手间')) return [...FURN_COMMON, ...FURN_BY_TYPE['卫生间']];
  if (n.includes('客厅')) return [...FURN_COMMON, ...FURN_BY_TYPE['客厅']];
  if (n.includes('厨房')) return [...FURN_COMMON, ...FURN_BY_TYPE['厨房']];
  return [...FURN_ALL];
}

function openRoomEditor(root, idx) {
  const room = layout[idx];
  if (!room) return;
  if (!Number.isFinite(room.w) || room.w < 1 || room.w > ROOM_GRID) room.w = ROOM_GRID;
  if (!Number.isFinite(room.h) || room.h < 1 || room.h > ROOM_GRID) room.h = ROOM_GRID;
  if (!Array.isArray(room.furn)) room.furn = [];

  const furnOptions = furnOptionsFor(room.name);
  let selectedFurn = null;

  const overlay = document.createElement('div');
  overlay.className = 'room-size-overlay';
  overlay.innerHTML = `
    <div class="room-size-panel" role="dialog" aria-modal="true">
      <div class="room-size-head">
        <div style="flex:1;">
          <div style="font-weight:800;font-size:18px;">${roomEmoji(room.name)} ${esc(room.name)} · 房间细致布局</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">拖动右下角滑块确定房间尺寸，选择家具后点击格子放置</div>
        </div>
        <button class="btn ghost sm" id="rs-close">✕ 关闭</button>
      </div>
      <div class="room-size-meta">房间大小：<b id="rs-size">${room.w} × ${room.h} 格</b><span class="muted">（左上角方块为起点，右下角滑块为终点）</span></div>
      <div class="furn-toolbar" id="furn-toolbar"></div>
      <p class="hint" style="margin:6px 0 8px;">选择家具后，在房间范围内点击格子放置；<b>再次点击已有家具格可删除</b>；上下左右相邻的相同家具会自动合并成一块。</p>
      <div class="room-grid-wrap">
        <div class="room-grid" id="rs-grid"></div>
        <div class="room-handle" id="rs-handle" title="拖动调整房间大小">⠿</div>
      </div>
      <p class="hint" style="margin:10px 0 0;">调整好后点「完成」，再点页面「💾 保存布局」即可生效。</p>
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn" id="rs-done">✓ 完成</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const grid = overlay.querySelector('#rs-grid');
  const handle = overlay.querySelector('#rs-handle');
  const sizeEl = overlay.querySelector('#rs-size');
  const toolbar = overlay.querySelector('#furn-toolbar');

  function renderToolbar() {
    const optsHtml = furnOptions.map((name) => `<button class="furn-opt${name === selectedFurn ? ' active' : ''}" data-furn="${esc(name)}">${furnEmoji(name)} <span>${esc(name)}</span></button>`).join('');
    toolbar.innerHTML = optsHtml + '<button class="furn-opt furn-add" id="furn-add" title="自行命名添加家具">＋ 自定义</button>';
    toolbar.querySelectorAll('[data-furn]').forEach((b) => {
      b.onclick = () => { selectedFurn = b.dataset.furn; renderToolbar(); };
    });
    toolbar.querySelector('#furn-add').onclick = () => {
      toolbar.innerHTML = optsHtml + '<span class="furn-input"><input id="furn-name" class="input" maxlength="10" placeholder="家具名称，回车确定"><button class="btn sm" id="furn-ok">添加</button><button class="btn ghost sm" id="furn-cancel">取消</button></span>';
      const input = toolbar.querySelector('#furn-name');
      const commit = () => {
        const n = String(input.value || '').trim().slice(0, 10);
        if (n) {
          if (!furnOptions.includes(n)) furnOptions.push(n);
          selectedFurn = n;
        }
        renderToolbar();
      };
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') renderToolbar();
      });
      toolbar.querySelector('#furn-ok').onclick = commit;
      toolbar.querySelector('#furn-cancel').onclick = () => renderToolbar();
    };
  }

  function render() {
    const furnMap = new Map();
    for (const f of room.furn) furnMap.set(f.x + ',' + f.y, f.name);
    let cells = '';
    for (let y = 0; y < ROOM_GRID; y++) {
      for (let x = 0; x < ROOM_GRID; x++) {
        const inside = x < room.w && y < room.h;
        const isOrigin = x === 0 && y === 0;
        const fname = furnMap.get(x + ',' + y);
        if (fname) {
          const { bg, bd } = furnColors(fname);
          const same = (dx, dy) => furnMap.get((x + dx) + ',' + (y + dy)) === fname;
          const side = (on) => (on ? '1px solid transparent' : '2px solid ' + bd);
          const style = `background:${bg};border-top:${side(same(0, -1))};border-bottom:${side(same(0, 1))};border-left:${side(same(-1, 0))};border-right:${side(same(1, 0))};`;
          cells += `<div class="room-cell furn" data-x="${x}" data-y="${y}" style="${style}"><span class="furn-e">${furnEmoji(fname)}</span><span class="furn-n">${esc(fname)}</span></div>`;
        } else {
          cells += `<div class="room-cell${inside ? ' in' : ''}${isOrigin ? ' origin' : ''}" data-x="${x}" data-y="${y}">${isOrigin ? '起' : ''}</div>`;
        }
      }
    }
    grid.innerHTML = cells;
    handle.style.left = (room.w / ROOM_GRID * 100) + '%';
    handle.style.top = (room.h / ROOM_GRID * 100) + '%';
    sizeEl.textContent = `${room.w} × ${room.h} 格`;
  }

  function onCellClick(x, y) {
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return;
    const i = room.furn.findIndex((f) => f.x === x && f.y === y);
    if (i >= 0) room.furn.splice(i, 1);
    else {
      if (!selectedFurn) { toast('请先选择一种家具'); return; }
      room.furn.push({ name: selectedFurn, x, y });
    }
    render();
  }

  grid.onclick = (e) => {
    const cell = e.target.closest('.room-cell');
    if (!cell) return;
    onCellClick(Number(cell.dataset.x), Number(cell.dataset.y));
  };

  render();
  renderToolbar();

  handle.onpointerdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = grid.getBoundingClientRect();
      if (!r.width || !r.height) return;
      let x = Math.floor((ev.clientX - r.left) / (r.width / ROOM_GRID)) + 1;
      let y = Math.floor((ev.clientY - r.top) / (r.height / ROOM_GRID)) + 1;
      x = Math.min(ROOM_GRID, Math.max(1, x));
      y = Math.min(ROOM_GRID, Math.max(1, y));
      if (x !== room.w || y !== room.h) {
        room.w = x;
        room.h = y;
        room.furn = room.furn.filter((f) => f.x < room.w && f.y < room.h);
        render();
      }
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const close = () => { overlay.remove(); renderFloor(root); };
  overlay.querySelector('#rs-close').onclick = close;
  overlay.querySelector('#rs-done').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

async function saveLayout(root) {
  const btn = root.querySelector('#p-save2');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 保存中…';
  try {
    const d = await api('/auth/profile', {
      method: 'PUT',
      body: {
        homeLayout: layout
          .filter((r) => r.name)
          .map((r) => {
            const cells = (r.cells || []).map((c) => ({ x: c.x, y: c.y }));
            const room = {
              name: r.name, desc: r.desc, spots: r.spots, cells,
              x: cells.length ? cells[0].x : null,
              y: cells.length ? cells[0].y : null
            };
            if (r.w !== undefined) room.w = r.w;
            if (r.h !== undefined) room.h = r.h;
            if (Array.isArray(r.furn) && r.furn.length) room.furn = r.furn;
            return room;
          })
      }
    });
    store.setUser(d.user);
    layout = d.user.profile.homeLayout.map((r) => ({
      ...r,
      spots: [...(r.spots || [])],
      furn: [...(r.furn || [])],
      cells: (Array.isArray(r.cells) && r.cells.length)
        ? r.cells.map((c) => ({ x: c.x, y: c.y }))
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : [])
    }));
    toast('家庭布局已保存 ✓');
    renderLayout(root);
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  btn.innerHTML = '💾 保存布局';
}

function lines(el) {
  return el.value.split('\n').map((s) => s.trim()).filter(Boolean);
}
