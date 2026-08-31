// pages/data/data.js — 物品存放统计：总量/照片覆盖/目录分布/房间分布/收纳家具/户型热力/最近录入
// 定位：物品数字化存放系统——统计"存了什么、放在哪、覆盖多少房间"，辅助查找与整理
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, confirm, roomEmoji } = require('../../utils/ui');

const BAR_COLORS = ['#3d7bfd', '#6a5cff', '#16a6c9', '#22b07d', '#ffb020', '#ff7a59', '#e85d75', '#8a5cf6'];

Page({
  data: {
    loading: true,
    error: '',
    s: { total: 0, withImage: 0, textOnly: 0, spaceCount: 0, roomCoverage: 0, last30: 0 },
    spaceChips: [],      // [{name, c}]
    roomBars: [],        // [{name, c, pct, color}]
    furnBars: [],        // [{name, c, pct, color}]
    heat: { hasLayout: false, placed: false, floorRows: [], extras: [], list: [] },
    recent: [],          // 最近录入 [{id,name,locationFull,time,room}]
    noItems: false
  },

  onShow() {
    if (!store.getToken()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    this.setData({ loading: this.data.s.total === 0 && !this.loaded, error: '' });
    try {
      const [d, items, me] = await Promise.all([
        api.request('/items/stats'),
        api.request('/items'),
        api.request('/auth/me')
      ]);
      if (me && me.user) store.setUser(me.user);
      this.renderStats(d.stats || {}, items.items || [], me && me.user ? me.user : store.getUser());
      this.loaded = true;
    } catch (e) {
      this.setData({ loading: false, error: e.message });
    }
  },

  renderStats(st, items, user) {
    const maxRoom = Math.max(1, ...st.byRoom.map((x) => x.c));
    const maxFurn = Math.max(1, ...st.byFurn.map((x) => x.c));
    this.setData({
      loading: false,
      error: '',
      s: {
        total: st.total || 0,
        withImage: st.withImage || 0,
        textOnly: st.textOnly || 0,
        spaceCount: st.spaceCount || 0,
        roomCoverage: st.roomCoverage || 0,
        last30: st.last30 || 0
      },
      spaceChips: (st.bySpace || []).map((x) => ({ name: x.name, c: x.c })),
      roomBars: (st.byRoom || []).map((x, i) => ({
        name: x.name, c: x.c, color: BAR_COLORS[i % BAR_COLORS.length],
        pct: Math.max(6, Math.round(x.c / maxRoom * 100))
      })),
      furnBars: (st.byFurn || []).map((x, i) => ({
        name: x.name, c: x.c, color: BAR_COLORS[i % BAR_COLORS.length],
        pct: Math.max(6, Math.round(x.c / maxFurn * 100))
      })),
      heat: this.buildHeat(st.byRoom || [], (user && user.profile && user.profile.homeLayout) || []),
      recent: items.slice(0, 10).map((it) => ({
        id: it.id,
        name: it.name,
        locationFull: it.locationFull || '未设置位置',
        room: it.room || '',
        hasImage: !!it.hasImage,
        time: (it.createdAt || '').slice(0, 16).replace('T', ' ')
      })),
      noItems: !items.length
    });
  },

  // 户型热力：房间物品数叠加到户型图（与首页一致的网格渲染）
  buildHeat(byRoom, layout) {
    const heat = { hasLayout: false, placed: false, floorRows: [], extras: [], list: [] };
    const countOf = (room) => {
      const it = byRoom.find((x) => x.name === room);
      return it ? it.c : 0;
    };
    const placed = [];
    (layout || []).forEach((r) => {
      const cells = (Array.isArray(r.cells) && r.cells.length)
        ? r.cells
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []);
      cells.forEach((c) => placed.push({ x: c.x, y: c.y, name: r.name }));
    });
    const counts = placed.map((p) => countOf(p.name));
    const max = Math.max(1, ...counts);
    const colorOf = (c) => {
      if (!c) return '#f6f8fb';
      return 'rgba(61,123,253,' + (0.12 + (c / max) * 0.5).toFixed(2) + ')';
    };
    if (!layout || !layout.length) {
      heat.list = byRoom.map((x) => ({ name: x.name, e: roomEmoji(x.name), count: x.c, bg: colorOf(x.c) }));
      return heat;
    }
    heat.hasLayout = true;
    if (placed.length) {
      heat.placed = true;
      const w = Math.min(10, Math.max(...placed.map((p) => p.x)) + 1);
      const h = Math.min(10, Math.max(...placed.map((p) => p.y)) + 1);
      const rows = [];
      for (let y = 0; y < h; y++) {
        const cells = [];
        for (let x = 0; x < w; x++) {
          const p = placed.find((pp) => pp.x === x && pp.y === y);
          if (p) {
            const c = countOf(p.name);
            cells.push({ empty: false, e: roomEmoji(p.name), n: p.name, count: c, dim: !c, bg: colorOf(c) });
          } else {
            cells.push({ empty: true, bg: '#f7f9fc' });
          }
        }
        rows.push({ cells, cols: w });
      }
      heat.floorRows = rows;
    } else {
      heat.list = byRoom.map((x) => ({ name: x.name, e: roomEmoji(x.name), count: x.c, bg: colorOf(x.c) }));
    }
    heat.extras = byRoom.filter((x) => !(layout || []).some((r) => r.name === x.name))
      .map((x) => ({ name: x.name, e: roomEmoji(x.name), count: x.c }));
    return heat;
  },

  tapItem(e) {
    const room = e.currentTarget.dataset.room;
    if (!room) { toast('该物品没有设置房间'); return; }
    wx.navigateTo({ url: '/pages/layout/layout?highlight=' + encodeURIComponent(room) });
  },

  async deleteItem(e) {
    if (!(await confirm('删除这件物品的记录（照片也会删除）？'))) return;
    try {
      await api.request('/items/' + e.currentTarget.dataset.id, { method: 'DELETE' });
      toast('已删除 ✓');
      this.refresh();
    } catch (err) { toast(err.message); }
  },

  retry() {
    this.refresh();
  },

  goItems() {
    wx.navigateTo({ url: '/pages/items/items?mode=add' });
  },
  goLayout() {
    wx.navigateTo({ url: '/pages/layout/layout' });
  }
});
