// pages/profile/profile.js — 我的画像：画像表单 + 硬件设备
// 户型图配置已独立到「pages/layout/layout」（首页 → 户型图配置）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast } = require('../../utils/ui');

Page({
  data: {
    agentName: '', agentStyle: '', habitsText: '', favsText: '', notes: '',
    hwPicks: { uhf_reader: false, case_locator: false },
    saving: false
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.init();
  },

  init() {
    const p = store.getUser().profile;
    this.setData({
      agentName: p.agentName || '',
      agentStyle: p.agentStyle || '',
      habitsText: (p.habits || []).join('\n'),
      favsText: (p.favoritePlaces || []).join('\n'),
      notes: p.notes || '',
      hwPicks: {
        uhf_reader: (p.hardware || []).includes('uhf_reader'),
        case_locator: (p.hardware || []).includes('case_locator')
      }
    });
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.k]: e.detail.value });
  },

  async saveBasic() {
    this.setData({ saving: true });
    try {
      const hardware = Object.keys(this.data.hwPicks).filter((k) => this.data.hwPicks[k]);
      const d = await api.request('/auth/profile', {
        method: 'PUT',
        data: {
          agentName: this.data.agentName.trim(),
          agentStyle: this.data.agentStyle.trim(),
          habits: lines(this.data.habitsText),
          favoritePlaces: lines(this.data.favsText),
          notes: this.data.notes.trim(),
          hardware
        }
      });
      store.setUser(d.user);
      toast('画像已保存 ✓');
    } catch (e) { toast(e.message); }
    this.setData({ saving: false });
  },

  toggleHw(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['hwPicks.' + key]: !this.data.hwPicks[key] });
  },

  goLayout() {
    wx.navigateTo({ url: '/pages/layout/layout' });
  },

  // ---------- 注销账号（永久删除全部个人数据） ----------
  deleteAccount() {
    wx.showModal({
      title: '注销账号',
      content: '确定要注销账号吗？你的画像、户型、找回记录等全部个人数据将被永久删除，不可恢复。',
      confirmText: '继续',
      confirmColor: '#e85d5d',
      success: (r1) => {
        if (!r1.confirm) return;
        wx.showModal({
          title: '最后确认',
          content: '再次确认：注销后数据无法找回，是否仍要注销？',
          confirmText: '确认注销',
          confirmColor: '#e85d5d',
          success: async (r2) => {
            if (!r2.confirm) return;
            try {
              await api.request('/auth/account', { method: 'DELETE' });
              store.clear();
              toast('账号已注销，感谢使用 👋');
              setTimeout(() => wx.reLaunch({ url: '/pages/auth/auth' }), 600);
            } catch (e) { toast(e.message); }
          }
        });
      }
    });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});

function lines(t) {
  return String(t || '').split('\n').map((s) => s.trim()).filter(Boolean);
}