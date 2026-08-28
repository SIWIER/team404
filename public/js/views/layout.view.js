// js/views/layout.view.js — 户型图配置（独立页）：目录管理 + 户型图编辑器 + 房间内部模块
// 物品数字化存放系统：为每个目录（家/公司/宿舍…）维护一套户型图，房间内可配置内部模块（书桌/书架/壁橱…）
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast, roomEmoji } from '../ui.js';

// 预设房间按目录类型分组（家/公司/学校/宿舍…）：不同场景提供不同的房间方块托盘
const SPACE_PRESETS = {
  home: {
    label: '家', emoji: '🏠',
    presets: ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间']
  },
  office: {
    label: '公司', emoji: '🏢',
    presets: ['办公室', '会议室', '工位区', '前台', '茶水间', '经理室', '财务室', '档案室', '机房', '仓库', '走廊']
  },
  school: {
    label: '学校', emoji: '🏫',
    presets: ['教室', '实验室', '图书室', '办公室', '机房', '报告厅', '会议室', '食堂', '体育器材室', '宿舍', '走廊']
  },
  dorm: {
    label: '宿舍', emoji: '🛌',
    presets: ['宿舍', '卫生间', '浴室', '洗衣房', '自习室', '厨房', '客厅', '阳台', '储物间', '走廊']
  }
};
const SPACE_EMOJI = { home: '🏠', office: '🏢', school: '🏫', dorm: '🛌' };
// 目录名 → 空间类型（未匹配默认家用）
function spaceKindOf(name) {
  const n = String(name || '');
  if (/公司|办公|单位|企业|office/i.test(n)) return 'office';
  if (/学校|校园|学院|大学|中学|小学|school/i.test(n)) return 'school';
  if (/宿舍|公寓|dorm/i.test(n)) return 'dorm';
  return 'home';
}
function activeSpaceKind() {
  const p = store.user.profile;
  const cur = (p.spaces || []).find((s) => s.id === p.activeSpaceId);
  return spaceKindOf(cur ? cur.name : '');
}

// 同类房间自动编号：卧室 → 卧室2 → 卧室3
function nextRoomName(base) {
  if (!layout.some((r) => r.name === base)) return base;
  let n = 2;
  while (layout.some((r) => r.name === base + n)) n++;
  return base + n;
}

let layout = []; // 编辑中的户型副本

export function renderLayout(root) {
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
  const kind = SPACE_PRESETS[activeSpaceKind()];

  root.innerHTML = `
    <div class="page-title">🏠 户型图配置</div>
    <p class="page-sub">为每个目录（家 / 公司 / 宿舍…）维护一套户型图，房间内可配置内部模块（书桌 / 书架 / 壁橱…）</p>
    <div class="card">
      <div class="layout-head">
        <div>
          <div style="font-weight:800;font-size:17px;">🗂 户型图（按目录管理）</div>
          <p class="hint" style="margin:2px 0 0;">一个目录对应一个空间（家 / 公司 / 宿舍…），每个目录有独立的户型图；推理使用当前目录的户型。</p>
        </div>
        <button class="btn ghost sm" id="p-template" title="按当前目录类型（${kind.label}）把已有房间摆成标准户型">${kind.emoji} 生成标准户型</button>
        <button class="btn sm" id="p-save2">💾 保存布局</button>
      </div>
      <div id="space-bar" style="margin-bottom:10px;"></div>
      <div id="layout-list"></div>
      <div class="btn-row" id="layout-presets"></div>
      <div id="layout-preview" style="margin-top:14px;"></div>
    </div>`;

  root.querySelector('#p-save2').onclick = () => saveLayout(root);
  root.querySelector('#p-template').onclick = () => applyTemplate(root);
  renderLayoutList(root);
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
        <b data-id="${s.id}" title="切换到该目录">${SPACE_EMOJI[spaceKindOf(s.name)]} ${esc(s.name)}</b>
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
    renderLayout(root);
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
    renderLayout(root);
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
    renderLayout(root);
    toast('已重命名');
  } catch (e) { toast(e.message); }
}

async function deleteSpace(root, id) {
  if (!window.confirm('删除该目录会一并删除其户型图，确定？')) return;
  try {
    await api('/spaces/' + id, { method: 'DELETE' });
    const fresh = await api('/auth/me');
    store.setUser(fresh.user);
    renderLayout(root);
    toast('目录已删除');
  } catch (e) { toast(e.message); }
}

