// pages/home/home.js — 首页：物品数字化存放系统
// 首屏直接展示当前目录户型图（点击进入户型图配置页），功能菜单重排
const api = require('../../utils/api');
const store = require('../../utils/store');
const { roomEmoji } = require('../../utils/ui');

Page({
  data: {
    user: null, avatar: '', createdAt: '',
    spaces: [], activeSpaceId: -1, activeSpaceName: '家',
    floorRows: [], layoutCount: 0, placedCount: 0, furnCount: 0
  },
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
    // 多格展开：每个房间的每一格都渲染为一个 tile（与户型图配置页一致，10×10 网格）
    const placed = [];
    layout.forEach((r) => {
      const cells = (Array.isArray(r.cells) && r.cells.length)
        ? r.cells
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []);
      const corridor = r.name.includes('走廊');
      cells.forEach((c, ci) => placed.push({ x: c.x, y: c.y, name: r.name, first: ci === 0, corridor }));
    });
    // 户型图行数据（迷你网格：每格 emoji + 首格房间名）
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
      furnCount
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
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url === 'layout') { wx.navigateTo({ url: '/pages/layout/layout' }); return; }
    if (url === 'data' || url === 'hardware' || url === 'profile') {
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
