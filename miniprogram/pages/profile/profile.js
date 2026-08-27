// pages/profile/profile.js — 个性化智能体：画像表单 + 家庭布局（自研触摸拖拽，弃用 movable-view）
// 设计要点：
// 1) 位置永远由数据单一来源计算（rooms[].cells），渲染/吸附/交换都从数据推导 → 不存在"视觉-数据脱同步"
// 2) 方块拖拽：touchstart/move/end 手写实现；松手按位移吸附最近格子；拖到占用格=交换
// 3) 托盘房间可直接拖进网格（幽灵方块跟手），也可点一下放入后自行拖动
// 4) 走廊为多格链式房间：可整体拖动、延长/缩短；标准户型模板保证所有房间紧贴走廊链
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, roomEmoji } = require('../../utils/ui');

const ROOM_PRESETS = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
const GRID = 6;
// 房间数量上限：与后端 sanitizeLayout（accounts.service.js）的 slice(0,10) 一致，
// 超出会被后端静默截断，导致"保存成功但房间消失"——前端必须先拦住并提示
const MAX_ROOMS = 10;

// 标准户型模板：走廊居中成链，所有房间与走廊/入户相邻（全连通）
const TEMPLATE = [
  { key: '走廊', cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }] },
  { key: '玄关', cells: [{ x: 2, y: 5 }] },
  { key: '客厅', cells: [{ x: 3, y: 3 }] },
  { key: '卫生间', cells: [{ x: 3, y: 4 }] },
  { key: '厨房', cells: [{ x: 1, y: 3 }] },
  { key: '餐厅', cells: [{ x: 1, y: 4 }] },
  { key: '书房', cells: [{ x: 3, y: 2 }] },
  { key: '卧室', cells: [{ x: 1, y: 2 }] },
  { key: '卧室', cells: [{ x: 2, y: 1 }] },
  { key: '阳台', cells: [{ x: 3, y: 1 }] },
  { key: '衣帽间', cells: [{ x: 0, y: 2 }] },
  { key: '储物间', cells: [{ x: 4, y: 2 }] }
];

