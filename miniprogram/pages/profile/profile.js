// pages/profile/profile.js — 个性化智能体：画像表单 + 家庭布局（纯拖拽交互）
// 交互约定（简洁、无干扰）：拖方块→移动/交换；✕→移出；点托盘→放入后自行拖动；一键生成标准户型
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, roomEmoji } = require('../../utils/ui');

const ROOM_PRESETS = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
const GRID = 6;          // 户型图网格 6×6（与后端 sanitizeLayout 0-5 一致）

// 标准户型模板：按常见家居布局预置槽位（单格/房间），生成后剩余房间按顺序补空
const TEMPLATE = [
  { key: '玄关', x: 0, y: 5 },
  { key: '走廊', x: 1, y: 5 },
  { key: '客厅', x: 2, y: 5 },
  { key: '卫生间', x: 4, y: 5 },
  { key: '厨房', x: 5, y: 4 },
  { key: '餐厅', x: 5, y: 3 },
  { key: '书房', x: 5, y: 2 },
  { key: '卧室', x: 0, y: 2 },
  { key: '卧室', x: 1, y: 1 },
  { key: '阳台', x: 0, y: 0 },
  { key: '衣帽间', x: 1, y: 0 },
  { key: '储物间', x: 5, y: 0 }
];

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
      // 内容宽 = 屏宽 - 页边距 24rpx*2 - 卡片内边距 32rpx*2 - 冗余 8rpx
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

  // ---------- 托盘：点一下放入第一个空格，再拖到想要的位置 ----------
  onChipTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    const empty = this.firstEmpty();
    if (!empty) { toast('网格已满，先把某个房间移出'); return; }
    room.x = empty.x;
    room.y = empty.y;
    this.renderLayout();
    toast('已放入，拖动它到想要的位置');
  },

  // ---------- 拖拽（唯一移动方式） ----------
  onTileMove(e) {
    const idx = e.currentTarget.dataset.idx;
    this._dragPos = this._dragPos || {};
    this._dragPos[idx] = { x: e.detail.x, y: e.detail.y };
  },

  onTileEnd(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    // 删除后的 touchend 冒泡：忽略
    if (this._suppressEnd && this._suppressEnd[idx]) {
      this._suppressEnd[idx] = false;
      return;
    }
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room || room.x == null || room.y == null) return; // 已在托盘，忽略
    const pos = (this._dragPos && this._dragPos[idx]) || null;
    if (!pos) return;
    const cell = this.data.grid.cell;
    const x = clamp(Math.round(pos.x / cell), 0, GRID - 1);
    const y = clamp(Math.round(pos.y / cell), 0, GRID - 1);
    this._dragPos[idx] = null;
    if (room.x === x && room.y === y) return; // 没动过（纯点击），保持原状
    const other = this.rooms.find((r) => r.idx !== idx && r.x === x && r.y === y);
    if (other) {
      other.x = room.x;
      other.y = room.y;
      toast('与「' + other.name + '」交换了位置');
    }
    room.x = x;
    room.y = y;
    this.renderLayout();
  },

  // 点 ✕ → 移出网格回托盘（并屏蔽随之而来的 touchend，防止被放回去）
  removeFromGrid(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    room.x = null;
    room.y = null;
    this._suppressEnd = this._suppressEnd || {};
    this._suppressEnd[idx] = true;
    if (this._dragPos) this._dragPos[idx] = null;
    this.renderLayout();
  },

  // ---------- 一键操作 ----------
  // 按标准户型模板摆放；模板外的房间依次补空位
  applyTemplate() {
    const unplaced = () => this.rooms.filter((r) => r.name && (r.x == null || r.y == null));
    if (!unplaced().length) { toast('所有房间都已在网格中，可先「全部移出」再生成'); return; }
    let n = 0;
    for (const slot of TEMPLATE) {
      const candidate = this.rooms.find((r) =>
        r.name && r.name.includes(slot.key) && r.x == null && r.y == null &&
        !this.rooms.some((o) => o.x === slot.x && o.y === slot.y));
      if (!candidate) continue;
      candidate.x = slot.x;
      candidate.y = slot.y;
      n++;
    }
    // 其余房间依次填空
    for (const room of this.rooms.filter((r) => r.name && (r.x == null || r.y == null))) {
      const empty = this.firstEmpty();
      if (!empty) break;
      room.x = empty.x;
      room.y = empty.y;
    }
    this.renderLayout();
    toast('🏠 已生成标准户型（可再拖动微调）');
  },

  clearLayout() {
    this.rooms.forEach((r) => { r.x = null; r.y = null; });
    this.renderLayout();
    toast('已全部移出网格');
  },

  // ---------- 工具 ----------
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
