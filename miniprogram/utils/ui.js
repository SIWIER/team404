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
  '衣帽间': '👔', '储物间': '📦'
};

function roomEmoji(name) {
  return ROOM_EMOJI[name] || '🏠';
}

module.exports = { toast, confirm, dateTime, roomEmoji };
