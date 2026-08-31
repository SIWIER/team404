// pages/items/items.js — 物品管理：录入（拍照→预览→自动识别名→三级位置选择器）+ 检索（文字/图图/文图）
// 团队三项决策：
// ① 三种识别：图文（录入页拍照→识别物品文字信息，走 /api/items/recognize）、
//    图图（拍照找相同物品）、文图（文字匹配物品图片，两者走 /api/items/search-image 向量检索）
// ② 图图/文图走 Chinese-CLIP 本地部署（后端 SQLite 存向量 + 暴力余弦；未部署时按钮置灰，文字检索不受影响）
// ③ 物品照片多端同步：上传后端本地存储（data/uploads/），列表缩略图经 /api/items/:id/image 回读
// 位置链四级：目录 → 房间 → 收纳家具 → 子位置；点结果跳 pages/layout/ 高亮所在房间
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, confirm, roomEmoji } = require('../../utils/ui');

// 压缩目标：约 800KB 以内，base64 后约 1.07MB，稳过后端 2MB 请求体限制
const TARGET_BYTES = 800 * 1024;
// 子位置快捷选项（可自由输入）
const SUB_QUICK = ['一层', '二层', '三层', '抽屉', '柜顶', '盒子'];

Page({
  data: {
    mode: 'add',                 // add | search
    cfg: { checking: true, recognizeEnabled: false, clipEnabled: false },

    // ---------- 录入 ----------
    imgPath: '',                 // 本地预览图路径
    recognizing: false,
    saving: false,
    note: '',                    // 识别说明
    name: '', desc: '',
    spaces: [],                  // [{id,name}] 目录选择
    spaceId: -1,
    rooms: [],                   // 选中目录的房间 [{name, emoji, furn:[...]}]
    room: '',
    furnList: [],                // 选中房间的收纳家具
    furn: '',
    subPos: '',
    subQuick: SUB_QUICK,

    // ---------- 检索 ----------
    kind: 'kw',                  // kw 文字检索 | img 拍照找同款 | txt 文字找物品
    kw: '',
    txt: '',
    searchImgPath: '',           // 图找物已选照片预览
    imgRecogNote: '',            // 图找物：后端视觉识别出的物品文字提示
    searching: false,
    searched: false,
    results: [],                 // [{id,name,desc,locationFull,room,thumb,score}]
    filterSpaces: [],            // 检索的目录过滤 chips（含"全部"）
    searchSpaceId: -1            // -1 = 全部目录
  },

  // 页面实例状态（图片 base64 较大，不进 data 避免渲染开销）
  _image: '',                    // 录入照片 base64（裸，无 data URL 前缀）
  _mime: 'image/jpeg',
  _searchImage: '',
  _searchMime: 'image/jpeg',
  _spaces: [],                   // GET /api/spaces 全量（含每目录 layout，用于房间/家具选项）
  _resultsRaw: [],               // 最近一次检索的原始结果（删除后本地重渲染用）

  onLoad(options) {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    // 支持外部跳转：?mode=search&kind=kw|img|txt（找物品引导页的策略入口直达）
    const mode = (options && options.mode) === 'search' ? 'search' : 'add';
    const kind = ['kw', 'img', 'txt'].includes(options && options.kind) ? options.kind : 'kw';
    this.setData({ mode, kind });
    this.init();
  },

  onShow() {
    // 从户型图配置页回来时刷新房间选项（可能新摆了房间/家具）
    if (this._spaces.length) this.refreshSpaces();
  },

  async init() {
    try {
      const d = await api.request('/items/config');
      this.setData({ cfg: { checking: false, recognizeEnabled: !!d.recognizeEnabled, clipEnabled: !!d.clipEnabled } });
    } catch (e) {
      this.setData({ cfg: { checking: false, recognizeEnabled: false, clipEnabled: false } });
    }
    // 外部跳转带了图找物/文找物，但向量检索未部署 → 回退到文字检索并提示
    if (this.data.kind !== 'kw' && !this.data.cfg.clipEnabled) {
      this.setData({ kind: 'kw' });
      toast('向量检索服务未部署，已切换到文字检索');
    }
    await this.refreshSpaces();
  },

  // 拉取目录列表（含户型图）并重建房间选项；录入表单默认当前目录
  async refreshSpaces() {
    try {
      const d = await api.request('/spaces');
      this._spaces = d.spaces || [];
      const u = store.getUser() || {};
      const activeId = (u.profile && u.profile.activeSpaceId) || (this._spaces[0] && this._spaces[0].id) || -1;
      this.setData({
        spaces: this._spaces.map((s) => ({ id: s.id, name: s.name })),
        spaceId: activeId,
        filterSpaces: [{ id: -1, name: '全部' }].concat(this._spaces.map((s) => ({ id: s.id, name: s.name }))),
        searchSpaceId: this.data.searchSpaceId === -1 ? -1 : this.data.searchSpaceId
      });
      this.computeRooms(activeId);
    } catch (e) {
      toast(e.message);
    }
  },

  // 按目录重建房间 chips（房间名 + 该房间的家具清单）
  computeRooms(spaceId) {
    const sp = this._spaces.find((s) => s.id === Number(spaceId));
    const layout = (sp && sp.layout) || [];
    const rooms = layout.map((r) => ({
      name: r.name,
      emoji: roomEmoji(r.name),
      furn: Array.isArray(r.furn) ? [...new Set(r.furn.map((f) => f.name).filter(Boolean))] : []
    }));
    this.setData({ rooms });
    this.computeFurn();
  },

  // 按当前 room 重建家具 chips
  computeFurn() {
    const r = this.data.rooms.find((x) => x.name === this.data.room);
    this.setData({ furnList: r ? r.furn : [] });
  },

  // ---------- 顶部 tab ----------
  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  // ---------- 图片工具（与 layout-scan 同款：压缩→base64） ----------
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

  pickImage() {
    return new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0];
          if (f) resolve(f);
          else reject(new Error('未选择照片'));
        },
        fail: () => reject(new Error('已取消'))
      });
    });
  },

  // ---------- 录入：选图 + 图文识别 ----------
  async chooseImage() {
    let f;
    try { f = await this.pickImage(); } catch (e) { if (e.message !== '已取消') toast(e.message); return; }
    this.setData({ imgPath: f.tempFilePath, note: '', name: '', desc: '', room: '', furn: '', subPos: '' });
    try {
      const path = await this.compress(f.tempFilePath, f.size);
      this._image = await this.readBase64(path);
      this._mime = this.mimeOf(path);
      if (this.data.cfg.recognizeEnabled) await this.recognize();
    } catch (e) {
      toast(e.message);
    }
  },

  // 图文识别：照片 → 物品文字信息回填表单（失败不阻断，可手动填写）
  async recognize() {
    if (!this._image) return;
    this.setData({ recognizing: true, note: '' });
    try {
      const d = await api.request('/items/recognize', {
        method: 'POST',
        data: { image: this._image, mimeType: this._mime }
      });
      const it = d.item || {};
      this.setData({
        name: it.name || '',
        desc: it.desc || '',
        room: it.room || '',
        furn: it.furn || '',
        subPos: it.subPos || '',
        note: d.note || '已自动识别，可修改后保存'
      });
      this.computeFurn();
    } catch (e) {
      const msg = (e.errors && (e.errors.image || e.errors.mimeType)) || e.message;
      toast(msg + '（可手动填写）');
      if (e.status === 503) this.setData({ 'cfg.recognizeEnabled': false });
    }
    this.setData({ recognizing: false });
  },

  retryRecognize() { this.recognize(); },

  clearImage() {
    this._image = '';
    this.setData({ imgPath: '', note: '' });
  },

  previewImage() {
    if (this.data.imgPath) wx.previewImage({ urls: [this.data.imgPath] });
  },

  // ---------- 录入：三级位置选择 ----------
  onSpaceTap(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.setData({ spaceId: id });
    this.computeRooms(id);
  },
  onRoomTap(e) {
    this.setData({ room: e.currentTarget.dataset.name });
    this.computeFurn();
  },
  onFurnTap(e) {
    this.setData({ furn: e.currentTarget.dataset.name });
  },
  onSubQuick(e) {
    this.setData({ subPos: e.currentTarget.dataset.name });
  },
  onRoomInput(e) {
    this.setData({ room: e.detail.value });
    this.computeFurn();
  },
  onField(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ [k]: e.detail.value });
  },

  // ---------- 录入：保存 ----------
  async save() {
    const d = this.data;
    if (!d.name && !this._image) { toast('请填写物品名称或拍照'); return; }
    this.setData({ saving: true });
    try {
      await api.request('/items', {
        method: 'POST',
        data: {
          spaceId: d.spaceId > 0 ? d.spaceId : null,
          name: d.name, desc: d.desc,
          image: this._image || undefined, mimeType: this._mime,
          room: d.room, furn: d.furn, subPos: d.subPos
        }
      });
      toast('已保存 ✓');
      // 重置表单 → 切到检索页自动展示全部物品（刚录入的排最前）
      this._image = '';
      this.setData({
        imgPath: '', note: '', name: '', desc: '', room: '', furn: '', subPos: '',
        saving: false, mode: 'search', kind: 'kw', kw: '', searched: false, results: []
      });
      this.doSearch();
    } catch (e) {
      this.setData({ saving: false });
      toast(e.message);
    }
  },

  // ---------- 检索：模式与过滤 ----------
  setKind(e) {
    const kind = e.currentTarget.dataset.kind;
    if (kind !== 'kw' && !this.data.cfg.clipEnabled) { toast('向量检索服务未部署（需本地 Chinese-CLIP）'); return; }
    this.setData({ kind, searched: false, results: [], searchImgPath: '' });
  },
  onSpaceFilter(e) {
    this.setData({ searchSpaceId: Number(e.currentTarget.dataset.id) });
  },
  onKw(e) { this.setData({ kw: e.detail.value }); },
  onTxt(e) { this.setData({ txt: e.detail.value }); },

  async chooseSearchImage() {
    let f;
    try { f = await this.pickImage(); } catch (e) { if (e.message !== '已取消') toast(e.message); return; }
    try {
      const path = await this.compress(f.tempFilePath, f.size);
      this._searchImage = await this.readBase64(path);
      this._searchMime = this.mimeOf(path);
      this.setData({ searchImgPath: f.tempFilePath });
      this.doSearch();
    } catch (e) {
      toast(e.message);
    }
  },

  // 统一检索入口：按 kind 调对应接口
  async doSearch() {
    const d = this.data;
    this.setData({ searching: true, searched: false, imgRecogNote: '' });
    let rows = [];
    let scoreBy = null;
    try {
      const spaceId = d.searchSpaceId > 0 ? d.searchSpaceId : undefined;
      if (d.kind === 'kw') {
        // GET 查询串手动拼，避免 wx.request 对 undefined 参数序列化不一致
        let path = '/items?q=' + encodeURIComponent(d.kw);
        if (spaceId) path += '&space_id=' + spaceId;
        const r = await api.request(path);
        rows = r.items || [];
      } else if (d.kind === 'img') {
        if (!this._searchImage) { toast('先拍下要找的物品'); return; }
        const r = await api.request('/items/search-image', {
          method: 'POST',
          data: { image: this._searchImage, mimeType: this._searchMime, spaceId }
        });
        rows = (r.results || []).map((x) => ({ ...x.item, score: x.score }));
        scoreBy = r.matchBy;
        // 后端双路融合：照片已被视觉模型识别成文字，纯文字物品按该文字匹配
        if (r.recognized && r.recognized.name) {
          this.setData({ imgRecogNote: '🤖 识别为「' + r.recognized.name + '」，纯文字物品按此文字匹配' });
        }
      } else {
        const text = d.txt.trim();
        if (!text) { toast('请先描述要找的物品'); return; }
        const r = await api.request('/items/search-image', {
          method: 'POST',
          data: { text, spaceId }
        });
        rows = (r.results || []).map((x) => ({ ...x.item, score: x.score }));
        scoreBy = r.matchBy;
      }
      this._resultsRaw = rows;
      const results = await this.loadThumbs(rows);
      this.setData({ results, searched: true, matchBy: scoreBy });
    } catch (e) {
      toast(e.message);
      this.setData({ results: [], searched: true });
    } finally {
      this.setData({ searching: false });
    }
  },

  // 逐件回读缩略图（≤10 件，串行请求避免瞬时并发）
  async loadThumbs(rows) {
    const out = [];
    for (const r of rows) {
      const row = {
        id: r.id, name: r.name, desc: r.desc || '',
        locationFull: r.locationFull || r.location || '未设置位置',
        room: r.room || '',
        hasImage: !!r.hasImage,
        thumb: '',
        score: r.score == null ? null : r.score
      };
      if (row.hasImage) {
        try {
          const d = await api.request('/items/' + r.id + '/image');
          row.thumb = 'data:' + d.mimeType + ';base64,' + d.image;
        } catch (e) { /* 缩略图失败只影响展示 */ }
      }
      out.push(row);
    }
    return out;
  },

  // 点结果 → 户型图高亮所在房间（完整位置链的展示在列表里已有）
  tapItem(e) {
    const room = e.currentTarget.dataset.room;
    if (!room) { toast('该物品没有设置房间'); return; }
    wx.navigateTo({ url: '/pages/layout/layout?highlight=' + encodeURIComponent(room) });
  },

  // 纯文字物品补录照片（也可换图）：上传后用本地 Chinese-CLIP 立即重嵌，不经过 DS/视觉模型
  async addPhoto(e) {
    const id = Number(e.currentTarget.dataset.id);
    let f;
    try { f = await this.pickImage(); } catch (err) { if (err.message !== '已取消') toast(err.message); return; }
    try {
      const path = await this.compress(f.tempFilePath, f.size);
      const image = await this.readBase64(path);
      const mime = this.mimeOf(path);
      const r = await api.request('/items/' + id + '/image', {
        method: 'POST',
        data: { image, mimeType: mime }
      });
      toast(r.embedded ? '照片已保存，向量已更新 ✓' : '照片已保存（向量服务未部署，稍后自动入库）');
      if (this.data.mode === 'search') this.doSearch();
    } catch (err) {
      toast(err.message);
    }
  },

  async deleteItem(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (!(await confirm('删除这件物品的记录（照片也会删除）？'))) return;
    try {
      await api.request('/items/' + id, { method: 'DELETE' });
      this._resultsRaw = this._resultsRaw.filter((r) => r.id !== id);
      const results = await this.loadThumbs(this._resultsRaw);
      this.setData({ results });
      toast('已删除');
    } catch (err) {
      toast(err.message);
    }
  },

  goLayout() {
    wx.navigateTo({ url: '/pages/layout/layout' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});
