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

// ---------- 导出报告图（canvas 2d 手绘，保存到相册） ----------
const REPORT_W = 750;   // 逻辑宽度（与 rpx 同刻度，按 2 倍 DPR 输出高清位图）
const REPORT_DPR = 2;

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function fmtDateNow() {
  const t = new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}

// 圆角矩形路径（arcTo 实现，兼容无 roundRect 的基础库）
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 中文按字符换行（fillText 不会自动换行）
function wrapLines(c, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of String(text)) {
    if (line && c.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
    else { line += ch; }
  }
  if (line) lines.push(line);
  return lines;
}

// 两遍绘制：第一遍度量排版算总高，第二遍定尺寸画图
function drawReport(canvas, s, user) {
  const W = REPORT_W, DPR = REPORT_DPR;
  const ctx = canvas.getContext('2d');
  const PAD = 40, RW = W - PAD * 2;
  const F = {
    section: 'bold 32px sans-serif',
    text: '26px sans-serif',
    small: '24px sans-serif',
    value: 'bold 44px sans-serif'
  };

  // ---- 第一遍：度量 ----
  const sec = [];
  let totalH = PAD + 210;                       // 头部
  const addSec = (type, h2, extra) => {
    if (sec.length) totalH += 28;
    sec.push({ type, y: totalH, h: h2, ...extra });
    totalH += h2;
  };

  addSec('stats', 324);                         // 2×2 统计卡
  ctx.font = F.text;
  const insights = (s.insights || []).slice(0, 5).map((t, i) => {
    const lines = wrapLines(ctx, t, RW - 64);
    return { t, i, lines, h: lines.length * 40 + 16 };
  });
  addSec('section', 56, { t: '💡 智能分析' });
  addSec('insights', insights.reduce((a, x) => a + x.h, 0), { items: insights });
  const tops = (s.topLocations || []).slice(0, 6);
  const maxTop = Math.max(1, ...tops.map((x) => x.count));
  addSec('section', 56, { t: '🏆 高频找回地点' });
  addSec('tops', tops.length ? tops.length * 64 : 40, { items: tops, max: maxTop });
  const rooms = (s.roomDist || []).slice(0, 8);
  const roomTotal = rooms.reduce((a, x) => a + x.count, 0) || 1;
  addSec('section', 56, { t: '🏠 房间分布' });
  addSec('rooms', rooms.length ? rooms.length * 44 : 40, { items: rooms, total: roomTotal });
  ctx.font = F.text;
  const timeStr = (s.timeDist || []).map((x) => x.name + ' ' + x.count + ' 次').join(' · ');
  const timeLines = timeStr ? wrapLines(ctx, '🕐 ' + timeStr, RW) : [];
  addSec('section', 56, { t: '🕐 丢眼镜时段' });
  addSec('times', timeLines.length ? timeLines.length * 40 + 8 : 40, { lines: timeLines });
  addSec('foot', 96);
  totalH += PAD;

  // ---- 第二遍：定尺寸并绘制 ----
  canvas.width = W * DPR;
  canvas.height = totalH * DPR;
  const c = canvas.getContext('2d');
  c.scale(DPR, DPR);

  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, totalH);

  // 头部（渐变横幅 + 日期/昵称 + 总记录）
  const grad = c.createLinearGradient(0, PAD, W, PAD);
  grad.addColorStop(0, '#3d7bfd');
  grad.addColorStop(1, '#6a5cff');
  c.fillStyle = grad;
  rr(c, PAD, PAD, RW, 210, 24);
  c.fill();
  c.fillStyle = '#ffffff';
  c.font = 'bold 40px sans-serif';
  c.fillText('📊 找眼镜助手 · 数据报告', PAD + 36, PAD + 78);
  c.font = F.small;
  c.globalAlpha = 0.9;
  c.fillText(fmtDateNow() + '  ·  ' + ((user && user.nickname) || '我'), PAD + 36, PAD + 136);
  c.font = 'bold 44px sans-serif';
  c.textAlign = 'right';
  c.fillText(String(s.total || 0) + ' 条', PAD + RW - 36, PAD + 100);
  c.globalAlpha = 0.85;
  c.font = F.small;
  c.fillText('累计找回记录', PAD + RW - 36, PAD + 142);
  c.globalAlpha = 1;
  c.textAlign = 'left';

  // 各区块
  for (const e of sec) {
    const y0 = e.y;
    if (e.type === 'stats') {
      const cw = (RW - 24) / 2, ch2 = 150;
      const stats = [
        { v: String(s.total || 0), k: '找回记录总数' },
        { v: (s.successRate || 0) + '%', k: '找回成功率' },
        { v: fmtDur(s.avgDur), k: '平均找回用时' },
        { v: String(s.last30 || 0), k: '近 30 天记录' }
      ];
      stats.forEach((st, i) => {
        const x = PAD + (i % 2) * (cw + 24);
        const yy = y0 + Math.floor(i / 2) * (ch2 + 24);
        c.fillStyle = '#f7f9fd';
        rr(c, x, yy, cw, ch2, 20);
        c.fill();
        c.fillStyle = '#3d7bfd';
        c.textAlign = 'center';
        c.font = i === 2 ? 'bold 36px sans-serif' : F.value;
        c.fillText(st.v, x + cw / 2, yy + 72);
        c.fillStyle = '#7b8794';
        c.font = F.small;
        c.fillText(st.k, x + cw / 2, yy + 118);
        c.textAlign = 'left';
      });
    } else if (e.type === 'section') {
      c.fillStyle = '#1f2b3a';
      c.font = F.section;
      c.fillText(e.t, PAD, y0 + 44);
    } else if (e.type === 'insights') {
      let yy = y0;
      e.items.forEach((it) => {
        c.fillStyle = '#eaf1ff';
        c.beginPath();
        c.arc(PAD + 18, yy + 18, 18, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#3d7bfd';
        c.textAlign = 'center';
        c.font = 'bold 22px sans-serif';
        c.fillText(String(it.i + 1), PAD + 18, yy + 26);
        c.textAlign = 'left';
        c.fillStyle = '#1f2b3a';
        c.font = F.text;
        it.lines.forEach((ln, li) => {
          c.fillText(ln, PAD + 64, yy + 32 + li * 40);
        });
        yy += it.h;
      });
    } else if (e.type === 'tops') {
      if (!e.items.length) { c.fillStyle = '#7b8794'; c.font = F.small; c.fillText('暂无找回数据', PAD, y0 + 12); }
      e.items.forEach((it, i) => {
        const yy = y0 + i * 64;
        c.fillStyle = '#1f2b3a';
        c.font = 'bold 26px sans-serif';
        c.fillText(it.name, PAD, yy + 24);
        c.fillStyle = COLORS[i % COLORS.length];
        c.textAlign = 'right';
        c.fillText(it.count + ' 次', PAD + RW, yy + 24);
        c.textAlign = 'left';
        c.fillStyle = '#eef1f6';
        rr(c, PAD, yy + 34, RW, 22, 11);
        c.fill();
        c.fillStyle = COLORS[i % COLORS.length];
        rr(c, PAD, yy + 34, Math.max(22, Math.round(it.count / e.max * RW)), 22, 11);
        c.fill();
      });
    } else if (e.type === 'rooms') {
      if (!e.items.length) { c.fillStyle = '#7b8794'; c.font = F.small; c.fillText('暂无找回数据', PAD, y0 + 12); }
      e.items.forEach((it, i) => {
        const yy = y0 + i * 44;
        c.fillStyle = COLORS[i % COLORS.length];
        c.beginPath();
        c.arc(PAD + 10, yy + 22, 10, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#1f2b3a';
        c.font = F.text;
        c.fillText(it.name, PAD + 34, yy + 32);
        c.fillStyle = '#7b8794';
        c.textAlign = 'right';
        c.fillText(it.count + ' 次 · ' + Math.round(it.count / e.total * 100) + '%', PAD + RW, yy + 32);
        c.textAlign = 'left';
      });
    } else if (e.type === 'times') {
      if (!e.lines.length) { c.fillStyle = '#7b8794'; c.font = F.small; c.fillText('暂无时段数据', PAD, y0 + 12); }
      c.fillStyle = '#1f2b3a';
      c.font = F.text;
      e.lines.forEach((ln, i) => {
        c.fillText(ln, PAD, y0 + 32 + i * 40);
      });
    } else if (e.type === 'foot') {
      c.fillStyle = '#b8c2cf';
      c.font = F.small;
      c.textAlign = 'center';
      c.fillText('由「找眼镜助手」小程序生成 · 数据仅属于你', W / 2, y0 + 36);
      c.textAlign = 'left';
    }
  }
  return totalH;
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
    this.mine = s;   // 供报告图导出使用（完整统计快照）
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

  // ---------- 导入导出（导出可选格式：JSON 剪贴板 / 报告图存相册） ----------
  doExport() {
    wx.showActionSheet({
      itemList: ['JSON 数据（复制到剪贴板）', '统计报告图（保存到手机相册）'],
      success: (res) => {
        if (res.tapIndex === 0) this.doExportJson();
        else if (res.tapIndex === 1) this.doExportImage();
      }
    });
  },

  async doExportJson() {
    try {
      const d = await api.request('/data/export');
      wx.setClipboardData({
        data: JSON.stringify(d, null, 2),
        success: () => toast('已复制 JSON 到剪贴板 ✓'),
        fail: () => toast('复制失败，请重试')
      });
    } catch (e) { toast(e.message); }
  },

  doExportImage() {
    if (!this.mine) { toast('统计数据尚未加载'); return; }
    wx.showLoading({ title: '正在生成…' });
    wx.createSelectorQuery().in(this)
      .select('#exportCanvas')
      .fields({ node: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          wx.hideLoading();
          toast('画布初始化失败，请重试');
          return;
        }
        try {
          drawReport(res[0].node, this.mine, store.getUser());
        } catch (e) {
          wx.hideLoading();
          toast('生成失败：' + e.message);
          return;
        }
        wx.canvasToTempFilePath({
          canvas: res[0].node,
          fileType: 'png',
          success: (r) => {
            wx.hideLoading();
            this.saveToAlbum(r.tempFilePath);
          },
          fail: () => { wx.hideLoading(); toast('生成图片失败，请重试'); }
        });
      });
  },

  saveToAlbum(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => toast('已保存到手机相册 ✓'),
      fail: (err) => {
        const msg = (err && (err.errMsg || '')) + (err && (err.errno || ''));
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0 || msg.indexOf('permission') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存报告图需要相册权限，请在设置中开启',
            confirmText: '去设置',
            success: (r) => { if (r.confirm) wx.openSetting(); }
          });
        } else {
          toast('保存失败，请重试');
        }
      }
    });
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