// ---------- 户型图编辑（房间卡片 + 预设托盘 + 网格） ----------
function renderLayoutList(root) {
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
    btn.onclick = () => { layout.splice(Number(btn.dataset.i), 1); renderLayoutList(root); };
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
  // 同类房间可重复添加，添加时自动编号区分；预设随当前目录类型（家/公司/学校/宿舍）切换
  const remaining = SPACE_PRESETS[activeSpaceKind()].presets;
  presets.innerHTML = [
    ...remaining.map((name) => `<button class="btn ghost sm" data-add="${esc(name)}">＋ ${roomEmoji(name)} ${esc(name)}</button>`),
    '<button class="btn ghost sm" id="add-custom">＋ ✏️ 自定义房间</button>'
  ].join('');
  presets.querySelectorAll('[data-add]').forEach((b) => {
    // 直接拖放：按住拖到网格任意格 = 在该格创建房间；点一下 = 放入第一个空位
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', 'preset:' + b.dataset.add);
      e.dataTransfer.effectAllowed = 'copy';
    });
    b.onclick = () => {
      const empty = firstEmptyCell();
      if (!empty) { toast('网格已满，先移出一些房间'); return; }
      layout.push({ name: nextRoomName(b.dataset.add), desc: '', spots: [], cells: [empty], w: 12, h: 12 });
      renderLayoutList(root);
    };
  });
  presets.querySelector('#add-custom').onclick = () => {
    layout.push({ name: '', desc: '', spots: [], cells: [], w: 12, h: 12 });
    renderLayoutList(root);
  };

  renderFloor(root);
}
// ---------- 户型图拖曳编辑器（10×10 细网格，房间按面积占多格） ----------
const GRID = 10;
const cellKey = (x, y) => x + ',' + y;
// 户型图编辑状态：sizeMode = 编辑大小模式；sizeTarget = 当前选中的房间
let sizeMode = false, sizeTarget = -1;

function firstEmptyCell() {
  const occ = new Set();
  layout.forEach((r) => (r.cells || []).forEach((c) => occ.add(cellKey(c.x, c.y))));
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!occ.has(cellKey(x, y))) return { x, y };
    }
  }
  return null;
}

