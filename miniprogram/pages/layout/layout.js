// pages/layout/layout.js — 户型图配置（独立页）
// 物品数字化存放系统：为每个目录（家/公司/宿舍…）维护一套户型图，房间内可配置内部模块（书桌/书架/壁橱…）
// 简化设计（相对旧画像页编辑器）：
// 1) 直接拖放：预设房间方块常驻托盘，按住直接拖进网格即自动创建摆放；点一下 = 放入第一个空位（不再需要先点＋创建）
// 2) 单模式编辑大小：一个「编辑大小」按钮，选中房间后 ＋加格 / −减格 同屏完成
// 3) 房间卡片只留名称；房间描述与常用存放位置移入「内部模块」浮层
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, confirm, roomEmoji, roomColor, tileBorderStyle } = require('../../utils/ui');

const ROOM_PRESETS = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
const GRID = 10;
// 房间数量上限：与后端 sanitizeLayout（accounts.service.js）的 slice(0, MAX_ROOMS) 一致
const MAX_ROOMS = 36;
// 房间内部画布 12×12（与后端 furn 坐标 0-11 一致）
const FURN_GRID = 12;

// 房间内部模块（家具）：通用 + 按房间类型自适应（与 Web 版一致）
const FURN_COMMON = ['书桌', '书架', '壁橱', '柜子', '架子', '窗台', '桌子'];
const FURN_BY_TYPE = {
  '卧室': ['床', '床头柜'],
  '卫生间': ['洗手池', '便池', '浴池'],
  '客厅': ['沙发', '电视', '茶几'],
  '厨房': ['灶台', '冰箱', '洗手池'],
  '书房': ['书桌', '书架']
};
const FURN_ALL = [...new Set([...FURN_COMMON, ...Object.values(FURN_BY_TYPE).flat()])];
const FURN_EMOJI = {
  '书桌': '🖥️', '书架': '📚', '壁橱': '👕', '床': '🛏️', '床头柜': '🗄️',
  '柜子': '🗄️', '架子': '📦', '桌子': '🪑', '窗台': '🪟', '洗手池': '🚰', '便池': '🚽',
  '浴池': '🛁', '沙发': '🛋️', '电视': '📺', '茶几': '🪑', '灶台': '🍳', '冰箱': '🧊'
};
function furnEmoji(name) {
  // 同名物件自动编号（书桌2/书桌3…）：按基础名查 emoji
  return FURN_EMOJI[String(name || '').replace(/\d+$/, '')] || '🪑';
}
// 按房间名返回可选模块（未匹配到特定类型 → 全部模块）
function furnOptionsFor(roomName) {
  const n = String(roomName || '');
  if (n.includes('卧室')) return [...FURN_COMMON, ...FURN_BY_TYPE['卧室']];
  if (n.includes('卫生间') || n.includes('厕所') || n.includes('洗手间')) return [...FURN_COMMON, ...FURN_BY_TYPE['卫生间']];
  if (n.includes('客厅')) return [...FURN_COMMON, ...FURN_BY_TYPE['客厅']];
  if (n.includes('厨房')) return [...FURN_COMMON, ...FURN_BY_TYPE['厨房']];
  if (n.includes('书房')) return [...FURN_COMMON, ...FURN_BY_TYPE['书房']];
  return [...FURN_ALL];
}
// 标准户型模板（10×10 细网格）：走廊居中成链，所有房间与走廊相邻（全连通）
function rect(x0, y0, w, h) {
  const cells = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) cells.push({ x, y });
  }
  return cells;
}
const TEMPLATE = [
  { key: '走廊', cells: Array.from({ length: 8 }, (_, i) => ({ x: 4, y: i + 1 })) },
  { key: '玄关', cells: [{ x: 4, y: 9 }] },
  { key: '客厅', cells: rect(5, 2, 4, 3) },
  { key: '阳台', cells: rect(9, 2, 1, 3) },
  { key: '卧室2', cells: rect(0, 1, 3, 3) },
  { key: '卧室', cells: rect(0, 5, 3, 3) },
  { key: '厨房', cells: rect(5, 6, 2, 2) },
  { key: '卫生间', cells: rect(7, 6, 2, 2) },
  { key: '卫生间2', cells: rect(5, 9, 2, 1) },
  { key: '餐厅', cells: rect(7, 8, 2, 1) },
  { key: '书房', cells: rect(0, 8, 3, 2) },
  { key: '衣帽间', cells: rect(3, 1, 1, 3) },
  { key: '储物间', cells: rect(3, 5, 1, 3) }
];

