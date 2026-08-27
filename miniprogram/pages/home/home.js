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
    const layout = p.homeLayout || [];
    // 多格展开：每个房间的每一格都渲染为一个 tile（与画像页编辑器一致，10×10 网格）
    const placed = [];
    layout.forEach((r) => {
      const cells = (Array.isArray(r.cells) && r.cells.length)
        ? r.cells
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []);
      const corridor = r.name.includes('走廊');
      cells.forEach((c, ci) => placed.push({ x: c.x, y: c.y, name: r.name, first: ci === 0, corridor }));
    });
    // 户型图行数据（迷你网格，含多格房间；名字只在房间首格显示）
    const rows = [];
    if (placed.length) {
      const w = Math.min(10, Math.max(...placed.map((c) => c.x)) + 1);
      const h = Math.min(10, Math.max(...placed.map((c) => c.y)) + 1);
      for (let y = 0; y < h; y++) {
        const cells = [];
        for (let x = 0; x < w; x++) {
          const c = placed.find((cc) => cc.x === x && cc.y === y);
          cells.push(c
            ? { e: roomEmoji(c.name), n: c.first ? c.name : '', empty: false, corridor: c.corridor }
            : { e: '', n: '', empty: true, corridor: false });
        }
        rows.push({ cells, cols: w });
      }
    }
    this.setData({
      user,
      avatar: user.nickname.slice(0, 1),
      createdAt: (user.createdAt || '').slice(0, 10),
      habits: p.habits || [],
      favs: (p.favoritePlaces || []).map((n) => ({ n, e: roomEmoji(n) })),
      layout,
      floorRows: rows,
      layoutCount: layout.length,
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
