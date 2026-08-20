// pages/home/home.js — 首页：个性化智能体 + 模块菜单
const api = require('../../utils/api');
const store = require('../../utils/store');
const { roomEmoji } = require('../../utils/ui');

Page({
  data: { user: null, habits: [], favs: [], layout: [], floorRows: [] },
  onShow() {
    const user = store.getUser();
    if (!user) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.render(user);
    // 拉取最新画像（可能被修改过）
    api.request('/auth/me').then((d) => { store.setUser(d.user); this.render(d.user); }).catch(() => {});
  },
  render(user) {
    const p = user.profile;
    const placed = (p.homeLayout || []).filter((r) => r.x != null && r.y != null);
    // 户型图行数据（迷你网格）
    const rows = [];
    if (placed.length) {
      const w = Math.max(...placed.map((r) => r.x)) + 1;
      const h = Math.max(...placed.map((r) => r.y)) + 1;
      for (let y = 0; y < h; y++) {
        const cells = [];
        for (let x = 0; x < w; x++) {
          const r = placed.find((rr) => rr.x === x && rr.y === y);
          cells.push(r ? { e: roomEmoji(r.name), n: r.name, empty: false } : { e: '', n: '', empty: true });
        }
        rows.push({ cells, cols: Math.min(w, 6) });
      }
    }
    this.setData({
      user,
      avatar: user.nickname.slice(0, 1),
      createdAt: (user.createdAt || '').slice(0, 10),
      habits: p.habits || [],
      favs: (p.favoritePlaces || []).map((n) => ({ n, e: roomEmoji(n) })),
      layout: p.homeLayout || [],
      floorRows: rows,
      layoutCount: (p.homeLayout || []).length,
      placedCount: placed.length
    });
  },
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url === 'data' || url === 'hardware' || url === 'profile') {
      wx.navigateTo({ url: '/pages/' + url + '/' + url });
    } else {
      wx.navigateTo({ url: '/pages/reason/reason' });
    }
  },
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },
  logout() {
    wx.showModal({
      title: '退出登录', content: '确认退出当前账号？',
      success: (r) => { if (r.confirm) { store.clear(); wx.reLaunch({ url: '/pages/auth/auth' }); } }
    });
  }
});
