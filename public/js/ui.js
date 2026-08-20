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
  '厨房/餐厅': '🍳', '书房': '📚', '玄关': '🚪', '走廊': '🚶', '阳台': '🪴', '衣帽间': '👔', '储物间': '📦'
};

export function roomEmoji(name) {
  return ROOM_EMOJI[name] || '🏠';
}
