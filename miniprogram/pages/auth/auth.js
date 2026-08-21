// pages/auth/auth.js — 登录/注册页（含微信一键登录与"绑定已有账号"流程）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast } = require('../../utils/ui');

Page({
  data: {
    tab: 'login',
    username: '', password: '', password2: '', nickname: '',
    remember: true,
    busy: false,
    error: '',
    // 微信登录相关
    wxEnabled: false,           // 后端是否启用微信登录
    wxBusy: false,              // 微信登录进行中
    wxConfigHint: '',           // 未启用时给用户看的提示
    // needBind 弹窗
    bindShow: false,
    bindToken: '',
    bindUsername: '',
    bindPassword: '',
    bindBusy: false,
    bindError: ''
  },
  onLoad() {
    if (store.getToken() && store.getUser()) {
      wx.reLaunch({ url: '/pages/home/home' });
      return;
    }
    this.fetchWxConfig();
  },
  fetchWxConfig() {
    api.request('/auth/wxconfig', { method: 'GET' })
      .then((d) => {
        const enabled = !!d.enabled;
        const hint = enabled ? '' : '后端未配置微信登录（缺少 WX_APPID）';
        this.setData({ wxEnabled: enabled, wxConfigHint: hint });
      })
      .catch(() => {
        this.setData({ wxEnabled: false, wxConfigHint: '微信登录配置探测失败' });
      });
  },
  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, error: '' });
  },
  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value, error: '' });
  },
  onBindInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value, bindError: '' });
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
  },

  // ===== 微信一键登录 =====
  async onWxLogin() {
    if (this.data.wxBusy) return;
    if (!this.data.wxEnabled) {
      toast(this.data.wxConfigHint || '微信登录暂未启用');
      return;
    }
    this.setData({ wxBusy: true, error: '' });
    try {
      // 1) 调 wx.login 拿 code
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({ success: resolve, fail: reject });
      });
      if (!loginRes || !loginRes.code) throw new Error('wx.login 未返回 code');
      // 2) 调后端 /api/auth/wxlogin
      const r = await api.request('/auth/wxlogin', { method: 'POST', data: { code: loginRes.code } });
      if (r.needBind) {
        // 弹窗让用户填已有账号密码
        this.setData({
          bindShow: true,
          bindToken: r.bindToken,
          bindUsername: '',
          bindPassword: '',
          bindError: '',
          wxBusy: false
        });
        return;
      }
      store.setAuth(r.token, r.user);
      toast('微信登录成功，欢迎 ' + r.user.nickname + ' 👋');
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (e) {
      const msg = e && e.message ? e.message : '微信登录失败';
      this.setData({ error: msg, wxBusy: false });
    }
  },

  // needBind 弹窗操作
  closeBind() {
    if (this.data.bindBusy) return;
    this.setData({ bindShow: false, bindToken: '', bindUsername: '', bindPassword: '', bindError: '' });
  },
  async confirmBind() {
    if (this.data.bindBusy) return;
    const { bindToken, bindUsername, bindPassword } = this.data;
    if (!bindUsername || !bindPassword) {
      return this.setData({ bindError: '请输入用户名和密码' });
    }
    this.setData({ bindBusy: true, bindError: '' });
    try {
      const r = await api.request('/auth/wxbind', {
        method: 'POST',
        data: { bindToken, username: bindUsername, password: bindPassword }
      });
      store.setAuth(r.token, r.user);
      this.setData({ bindShow: false, bindBusy: false });
      toast('绑定并登录成功，欢迎 ' + r.user.nickname + ' 🎉');
      wx.reLaunch({ url: '/pages/home/home' });
    } catch (e) {
      this.setData({ bindError: e.message || '绑定失败', bindBusy: false });
    }
  }
});
