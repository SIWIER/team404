// utils/ui.js — 通用提示与格式化（对应 Web 端 ui.js）
function toast(title) {
  wx.showToast({ title: String(title).slice(0, 30), icon: 'none', duration: 2200 });
}

function confirm(content) {
  return new Promise((resolve) => {
    wx.showModal({ title: '提示', content, success: (r) => resolve(!!r.confirm) });
  });
}

function dateTime(d) {
  return d ? d.slice(0, 16).replace('T', ' ') : '—';
}

const ROOM_EMOJI = {
  '卧室': '🛏️', '卫生间': '🛁', '客厅': '🛋️', '厨房': '🍳', '餐厅': '🍽️',
  '厨房/餐厅': '🍳', '书房': '📚', '玄关': '🚪', '走廊': '🚶', '阳台': '🪴',
  '衣帽间': '👔', '储物间': '📦',
  // 公司
  '办公室': '🏢', '会议室': '📋', '工位区': '💻', '前台': '🛎️', '茶水间': '☕',
  '经理室': '💼', '财务室': '💰', '档案室': '🗄️', '机房': '🖥️', '仓库': '📦',
  // 学校
  '教室': '🏫', '实验室': '🧪', '图书室': '📚', '报告厅': '🎤', '食堂': '🍽️',
  '体育器材室': '🏀',
  // 宿舍
  '宿舍': '🛌', '浴室': '🚿', '洗衣房': '🧺', '自习室': '📖'
};

function roomEmoji(name) {
  // 同名房间自动编号（卧室2/卧室3…）：按基础名查 emoji
  return ROOM_EMOJI[String(name || '').replace(/\d+$/, '')] || '🏠';
}

// 户型编辑器的房间配色（bg, 描边色）：同一房间所有格子同色，便于识别同一房间
const ROOM_PALETTE = [
  ['#e8f0ff', '#8fb3f0'], ['#fff3e0', '#eebc7d'], ['#eaf7ed', '#8fd0a4'],
  ['#fdeef3', '#ef9ab8'], ['#e6f7f7', '#8bd0d0'], ['#f3f0ff', '#b3a6ec'],
  ['#e0f2ff', '#8fc3e8'], ['#fdf0e6', '#e0b08a'], ['#fff5e6', '#e3bd7e'],
  ['#eef1f6', '#aeb9c9']
];
function roomColor(i) {
  return ROOM_PALETTE[i % ROOM_PALETTE.length];
}

// 同一房间的格子拼合成一个色块：与同房间格相邻的边不画边框，露出的边画边框
function tileBorderStyle(cells, ci, borderColor) {
  const c = cells[ci];
  if (!c) return '';
  const same = (dx, dy) => cells.some((x) => x.x === c.x + dx && x.y === c.y + dy);
  const w = '2px solid ' + borderColor;
  return 'border-left:' + (same(-1, 0) ? '0' : w) + ';border-top:' + (same(0, -1) ? '0' : w) +
    ';border-right:' + (same(1, 0) ? '0' : w) + ';border-bottom:' + (same(0, 1) ? '0' : w) + ';';
}

// 画像「硬件声明」↔ 设备类型 映射（与后端 hardware.service.OWNED_TYPE_MAP 保持一致）：
// 偏好设置勾选的"拥有哪类硬件"决定硬件页展示哪些类型的设备，两页共用此规则保证同步
const HARDWARE_OWNED_TYPES = { case_locator: 'locator', uhf_reader: 'rfid_reader' };
const HARDWARE_TYPE_LABELS = { locator: '定位器', nfc: '近场呼唤器', tag: '防丢标签', rfid_reader: 'UHF 手持机' };

module.exports = { toast, confirm, dateTime, roomEmoji, roomColor, tileBorderStyle, HARDWARE_OWNED_TYPES, HARDWARE_TYPE_LABELS };
