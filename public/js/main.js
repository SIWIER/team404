// js/main.js — 应用入口：恢复会话 → 挂载路由
import { store } from './store.js';
import { api } from './api.js';
import { initRouter, navigate } from './router.js';

async function boot() {
  if (store.token) {
    try {
      const d = await api('/auth/me');
      store.setUser(d.user);
    } catch { /* 令牌失效 → 守卫会跳转登录 */ }
  }
  initRouter();
  navigate();
}

document.addEventListener('DOMContentLoaded', boot);
