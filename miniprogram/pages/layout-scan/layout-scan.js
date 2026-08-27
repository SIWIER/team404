// pages/layout-scan/layout-scan.js — 拍照识别户型：选图 → 压缩 → 视觉识别 → 预览 → 应用
// 设计要点：
// 1) 先预览再应用：识别结果只在本页只读网格展示，用户点「应用」才写入画像（覆盖前二次确认）
// 2) 图片压缩后再转 base64：后端请求体上限 2MB（core/http.js），base64 会膨胀约 33%
// 3) 后端未配置视觉模型时按钮置灰 + 文案提示，手动拖拽路径完全不受影响（与微信登录降级同思路）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, confirm, roomEmoji, roomColor, tileBorderStyle } = require('../../utils/ui');

const GRID = 10;
// 压缩目标：约 800KB 以内，base64 后约 1.07MB，稳过后端 2MB 限制
const TARGET_BYTES = 800 * 1024;

Page({
  data: {
    visionEnabled: true,
    checking: true,       // 正在探测后端是否支持
    imgPath: '',          // 本地预览图
    recognizing: false,
    applying: false,
    note: '',             // 模型给的户型概况
    rooms: [],            // 识别结果房间清单 {name,emoji,desc,spotsText,cellCount}
    tiles: [],            // 预览网格方块 {key,name,emoji,corridor,px,py}
    grid: { cell: 52, area: 312, size: GRID, cells: [] },
    layout: null          // 待应用的原始 homeLayout
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.computeGrid();
    this.checkVision();
  },

  // 网格尺寸自适应（与画像页 computeGrid 同算法，保证两页视觉一致）
  computeGrid() {
    try {
      const sys = wx.getSystemInfoSync();
      const areaPx = Math.floor((sys.windowWidth * (750 - 48 - 64 - 8)) / 750);
      const cell = Math.max(26, Math.floor(areaPx / GRID));
      const cells = [];
      for (let i = 0; i < GRID * GRID; i++) {
        cells.push({ x: (i % GRID) * cell, y: Math.floor(i / GRID) * cell });
      }
      this.setData({ grid: { cell, area: cell * GRID, size: GRID, cells } });
    } catch (e) { /* 默认值兜底 */ }
  },

  async checkVision() {
    try {
      const d = await api.request('/layout/config');
      this.setData({ visionEnabled: !!d.visionEnabled, checking: false });
    } catch (e) {
      this.setData({ visionEnabled: false, checking: false });
    }
  },

  // ---------- 选图 ----------
  chooseImage() {
    if (!this.data.visionEnabled) {
      toast('后端未配置视觉模型');
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({ imgPath: f.tempFilePath, rooms: [], tiles: [], note: '', layout: null });
        this.recognize(f.tempFilePath, f.size);
      },
      fail: () => { /* 用户取消，不打扰 */ }
    });
  },

  // 按体积决定压缩质量；小图直接用原图
  compress(filePath, size) {
    return new Promise((resolve) => {
      if (size && size <= TARGET_BYTES) return resolve(filePath);
      const quality = !size ? 70 : Math.max(30, Math.min(80, Math.floor((TARGET_BYTES / size) * 90)));
      wx.compressImage({
        src: filePath,
        quality,
        success: (r) => resolve(r.tempFilePath || filePath),
        fail: () => resolve(filePath)   // 压缩失败退回原图，由后端体积校验兜底
      });
    });
  },

  readBase64(filePath) {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: (r) => resolve(r.data),
        fail: () => reject(new Error('读取图片失败，请重新选择'))
      });
    });
  },

  mimeOf(filePath) {
    const ext = String(filePath).split('.').pop().toLowerCase();
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  },

  // ---------- 识别 ----------
  async recognize(filePath, size) {
    this.setData({ recognizing: true });
    try {
      const path = await this.compress(filePath, size);
      const image = await this.readBase64(path);
      const d = await api.request('/layout/recognize', {
        method: 'POST',
        data: { image, mimeType: this.mimeOf(path) }
      });
      this.applyPreview(d.layout, d.note);
      toast(`识别到 ${d.layout.length} 个房间`);
    } catch (e) {
      const msg = (e.errors && (e.errors.image || e.errors.mimeType)) || e.message;
      toast(msg);
      if (e.status === 503) this.setData({ visionEnabled: false });
    }
    this.setData({ recognizing: false });
  },

  // 识别结果 → 只读预览网格（定位算法与画像页 renderLayout 一致）
  applyPreview(layout, note) {
    const cell = this.data.grid.cell;
    const tiles = [];
    const rooms = [];
    (layout || []).forEach((r, i) => {
      const emoji = roomEmoji(r.name);
      const corridor = String(r.name).includes('走廊');
      const [bg, bd] = roomColor(i);
      (r.cells || []).forEach((c, ci) => {
        tiles.push({
          key: i + '-' + ci,
          name: ci === 0 ? r.name : '',   // 名字只显示在首格
          emoji,
          corridor,
          px: c.x * cell,
          py: c.y * cell,
          bg: corridor ? '#fff7e8' : bg,
          borderStyle: corridor ? '' : tileBorderStyle(r.cells || [], ci, bd)
        });
      });
      rooms.push({
        name: r.name,
        emoji,
        desc: r.desc || '',
        spotsText: (r.spots || []).join('，'),
        cellCount: (r.cells || []).length
      });
    });
    this.setData({ layout, rooms, tiles, note: note || '' });
  },

  // ---------- 应用 ----------
  async applyLayout() {
    if (!this.data.layout || !this.data.layout.length) return;
    // 防御性取值：onLoad 已挡过未登录，但本方法在用户操作后才触发，
    // 期间若令牌失效（api.js 的 401 分支会 store.clear()）user 可能已为 null
    const u = store.getUser() || {};
    const had = ((u.profile && u.profile.homeLayout) || []).length;
    const msg = had
      ? `将用识别结果替换你现有的 ${had} 个房间布局，替换后仍可在画像页手动拖拽微调。确定吗？`
      : '将把识别结果保存为你的家庭布局，之后仍可在画像页手动拖拽微调。确定吗？';
    if (!(await confirm(msg))) return;

    this.setData({ applying: true });
    try {
      const d = await api.request('/auth/profile', {
        method: 'PUT',
        data: { homeLayout: this.data.layout }
      });
      store.setUser(d.user);
      toast('户型已应用 ✓');
      setTimeout(() => wx.reLaunch({ url: '/pages/profile/profile' }), 800);
    } catch (e) {
      toast(e.message);
    }
    this.setData({ applying: false });
  },

  reset() {
    this.setData({ imgPath: '', rooms: [], tiles: [], note: '', layout: null });
  },

  previewImage() {
    if (this.data.imgPath) wx.previewImage({ urls: [this.data.imgPath] });
  },

  goProfile() {
    wx.reLaunch({ url: '/pages/profile/profile' });
  }
});
