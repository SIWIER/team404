// pages/data/data.js — 数据统计与分析：统计卡 + 智能洞察 + ECharts 图表 + 户型热力 + 记录分页 + 导入导出
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, confirm, roomEmoji } = require('../../utils/ui');
const echarts = require('../../ec-canvas/echarts');

const PAGE_SIZE = 10;
const COLORS = ['#3d7bfd', '#6a5cff', '#16a6c9', '#22b07d', '#ffb020', '#ff7a59', '#e85d75', '#8a5cf6'];
const AXIS_TEXT = { color: '#7b8794', fontSize: 10 };
const SPLIT_LINE = { lineStyle: { color: '#eef1f6' } };

function fmtDur(sec) {
  if (sec == null) return '—';
  if (sec >= 60) return Math.floor(sec / 60) + '分' + (sec % 60) + '秒';
  return sec + '秒';
}

function shortName(name) {
  return name && name.length > 8 ? name.slice(0, 8) + '…' : name;
}

Page({
  data: {
    loading: true,
    error: '',
    s: { total: 0, successRate: 0, avgDurText: '—', last30: 0 },
    insights: [],
    topCount: 0,
    topEmpty: false,
    roomEmpty: false,
    timeEmpty: false,
    todEmpty: false,
    heat: { hasLayout: false, placed: false, floorRows: [], extras: [], list: [], listHint: '' },
    records: [],
    total: 0,
    hasMore: false,
    loadingMore: false,
    showImport: false,
    importText: '',
    // 四个图表的 ec-canvas 初始化句柄（组件 ready 后回调 onInit）
    ecTop: {},
    ecRoom: {},
    ecTime: {},
    ecTod: {}
  },

  onLoad() {
    this.charts = {};      // key -> echarts 实例
    this.chartData = {};   // key -> option（数据晚于组件就绪时兜底）
    this.offset = 0;
    this.loaded = false;
    const bind = (k) => (canvas, width, height, dpr) => this.initChart(k, canvas, width, height, dpr);
    this.setData({
      ecTop: { onInit: bind('top') },
      ecRoom: { onInit: bind('room') },
      ecTime: { onInit: bind('time') },
      ecTod: { onInit: bind('tod') }
    });
  },

  onShow() {
    if (!store.getToken()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.refresh(!this.loaded);
  },

  onPullDownRefresh() {
    this.refresh(false).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.loadMore();
  },

  // ---------- 图表初始化（ec-canvas onInit 回调） ----------
  initChart(key, canvas, width, height, dpr) {
    const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
    canvas.setChart(chart);
    this.charts[key] = chart;
    if (this.chartData[key]) chart.setOption(this.chartData[key], true);
    return chart;
  },

  applyChart(key, option) {
    this.chartData[key] = option;
    if (this.charts[key]) this.charts[key].setOption(option, true);
  },

  // ---------- 数据加载 ----------
  async refresh(showLoading) {
    if (showLoading) this.setData({ loading: true, error: '' });
    try {
      const [d, me] = await Promise.all([
        api.request('/data/stats'),
        api.request('/auth/me')
      ]);
      if (me && me.user) store.setUser(me.user);
      this.renderStats(d && d.mine ? d.mine : {}, me && me.user ? me.user : store.getUser());
      this.loaded = true;
      this.loadRecords(true);
    } catch (e) {
      this.setData({ loading: false, error: e.message });
    }
  },

  renderStats(s, user) {
    const topLocations = s.topLocations || [];
    const roomDist = s.roomDist || [];
    const timeline = s.timeline || [];
    const timeDist = s.timeDist || [];

    const topItems = topLocations.slice(0, 8);
    this.applyChart('top', this.topOption(topItems));
    this.applyChart('room', this.roomOption(roomDist));
    this.applyChart('time', this.timeOption(timeline));
    this.applyChart('tod', this.todOption(timeDist));

    this.setData({
      loading: false,
      error: '',
      s: {
        total: s.total || 0,
        successRate: s.successRate || 0,
        avgDurText: fmtDur(s.avgDur),
        last30: s.last30 || 0
      },
      insights: s.insights || [],
      topCount: Math.min(topLocations.length, 8),
      topEmpty: !topItems.length,
      roomEmpty: !roomDist.length,
      timeEmpty: !timeline.length,
      todEmpty: !timeDist.length,
      heat: this.buildHeat(s, (user && user.profile && user.profile.homeLayout) || [])
    });
  },

  // ---------- 图表 option（字段名与 Web 版 data.view.js 完全一致） ----------
  topOption(items) {
    return {
      grid: { left: 8, right: 42, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        data: items.map((x) => shortName(x.name)).reverse(),
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: AXIS_TEXT
      },
      series: [{
        type: 'bar',
        data: items.map((x, i) => ({
          value: x.count,
          itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [0, 7, 7, 0] }
        })).reverse(),
        barWidth: 14,
        label: { show: true, position: 'right', formatter: '{c} 次', fontSize: 10, fontWeight: 700, color: '#1f2b3a' }
      }]
    };
  },

  roomOption(items) {
    const total = items.reduce((a, i) => a + i.count, 0) || 0;
    return {
      color: COLORS,
      tooltip: { trigger: 'item', formatter: '{b}：{c} 次（{d}%）' },
      legend: {
        bottom: 0, left: 'center',
        itemWidth: 10, itemHeight: 10, textStyle: AXIS_TEXT,
        formatter: (name) => {
          const it = items.find((x) => x.name === name);
          return name + ' ' + (it ? it.count : 0) + '次';
        }
      },
      title: {
        text: total + ' 次', left: 'center', top: '38%',
        textStyle: { fontSize: 16, fontWeight: 800, color: '#1f2b3a' }
      },
      series: [{
        type: 'pie',
        radius: ['42%', '66%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: 700 } },
        data: items.map((x) => ({ name: x.name, value: x.count }))
      }]
    };
  },

  timeOption(items) {
    const labels = items.map((i) => i[0].slice(5));
    return {
      grid: { left: 8, right: 8, top: 20, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category', data: labels,
        axisLine: { lineStyle: { color: '#e3e9f2' } }, axisTick: { show: false },
        axisLabel: Object.assign({}, AXIS_TEXT, { interval: Math.max(0, Math.ceil(labels.length / 8) - 1) })
      },
      yAxis: { type: 'value', minInterval: 1, axisLine: { show: false }, axisTick: { show: false }, splitLine: SPLIT_LINE, axisLabel: AXIS_TEXT },
      series: [{
        type: 'bar', data: items.map((i) => i[1]), barMaxWidth: 16,
        itemStyle: { color: '#3d7bfd', borderRadius: [4, 4, 0, 0] },
        label: { show: items.length <= 12, position: 'top', fontSize: 9, color: '#1f2b3a' }
      }]
    };
  },

  todOption(items) {
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category', data: items.map((x) => x.name),
        axisLine: { lineStyle: { color: '#e3e9f2' } }, axisTick: { show: false }, axisLabel: AXIS_TEXT
      },
      yAxis: { type: 'value', minInterval: 1, axisLine: { show: false }, axisTick: { show: false }, splitLine: SPLIT_LINE, axisLabel: AXIS_TEXT },
      series: [{
        type: 'bar',
        data: items.map((x, i) => ({
          value: x.count,
          itemStyle: { color: COLORS[i % COLORS.length], borderRadius: [6, 6, 0, 0] }
        })),
        barMaxWidth: 28,
        label: { show: true, position: 'top', fontSize: 10, fontWeight: 700, color: '#1f2b3a' }
      }]
    };
  },

  // ---------- 户型热力（普通 view 网格，非 canvas） ----------
  buildHeat(s, layout) {
    const roomDist = s.roomDist || [];
    const heat = { hasLayout: false, placed: false, floorRows: [], extras: [], list: [], listHint: '' };
    const countOf = (room) => {
      const it = roomDist.find((x) => x.name === room);
      return it ? it.count : 0;
    };
    // 展开多格走廊链：每一格都渲染为一个 tile（与首页/画像页编辑器一致）
    const placed = [];
    (layout || []).forEach((r) => {
      const cells = (Array.isArray(r.cells) && r.cells.length)
        ? r.cells
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []);
      cells.forEach((c) => placed.push({ x: c.x, y: c.y, name: r.name }));
    });
    const extras = roomDist.filter((x) => !(layout || []).some((r) => r.name === x.name));

    // 全局最大次数（户型内 + 户型外统一映射 0.1~0.6 透明度）
    const counts = placed.map((p) => countOf(p.name)).concat(extras.map((x) => x.count));
    const max = Math.max(1, ...counts);
    const colorOf = (c) => {
      if (!c) return '#f6f8fb';
      const alpha = (0.1 + (c / max) * 0.5).toFixed(2);
      return 'rgba(61,123,253,' + alpha + ')';
    };

    if (!layout || !layout.length) {
      heat.list = roomDist.map((x) => ({
        name: x.name, e: roomEmoji(x.name), count: x.count, bg: colorOf(x.count)
      }));
      return heat;
    }
    heat.hasLayout = true;

    if (placed.length) {
      heat.placed = true;
      const w = Math.min(6, Math.max(...placed.map((p) => p.x)) + 1);
      const h = Math.min(6, Math.max(...placed.map((p) => p.y)) + 1);
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
      heat.list = roomDist.map((x) => ({
        name: x.name, e: roomEmoji(x.name), count: x.count, bg: colorOf(x.count)
      }));
      heat.listHint = '户型尚未在网格中摆放，先按房间列表展示';
    }

    heat.extras = extras.map((x) => ({
      name: x.name, e: roomEmoji(x.name), count: x.count
    }));
    return heat;
  },

  // ---------- 记录分页（触底加载更多） ----------
  async loadRecords(reset) {
    if (reset) this.offset = 0;
    this.setData({ loadingMore: true });
    try {
      const d = await api.request('/data/records?limit=' + PAGE_SIZE + '&offset=' + this.offset);
      const items = (d.items || []).map((r) => ({
        id: r.id,
        timeText: (r.startedAt || '').slice(0, 16).replace('T', ' '),
        loc: r.foundLocation || '—',
        room: r.foundRoom || '',
        confText: r.confidence != null ? Math.round(r.confidence) + '%' : '—',
        durText: r.durationSec != null ? r.durationSec + 's' : '—',
        ok: !!r.success,
        resultText: r.success ? '找到' : '未找到',
        hasConv: !!r.hasConversation
      }));
      const records = reset ? items : this.data.records.concat(items);
      this.offset += items.length;
      this.setData({
        records,
        total: d.total,
        hasMore: this.offset < d.total,
        loadingMore: false
      });
    } catch (e) {
      this.setData({ loadingMore: false });
      toast(e.message);
    }
  },

  loadMore() {
    this.loadRecords(false);
  },

  async doDel(e) {
    if (!(await confirm('确认删除这条记录？删除后统计将更新。'))) return;
    try {
      await api.request('/data/records/' + e.currentTarget.dataset.id, { method: 'DELETE' });
      toast('已删除 ✓');
      this.refresh(false);
    } catch (err) { toast(err.message); }
  },

  // ---------- 导入导出（简化版：剪贴板复制 / 粘贴 JSON） ----------
  async doExport() {
    try {
      const d = await api.request('/data/export');
      wx.setClipboardData({
        data: JSON.stringify(d, null, 2),
        success: () => toast('已复制 JSON 到剪贴板 ✓'),
        fail: () => toast('复制失败，请重试')
      });
    } catch (e) { toast(e.message); }
  },

  toggleImport() {
    this.setData({ showImport: !this.data.showImport });
  },

  onImportInput(e) {
    this.setData({ importText: e.detail.value });
  },

  async doImport() {
    let data;
    try {
      data = JSON.parse(this.data.importText);
    } catch (e) {
      toast('JSON 解析失败，请检查内容');
      return;
    }
    const records = Array.isArray(data) ? data : (data && data.records) || null;
    if (!records) {
      toast('格式不正确：应为记录数组或包含 records 字段的导出文件');
      return;
    }
    if (records.length > 200) {
      toast('单次最多导入 200 条');
      return;
    }
    if (!(await confirm('确认导入 ' + records.length + ' 条记录？'))) return;
    try {
      const r = await api.request('/data/import', { method: 'POST', data: { records } });
      toast('导入完成：成功 ' + r.imported + ' 条' + (r.skipped ? '，跳过 ' + r.skipped + ' 条' : '') + ' ✓');
      this.setData({ showImport: false, importText: '' });
      this.refresh(false);
    } catch (e) { toast(e.message); }
  },

  retry() {
    this.refresh(true);
  },

  // ---------- 跳转 ----------
  goReason() {
    wx.navigateTo({ url: '/pages/reason/reason' });
  },
  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  }
});
