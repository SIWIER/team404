// js/router.js — 哈希路由 + 登录守卫
import { store } from './store.js';
import { renderAuth } from './views/auth.view.js';
import { renderHome } from './views/home.view.js';
import { renderProfile } from './views/profile.view.js';
import { renderLayout } from './views/layout.view.js';
import { renderReason } from './views/reason.view.js';
import { renderData } from './views/data.view.js';
import { renderHardware, disposeHardware } from './views/hardware.view.js';
import { renderPlaceholder } from './views/placeholder.view.js';

const ROUTES = [
  { hash: '#/auth', title: '登录', auth: false, view: (r) => renderAuth(r) },
  { hash: '#/', title: '首页', auth: true, view: (r) => renderHome(r) },
  { hash: '#/home', title: '首页', auth: true, view: (r) => renderHome(r) },
  { hash: '#/profile', title: '智能体画像', auth: true, view: (r) => renderProfile(r) },
  { hash: '#/layout', title: '户型图配置', auth: true, view: (r) => renderLayout(r) },
  { hash: '#/reason', title: '引导推理', auth: true, view: (r) => renderReason(r) },
  { hash: '#/data', title: '数据统计', auth: true, view: (r) => renderData(r) },
  { hash: '#/hardware', title: '硬件接入', auth: true, view: (r) => renderHardware(r) }
];

function currentHash() {
  const h = location.hash || '#/';
  return ROUTES.find((r) => r.hash === h) || ROUTES[0];
}

export function navigate() {
  const route = currentHash();
  const topbar = document.getElementById('topbar');

  // 守卫
  if (route.auth && !store.user) { location.hash = '#/auth'; return; }
  if (route.hash === '#/auth' && store.user) { location.hash = '#/'; return; }

  disposeHardware(); // 离开设备页时断开 WebSocket

  if (store.user) {
    topbar.classList.remove('hidden');
    document.getElementById('userNick').textContent = '👤 ' + store.user.nickname;
    renderNav(route);
  } else {
    topbar.classList.add('hidden');
  }
  route.view(document.getElementById('app'));
}

function renderNav(active) {
  const nav = document.getElementById('topnav');
  const links = [['#/', '🏠 首页'], ['#/layout', '🗺 户型'], ['#/reason', '🔍 找眼镜'], ['#/data', '📊 数据'], ['#/hardware', '📡 设备']];
  nav.innerHTML = links.map(([h, t]) => `<a href="${h}" class="${h === active.hash ? 'on' : ''}">${t}</a>`).join('');
}

export function initRouter() {
  window.addEventListener('hashchange', navigate);
  document.addEventListener('fmg:logout', () => {
    store.clear();
    location.hash = '#/auth';
  });
}