Page({
  data: {
    rooms: [], tiles: [], roomLabels: [],
    unplaced: [], presets: [],
    grid: { cell: 40, area: 400, size: GRID, cells: [] },
    drag: { idx: -1, dx: 0, dy: 0 },
    ghost: { show: false, emoji: '', name: '', x: 0, y: 0 },
    sizeMode: false, sizeTarget: -1, sizeCands: [],
    sizeGuide: { show: false, x: 0, y: 0, w: 0, h: 0, text: '' },
    spaces: [], activeSpaceId: -1,
    savingLayout: false,
    furnEditor: { show: false, roomIdx: -1, roomName: '', cell: 22, area: 264, areaH: 264, gridCells: [], roomOutline: [], tiles: [], labels: [], cands: [], guide: { show: false, x: 0, y: 0, w: 0, h: 0, text: '' }, items: [], palette: [], sizeMode: false, sizeTarget: -1, desc: '', spotsText: '' },
    furnDrag: { idx: -1, dx: 0, dy: 0 },
    furnGhost: { show: false, emoji: '', name: '', x: 0, y: 0 }
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.computeGrid();
    this.init();
  },

  computeGrid() {
    try {
      const sys = wx.getSystemInfoSync();
      const win = sys.windowWidth;
      const areaPx = Math.floor((win * (750 - 48 - 64 - 8)) / 750);
      const cell = Math.max(26, Math.floor(areaPx / GRID));
      const cells = [];
      for (let i = 0; i < GRID * GRID; i++) {
        cells.push({ x: (i % GRID) * cell, y: Math.floor(i / GRID) * cell });
      }
      this.setData({ grid: { cell, area: cell * GRID, size: GRID, cells } });
    } catch (e) { /* 默认值兜底 */ }
  },

  init() {
    const p = store.getUser().profile;
    this.rooms = (p.homeLayout || []).map((r, i) => ({
      idx: i,
      name: r.name || '',
      desc: r.desc || '',
      spotsText: (r.spots || []).join('，'),
      cells: (Array.isArray(r.cells) && r.cells.length)
        ? r.cells.map((c) => ({ x: c.x, y: c.y }))
        : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []),
      w: r.w || 12,
      h: r.h || 12,
      furn: (Array.isArray(r.furn) ? r.furn.map((f) => ({ name: f.name, x: f.x, y: f.y })) : [])
    }));
    this.setData({ spaces: p.spaces || [], activeSpaceId: p.activeSpaceId });
    this.renderLayout();
  },

  // ---------- 房间创建：直接拖放 / 点一下放入 ----------
  canAddRoom() {
    if (this.rooms.length >= MAX_ROOMS) {
      toast('房间已达上限（36 个）');
      return false;
    }
    return true;
  },

  placePreset(name) {
    if (!this.canAddRoom()) return;
    const empty = this.firstEmpty();
    if (!empty) { toast('网格已满，先移出或删除一些房间'); return; }
    const uname = uniqueRoomName(this.rooms, name);
    this.rooms.push({ idx: nextIdx(this.rooms), name: uname, desc: '', spotsText: '', cells: [empty], w: 12, h: 12, furn: [] });
    this.renderLayout();
    toast('已放入「' + uname + '」');
  },

  addCustom() {
    if (!this.canAddRoom()) return;
    wx.showModal({
      title: '自定义房间',
      editable: true,
      placeholderText: '房间名（如：电竞房 / 茶水间）',
      success: (r) => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim() || '自定义房间';
        this.placePreset(name);
      }
    });
  },

  // 预设托盘：点一下 = 放入第一个空位
  onPaletteTap(e) {
    this.placePreset(e.currentTarget.dataset.name);
  },

  // 预设托盘：按住直接拖进网格，落在哪格就在哪格创建
  onPaletteTouchStart(e) {
    const t = e.touches[0];
    this._pal = { name: e.currentTarget.dataset.name, sx: t.clientX, sy: t.clientY, moved: false };
    this._areaRect = null;
    wx.createSelectorQuery().in(this).select('.floor-area').boundingClientRect((rect) => {
      this._areaRect = rect;
    }).exec();
  },

  onPaletteTouchMove(e) {
    if (!this._pal) return;
    const t = e.touches[0];
    const dx = t.clientX - this._pal.sx;
    const dy = t.clientY - this._pal.sy;
    if (!this._pal.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._pal.moved = true;
    const cell = this.data.grid.cell;
    this.setData({
      ghost: { show: true, emoji: roomEmoji(this._pal.name), name: this._pal.name, x: t.clientX - cell / 2, y: t.clientY - cell / 2 }
    });
  },

  onPaletteTouchEnd(e) {
    const pal = this._pal;
    this._pal = null;
    this.setData({ ghost: { show: false, emoji: '', name: '', x: 0, y: 0 } });
    if (!pal) return;
    // 未拖动：由 bindtap（onPaletteTap）处理放入，避免重复放置
    if (!pal.moved) return;
    const t = e.changedTouches[0];
    const rect = this._areaRect;
    if (!rect || t.clientX < rect.left || t.clientX > rect.right || t.clientY < rect.top || t.clientY > rect.bottom) {
      toast('拖到下方网格中放置');
      return;
    }
    if (!this.canAddRoom()) return;
    const cell = this.data.grid.cell;
    const x = clamp(Math.floor((t.clientX - rect.left) / cell), 0, GRID - 1);
    const y = clamp(Math.floor((t.clientY - rect.top) / cell), 0, GRID - 1);
    if (this.occupiedSet(-1).has(key({ x, y }))) { toast('该格已被占用'); return; }
    const uname = uniqueRoomName(this.rooms, pal.name);
    this.rooms.push({ idx: nextIdx(this.rooms), name: uname, desc: '', spotsText: '', cells: [{ x, y }], w: 12, h: 12, furn: [] });
    this.renderLayout();
    toast('已放置「' + uname + '」');
  },
  // ---------- 房间改名 / 删除 ----------
  onRoomInput(e) {
    const { idx, k } = e.currentTarget.dataset;
    const room = this.rooms.find((r) => r.idx === Number(idx));
    if (!room) return;
    const wasCorridor = room.name.includes('走廊');
    room[k] = e.detail.value;
    // 改名离开走廊：多格塌缩为第一格，避免形状残留
    if (k === 'name' && wasCorridor && !room.name.includes('走廊') && room.cells.length > 1) {
      room.cells = room.cells.slice(0, 1);
    }
    this.renderLayout();
  },

  removeRoom(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.rooms = this.rooms.filter((r) => r.idx !== idx);
    this.renderLayout();
  },

  // ---------- 网格内方块拖拽（自研实现，数据单一来源） ----------
  onTileTouchStart(e) {
    const t = e.touches[0];
    this._t = { idx: Number(e.currentTarget.dataset.idx), sx: t.clientX, sy: t.clientY, moved: false };
  },

  onTileTouchMove(e) {
    if (!this._t) return;
    const t = e.touches[0];
    const dx = t.clientX - this._t.sx;
    const dy = t.clientY - this._t.sy;
    if (!this._t.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._t.moved = true;
    this.setData({ drag: { idx: this._t.idx, dx, dy } });
  },

  onTileTouchEnd() {
    const t = this._t;
    if (!t) return;
    this._t = null;
    if (!t.moved) { this.resetDrag(); return; }
    const cell = this.data.grid.cell;
    const dX = Math.round(this.data.drag.dx / cell);
    const dY = Math.round(this.data.drag.dy / cell);
    this.resetDrag();
    if (dX === 0 && dY === 0) return;

    const room = this.rooms.find((r) => r.idx === t.idx);
    if (!room || !room.cells.length) return;

    if (room.cells.length > 1) {
      // 多格房间整体平移：校验不出界、不与他人重叠
      const cand = room.cells.map((c) => ({ x: c.x + dX, y: c.y + dY }));
      const occupied = this.occupiedSet(room.idx);
      const ok = cand.every((c) => c.x >= 0 && c.x < GRID && c.y >= 0 && c.y < GRID && !occupied.has(key(c)));
      if (!ok) { toast('移不过去：会出界或与其他房间重叠'); this.renderLayout(); return; }
      room.cells = cand;
    } else {
      const target = {
        x: clamp(room.cells[0].x + dX, 0, GRID - 1),
        y: clamp(room.cells[0].y + dY, 0, GRID - 1)
      };
      if (target.x === room.cells[0].x && target.y === room.cells[0].y) return;
      const other = this.rooms.find((r) => r.idx !== room.idx && r.cells.some((c) => c.x === target.x && c.y === target.y));
      if (other) {
        other.cells = room.cells;
        toast('与「' + other.name + '」交换了位置');
      }
      room.cells = [target];
    }
    this.renderLayout();
  },

  resetDrag() {
    this.setData({ drag: { idx: -1, dx: 0, dy: 0 } });
  },

  // 点 ✕ → 移出该格（走廊去掉该段；普通房间回托盘）
  removeFromGrid(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const ci = Number(e.currentTarget.dataset.ci);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    if (room.cells.length > 1) {
      room.cells.splice(ci, 1);
    } else {
      room.cells = [];
    }
    this.renderLayout();
  },

  // ---------- 移出待放托盘：点一下放回 / 按住拖回网格 ----------
  onTrayTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    const empty = this.firstEmpty();
    if (!empty) { toast('网格已满，先把某个房间移出'); return; }
    room.cells = [empty];
    this.renderLayout();
  },

  onTrayTouchStart(e) {
    const t = e.touches[0];
    this._chip = { idx: Number(e.currentTarget.dataset.idx), sx: t.clientX, sy: t.clientY, moved: false };
    this._areaRect = null;
    wx.createSelectorQuery().in(this).select('.floor-area').boundingClientRect((rect) => {
      this._areaRect = rect;
    }).exec();
  },

  onTrayTouchMove(e) {
    if (!this._chip) return;
    const t = e.touches[0];
    const dx = t.clientX - this._chip.sx;
    const dy = t.clientY - this._chip.sy;
    if (!this._chip.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._chip.moved = true;
    const room = this.rooms.find((r) => r.idx === this._chip.idx);
    if (!room) return;
    const cell = this.data.grid.cell;
    this.setData({
      ghost: { show: true, emoji: roomEmoji(room.name), name: room.name, x: t.clientX - cell / 2, y: t.clientY - cell / 2 }
    });
  },

  onTrayTouchEnd(e) {
    const chip = this._chip;
    this._chip = null;
    this.setData({ ghost: { show: false, emoji: '', name: '', x: 0, y: 0 } });
    if (!chip) return;
    const room = this.rooms.find((r) => r.idx === chip.idx);
    if (!room) return;
    // 未拖动：由 bindtap（onTrayTap）处理放回，避免重复放置
    if (!chip.moved) return;
    const t = e.changedTouches[0];
    const rect = this._areaRect;
    if (!rect || t.clientX < rect.left || t.clientX > rect.right || t.clientY < rect.top || t.clientY > rect.bottom) {
      toast('没有落在网格内，房间留在托盘');
      return;
    }
    const cell = this.data.grid.cell;
    const x = clamp(Math.floor((t.clientX - rect.left) / cell), 0, GRID - 1);
    const y = clamp(Math.floor((t.clientY - rect.top) / cell), 0, GRID - 1);
    const other = this.rooms.find((r) => r.idx !== room.idx && r.cells.some((c) => c.x === x && c.y === y));
    if (other) {
      other.cells = room.cells;
      toast('与「' + other.name + '」交换了位置');
    }
    room.cells = [{ x, y }];
    this.renderLayout();
  },

  // ---------- 单模式编辑大小（＋加格 / −减格 同屏） ----------
  toggleSize() {
    const turningOn = !this.data.sizeMode;
    let sizeTarget = -1;
    if (turningOn) {
      const corridor = this.rooms.find((r) => r.name.includes('走廊'));
      sizeTarget = corridor ? corridor.idx : (this.rooms.find((r) => r.cells.length) || { idx: -1 }).idx;
    }
    this.setData({ sizeMode: turningOn, sizeTarget });
    this.renderLayout();
  },

  onTileTap(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    if (this.data.sizeMode) {
      this.setData({ sizeTarget: idx });
      this.renderLayout();
      return;
    }
    // 单击已放置的房间块 → 打开房间内部模块（家具）编辑器
    this.openFurnEditor(idx);
  },

  onAddCell(e) {
    if (!this.data.sizeMode) return;
    const room = this.rooms.find((r) => r.idx === this.data.sizeTarget);
    if (!room) return;
    const x = Number(e.currentTarget.dataset.x);
    const y = Number(e.currentTarget.dataset.y);
    room.cells.push({ x, y });
    this.renderLayout(); // 保持编辑大小模式，继续点下一个格可连成任意形状
  },

  onRemoveCell(e) {
    if (!this.data.sizeMode) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const ci = Number(e.currentTarget.dataset.ci);
    const room = this.rooms.find((r) => r.idx === idx);
    if (!room) return;
    if (room.cells.length <= 1) { toast('房间至少保留一格'); return; }
    room.cells.splice(ci, 1);
    this.renderLayout();
  },
  // ---------- 房间内部模块（家具）编辑器：与户型图一致的拖拽 + 自由编辑大小 ----------
  // 画布固定 12×12（与后端 furn 坐标 0-11 一致）；每个模块可占多格，可拖动、可＋/− 编辑大小
  openFurnFromCard(e) {
    this.openFurnEditor(Number(e.currentTarget.dataset.idx));
  },

  openFurnEditor(roomIdx) {
    if (this.data.sizeMode) return;
    const room = this.rooms.find((r) => r.idx === roomIdx);
    if (!room) return;
    // 兼容旧单格 {name,x,y} 与新的多格 cells
    this._furn = {
      roomIdx,
      desc: room.desc || '',
      spotsText: room.spotsText || '',
      // 房间外轮廓（来自户型图）：作为内部编辑的辅助线
      shape: this.roomShape(room),
      items: (Array.isArray(room.furn) ? room.furn : []).map((f, i) => ({
        idx: i,
        name: f.name || '',
        emoji: furnEmoji(f.name),
        cells: (Array.isArray(f.cells) && f.cells.length)
          ? f.cells.map((c) => ({ x: c.x, y: c.y }))
          : ((f.x != null && f.y != null) ? [{ x: f.x, y: f.y }] : [])
      })).filter((it) => it.name && it.cells.length),
      sizeMode: false,
      sizeTarget: -1,
      selected: -1
    };
    this.renderFurnEditor();
  },

  // 房间在户型图上的外轮廓 → 相对坐标（自身左上角为 0,0）
  roomShape(room) {
    const cells = (Array.isArray(room.cells) && room.cells.length) ? room.cells : [];
    if (!cells.length) return null;
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return {
      cells: cells.map((c) => ({ x: c.x - minX, y: c.y - minY })),
      w: maxX - minX + 1,
      h: maxY - minY + 1
    };
  },

  onFurnInput(e) {
    const f = this._furn;
    if (!f) return;
    const k = e.currentTarget.dataset.k;
    f[k] = e.detail.value;
    this.setData({ ['furnEditor.' + k]: f[k] });
  },

  renderFurnEditor() {
    const f = this._furn;
    if (!f) return;
    const cell = 22;
    const gridCells = [];
    for (let i = 0; i < FURN_GRID * FURN_GRID; i++) {
      gridCells.push({ x: (i % FURN_GRID) * cell, y: Math.floor(i / FURN_GRID) * cell });
    }
    // 房间外轮廓辅助线：户型图轮廓按整数格等比放大到内部画布，只描最外圈线条，线条紧贴网格线
    const roomOutline = [];
    if (f.shape) {
      const { w, h, cells } = f.shape;
      // 整数倍缩放：房间每个格映射到整数个内部网格格，外轮廓正好落在 22px 网格线上
      const scale = Math.max(1, Math.min(Math.floor(FURN_GRID / w), Math.floor(FURN_GRID / h)));
      const offX = Math.floor((FURN_GRID - w * scale) / 2);
      const offY = Math.floor((FURN_GRID - h * scale) / 2);
      const cellSet = new Set(cells.map((c) => c.x + ',' + c.y));
      const has = (x, y) => x >= 0 && x < w && y >= 0 && y < h && cellSet.has(x + ',' + y);
      const W = 2;                          // 线条宽度（px）
      const HW = Math.floor(W / 2);         // 半宽：让线条居中落在网格线上
      const maxPx = cell * FURN_GRID;       // 画布像素边长
      const clampPos = (v) => Math.max(0, Math.min(maxPx - W, v)); // 2px 厚度方向的起点：保证整条线都在画布内
      const clampLen = (v) => Math.max(0, Math.min(maxPx, v));     // 长度方向两端夹取：贴画布边时截断溢出部分
      cells.forEach((c) => {
        const x0 = (offX + c.x * scale) * cell;
        const y0 = (offY + c.y * scale) * cell;
        const len = scale * cell;
        // 线段居中于网格线并向两端各延伸 1px，保证与相邻线段/角点相接；边界处夹取到画布内，避免被裁剪
        if (!has(c.x - 1, c.y)) {
          const top = clampLen(y0 - HW), bottom = clampLen(y0 + len + HW);
          if (bottom > top) roomOutline.push({ key: 'vl-' + c.x + '-' + c.y, left: clampPos(x0 - HW), top, width: W, height: bottom - top });
        }
        if (!has(c.x + 1, c.y)) {
          const top = clampLen(y0 - HW), bottom = clampLen(y0 + len + HW);
          if (bottom > top) roomOutline.push({ key: 'vr-' + c.x + '-' + c.y, left: clampPos(x0 + len - HW), top, width: W, height: bottom - top });
        }
        if (!has(c.x, c.y - 1)) {
          const left = clampLen(x0 - HW), right = clampLen(x0 + len + HW);
          if (right > left) roomOutline.push({ key: 'ht-' + c.x + '-' + c.y, left, top: clampPos(y0 - HW), width: right - left, height: W });
        }
        if (!has(c.x, c.y + 1)) {
          const left = clampLen(x0 - HW), right = clampLen(x0 + len + HW);
          if (right > left) roomOutline.push({ key: 'hb-' + c.x + '-' + c.y, left, top: clampPos(y0 + len - HW), width: right - left, height: W });
        }
      });
    }
    const tiles = [];
    const labels = [];
    const selIdx = f.sizeMode ? f.sizeTarget : f.selected;
    f.items.forEach((it, pos) => {
      const [bg, bd] = roomColor(pos);
      it.cells.forEach((c, ci) => {
        tiles.push({
          key: it.idx + '-' + ci,
          idx: it.idx,
          ci,
          showX: ci === 0 && !f.sizeMode,
          shrinkBadge: f.sizeMode && it.idx === selIdx && it.cells.length > 1,
          selected: it.idx === selIdx,
          emoji: (ci === 0 && it.cells.length > 1) ? it.emoji : '',
          px: c.x * cell,
          py: c.y * cell,
          bg,
          borderStyle: tileBorderStyle(it.cells, ci, bd)
        });
      });
      if (it.cells.length) {
        const xs = it.cells.map((c) => c.x);
        const ys = it.cells.map((c) => c.y);
        labels.push({
          key: 'fl-' + it.idx,
          text: it.cells.length > 1 ? it.name : it.emoji + ' ' + it.name,
          cx: ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * cell,
          cy: ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * cell
        });
      }
    });
    // 编辑大小模式：选中模块四周空格为 ＋ 候选
    let cands = [];
    // 放大轮廓辅助线：选中模块的虚线包围盒
    let guide = { show: false, x: 0, y: 0, w: 0, h: 0, text: '' };
    if (f.sizeMode) {
      const it = f.items.find((x) => x.idx === selIdx);
      if (it) {
        const occ = new Set(f.items.flatMap((x) => x.cells.map((c) => c.x + ',' + c.y)));
        const seen = new Set();
        for (const c of it.cells) {
          for (const d of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }]) {
            const nx = c.x + d.x;
            const ny = c.y + d.y;
            if (nx < 0 || nx >= FURN_GRID || ny < 0 || ny >= FURN_GRID) continue;
            const k = nx + ',' + ny;
            if (seen.has(k) || occ.has(k)) continue;
            seen.add(k);
            cands.push({ idx: it.idx, x: nx, y: ny, px: nx * cell, py: ny * cell });
          }
        }
        if (it.cells.length) {
          const xs = it.cells.map((c) => c.x);
          const ys = it.cells.map((c) => c.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          const y0 = Math.min(...ys), y1 = Math.max(...ys);
          const pad = 3;
          guide = {
            show: true,
            x: x0 * cell - pad,
            y: y0 * cell - pad,
            w: (x1 - x0 + 1) * cell + pad * 2,
            h: (y1 - y0 + 1) * cell + pad * 2,
            text: it.name + ' · ' + (x1 - x0 + 1) + '×' + (y1 - y0 + 1) + ' 格',
            tagBelow: (y1 + 1) < FURN_GRID
          };
        }
      }
    }
    const room = this.rooms.find((r) => r.idx === f.roomIdx);
    this.setData({
      furnEditor: {
        show: true,
        roomIdx: f.roomIdx,
        roomName: room ? room.name : '',
        cell,
        area: FURN_GRID * cell,
        areaH: FURN_GRID * cell,
        gridCells,
        roomOutline,
        tiles,
        labels,
        cands,
        guide,
        items: f.items.map((it) => ({
          idx: it.idx, name: it.name, emoji: it.emoji,
          cells: it.cells, cellCount: it.cells.length
        })),
        palette: furnOptionsFor(room ? room.name : '').map((n) => ({ name: n, emoji: furnEmoji(n) })),
        sizeMode: f.sizeMode,
        sizeTarget: f.sizeTarget,
        desc: f.desc,
        spotsText: f.spotsText
      }
    });
  },

  furnFirstEmpty() {
    const f = this._furn;
    const occ = new Set(f.items.flatMap((it) => it.cells.map((c) => c.x + ',' + c.y)));
    for (let y = 0; y < FURN_GRID; y++) {
      for (let x = 0; x < FURN_GRID; x++) {
        if (!occ.has(x + ',' + y)) return { x, y };
      }
    }
    return null;
  },

  // ---------- 模块托盘：点一下放入 / 按住直接拖进画布（与户型图一致） ----------
  furnPlace(name) {
    const f = this._furn;
    if (!f) return;
    const empty = this.furnFirstEmpty();
    if (!empty) { toast('画布已满，先删除一些模块'); return; }
    const uname = furnUniqueName(f.items, name);
    f.items.push({ idx: furnNextIdx(f.items), name: uname, emoji: furnEmoji(uname), cells: [empty] });
    this.renderFurnEditor();
  },

  onFurnChipTap(e) {
    this.furnPlace(e.currentTarget.dataset.name);
  },

  onFurnChipTouchStart(e) {
    const t = e.touches[0];
    this._fc = { name: e.currentTarget.dataset.name, sx: t.clientX, sy: t.clientY, moved: false };
    this._furnRect = null;
    wx.createSelectorQuery().in(this).select('.furn-area').boundingClientRect((rect) => {
      this._furnRect = rect;
    }).exec();
  },

  onFurnChipTouchMove(e) {
    if (!this._fc) return;
    const t = e.touches[0];
    const dx = t.clientX - this._fc.sx;
    const dy = t.clientY - this._fc.sy;
    if (!this._fc.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._fc.moved = true;
    const cell = 22;
    this.setData({
      furnGhost: { show: true, emoji: furnEmoji(this._fc.name), name: this._fc.name, x: t.clientX - cell / 2, y: t.clientY - cell / 2 }
    });
  },

  onFurnChipTouchEnd(e) {
    const fc = this._fc;
    this._fc = null;
    this.setData({ furnGhost: { show: false, emoji: '', name: '', x: 0, y: 0 } });
    if (!fc) return;
    // 未拖动：由 bindtap（onFurnChipTap）处理放入
    if (!fc.moved) return;
    const t = e.changedTouches[0];
    const rect = this._furnRect;
    if (!rect || t.clientX < rect.left || t.clientX > rect.right || t.clientY < rect.top || t.clientY > rect.bottom) {
      toast('拖到画布中放置');
      return;
    }
    const f = this._furn;
    if (!f) return;
    const cell = 22;
    const x = clamp(Math.floor((t.clientX - rect.left) / cell), 0, FURN_GRID - 1);
    const y = clamp(Math.floor((t.clientY - rect.top) / cell), 0, FURN_GRID - 1);
    const occ = new Set(f.items.flatMap((it) => it.cells.map((c) => c.x + ',' + c.y)));
    if (occ.has(x + ',' + y)) { toast('该格已被占用'); return; }
    const uname = furnUniqueName(f.items, fc.name);
    f.items.push({ idx: furnNextIdx(f.items), name: uname, emoji: furnEmoji(uname), cells: [{ x, y }] });
    this.renderFurnEditor();
  },

  // ---------- 画布内模块拖拽（与户型图一致：整体平移 / 交换） ----------
  onFurnTileTouchStart(e) {
    const t = e.touches[0];
    this._ft = { idx: Number(e.currentTarget.dataset.idx), sx: t.clientX, sy: t.clientY, moved: false };
  },

  onFurnTileTouchMove(e) {
    if (!this._ft) return;
    const t = e.touches[0];
    const dx = t.clientX - this._ft.sx;
    const dy = t.clientY - this._ft.sy;
    if (!this._ft.moved && Math.abs(dx) + Math.abs(dy) < 10) return;
    this._ft.moved = true;
    this.setData({ furnDrag: { idx: this._ft.idx, dx, dy } });
  },

  onFurnTileTouchEnd() {
    const t = this._ft;
    if (!t) return;
    this._ft = null;
    if (!t.moved) { this.setData({ furnDrag: { idx: -1, dx: 0, dy: 0 } }); return; }
    const cell = 22;
    const dX = Math.round(this.data.furnDrag.dx / cell);
    const dY = Math.round(this.data.furnDrag.dy / cell);
    this.setData({ furnDrag: { idx: -1, dx: 0, dy: 0 } });
    if (dX === 0 && dY === 0) return;
    const f = this._furn;
    if (!f) return;
    const it = f.items.find((x) => x.idx === t.idx);
    if (!it) return;
    if (it.cells.length > 1) {
      const cand = it.cells.map((c) => ({ x: c.x + dX, y: c.y + dY }));
      const occ = new Set(f.items.filter((x) => x.idx !== it.idx).flatMap((x) => x.cells.map((c) => c.x + ',' + c.y)));
      const ok = cand.every((c) => c.x >= 0 && c.x < FURN_GRID && c.y >= 0 && c.y < FURN_GRID && !occ.has(c.x + ',' + c.y));
      if (!ok) { toast('移不过去：会出界或与其他模块重叠'); this.renderFurnEditor(); return; }
      it.cells = cand;
    } else {
      const target = {
        x: clamp(it.cells[0].x + dX, 0, FURN_GRID - 1),
        y: clamp(it.cells[0].y + dY, 0, FURN_GRID - 1)
      };
      if (target.x === it.cells[0].x && target.y === it.cells[0].y) return;
      const other = f.items.find((x) => x.idx !== it.idx && x.cells.some((c) => c.x === target.x && c.y === target.y));
      if (other) {
        other.cells = it.cells;
        toast('与「' + other.name + '」交换了位置');
      }
      it.cells = [target];
    }
    this.renderFurnEditor();
  },

  // ---------- 模块选中 / 删除 / 自由编辑大小（＋加格 / −减格 同屏，与户型图一致） ----------
  onFurnTileTap(e) {
    const f = this._furn;
    if (!f) return;
    const idx = Number(e.currentTarget.dataset.idx);
    if (f.sizeMode) { f.sizeTarget = idx; this.renderFurnEditor(); return; }
    f.selected = idx;
    this.renderFurnEditor();
  },

  toggleFurnSize() {
    const f = this._furn;
    if (!f) return;
    const on = !f.sizeMode;
    let target = -1;
    if (on) target = (f.items.find((x) => x.cells.length) || { idx: -1 }).idx;
    f.sizeMode = on;
    f.sizeTarget = target;
    this.renderFurnEditor();
  },

  onFurnAddCell(e) {
    const f = this._furn;
    if (!f || !f.sizeMode) return;
    const it = f.items.find((x) => x.idx === Number(e.currentTarget.dataset.idx));
    if (!it) return;
    it.cells.push({ x: Number(e.currentTarget.dataset.x), y: Number(e.currentTarget.dataset.y) });
    this.renderFurnEditor();
  },

  onFurnRemoveCell(e) {
    const f = this._furn;
    if (!f || !f.sizeMode) return;
    const it = f.items.find((x) => x.idx === Number(e.currentTarget.dataset.idx));
    if (!it) return;
    if (it.cells.length <= 1) { toast('模块至少保留一格'); return; }
    it.cells.splice(Number(e.currentTarget.dataset.ci), 1);
    this.renderFurnEditor();
  },

  // 点 ✕ → 多格模块去掉该段；单格模块直接删除
  onFurnRemove(e) {
    const f = this._furn;
    if (!f) return;
    const idx = Number(e.currentTarget.dataset.idx);
    const ci = Number(e.currentTarget.dataset.ci);
    const it = f.items.find((x) => x.idx === idx);
    if (!it) return;
    if (it.cells.length > 1) {
      it.cells.splice(ci, 1);
    } else {
      f.items = f.items.filter((x) => x.idx !== idx);
      if (f.sizeTarget === idx) f.sizeTarget = -1;
      if (f.selected === idx) f.selected = -1;
    }
    this.renderFurnEditor();
  },

  onFurnDelete(e) {
    const f = this._furn;
    if (!f) return;
    const idx = Number(e.currentTarget.dataset.idx);
    f.items = f.items.filter((x) => x.idx !== idx);
    if (f.sizeTarget === idx) f.sizeTarget = -1;
    if (f.selected === idx) f.selected = -1;
    this.renderFurnEditor();
  },

  saveFurnEditor() {
    const f = this._furn;
    if (!f) return;
    const room = this.rooms.find((r) => r.idx === f.roomIdx);
    if (room) {
      room.desc = f.desc;
      room.spotsText = f.spotsText;
      room.w = FURN_GRID;
      room.h = FURN_GRID;
      room.furn = f.items.map((it) => ({
        name: it.name,
        x: it.cells[0].x,
        y: it.cells[0].y,
        cells: it.cells.map((c) => ({ x: c.x, y: c.y }))
      }));
    }
    this._furn = null;
    this.setData({
      'furnEditor.show': false,
      furnGhost: { show: false, emoji: '', name: '', x: 0, y: 0 },
      furnDrag: { idx: -1, dx: 0, dy: 0 }
    });
    this.renderLayout();
    toast('房间模块已保存（记得点「保存布局」生效）');
  },

  closeFurnEditor() {
    this._furn = null;
    this.setData({
      'furnEditor.show': false,
      furnGhost: { show: false, emoji: '', name: '', x: 0, y: 0 },
      furnDrag: { idx: -1, dx: 0, dy: 0 }
    });
  },

  noop() {},

  // ---------- 一键清空（删除全部房间并立即保存） ----------
  async clearAllRooms() {
    if (!this.rooms.length) { toast('还没有房间'); return; }
    if (!(await confirm('确认清空当前目录全部房间？将立即保存。'))) return;
    this.rooms = [];
    this.setData({ sizeMode: false, sizeTarget: -1 });
    await this.saveLayout();
  },

  // 生成标准户型：先清空，按模板摆放（走廊链连接所有房间），剩余房间补空
  applyTemplate() {
    const named = this.rooms.filter((r) => r.name);
    if (!named.length) { toast('还没有房间，先拖动房间方块到网格'); return; }
    this.rooms.forEach((r) => { r.cells = []; });
    this.setData({ sizeMode: false, sizeTarget: -1 });
    const occupied = () => this.rooms.flatMap((r) => r.cells);
    const isFree = (cs) => cs.every((c) => !occupied().some((o) => o.x === c.x && o.y === c.y));
    let n = 0;
    for (const slot of TEMPLATE) {
      const candidate = this.rooms.find((r) =>
        r.name.includes(slot.key) && !r.cells.length && isFree(slot.cells));
      if (!candidate) continue;
      candidate.cells = slot.cells.map((c) => ({ x: c.x, y: c.y }));
      n++;
    }
    for (const room of this.rooms.filter((r) => r.name && !r.cells.length)) {
      const empty = this.firstEmpty();
      if (!empty) break;
      room.cells = [empty];
    }
    this.renderLayout();
    toast('🏠 已生成标准户型：所有房间都通过走廊相连（可拖动微调）');
  },

  // ---------- 工具 ----------
  occupiedSet(exceptIdx) {
    const set = new Set();
    this.rooms.forEach((r) => {
      if (r.idx === exceptIdx) return;
      r.cells.forEach((c) => set.add(key(c)));
    });
    return set;
  },

  firstEmpty() {
    const occupied = this.occupiedSet(-1);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!occupied.has(key({ x, y }))) return { x, y };
      }
    }
    return null;
  },

  renderLayout() {
    const cell = this.data.grid.cell;
    const tiles = [];
    const roomLabels = [];
    const selIdx = this.data.sizeMode ? this.data.sizeTarget : -1;
    this.rooms.forEach((r, roomPos) => {
      r.emoji = roomEmoji(r.name);
      const corridor = r.name.includes('走廊');
      const [bg, bd] = roomColor(roomPos);
      r.cells.forEach((c, ci) => {
        tiles.push({
          key: r.idx + '-' + ci,
          roomIdx: r.idx,
          ci,
          showX: ci === 0 && !this.data.sizeMode,
          shrinkBadge: this.data.sizeMode && r.idx === selIdx && r.cells.length > 1,
          selected: r.idx === selIdx,
          emoji: (ci === 0 && r.cells.length > 1) ? roomEmoji(r.name) : '',
          hasFurn: ci === 0 && Array.isArray(r.furn) && r.furn.length > 0,
          corridor,
          px: c.x * cell,
          py: c.y * cell,
          bg: corridor ? '#fff7e8' : bg,
          borderStyle: corridor ? '' : tileBorderStyle(r.cells, ci, bd)
        });
      });
      if (r.cells.length) {
        const xs = r.cells.map((c) => c.x);
        const ys = r.cells.map((c) => c.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        roomLabels.push({
          key: 'lbl-' + r.idx,
          text: r.cells.length > 1 ? r.name : roomEmoji(r.name) + ' ' + r.name,
          cx: ((minX + maxX + 1) / 2) * cell,
          cy: ((minY + maxY + 1) / 2) * cell,
          emojiOnly: r.cells.length === 1
        });
      }
    });
    const unplaced = this.rooms
      .filter((r) => r.name && !r.cells.length)
      .map((r) => ({ idx: r.idx, name: r.name, emoji: roomEmoji(r.name) }));
    // 同名房间可复数存在：预设托盘常驻全部类型，放置时自动编号（卧室、卧室2、卧室3…）
    const presets = ROOM_PRESETS.map((n) => ({ name: n, emoji: roomEmoji(n) }));

    // 编辑大小模式：选中房间四周的空格是 ＋ 候选
    let sizeCands = [];
    // 放大轮廓辅助线：选中房间的虚线包围盒，标出放大边界与当前尺寸
    let sizeGuide = { show: false, x: 0, y: 0, w: 0, h: 0, text: '' };
    if (this.data.sizeMode) {
      const room = this.rooms.find((r) => r.idx === this.data.sizeTarget);
      if (room) {
        const occupied = this.occupiedSet(room.idx);
        const seen = new Set();
        for (const c of room.cells) {
          for (const d of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }]) {
            const nx = c.x + d.x;
            const ny = c.y + d.y;
            if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
            const k = key({ x: nx, y: ny });
            if (seen.has(k) || occupied.has(k)) continue;
            seen.add(k);
            sizeCands.push({ x: nx, y: ny, px: nx * cell, py: ny * cell });
          }
        }
        if (room.cells.length) {
          const xs = room.cells.map((c) => c.x);
          const ys = room.cells.map((c) => c.y);
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          const y0 = Math.min(...ys), y1 = Math.max(...ys);
          const pad = 4;
          sizeGuide = {
            show: true,
            x: x0 * cell - pad,
            y: y0 * cell - pad,
            w: (x1 - x0 + 1) * cell + pad * 2,
            h: (y1 - y0 + 1) * cell + pad * 2,
            text: room.name + ' · ' + (x1 - x0 + 1) + '×' + (y1 - y0 + 1) + ' 格',
            tagBelow: (y1 + 1) < GRID
          };
        }
      }
    }

    this.setData({
      rooms: this.rooms,
      tiles,
      roomLabels,
      unplaced,
      presets,
      sizeCands,
      sizeGuide,
      corridorExists: this.rooms.some((r) => r.name.includes('走廊'))
    });
  },

  async saveLayout() {
    if (this.rooms.filter((r) => r.name).length > MAX_ROOMS) {
      toast('房间数量超过上限（36 个），请删除多余房间后再保存');
      return false;
    }
    this.setData({ savingLayout: true, sizeMode: false, sizeTarget: -1 });
    const homeLayout = this.rooms
      .filter((r) => r.name)
      .map((r) => {
        const room = {
          name: r.name, desc: r.desc,
          spots: splitSpots(r.spotsText),
          x: r.cells.length ? r.cells[0].x : null,
          y: r.cells.length ? r.cells[0].y : null,
          cells: r.cells.map((c) => ({ x: c.x, y: c.y }))
        };
        if (r.w) room.w = r.w;
        if (r.h) room.h = r.h;
        if (Array.isArray(r.furn) && r.furn.length) {
          room.furn = r.furn.map((f) => ({ name: f.name, x: f.x, y: f.y }));
        }
        return room;
      });
    try {
      const d = await api.request('/auth/profile', { method: 'PUT', data: { homeLayout } });
      store.setUser(d.user);
      this.rooms = (d.user.profile.homeLayout || []).map((r, i) => ({
        idx: i, name: r.name, desc: r.desc || '',
        spotsText: (r.spots || []).join('，'),
        cells: (Array.isArray(r.cells) && r.cells.length)
          ? r.cells.map((c) => ({ x: c.x, y: c.y }))
          : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []),
        w: r.w || 12,
        h: r.h || 12,
        furn: (Array.isArray(r.furn) ? r.furn.map((f) => ({ name: f.name, x: f.x, y: f.y })) : [])
      }));
      this.setData({ spaces: d.user.profile.spaces || [], activeSpaceId: d.user.profile.activeSpaceId });
      toast('户型图已保存 ✓');
      this.renderLayout();
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    } finally {
      this.setData({ savingLayout: false });
    }
  },

  // ---------- 目录（家/公司/宿舍…）管理 ----------
  async switchSpace(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (id === this.data.activeSpaceId) return;
    const ok = await this.saveLayout();
    if (!ok) return;
    try {
      await api.request('/spaces/' + id + '/active', { method: 'PUT' });
      const d = await api.request('/auth/me');
      store.setUser(d.user);
      this.init();
      toast('已切换到该目录');
    } catch (err) { toast(err.message); }
  },

  addSpace() {
    wx.showModal({
      title: '新建目录',
      editable: true,
      placeholderText: '如：家 / 公司 / 宿舍',
      success: async (r) => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim();
        if (!name) { toast('目录名称不能为空'); return; }
        try {
          await api.request('/spaces', { method: 'POST', data: { name } });
          const d = await api.request('/auth/me');
          store.setUser(d.user);
          this.init();
          toast('已创建并切换到新目录');
        } catch (err) { toast(err.message); }
      }
    });
  },

  renameSpace() {
    const cur = this.data.spaces.find((s) => s.id === this.data.activeSpaceId);
    if (!cur) return;
    wx.showModal({
      title: '重命名目录',
      editable: true,
      content: cur.name,
      success: async (r) => {
        if (!r.confirm) return;
        const name = String(r.content || '').trim();
        if (!name) { toast('目录名称不能为空'); return; }
        try {
          await api.request('/spaces/' + cur.id, { method: 'PUT', data: { name } });
          const d = await api.request('/auth/me');
          store.setUser(d.user);
          this.init();
          toast('已重命名');
        } catch (err) { toast(err.message); }
      }
    });
  },

  deleteSpace() {
    wx.showModal({
      title: '删除目录',
      content: '将删除当前目录及其户型图，确定？',
      confirmText: '删除',
      confirmColor: '#e85d5d',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.request('/spaces/' + this.data.activeSpaceId, { method: 'DELETE' });
          const d = await api.request('/auth/me');
          store.setUser(d.user);
          this.init();
          toast('目录已删除');
        } catch (err) { toast(err.message); }
      }
    });
  },

  goLayoutScan() {
    wx.navigateTo({ url: '/pages/layout-scan/layout-scan' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});

function splitSpots(t) {
  return String(t || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}
function furnNextIdx(items) {
  return items.length ? Math.max(...items.map((x) => x.idx)) + 1 : 0;
}
function furnUniqueName(items, base) {
  const names = new Set(items.map((x) => x.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(base + n)) n++;
  return base + n;
}
function nextIdx(rooms) {
  return rooms.length ? Math.max(...rooms.map((r) => r.idx)) + 1 : 0;
}
function uniqueRoomName(rooms, base) {
  const names = new Set(rooms.map((r) => r.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(base + n)) n++;
  return base + n;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function key(c) {
  return c.x + ',' + c.y;
}
