// pages/home/home.js — 首页：物品数字化存放系统
// 首屏直接展示当前目录户型图（点击房间格进入细致布局搜查），功能菜单重排
const api = require('../../utils/api');
const store = require('../../utils/store');
const { roomEmoji } = require('../../utils/ui');
const { searchPositionsFor, furnitureEmoji } = require('../../utils/furniture');

// 搜查标记持久化（与 Web 端同构：按目录隔离，仅本机）
const SEARCH_KEY = 'fmg_search_progress_v1';
function loadSearchProgress() {
  try { return JSON.parse(wx.getStorageSync(SEARCH_KEY)) || {}; } catch (e) { return {}; }
}
function saveSearchProgress(map) {
  try { wx.setStorageSync(SEARCH_KEY, JSON.stringify(map)); } catch (e) { /* 存储不可用时静默 */ }
}

Page({
  data: {
    user: null, avatar: '', createdAt: '',
    spaces: [], activeSpaceId: -1, activeSpaceName: '家',
    floorRows: [], layoutCount: 0, placedCount: 0, furnCount: 0,
    searchText: '',
    search: { show: false, name: '', emoji: '', desc: '', furn: [], done: false, last: '', searchedCount: 0 }
  },
  onShow() {
    const user = store.getUser();
    if (!user) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.render(user);
    // 拉取最新画像（可能被修改过）
    api.request('/auth/me').then((d) => { store.setUser(d.user); this.render(d.user); }).catch(() => {});
  },
  // 当前目录的搜查进度（按 activeSpaceId 隔离）
  spaceSearchMap(activeSpaceId) {
    const id = activeSpaceId != null ? activeSpaceId : 0;
    const all = loadSearchProgress();
    if (!all[id]) all[id] = {};
    return all[id];
  },
  // 房间搜查状态：null = 无可搜位置；否则 { total, searched, done }
  roomSearchStatus(room, smap) {
    const positions = searchPositionsFor(room);
    if (!positions.length) return null;
    const searched = (smap[room.name] && Array.isArray(smap[room.name].furn)) ? smap[room.name].furn : [];
    const done = positions.every((p) => searched.includes(p));
    return { total: positions.length, searched: searched.length, done };
  },
  render(user) {
    const p = user.profile;
    const layout = p.homeLayout || [];
    const smap = this.spaceSearchMap(p.activeSpaceId);
    // 搜查进度汇总：整间搜完的房间数 / 可搜房间数
    let doneRooms = 0, totalRooms = 0;
    layout.forEach((r) => {
      const st = this.roomSearchStatus(r, smap);
      if (st) { totalRooms++; if (st.done) doneRooms++; }
    });
    // 多格展开：每个房间的每一格都渲染为一个 tile（与户型图配置页一致，10×10 网格）
    const placed = [];
    layout.forEach((r, idx) => {
      const st = this.roomSearchStatus(r, smap);
      const cells = (Array.isArray(r.cells) && r.cells.length)
        ? r.cells
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []);
      const corridor = r.name.includes('走廊');
      cells.forEach((c, ci) => placed.push({
        x: c.x, y: c.y, name: r.name, first: ci === 0, corridor,
        roomIdx: idx, done: !!(st && st.done),
        prog: (st && ci === 0 && !st.done) ? st.searched + '/' + st.total : ''
      }));
    });
    // 户型图行数据（迷你网格：每格 emoji + 首格房间名 + 搜查进度角标）
    const rows = [];
    if (placed.length) {
      const w = Math.min(10, Math.max(...placed.map((c) => c.x)) + 1);
      const h = Math.min(10, Math.max(...placed.map((c) => c.y)) + 1);
      for (let y = 0; y < h; y++) {
        const cells = [];
        for (let x = 0; x < w; x++) {
          const c = placed.find((cc) => cc.x === x && cc.y === y);
          cells.push(c
            ? { e: roomEmoji(c.name), n: c.first ? c.name : '', empty: false, corridor: c.corridor, roomIdx: c.roomIdx, done: c.done, first: c.first, prog: c.prog }
            : { e: '', n: '', empty: true, corridor: false, roomIdx: -1, done: false, first: false, prog: '' });
        }
        rows.push({ cells, cols: w });
      }
    }
    const furnCount = layout.reduce((n, r) => n + (Array.isArray(r.furn) ? r.furn.length : 0), 0);
    const spaces = p.spaces || [];
    const active = spaces.find((s) => s.id === p.activeSpaceId);
    this.setData({
      user,
      avatar: user.nickname.slice(0, 1),
      createdAt: (user.createdAt || '').slice(0, 10),
      spaces,
      activeSpaceId: p.activeSpaceId,
      activeSpaceName: active ? active.name : '家',
      floorRows: rows,
      layoutCount: layout.length,
      placedCount: placed.length,
      furnCount,
      searchText: totalRooms ? (' · 已搜完 ' + doneRooms + '/' + totalRooms + ' 间') : ''
    });
  },
  // 目录（家/公司/宿舍…）切换
  async switchSpace(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (id === this.data.activeSpaceId) return;
    try {
      await api.request('/spaces/' + id + '/active', { method: 'PUT' });
      const d = await api.request('/auth/me');
      store.setUser(d.user);
      this.render(d.user);
      wx.showToast({ title: '已切换目录', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '切换失败', icon: 'none' });
    }
  },
  // ---------- 房间细致布局搜查（已搜位置调灰 → 搜完整间整间标记） ----------
  openRoom(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (idx < 0) return;
    const user = store.getUser();
    const room = (user.profile.homeLayout || [])[idx];
    if (!room) return;
    const smap = this.spaceSearchMap(user.profile.activeSpaceId);
    this._searchRoom = room;
    this._searchSearched = (smap[room.name] && Array.isArray(smap[room.name].furn)) ? smap[room.name].furn.slice() : [];
    this._openedAt = Date.now();
    this.buildSearch();
  },
  // 重建搜查浮层数据（点按后实时刷新）
  buildSearch() {
    const room = this._searchRoom;
    const searched = this._searchSearched || [];
    const positions = searchPositionsFor(room);
    const done = positions.length > 0 && positions.every((n) => searched.includes(n));
    const furn = positions.map((n) => ({ name: n, e: furnitureEmoji(n), on: searched.includes(n) }));
    this.setData({
      search: {
        show: true,
        name: room.name,
        emoji: roomEmoji(room.name),
        desc: room.desc || '房间细致布局',
        furn,
        done,
        last: searched.length ? searched[searched.length - 1] : '',
        searchedCount: searched.length
      }
    });
  },
  toggleFurn(e) {
    const name = e.currentTarget.dataset.name;
    const i = this._searchSearched.indexOf(name);
    if (i >= 0) this._searchSearched.splice(i, 1); else this._searchSearched.push(name);
    this.persistSearch();
    this.buildSearch();
  },
  // 搜查进度写入本机（按目录隔离；全部取消时删除该房间记录）
  persistSearch() {
    const user = store.getUser();
    const spaceId = user.profile.activeSpaceId != null ? user.profile.activeSpaceId : 0;
    const all = loadSearchProgress();
    if (!all[spaceId]) all[spaceId] = {};
    if (this._searchSearched.length) all[spaceId][this._searchRoom.name] = { furn: this._searchSearched.slice(), ts: Date.now() };
    else delete all[spaceId][this._searchRoom.name];
    saveSearchProgress(all);
  },
  closeSearch() {
    this.setData({ 'search.show': false });
    const user = store.getUser();
    if (user) this.render(user); // 刷新户型图：整间搜完 → 房间整间标记
  },
  noop() {},
  async recordFound() {
    const room = this._searchRoom;
    const name = this._searchSearched[this._searchSearched.length - 1];
    const durationSec = Math.round((Date.now() - this._openedAt) / 1000);
    try {
      await api.request('/reason/record', {
        method: 'POST',
        data: {
          startedAt: new Date(this._openedAt).toISOString(),
          foundLocation: name,
          foundRoom: room.name,
          success: true,
          durationSec
        }
      });
      this.closeSearch();
      wx.showToast({ title: '已记录：物品在「' + name + '」找到 ✓', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '记录失败', icon: 'none' });
    }
  },
  async recordNotFound() {
    const room = this._searchRoom;
    const durationSec = Math.round((Date.now() - this._openedAt) / 1000);
    try {
      await api.request('/reason/record', {
        method: 'POST',
        data: {
          startedAt: new Date(this._openedAt).toISOString(),
          foundRoom: room.name,
          success: false,
          durationSec
        }
      });
      this.closeSearch();
      wx.showToast({ title: '已记录本次未找到，数据已更新', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '记录失败', icon: 'none' });
    }
  },
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url === 'layout') { wx.navigateTo({ url: '/pages/layout/layout' }); return; }
    if (url === 'data' || url === 'hardware' || url === 'profile' || url === 'items') {
      wx.navigateTo({ url: '/pages/' + url + '/' + url });
    } else {
      wx.navigateTo({ url: '/pages/reason/reason' });
    }
  },
  goLayout() {
    wx.navigateTo({ url: '/pages/layout/layout' });
  },
  logout() {
    wx.showModal({
      title: '退出登录', content: '确认退出当前账号？',
      success: (r) => { if (r.confirm) { store.clear(); wx.reLaunch({ url: '/pages/auth/auth' }); } }
    });
  }
});