// (x,y) 是否是目标房间四周的空格（编辑大小模式的 ＋ 候选）
function isCandCell(targetIdx, x, y) {
  const r = layout[targetIdx];
  if (!r || !Array.isArray(r.cells) || !r.cells.length) return false;
  const occ = new Set();
  layout.forEach((o, j) => {
    if (j === targetIdx) return;
    (o.cells || []).forEach((c) => occ.add(cellKey(c.x, c.y)));
  });
  if (occ.has(cellKey(x, y))) return false;
  return r.cells.some((c) =>
    (Math.abs(c.x - x) === 1 && c.y === y) || (c.x === x && Math.abs(c.y - y) === 1));
}

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

  // 编辑大小模式：选中房间的虚线包围盒（左上角像素在渲染后计算）
  let guide = null;
  if (sizeMode && sizeTarget >= 0 && layout[sizeTarget] && (layout[sizeTarget].cells || []).length) {
    const cs = layout[sizeTarget].cells;
    const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
    guide = {
      name: layout[sizeTarget].name,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
      w: Math.max(...xs) - Math.min(...xs) + 1,
      h: Math.max(...ys) - Math.min(...ys) + 1
    };
  }

  let cells = '';
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const idx = roomAt(x, y);
      if (idx >= 0) {
        const isSel = sizeMode && idx === sizeTarget;
        const first = (layout[idx].cells || [])[0];
        cells += `<div class="floor-cell filled" data-x="${x}" data-y="${y}">
          <div class="floor-tile${isSel ? ' sel' : ''}" draggable="${sizeMode ? 'false' : 'true'}" data-idx="${idx}" title="${sizeMode ? '点选房间后加减格' : '拖到其他格子移动；点 ✕ 移出网格'}">
            ${sizeMode
              ? ((layout[idx].cells || []).length > 1 && first && first.x === x && first.y === y
                  ? `<span class="tile-minus" data-idx="${idx}" data-x="${x}" data-y="${y}" title="减格">−</span>` : '')
              : `<span class="tile-x" data-idx="${idx}" title="移出网格">✕</span>`}
            <div class="tile-emoji">${roomEmoji(layout[idx].name)}</div>
            <div class="tile-name">${esc(firstCellOf(idx, x, y))}</div>
          </div>
        </div>`;
      } else if (sizeMode && sizeTarget >= 0 && isCandCell(sizeTarget, x, y)) {
        cells += `<div class="floor-cell cand" data-idx="${sizeTarget}" data-x="${x}" data-y="${y}" title="加格">＋</div>`;
      } else {
        cells += `<div class="floor-cell" data-x="${x}" data-y="${y}"></div>`;
      }
    }
  }

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
      <div class="muted" style="font-size:12px;font-weight:600;">户型图（拖拽房间摆放相对位置，将用于推理的距离远近计算；大房间多格、小房间少格）</div>
      <button class="btn ghost sm" id="size-toggle" style="flex:none;">${sizeMode ? '✅ 完成编辑大小' : '📐 编辑大小'}</button>
    </div>
    ${sizeMode ? '<p class="hint" style="margin:-2px 0 8px;">编辑大小：点房间选中，点 ＋ 加格、点 − 减格（至少保留一格）</p>' : ''}
    ${tray.length ? `<div class="tray">待放置：${tray.map((r, i) => `
      <div class="floor-tile tray-tile" draggable="true" data-idx="${layout.indexOf(r)}" title="拖到下方网格中放置">
        <div class="tile-emoji">${roomEmoji(r.name)}</div>
        <div class="tile-name">${esc(r.name)}</div>
      </div>`).join('')}</div>` : ''}
    <div class="floor-grid" style="position:relative;">${cells}${guide ? '<div class="size-guide" data-guide="1"></div><span class="size-guide-tag" data-guide-tag="1"></span>' : ''}</div>
    <p class="hint" style="margin-top:8px;">相邻格子 = 相邻房间。推理时：与"最后所在房间"越近的位置权重越高；拖到 ✕ 外可移回待放置区。${sizeMode ? '' : '<b>双击房间</b>可展开内部布局（家具模块）。'}</p>`;

  // 编辑大小：选中房间的虚线包围盒按渲染后的实际格子尺寸定位
  if (guide) {
    const gEl = box.querySelector('[data-guide="1"]');
    const tEl = box.querySelector('[data-guide-tag="1"]');
    const gridEl = box.querySelector('.floor-grid');
    if (gEl && gridEl) {
      const rect = gridEl.getBoundingClientRect();
      const gap = 6;
      const cw = (rect.width - (GRID - 1) * gap) / GRID;
      const px = (i) => i * (cw + gap);
      const left = px(guide.minX) - 3, top = px(guide.minY) - 3;
      gEl.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${(guide.maxX - guide.minX + 1) * cw + (guide.maxX - guide.minX) * gap + 6}px;height:${(guide.maxY - guide.minY + 1) * cw + (guide.maxY - guide.minY) * gap + 6}px;`;
      tEl.style.cssText = `position:absolute;left:${left}px;top:${Math.max(0, top - 26)}px;`;
      tEl.textContent = guide.name + ' · ' + guide.w + '×' + guide.h + ' 格';
    }
  }

  box.querySelector('#size-toggle').onclick = () => {
    sizeMode = !sizeMode;
    sizeTarget = -1;
    renderFloor(root);
  };

  // 拖放
  box.querySelectorAll('.floor-tile').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  // 编辑大小：点房间选中；点 ＋ 加格；点 − 减格（至少保留一格）
  box.querySelectorAll('.floor-cell.filled .floor-tile').forEach((el) => {
    el.onclick = (e) => {
      if (!sizeMode || e.target.closest('.tile-minus')) return;
      sizeTarget = Number(el.dataset.idx);
      renderFloor(root);
    };
  });
  box.querySelectorAll('.floor-cell.cand').forEach((el) => {
    el.onclick = () => {
      const idx = Number(el.dataset.idx);
      if (!layout[idx]) return;
      layout[idx].cells.push({ x: Number(el.dataset.x), y: Number(el.dataset.y) });
      renderFloor(root);
    };
  });
  box.querySelectorAll('.tile-minus').forEach((el) => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(el.dataset.idx);
      const r = layout[idx];
      if (!r || (r.cells || []).length <= 1) return;
      r.cells = r.cells.filter((c) => !(c.x === Number(el.dataset.x) && c.y === Number(el.dataset.y)));
      renderFloor(root);
    };
  });
  // 双击已放置的房间块：打开房间内部细致布局（12×12 网格，拖右下角滑块定尺寸）
  box.querySelectorAll('.floor-cell .floor-tile').forEach((el) => {
    el.addEventListener('dblclick', (e) => {
      if (sizeMode) return;
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
      const data = e.dataTransfer.getData('text/plain');
      const x = Number(cell.dataset.x);
      const y = Number(cell.dataset.y);
      // 预设直接拖放：拖到哪格就在哪格创建房间
      if (data.indexOf('preset:') === 0) {
        const name = data.slice(7);
        if (roomAt(x, y) >= 0) { toast('该格已被占用'); renderFloor(root); return; }
        layout.push({ name: nextRoomName(name), desc: '', spots: [], cells: [{ x, y }], w: 12, h: 12 });
        renderFloor(root);
        return;
      }
      const idx = Number(data);
      if (!Number.isInteger(idx) || !layout[idx]) return;
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
// 家具分类：通用家具任何房间都有（书桌/书架/壁橱…）；特定房间类型再附加专属家具；自定义/其他房间给全部家具
const FURN_COMMON = ['书桌', '书架', '壁橱', '柜子', '架子', '窗台', '桌子'];
const FURN_BY_TYPE = {
  '卧室': ['床', '床头柜'],
  '卫生间': ['洗手池', '便池', '浴池'],
  '客厅': ['沙发', '电视', '茶几'],
  '厨房': ['灶台', '冰箱', '洗手池'],
  '书房': ['书桌', '书架']
};
const FURN_ALL = [...new Set([...FURN_COMMON, ...Object.values(FURN_BY_TYPE).flat()])];
const FURN_EMOJI = {
  '书桌': '🖥️', '书架': '📚', '壁橱': '👕', '床': '🛏️', '床头柜': '🗄️',
  '柜子': '🗄️', '架子': '📦', '桌子': '🪑', '窗台': '🪟', '洗手池': '🚰', '便池': '🚽',
  '浴池': '🛁', '沙发': '🛋️', '电视': '📺', '茶几': '🪑', '灶台': '🍳', '冰箱': '🧊',
  '办公桌': '💻', '电脑': '🖥️', '文件柜': '🗄️', '会议桌': '🪑', '投影': '📽️', '椅子': '🪑',
  '课桌椅': '🪑', '黑板': '📋', '讲台': '🎤', '实验台': '🧪', '仪器柜': '🗄️', '服务器': '🖥️',
  '货架': '🗃️', '箱子': '📦', '衣柜': '👕', '洗衣机': '🧺', '餐桌': '🍽️'
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
function furnEmoji(name) {
  // 同名物件自动编号（书桌2/书桌3…）：按基础名查 emoji
  return FURN_EMOJI[String(name || '').replace(/\d+$/, '')] || '🪑';
}
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
  if (n.includes('书房')) return [...FURN_COMMON, ...FURN_BY_TYPE['书房']];
  // 公司/学校/宿舍场景的房间模块
  if (n.includes('办公室') || n.includes('工位区') || n.includes('经理室') || n.includes('财务室') || n.includes('前台')) return [...FURN_COMMON, '办公桌', '电脑', '文件柜'];
  if (n.includes('会议室') || n.includes('报告厅')) return [...FURN_COMMON, '会议桌', '投影', '椅子'];
  if (n.includes('教室')) return [...FURN_COMMON, '课桌椅', '黑板', '讲台'];
  if (n.includes('实验室')) return [...FURN_COMMON, '实验台', '仪器柜'];
  if (n.includes('机房')) return [...FURN_COMMON, '服务器', '电脑'];
  if (n.includes('图书室') || n.includes('自习室')) return [...FURN_COMMON, '书架', '书桌'];
  if (n.includes('档案室') || n.includes('体育器材室')) return [...FURN_COMMON, '架子', '箱子'];
  if (n.includes('仓库')) return [...FURN_COMMON, '货架', '箱子'];
  if (n.includes('宿舍')) return [...FURN_COMMON, '床', '书桌', '衣柜'];
  if (n.includes('浴室')) return [...FURN_COMMON, '浴池', '洗手池'];
  if (n.includes('洗衣房')) return [...FURN_COMMON, '洗衣机', '架子'];
  if (n.includes('食堂') || n.includes('餐厅')) return [...FURN_COMMON, '餐桌', '冰箱'];
  return [...FURN_ALL];
}

// 房间外轮廓辅助线：户型图轮廓按整数格等比放大到 12×12 内部画布（只描外圈线条、紧贴网格、边界防裁剪）
function roomOutlinePx(room, cellPx) {
  const cells = (Array.isArray(room.cells) && room.cells.length) ? room.cells : [];
  if (!cells.length) return [];
  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
  const rel = cells.map((c) => ({ x: c.x - minX, y: c.y - minY }));
  const scale = Math.max(1, Math.min(Math.floor(ROOM_GRID / w), Math.floor(ROOM_GRID / h)));
  const offX = Math.floor((ROOM_GRID - w * scale) / 2);
  const offY = Math.floor((ROOM_GRID - h * scale) / 2);
  const maxPx = ROOM_GRID * cellPx;
  const W = 2, HW = Math.floor(W / 2);
  const clampPos = (v) => Math.max(0, Math.min(maxPx - W, v));
  const clampLen = (v) => Math.max(0, Math.min(maxPx, v));
  const set = new Set(rel.map((c) => c.x + ',' + c.y));
  const has = (x, y) => x >= 0 && x < w && y >= 0 && y < h && set.has(x + ',' + y);
  const segs = [];
  rel.forEach((c) => {
    const x0 = (offX + c.x * scale) * cellPx;
    const y0 = (offY + c.y * scale) * cellPx;
    const len = scale * cellPx;
    if (!has(c.x - 1, c.y)) { const t = clampLen(y0 - HW), b = clampLen(y0 + len + HW); if (b > t) segs.push({ left: clampPos(x0 - HW), top: t, width: W, height: b - t }); }
    if (!has(c.x + 1, c.y)) { const t = clampLen(y0 - HW), b = clampLen(y0 + len + HW); if (b > t) segs.push({ left: clampPos(x0 + len - HW), top: t, width: W, height: b - t }); }
    if (!has(c.x, c.y - 1)) { const l = clampLen(x0 - HW), r = clampLen(x0 + len + HW); if (r > l) segs.push({ left: l, top: clampPos(y0 - HW), width: r - l, height: W }); }
    if (!has(c.x, c.y + 1)) { const l = clampLen(x0 - HW), r = clampLen(x0 + len + HW); if (r > l) segs.push({ left: l, top: clampPos(y0 + len - HW), width: r - l, height: W }); }
  });
  return segs;
}

function openRoomEditor(root, idx) {
  const room = layout[idx];
  if (!room) return;
  if (!Number.isFinite(room.w) || room.w < 1 || room.w > ROOM_GRID) room.w = ROOM_GRID;
  if (!Number.isFinite(room.h) || room.h < 1 || room.h > ROOM_GRID) room.h = ROOM_GRID;
  // 家具数据归一化：兼容旧单格 {name,x,y} 与多格 {name,cells}
  room.furn = (Array.isArray(room.furn) ? room.furn : []).map((f) => ({
    name: f.name,
    cells: (Array.isArray(f.cells) && f.cells.length)
      ? f.cells.map((c) => ({ x: c.x, y: c.y }))
      : [{ x: f.x, y: f.y }]
  }));
  // 家具编辑大小模式：furnSizeMode 开、furnSizeTarget 为选中家具下标
  let furnSizeMode = false, furnSizeTarget = -1;

  const furnOptions = furnOptionsFor(room.name);
  let selectedFurn = null;
  // 同名物件自动编号（书桌、书桌2、书桌3…）
  const nextFurnName = (base) => {
    if (!room.furn.some((f) => f.name === base)) return base;
    let n = 2;
    while (room.furn.some((f) => f.name === base + n)) n++;
    return base + n;
  };
  // 房间范围内第一个空格（点家具按钮 → 快捷放入）
  const firstFurnEmpty = () => {
    const occ = new Set();
    room.furn.forEach((f) => f.cells.forEach((c) => occ.add(c.x + ',' + c.y)));
    for (let y = 0; y < room.h; y++) {
      for (let x = 0; x < room.w; x++) {
        if (!occ.has(x + ',' + y)) return { x, y };
      }
    }
    return null;
  };

  const overlay = document.createElement('div');
  overlay.className = 'room-size-overlay';
  overlay.innerHTML = `
    <div class="room-size-panel" role="dialog" aria-modal="true">
      <div class="room-size-head">
        <div style="flex:1;">
          <div style="font-weight:800;font-size:18px;">${roomEmoji(room.name)} ${esc(room.name)} · 房间细致布局</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">点家具快捷放入首个空位；也可点格放置/删除；「编辑家具大小」可加减格</div>
        </div>
        <button class="btn ghost sm" id="rs-close">✕ 关闭</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
        <div class="room-size-meta" style="margin-bottom:0;">房间大小：<b id="rs-size">${room.w} × ${room.h} 格</b><span class="muted">（拖右下角滑块）</span></div>
        <button class="btn ghost sm" id="furn-size-toggle" style="flex:none;">${furnSizeMode ? '✅ 完成编辑大小' : '📐 编辑家具大小'}</button>
      </div>
      <div class="furn-toolbar" id="furn-toolbar"></div>
      <p class="hint" style="margin:6px 0 8px;">${furnSizeMode ? '编辑家具大小：点家具选中，点 ＋ 加格、点 − 减格（至少保留一格）' : '选择家具后自动放入第一个空位；在房间范围内点击格子可放置，再次点击已有家具格删除；相邻同家具自动合并成一块。'}</p>
      <div class="room-grid-wrap">
        <div class="room-grid" id="rs-grid"></div>
        <div class="room-outline" id="rs-outline"></div>
        <div class="room-handle" id="rs-handle" title="拖动调整房间大小">⠿</div>
      </div>
      <p class="hint" style="margin:10px 0 0;">蓝色线条 = 房间外轮廓（来自户型图，等比放大、紧贴网格）；调整好后点「完成」，再点页面「💾 保存布局」即可生效。</p>
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
      b.onclick = () => {
        selectedFurn = b.dataset.furn;
        renderToolbar();
        // 点一下 = 放入第一个空位（编辑家具大小模式下只选中，不自动放置）
        if (furnSizeMode) return;
        const empty = firstFurnEmpty();
        if (empty) {
          room.furn.push({ name: nextFurnName(selectedFurn), cells: [empty] });
          render();
        } else {
          toast('画布已满，先移出一些家具');
        }
      };
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

  const selFurn = () => (furnSizeMode && furnSizeTarget >= 0 ? room.furn[furnSizeTarget] : null);
  // 家具四周的空格（编辑家具大小模式的 ＋ 候选）
  const isCandFurnCell = (f, x, y) => {
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return false;
    const occ = new Set();
    room.furn.forEach((o) => o.cells.forEach((c) => occ.add(c.x + ',' + c.y)));
    if (occ.has(x + ',' + y)) return false;
    return f.cells.some((c) => (Math.abs(c.x - x) === 1 && c.y === y) || (c.x === x && Math.abs(c.y - y) === 1));
  };
  // 房间外轮廓辅助线（来自户型图，等比放大、紧贴网格、只描外圈）
  function renderOutline() {
    const wrap = overlay.querySelector('.room-grid-wrap');
    const out = overlay.querySelector('#rs-outline');
    if (!wrap || !out) return;
    const cellPx = (wrap.clientWidth || 440) / ROOM_GRID;
    out.innerHTML = roomOutlinePx(room, cellPx).map((s) =>
      `<div class="room-edge" style="left:${s.left}px;top:${s.top}px;width:${s.width}px;height:${s.height}px;"></div>`).join('');
  }
  // 编辑家具大小：选中家具的虚线包围盒 + 尺寸标注
  function renderFurnGuide() {
    const wrap = overlay.querySelector('.room-grid-wrap');
    let g = wrap && wrap.querySelector('.furn-guide');
    const f = selFurn();
    if (!f || !f.cells.length) {
      if (g) g.remove();
      return;
    }
    if (!g) {
      g = document.createElement('div');
      g.className = 'size-guide furn-guide';
      wrap.appendChild(g);
    }
    const cellPx = (wrap.clientWidth || 440) / ROOM_GRID;
    const xs = f.cells.map((c) => c.x), ys = f.cells.map((c) => c.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    g.style.left = (minX * cellPx - 3) + 'px';
    g.style.top = (minY * cellPx - 3) + 'px';
    g.style.width = ((Math.max(...xs) - minX + 1) * cellPx + 6) + 'px';
    g.style.height = ((Math.max(...ys) - minY + 1) * cellPx + 6) + 'px';
  }

  function render() {
    // 家具格 → 所属家具（多格展开）
    const furnMap = new Map();
    room.furn.forEach((f, fi) => f.cells.forEach((c) => furnMap.set(c.x + ',' + c.y, { f, fi })));
    const fSel = selFurn();
    let cells = '';
    for (let y = 0; y < ROOM_GRID; y++) {
      for (let x = 0; x < ROOM_GRID; x++) {
        const inside = x < room.w && y < room.h;
        const isOrigin = x === 0 && y === 0;
        const hit = furnMap.get(x + ',' + y);
        if (hit) {
          const { f, fi } = hit;
          const { bg, bd } = furnColors(f.name);
          const same = (dx, dy) => { const g = furnMap.get((x + dx) + ',' + (y + dy)); return g && g.f === f; };
          const side = (on) => (on ? '1px solid transparent' : '2px solid ' + bd);
          const style = `background:${bg};border-top:${side(same(0, -1))};border-bottom:${side(same(0, 1))};border-left:${side(same(-1, 0))};border-right:${side(same(1, 0))};`;
          const first = f.cells[0];
          const isFirst = first && first.x === x && first.y === y;
          const showMinus = furnSizeMode && furnSizeTarget === fi && f.cells.length > 1 && isFirst;
          cells += `<div class="room-cell furn${furnSizeMode && furnSizeTarget === fi ? ' sel' : ''}" data-x="${x}" data-y="${y}" style="${style}">${showMinus ? `<span class="tile-minus" data-fi="${fi}" data-x="${x}" data-y="${y}" title="减格">−</span>` : ''}<span class="furn-e">${isFirst && f.cells.length > 1 ? furnEmoji(f.name) : ''}</span><span class="furn-n">${isFirst ? esc(f.name) : ''}</span></div>`;
        } else if (furnSizeMode && fSel && inside && isCandFurnCell(fSel, x, y)) {
          cells += `<div class="room-cell cand" data-fi="${furnSizeTarget}" data-x="${x}" data-y="${y}" title="加格">＋</div>`;
        } else {
          cells += `<div class="room-cell${inside ? ' in' : ''}${isOrigin ? ' origin' : ''}" data-x="${x}" data-y="${y}">${isOrigin ? '起' : ''}</div>`;
        }
      }
    }
    grid.innerHTML = cells;
    handle.style.left = (room.w / ROOM_GRID * 100) + '%';
    handle.style.top = (room.h / ROOM_GRID * 100) + '%';
    sizeEl.textContent = `${room.w} × ${room.h} 格`;
    renderOutline();
    renderFurnGuide();
  }

  function onCellClick(x, y) {
    if (x < 0 || y < 0 || x >= room.w || y >= room.h) return;
    // 编辑家具大小：点家具选中（加减格由 ＋/− 完成）
    if (furnSizeMode) {
      const hit = room.furn.findIndex((f) => f.cells.some((c) => c.x === x && c.y === y));
      if (hit >= 0) {
        furnSizeTarget = hit;
        render();
      }
      return;
    }
    const hit = room.furn.find((f) => f.cells.some((c) => c.x === x && c.y === y));
    if (hit) {
      // 点击已有家具格：删除该格（多格减一格，单格删整个家具）
      const cells = hit.cells;
      const i = cells.findIndex((c) => c.x === x && c.y === y);
      if (i >= 0) {
        cells.splice(i, 1);
        if (!cells.length) room.furn = room.furn.filter((f) => f !== hit);
      }
    } else {
      if (!selectedFurn) { toast('请先选择一种家具（点上方按钮可快捷放置）'); return; }
      room.furn.push({ name: nextFurnName(selectedFurn), cells: [{ x, y }] });
    }
    render();
  }

  grid.onclick = (e) => {
    const cell = e.target.closest('.room-cell');
    if (!cell) return;
    // 编辑家具大小：− 减格 / ＋ 加格 优先处理
    const minus = e.target.closest('.tile-minus');
    if (minus) {
      const f = room.furn[Number(minus.dataset.fi)];
      if (f && f.cells.length > 1) {
        f.cells = f.cells.filter((c) => !(c.x === Number(minus.dataset.x) && c.y === Number(minus.dataset.y)));
      }
      render();
      return;
    }
    if (cell.classList.contains('cand')) {
      const f = room.furn[Number(cell.dataset.fi)];
      if (f) f.cells.push({ x: Number(cell.dataset.x), y: Number(cell.dataset.y) });
      render();
      return;
    }
    onCellClick(Number(cell.dataset.x), Number(cell.dataset.y));
  };

  // 编辑家具大小：切换模式
  overlay.querySelector('#furn-size-toggle').onclick = () => {
    furnSizeMode = !furnSizeMode;
    furnSizeTarget = -1;
    renderToolbar();
    render();
  };

  render();
  renderToolbar();
  // 外轮廓辅助线依赖网格实际渲染宽度，下一帧重算一次
  requestAnimationFrame(() => renderOutline());

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
        room.furn = room.furn
          .map((f) => ({ ...f, cells: f.cells.filter((c) => c.x < room.w && c.y < room.h) }))
          .filter((f) => f.cells.length);
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
// ---------- 标准户型模板（10×10 细网格）：走廊居中成链，所有房间与走廊相邻（全连通） ----------
function rect(x0, y0, w, h) {
  const cells = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  }
  return cells;
}
const TEMPLATE_HOME = [
  { key: '走廊', cells: Array.from({ length: 8 }, (_, i) => ({ x: 4, y: i + 1 })) },
  { key: '玄关', cells: [{ x: 4, y: 9 }] },
  { key: '客厅', cells: rect(5, 2, 4, 3) },
  { key: '阳台', cells: rect(9, 2, 1, 3) },
  { key: '卧室2', cells: rect(0, 1, 3, 3) },
  { key: '卧室', cells: rect(0, 5, 3, 3) },
  { key: '厨房', cells: rect(5, 6, 2, 2) },
  { key: '卫生间', cells: rect(7, 6, 2, 2) },
  { key: '卫生间2', cells: rect(5, 9, 2, 1) },
  { key: '餐厅', cells: rect(7, 8, 2, 1) },
  { key: '书房', cells: rect(0, 8, 3, 2) },
  { key: '衣帽间', cells: rect(3, 1, 1, 3) },
  { key: '储物间', cells: rect(3, 5, 1, 3) }
];
// 公司标准户型（10×10）：走廊竖链居中，前台/办公室/工位区/会议室等与走廊或相邻房间相连
const TEMPLATE_OFFICE = [
  { key: '走廊', cells: Array.from({ length: 8 }, (_, i) => ({ x: 4, y: i + 1 })) },
  { key: '前台', cells: [{ x: 4, y: 0 }] },
  { key: '办公室', cells: rect(1, 1, 3, 3) },
  { key: '工位区', cells: rect(1, 5, 3, 3) },
  { key: '会议室', cells: rect(5, 1, 3, 3) },
  { key: '茶水间', cells: rect(8, 1, 1, 2) },
  { key: '经理室', cells: rect(5, 5, 2, 2) },
  { key: '财务室', cells: rect(7, 5, 2, 2) },
  { key: '档案室', cells: rect(5, 8, 2, 1) },
  { key: '机房', cells: rect(7, 8, 2, 1) },
  { key: '仓库', cells: rect(1, 8, 3, 1) }
];
// 学校标准户型：教室/实验室/图书室/机房/报告厅等围绕走廊
const TEMPLATE_SCHOOL = [
  { key: '走廊', cells: Array.from({ length: 8 }, (_, i) => ({ x: 4, y: i + 1 })) },
  { key: '教室', cells: rect(1, 1, 3, 3) },
  { key: '实验室', cells: rect(5, 1, 3, 2) },
  { key: '体育器材室', cells: rect(8, 1, 1, 2) },
  { key: '宿舍', cells: rect(8, 3, 1, 2) },
  { key: '图书室', cells: rect(1, 5, 3, 3) },
  { key: '机房', cells: rect(5, 5, 2, 2) },
  { key: '办公室', cells: rect(7, 5, 2, 2) },
  { key: '食堂', cells: rect(1, 8, 3, 1) },
  { key: '报告厅', cells: rect(5, 8, 3, 1) }
];
// 宿舍标准户型：宿舍/卫浴/洗衣房/自习室/客厅/厨房等围绕走廊
const TEMPLATE_DORM = [
  { key: '走廊', cells: Array.from({ length: 9 }, (_, i) => ({ x: 4, y: i + 1 })) },
  { key: '储物间', cells: [{ x: 4, y: 0 }] },
  { key: '宿舍', cells: rect(1, 1, 3, 2) },
  { key: '宿舍2', cells: rect(1, 4, 3, 2) },
  { key: '卫生间', cells: rect(5, 1, 2, 2) },
  { key: '浴室', cells: rect(7, 1, 2, 2) },
  { key: '洗衣房', cells: rect(5, 4, 2, 2) },
  { key: '自习室', cells: rect(7, 4, 2, 2) },
  { key: '厨房', cells: rect(1, 7, 3, 2) },
  { key: '客厅', cells: rect(5, 7, 2, 2) },
  { key: '阳台', cells: rect(7, 7, 2, 2) }
];
// 目录类型 → 标准户型模板
const SPACE_TEMPLATES = {
  home: TEMPLATE_HOME,
  office: TEMPLATE_OFFICE,
  school: TEMPLATE_SCHOOL,
  dorm: TEMPLATE_DORM
};

// 生成标准户型：先清空，按模板摆放（走廊链连接所有房间），剩余房间补空
function applyTemplate(root) {
  const named = layout.filter((r) => r.name);
  if (!named.length) { toast('还没有房间，先在下方添加房间方块'); return; }
  layout.forEach((r) => { r.cells = []; });
  sizeMode = false; sizeTarget = -1;
  const kind = SPACE_PRESETS[activeSpaceKind()];
  const template = SPACE_TEMPLATES[activeSpaceKind()];
  const occupied = () => layout.flatMap((r) => r.cells);
  const isFree = (cs) => cs.every((c) => !occupied().some((o) => o.x === c.x && o.y === c.y));
  for (const slot of template) {
    const candidate = layout.find((r) =>
      r.name.includes(slot.key) && !r.cells.length && isFree(slot.cells));
    if (!candidate) continue;
    candidate.cells = slot.cells.map((c) => ({ x: c.x, y: c.y }));
  }
  for (const room of layout.filter((r) => r.name && !r.cells.length)) {
    const empty = firstEmptyCell();
    if (!empty) break;
    room.cells = [empty];
  }
  renderLayoutList(root);
  toast(kind.emoji + ' 已生成「' + kind.label + '」标准户型：所有房间都通过走廊相连（可拖动微调）');
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
    renderLayoutList(root);
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  btn.innerHTML = '💾 保存布局';
}
