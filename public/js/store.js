// js/store.js — 全局状态（令牌 + 当前用户）
const LS_KEY = 'fmg_pro_token';

export const store = {
  token: localStorage.getItem(LS_KEY) || null,
  user: null,
  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem(LS_KEY, token);
  },
  setUser(user) { this.user = user; },
  clear() {
    this.token = null;
    this.user = null;
    localStorage.removeItem(LS_KEY);
  }
};
