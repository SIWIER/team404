// js/ui.js — 通用 UI 工具
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// 切换视图时清理 + 渲染
export function mount(rootEl, renderFn) {
  rootEl.innerHTML = '';
  renderFn(rootEl);
}

export function dateTime(d) {
  return d ? d.slice(0, 16).replace('T', ' ') : '—';
}

export const ROOM_EMOJI = {
  '卧室': '🛏️', '卫生间': '🛁', '客厅': '🛋️', '厨房': '🍳', '餐厅': '🍽️',
  '厨房/餐厅': '🍳', '书房': '📚', '玄关': '🚪', '走廊': '🚶', '阳台': '🪴', '衣帽间': '👔', '储物间': '📦',
  // 公司
  '办公室': '🏢', '会议室': '📋', '工位区': '💻', '前台': '🛎️', '茶水间': '☕',
  '经理室': '💼', '财务室': '💰', '档案室': '🗄️', '机房': '🖥️', '仓库': '📦',
  // 学校
  '教室': '🏫', '实验室': '🧪', '图书室': '📚', '报告厅': '🎤', '食堂': '🍽️',
  '体育器材室': '🏀',
  // 宿舍
  '宿舍': '🛌', '浴室': '🚿', '洗衣房': '🧺', '自习室': '📖'
};

export function roomEmoji(name) {
  return ROOM_EMOJI[name] || ROOM_EMOJI[String(name || '').replace(/\d+$/, '')] || '🏠';
}
