// pages/auth/auth.js — 登录/注册页
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast } = require('../../utils/ui');

Page({
  data: {
    tab: 'login',
    username: '', password: '', password2: '', nickname: '',
    remember: true,
    busy: false,
    error: ''
  },
  onLoad() {
    // 已登录直接进首页
    if (store.getToken() && store.getUser()) {
      wx.reLaunch({ url: '/pages/home/home' });
    }
  },
  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, error: '' });
  },
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value, error: '' });
  },
  toggleRemember(e) {
    this.setData({ remember: e.detail.value });
  },
  async submit() {
    if (this.data.busy) return;
    const d = this.data;
    if (d.tab === 'reg' && d.password !== d.password2) {
      return this.setData({ error: '两次输入的密码不一致' });
    }
    this.setData({ busy: true, error: '' });
    try {
      if (d.tab === 'login') {
        const r = await api.request('/auth/login', {
          method: 'POST',
          data: { username: d.username, password: d.password, remember: d.remember }
        });
        store.setAuth(r.token, r.user);
        toast('登录成功，欢迎回来 ' + r.user.nickname + ' 👋');
        wx.reLaunch({ url: '/pages/home/home' });
      } else {
        await api.request('/auth/register', {
          method: 'POST',
          data: { username: d.username, password: d.password, nickname: d.nickname }
        });
        toast('注册成功，请登录 ✓');
        this.setData({ tab: 'login', busy: false });
      }
    } catch (e) {
      this.setData({ error: (e.errors && Object.values(e.errors)[0]) || e.message, busy: false });
    }
    if (this.data.tab === 'login') this.setData({ busy: false });
  }
});
