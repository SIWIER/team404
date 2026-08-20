// app.js — 全局入口：恢复登录态
const store = require('./utils/store');
const api = require('./utils/api');

App({
  globalData: { user: null },
  onLaunch() {
    // 若本地有令牌，尝试恢复用户信息（失败由各页面守卫跳转登录页）
    if (store.getToken()) {
      api.request('/auth/me')
        .then((d) => { store.setUser(d.user); this.globalData.user = d.user; })
        .catch(() => store.clear());
    }
  }
});
