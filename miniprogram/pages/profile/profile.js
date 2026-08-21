// pages/profile/profile.js — 个性化智能体：画像表单 + 家庭布局（户型图：点选放置为主，拖拽为辅）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, roomEmoji } = require('../../utils/ui');

const ROOM_PRESETS = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
const GRID = 6;          // 户型图网格 6×6（与后端 sanitizeLayout 0-5 一致）

Page({
  data: {
    // 表单
    agentName: '', agentStyle: '', habitsText: '', favsText: '', notes: '',
    saving: false, savingLayout: false,
    // 布局
    rooms: [],           // 房间编辑副本（含 idx/name/desc/spotsText/x/y）
    placed: [],          // 已放置（movable-view 用，x/y 为 px）
    unplaced: [],        // 待放置托盘
    presets: [],         // 可快捷添加的预设
    selectedIdx: null,   // 当前选中的房间（点选放置流）
    grid: { cell: 52, area: 312, size: GRID, cells: [] }
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.computeGrid();
    this.init();
  },

  // 按屏幕宽度计算网格像素尺寸，保证任何机型都不溢出卡片
  computeGrid() {
    try {
      const sys = wx.getSystemInfoSync();
      const win = sys.windowWidth; // px
      // 内容宽 = 屏宽 - 页边距 24rpx*2 - 卡片内边距 32rpx*2 - 少量冗余
      const areaPx = Math.floor((win * (750 - 48 - 64 - 8)) / 750);
      const cell = Math.max(40, Math.floor(areaPx / GRID));
      const area = cell * GRID;
      const cells = [];
      for (let i = 0; i < GRID * GRID; i++) {
        cells.push({ x: (i % GRID) * cell, y: Math.floor(i / GRID) * cell });
      }
      this.setData({ grid: { cell, area, size: GRID, cells } });
    } catch (e) { /* 保持默认值 */ }
  },

  init() {
    const p = store.getUser().profile;
    this.rooms = (p.homeLayout || []).map((r, i) => ({
      idx: i,
      name: r.name || '',
      desc: r.desc || '',
      spotsText: (r.spots || []).join('，'),
      x: (r.x != null && r.y != null) ? r.x : null,
      y: (r.x != null && r.y != null) ? r.y : null
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
    room[k] = e.detail.value;
    this.renderLayout();
  },

  removeRoom(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.rooms = this.rooms.filter((r) => r.idx !== idx);
    this.setData({ selectedIdx: this.data.selectedIdx === idx ? null : this.data.selectedIdx });
    this.renderLayout();
  },

  addPreset(e) {
    const name = e.currentTarget.dataset.name;
    this.rooms.push({ idx: nextIdx(this.rooms), name, desc: '', spotsText: '', x: null, y: null });
    this.renderLayout();
  },

  addCustom() {
    this.rooms.push({ idx: nextIdx(this.rooms), name: '', desc: '', spotsText: '', x: null, y: null });
    this.renderLayout();
  },

  // ---------- 点选放置流（主要交互，新手友好） ----------
  // 点托盘房间：第一次选中，再点一次放进第一个空格
  onChipTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (this.data.selectedIdx === idx) {
      this.placeSelectedAt(idx, this.firstEmpty());
    } else {
      this.setData({ selectedIdx: idx });
      toast('已选中「' + (this.roomName(idx) || '该房间') + '」，点网格中的格子放置');
    }
  },

  // 点网格上的方块：选中它（不移动；移动请点目标格子）
  onTileTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    // 刚结束拖拽的误触忽略
    if (this._justDragged && Date.now() - this._justDragged < 350) return;
    this.setData({ selectedIdx: this.data.selectedIdx === idx ? null : idx });
  },

  // 点格子：优先放置/移动选中的房间
  onAreaTap(e) {
    if (!e.detail || e.detail.x == null || e.detail.y == null) return;
    const cell = this.data.grid.cell;
    const x = clamp(Math.floor(e.detail.x / cell), 0, GRID - 1);
    const y = clamp(Math.floor(e.detail.y / cell), 0, GRID - 1);
    const sel = this.data.selectedIdx;
    if (sel != null) {
      this.placeSelectedAt(sel, { x, y });
      return;
    }
    // 未选中：放置第一个待放置房间
    const pending = this.rooms.find((r) => r.name && (r.x == null || r.y == null));
    if (!pending) { toast('没有待放置的房间，先在上方添加'); return; }
    pending.x = x;
    pending.y = y;
    this.setData({ selectedIdx: null });
    this.renderLayout();
  },

  // 把 idx 房间放到目标格；被占则交换并提示
  placeSelectedAt(idx, cell) {
    if (!cell) { toast('网格已满，先把某个房间移出'); return; }
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    const other = this.rooms.find((r) => r.idx !== idx && r.x === cell.x && r.y === cell.y);
    if (other) {
      other.x = room.x;
      other.y = room.y;
      toast('与「' + other.name + '」交换了位置');
    } else if (room.x == null && room.y == null) {
      toast('已放入网格');
    } else {
      toast('已移动到新位置');
    }
    room.x = cell.x;
    room.y = cell.y;
    this.setData({ selectedIdx: null });
    this.renderLayout();
  },

  // ---------- 拖拽（快捷方式） ----------
  onTileMove(e) {
    const idx = e.currentTarget.dataset.idx;
    this._dragPos = this._dragPos || {};
    this._dragPos[idx] = { x: e.detail.x, y: e.detail.y };
  },

  onTileEnd(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    const pos = (this._dragPos && this._dragPos[idx]) || null;
    if (!room || !pos) return;
    this._justDragged = Date.now();
    const cell = this.data.grid.cell;
    const x = clamp(Math.round(pos.x / cell), 0, GRID - 1);
    const y = clamp(Math.round(pos.y / cell), 0, GRID - 1);
    const other = this.rooms.find((r) => r.idx !== idx && r.x === x && r.y === y);
    if (other) {
      other.x = room.x;
      other.y = room.y;
      toast('与「' + other.name + '」交换了位置');
    }
    room.x = x;
    room.y = y;
    if (this._dragPos) this._dragPos[idx] = null;
    this.setData({ selectedIdx: null });
    this.renderLayout();
  },

  // 点 ✕ → 移出网格回托盘
  removeFromGrid(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    room.x = null;
    room.y = null;
    this.setData({ selectedIdx: this.data.selectedIdx === idx ? null : this.data.selectedIdx });
    this.renderLayout();
  },

  // ---------- 一键操作 ----------
  // 自动把待放置房间依次填满空格
  autoLayout() {
    const pending = this.rooms.filter((r) => r.name && (r.x == null || r.y == null));
    if (!pending.length) { toast('所有房间都已在网格中'); return; }
    for (const room of pending) {
      const empty = this.firstEmpty();
      if (!empty) { toast('网格已满，剩余房间留在托盘'); break; }
      room.x = empty.x;
      room.y = empty.y;
    }
    this.setData({ selectedIdx: null });
    this.renderLayout();
    toast('✨ 已自动排列');
  },

  clearLayout() {
    this.rooms.forEach((r) => { r.x = null; r.y = null; });
    this.setData({ selectedIdx: null });
    this.renderLayout();
    toast('已全部移出网格');
  },

  // ---------- 工具 ----------
  roomName(idx) {
    const r = this.rooms.find((x) => x.idx === idx);
    return r ? r.name : '';
  },

  firstEmpty() {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!this.rooms.some((r) => r.x === x && r.y === y)) return { x, y };
      }
    }
    return null;
  },

  renderLayout() {
    const cell = this.data.grid.cell;
    const placed = this.rooms
      .filter((r) => r.name && r.x != null && r.y != null)
      .map((r) => ({ idx: r.idx, name: r.name, emoji: roomEmoji(r.name), x: r.x * cell, y: r.y * cell }));
    const unplaced = this.rooms
      .filter((r) => r.name && (r.x == null || r.y == null))
      .map((r) => ({ idx: r.idx, name: r.name, emoji: roomEmoji(r.name) }));
    const presets = ROOM_PRESETS
      .filter((n) => !this.rooms.some((r) => r.name === n))
      .slice(0, 6)
      .map((n) => ({ name: n, emoji: roomEmoji(n) }));
    this.setData({ rooms: this.rooms, placed, unplaced, presets });
  },

  async saveLayout() {
    this.setData({ savingLayout: true });
    const homeLayout = this.rooms
      .filter((r) => r.name)
      .map((r) => ({
        name: r.name, desc: r.desc,
        spots: splitSpots(r.spotsText),
        x: r.x, y: r.y
      }));
    try {
      const d = await api.request('/auth/profile', { method: 'PUT', data: { homeLayout } });
      store.setUser(d.user);
      this.rooms = (d.user.profile.homeLayout || []).map((r, i) => ({
        idx: i, name: r.name, desc: r.desc || '',
        spotsText: (r.spots || []).join('，'),
        x: (r.x != null && r.y != null) ? r.x : null,
        y: (r.x != null && r.y != null) ? r.y : null
      }));
      toast('家庭布局已保存 ✓');
      this.renderLayout();
    } catch (e) { toast(e.message); }
    this.setData({ savingLayout: false });
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
