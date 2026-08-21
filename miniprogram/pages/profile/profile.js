// pages/profile/profile.js — 个性化智能体：画像表单 + 家庭布局（movable-view 户型图拖拽）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, roomEmoji } = require('../../utils/ui');

const ROOM_PRESETS = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
const GRID = 6;          // 户型图网格 6×6（与后端 sanitizeLayout 0-5 一致）
const CELL = 52;         // 单格 px（movable-area 使用 px 单位）
const AREA = CELL * GRID;

Page({
  data: {
    // 表单
    agentName: '', agentStyle: '', habitsText: '', favsText: '', notes: '',
    saving: false, savingLayout: false,
    // 布局
    rooms: [],           // 房间编辑副本（含 idx/name/desc/spotsText/x/y）
    placed: [],          // 已放置（供 movable-view，x/y 已换算为 px）
    unplaced: [],        // 待放置托盘
    presets: [],         // 可快捷添加的预设
    grid: { cell: CELL, area: AREA, size: GRID }
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.init();
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

  // ---------- 家庭布局编辑 ----------
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

  // 点托盘房间 → 放进第一个空格子
  placeFromTray(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    const empty = this.firstEmpty();
    if (!empty) { toast('网格已满，先把某个房间移出'); return; }
    room.x = empty.x;
    room.y = empty.y;
    this.renderLayout();
  },

  // 点空白格子 → 放置第一个待放置房间
  onAreaTap(e) {
    if (!e.detail || e.detail.x == null || e.detail.y == null) return;
    const x = clamp(Math.floor(e.detail.x / CELL), 0, GRID - 1);
    const y = clamp(Math.floor(e.detail.y / CELL), 0, GRID - 1);
    if (this.rooms.some((r) => r.x === x && r.y === y)) return;
    const pending = this.rooms.find((r) => r.name && (r.x == null || r.y == null));
    if (!pending) return;
    pending.x = x;
    pending.y = y;
    this.renderLayout();
  },

  // 拖拽过程中记录位置
  onTileMove(e) {
    const idx = e.currentTarget.dataset.idx;
    this._dragPos = this._dragPos || {};
    this._dragPos[idx] = { x: e.detail.x, y: e.detail.y };
  },

  // 拖拽结束 → 吸附最近格子；目标格被占则交换
  onTileEnd(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    const pos = (this._dragPos && this._dragPos[idx]) || null;
    if (!room || !pos) return;
    const x = clamp(Math.round(pos.x / CELL), 0, GRID - 1);
    const y = clamp(Math.round(pos.y / CELL), 0, GRID - 1);
    const other = this.rooms.find((r) => r.idx !== idx && r.x === x && r.y === y);
    if (other) { other.x = room.x; other.y = room.y; } // 交换
    room.x = x;
    room.y = y;
    if (this._dragPos) this._dragPos[idx] = null;
    this.renderLayout();
  },

  // 点 ✕ → 移出网格回托盘
  removeFromGrid(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    room.x = null;
    room.y = null;
    this.renderLayout();
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
    const placed = this.rooms
      .filter((r) => r.name && r.x != null && r.y != null)
      .map((r) => ({ idx: r.idx, name: r.name, emoji: roomEmoji(r.name), x: r.x * CELL, y: r.y * CELL }));
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
      // 用服务端规范化结果刷新本地副本
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
