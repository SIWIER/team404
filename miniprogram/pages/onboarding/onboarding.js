// pages/onboarding/onboarding.js — 注册后的"有无硬件设备"引导页
// 默认无设备：不选任何项直接进入 = 无硬件（推理引擎自动启用无硬件补偿）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast } = require('../../utils/ui');

Page({
  data: {
    busy: false,
    picks: { uhf_reader: false, case_locator: false }
  },

  onLoad() {
    if (!store.getToken()) { wx.reLaunch({ url: '/pages/auth/auth' }); }
  },

  togglePick(e) {
    if (this.data.busy) return;
    const key = e.currentTarget.dataset.key;
    this.setData({ ['picks.' + key]: !this.data.picks[key] });
  },

  async confirm() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    const hardware = Object.keys(this.data.picks).filter((k) => this.data.picks[k]);
    try {
      const d = await api.request('/auth/profile', { method: 'PUT', data: { hardware } });
      store.setUser(d.user);
      toast('欢迎加入找眼镜助手 🎉');
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (e) {
      this.setData({ busy: false });
      toast(e.message);
    }
  },

  skip() {
    toast('没问题，问答推理不依赖硬件 👌');
    wx.reLaunch({ url: '/pages/home/home' });
  }
});
