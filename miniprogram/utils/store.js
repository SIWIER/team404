// utils/store.js — 令牌与用户状态（对应 Web 端 store.js）
const KEY = 'fmg_token';

module.exports = {
  getToken() {
    return wx.getStorageSync(KEY) || '';
  },
  setAuth(token, user) {
    wx.setStorageSync(KEY, token);
    if (getApp()) getApp().globalData.user = user;
  },
  getUser() {
    return getApp().globalData.user;
  },
  setUser(user) {
    if (getApp()) getApp().globalData.user = user;
  },
  clear() {
    wx.removeStorageSync(KEY);
    if (getApp()) getApp().globalData.user = null;
  }
};