Page({
  data: {
    // 表单
    agentName: '', agentStyle: '', habitsText: '', favsText: '', notes: '',
    saving: false, savingLayout: false,
    // 布局
    rooms: [],           // 编辑副本 {idx,name,desc,spotsText,cells:[{x,y}]}（cells 空=在托盘）
    tiles: [],           // 网格方块（含走廊每格一段）{key,roomIdx,ci,name,emoji,corridor,px,py}
    unplaced: [],        // 托盘
    presets: [],
    corridorExists: false,
    extendMode: false,   // 走廊延长模式：点高亮格选方向（可弯折）
    extendCands: [],     // 可延伸候选格（走廊任意段四周的空格）
    drag: { idx: -1, dx: 0, dy: 0 },   // 方块拖拽位移
    ghost: { show: false, emoji: '', name: '', x: 0, y: 0 }, // 托盘拖拽幽灵
    grid: { cell: 52, area: 312, size: GRID, cells: [] }
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.computeGrid();
    this.init();
  },

  computeGrid() {
    try {
      const sys = wx.getSystemInfoSync();
      const win = sys.windowWidth;
      const areaPx = Math.floor((win * (750 - 48 - 64 - 8)) / 750);
      const cell = Math.max(40, Math.floor(areaPx / GRID));
      const area = cell * GRID;
      const cells = [];
      for (let i = 0; i < GRID * GRID; i++) {
        cells.push({ x: (i % GRID) * cell, y: Math.floor(i / GRID) * cell });
      }
      this.setData({ grid: { cell, area, size: GRID, cells } });
    } catch (e) { /* 默认值兜底 */ }
  },

  init() {
    const p = store.getUser().profile;
    this.rooms = (p.homeLayout || []).map((r, i) => ({
      idx: i,
      name: r.name || '',
      desc: r.desc || '',
      spotsText: (r.spots || []).join('，'),
      cells: (Array.isArray(r.cells) && r.cells.length)
        ? r.cells.map((c) => ({ x: c.x, y: c.y }))
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : [])
    }));
    this.setData({
      agentName: p.agentName || '',
      agentStyle: p.agentStyle || '',
      habitsText: (p.habits || []).join('\n'),
      favsText: (p.favoritePlaces || []).join('\n'),
      notes: p.notes || ''
    });
    this.renderLayout();
  },

  // ---------- 基础画像 ----------
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value });
  },

  async saveBasic() {
    this.setData({ saving: true });
    try {
      const d = await api.request('/auth/profile', {
        method: 'PUT',
        data: {
          agentName: this.data.agentName.trim(),
          agentStyle: this.data.agentStyle.trim(),
          habits: lines(this.data.habitsText),
          favoritePlaces: lines(this.data.favsText),
          notes: this.data.notes.trim()
        }
      });
      store.setUser(d.user);
      toast('画像已保存 ✓');
    } catch (e) { toast(e.message); }
    this.setData({ saving: false });
  },

  // ---------- 房间增删改 ----------
  onRoomInput(e) {
    const { idx, k } = e.currentTarget.dataset;
    const room = this.rooms.find((r) => r.idx === Number(idx));
    if (!room) return;
    const wasCorridor = room.name.includes('走廊');
    room[k] = e.detail.value;
    // 改名离开走廊：多格塌缩为第一格，避免形状残留
    if (k === 'name' && wasCorridor && !room.name.includes('走廊') && room.cells.length > 1) {
      room.cells = room.cells.slice(0, 1);
    }
    this.renderLayout();
  },

  removeRoom(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.rooms = this.rooms.filter((r) => r.idx !== idx);
    this.renderLayout();
  },

  canAddRoom() {
    if (this.rooms.length >= MAX_ROOMS) {
      toast('房间已达上限（10 个，含托盘里的）：先删除或合并一个房间，再添加走廊');
      return false;
    }
    return true;
  },

  addPreset(e) {
    if (!this.canAddRoom()) return;
    const name = e.currentTarget.dataset.name;
    this.rooms.push({ idx: nextIdx(this.rooms), name, desc: '', spotsText: '', cells: [] });
    this.renderLayout();
  },

  addCustom() {
    if (!this.canAddRoom()) return;
    this.rooms.push({ idx: nextIdx(this.rooms), name: '', desc: '', spotsText: '', cells: [] });
    this.renderLayout();
  },

  // ---------- 方块拖拽（自研实现，数据单一来源） ----------
  onTileTouchStart(e) {
    const t = e.touches[0];
    this._t = {
      idx: Number(e.currentTarget.dataset.idx),
      sx: t.clientX, sy: t.clientY,
      moved: false
    };
  },

  onTileTouchMove(e) {
    if (!this._t) return;
    const t = e.touches[0];
    const dx = t.clientX - this._t.sx;
    const dy = t.clientY - this._t.sy;
    if (!this._t.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._t.moved = true;
    this.setData({ drag: { idx: this._t.idx, dx, dy } });
  },

  onTileTouchEnd() {
    const t = this._t;
    if (!t) return;
    this._t = null;
    if (!t.moved) { this.resetDrag(); return; }
    const cell = this.data.grid.cell;
    const dX = Math.round(this.data.drag.dx / cell);
    const dY = Math.round(this.data.drag.dy / cell);
    this.resetDrag();
    if (dX === 0 && dY === 0) return; // 位移不足一格，保持原状

    const room = this.rooms.find((r) => r.idx === t.idx);
    if (!room || !room.cells.length) return;

    if (room.cells.length > 1) {
      // 走廊链整体平移：校验不出界、不与他人重叠
      const cand = room.cells.map((c) => ({ x: c.x + dX, y: c.y + dY }));
      const occupied = this.occupiedSet(room.idx);
      const ok = cand.every((c) => c.x >= 0 && c.x < GRID && c.y >= 0 && c.y < GRID && !occupied.has(key(c)));
      if (!ok) { toast('移不过去：会出界或与其他房间重叠'); this.renderLayout(); return; }
      room.cells = cand;
    } else {
      const target = {
        x: clamp(room.cells[0].x + dX, 0, GRID - 1),
        y: clamp(room.cells[0].y + dY, 0, GRID - 1)
      };
      if (target.x === room.cells[0].x && target.y === room.cells[0].y) return;
      const other = this.rooms.find((r) => r.idx !== room.idx && r.cells.some((c) => c.x === target.x && c.y === target.y));
      if (other) {
        other.cells = room.cells;
        toast('与「' + other.name + '」交换了位置');
      }
      room.cells = [target];
    }
    this.renderLayout();
  },

  resetDrag() {
    this.setData({ drag: { idx: -1, dx: 0, dy: 0 } });
  },

  // 点 ✕ → 移出该格（走廊去掉该段；普通房间回托盘）
  removeFromGrid(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const ci = Number(e.currentTarget.dataset.ci);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    if (room.cells.length > 1) {
      room.cells.splice(ci, 1);
    } else {
      room.cells = [];
    }
    this.renderLayout();
  },

  // ---------- 托盘：点一下放入；或直接拖进网格 ----------
  onChipTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    const empty = this.firstEmpty();
    if (!empty) { toast('网格已满，先把某个房间移出'); return; }
    room.cells = [empty];
    this.renderLayout();
    toast('已放入，拖动它到想要的位置');
  },

  onChipTouchStart(e) {
    const t = e.touches[0];
    this._chip = { idx: Number(e.currentTarget.dataset.idx), sx: t.clientX, sy: t.clientY, moved: false };
    // 提前查好网格区域位置（拖到网格上空时使用）
    this._areaRect = null;
    wx.createSelectorQuery().in(this).select('.floor-area').boundingClientRect((rect) => {
      this._areaRect = rect;
    }).exec();
  },

  onChipTouchMove(e) {
    if (!this._chip) return;
    const t = e.touches[0];
    const dx = t.clientX - this._chip.sx;
    const dy = t.clientY - this._chip.sy;
    if (!this._chip.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._chip.moved = true;
    const room = this.rooms.find((r) => r.idx === this._chip.idx);
    if (!room) return;
    const cell = this.data.grid.cell;
    this.setData({
      ghost: { show: true, emoji: roomEmoji(room.name), name: room.name, x: t.clientX - cell / 2, y: t.clientY - cell / 2 }
    });
  },

  onChipTouchEnd(e) {
    const chip = this._chip;
    this._chip = null;
    this.setData({ ghost: { show: false, emoji: '', name: '', x: 0, y: 0 } });
    if (!chip) return;
    const room = this.rooms.find((r) => r.idx === chip.idx);
    if (!room) return;
    if (!chip.moved) { this.onChipTap({ currentTarget: { dataset: { idx: chip.idx } } }); return; }

    // 拖拽结束：判断是否落在网格内
    const t = e.changedTouches[0];
    const rect = this._areaRect;
    if (!rect || t.clientX < rect.left || t.clientX > rect.right || t.clientY < rect.top || t.clientY > rect.bottom) {
      toast('没有落在网格内，房间留在托盘');
      return;
    }
    const cell = this.data.grid.cell;
    const x = clamp(Math.floor((t.clientX - rect.left) / cell), 0, GRID - 1);
    const y = clamp(Math.floor((t.clientY - rect.top) / cell), 0, GRID - 1);
    const other = this.rooms.find((r) => r.idx !== room.idx && r.cells.some((c) => c.x === x && c.y === y));
    if (other) {
      other.cells = room.cells;
      toast('与「' + other.name + '」交换了位置');
    }
    room.cells = [{ x, y }];
    this.renderLayout();
  },

  // ---------- 走廊形状 ----------
  // 切换延长模式：点高亮格即可向任意方向延长（支持弯折）
  toggleExtend() {
    const room = this.rooms.find((r) => r.name.includes('走廊'));
    if (!room) { toast('还没有「走廊」房间，先添加一个'); return; }
    this.setData({ extendMode: !this.data.extendMode });
    this.renderLayout();
  },

  onExtendCell(e) {
    if (!this.data.extendMode) return;
    const room = this.rooms.find((r) => r.name.includes('走廊'));
    if (!room) return;
    const x = Number(e.currentTarget.dataset.x);
    const y = Number(e.currentTarget.dataset.y);
    room.cells.push({ x, y });
    this.renderLayout(); // 保持延长模式，继续点下一个格可连成任意形状
  },

  shrinkCorridor() {
    const room = this.rooms.find((r) => r.name.includes('走廊'));
    if (!room) return;
    if (room.cells.length <= 1) { toast('走廊至少保留一格'); return; }
    room.cells.pop();
    this.renderLayout();
  },

  // ---------- 一键操作 ----------
  // 生成标准户型：先清空，按模板摆放（走廊链连接所有房间），剩余房间补空
  applyTemplate() {
    const named = this.rooms.filter((r) => r.name);
    if (!named.length) { toast('还没有添加房间，先点上方按钮添加'); return; }
    this.rooms.forEach((r) => { r.cells = []; });
    this.setData({ extendMode: false });
    const occupied = () => this.rooms.flatMap((r) => r.cells);
    const isFree = (cs) => cs.every((c) => !occupied().some((o) => o.x === c.x && o.y === c.y));
    let n = 0;
    for (const slot of TEMPLATE) {
      const candidate = this.rooms.find((r) =>
        r.name.includes(slot.key) && !r.cells.length && isFree(slot.cells));
      if (!candidate) continue;
      candidate.cells = slot.cells.map((c) => ({ x: c.x, y: c.y }));
      n++;
    }
    for (const room of this.rooms.filter((r) => r.name && !r.cells.length)) {
      const empty = this.firstEmpty();
      if (!empty) break;
      room.cells = [empty];
    }
    this.renderLayout();
    toast('🏠 已生成标准户型：所有房间都通过走廊相连（可拖动微调）');
  },

  clearLayout() {
    this.rooms.forEach((r) => { r.cells = []; });
    this.setData({ extendMode: false });
    this.renderLayout();
    toast('已全部移出网格');
  },

  // ---------- 工具 ----------
  occupiedSet(exceptIdx) {
    const set = new Set();
    this.rooms.forEach((r) => {
      if (r.idx === exceptIdx) return;
      r.cells.forEach((c) => set.add(key(c)));
    });
    return set;
  },

  firstEmpty() {
    const occupied = this.occupiedSet(-1);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!occupied.has(key({ x, y }))) return { x, y };
      }
    }
    return null;
  },

  renderLayout() {
    const cell = this.data.grid.cell;
    const tiles = [];
    this.rooms.forEach((r) => {
      r.emoji = roomEmoji(r.name);
      r.cells.forEach((c, ci) => {
        tiles.push({
          key: r.idx + '-' + ci,
          roomIdx: r.idx,
          ci,
          name: r.name,
          emoji: roomEmoji(r.name),
          corridor: r.name.includes('走廊'),
          px: c.x * cell,
          py: c.y * cell
        });
      });
    });
    const unplaced = this.rooms
      .filter((r) => r.name && !r.cells.length)
      .map((r) => ({ idx: r.idx, name: r.name, emoji: roomEmoji(r.name) }));
    const presets = ROOM_PRESETS
      .filter((n) => !this.rooms.some((r) => r.name === n))
      .slice(0, 6)
      .map((n) => ({ name: n, emoji: roomEmoji(n) }));

    // 延长模式：走廊任意段四周的空格都是候选（支持弯折/绕行）
    let extendCands = [];
    if (this.data.extendMode) {
      const corridor = this.rooms.find((r) => r.name.includes('走廊'));
      if (corridor) {
        const occupied = this.occupiedSet(corridor.idx);
        const seen = new Set();
        for (const c of corridor.cells) {
          for (const d of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }]) {
            const nx = c.x + d.x;
            const ny = c.y + d.y;
            if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
            const k = key({ x: nx, y: ny });
            if (seen.has(k) || occupied.has(k)) continue;
            seen.add(k);
            extendCands.push({ x: nx, y: ny, px: nx * cell, py: ny * cell });
          }
        }
      }
    }

    this.setData({
      rooms: this.rooms,
      tiles,
      unplaced,
      presets,
      extendCands,
      corridorExists: this.rooms.some((r) => r.name.includes('走廊'))
    });
  },

  async saveLayout() {
    if (this.rooms.filter((r) => r.name).length > MAX_ROOMS) {
      toast('房间数量超过上限（10 个），请删除多余房间后再保存');
      return;
    }
    this.setData({ savingLayout: true, extendMode: false });
    const homeLayout = this.rooms
      .filter((r) => r.name)
      .map((r) => ({
        name: r.name, desc: r.desc,
        spots: splitSpots(r.spotsText),
        x: r.cells.length ? r.cells[0].x : null,
        y: r.cells.length ? r.cells[0].y : null,
        cells: r.cells.map((c) => ({ x: c.x, y: c.y }))
      }));
    try {
      const d = await api.request('/auth/profile', { method: 'PUT', data: { homeLayout } });
      store.setUser(d.user);
      this.rooms = (d.user.profile.homeLayout || []).map((r, i) => ({
        idx: i, name: r.name, desc: r.desc || '',
        spotsText: (r.spots || []).join('，'),
        cells: (Array.isArray(r.cells) && r.cells.length)
          ? r.cells.map((c) => ({ x: c.x, y: c.y }))
          : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : [])
      }));
      toast('家庭布局已保存 ✓');
      this.renderLayout();
    } catch (e) { toast(e.message); }
    this.setData({ savingLayout: false });
  },

  // 跳转拍照识别户型页（识别结果由该页确认后写入画像，返回本页可继续手动微调）
  goLayoutScan() {
    wx.navigateTo({ url: '/pages/layout-scan/layout-scan' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});

function lines(t) {
  return String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function splitSpots(t) {
  return String(t || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}
function nextIdx(rooms) {
  return rooms.length ? Math.max(...rooms.map((r) => r.idx)) + 1 : 0;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function key(c) {
  return c.x + ',' + c.y;
}
