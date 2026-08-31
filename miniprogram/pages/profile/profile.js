// pages/profile/profile.js — 我的存放偏好：画像表单 + 硬件设备（与硬件页同步）
// 户型图配置已独立到「pages/layout/layout」（首页 → 户型图配置）
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast, HARDWARE_OWNED_TYPES, HARDWARE_TYPE_LABELS } = require('../../utils/ui');

const HW_ICON = { locator: '📡', nfc: '🔊', tag: '🏷️', rfid_reader: '🎛️' };

Page({
  data: {
    agentName: '', agentStyle: '', habitsText: '', favsText: '', notes: '',
    hwPicks: { uhf_reader: false, case_locator: false },
    devices: [],       // 已接入设备（按画像声明过滤，与硬件页同一规则）
    deviceHint: '',    // 已登记声明但没设备的提示
    saving: false
  },

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.init();
  },

  onShow() {
    // 从硬件页回来时刷新设备清单（注册/删除设备后保持同步）
    if (store.getUser()) this.loadDevices();
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
    this.loadDevices();
  },

  // 与硬件页同一过滤规则：声明（case_locator→定位器 / uhf_reader→UHF 手持机）决定展示哪些设备
  async loadDevices() {
    try {
      const u = store.getUser() || {};
      const owned = (u.profile && u.profile.hardware) || [];
      const ownedTypes = owned.map((k) => HARDWARE_OWNED_TYPES[k]).filter(Boolean);
      if (!ownedTypes.length) { this.setData({ devices: [], deviceHint: '' }); return; }
      const d = await api.request('/hardware/devices');
      const all = d.devices || [];
      const devices = all
        .filter((x) => ownedTypes.includes(x.type))
        .map((x) => ({
          id: x.id,
          icon: HW_ICON[x.type] || '📟',
          label: HARDWARE_TYPE_LABELS[x.type] || x.type,
          name: x.name,
          on: x.status === 'online',
          isMock: !!x.isMock
        }));
      const missing = owned
        .filter((k) => HARDWARE_OWNED_TYPES[k] && !all.some((x) => x.type === HARDWARE_OWNED_TYPES[k]));
      const deviceHint = missing.length
        ? '已登记「' + missing.map((k) => (k === 'uhf_reader' ? 'UHF 手持机' : '物品盒定位器')).join('、') + '」，但还没有接入对应设备：去硬件页「＋ 注册设备」。'
        : '';
      this.setData({ devices, deviceHint });
    } catch (e) {
      this.setData({ devices: [], deviceHint: '' });
    }
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
      this.loadDevices();   // 声明变化 → 立即刷新"已接入设备"清单，与硬件页保持一致
    } catch (e) { toast(e.message); }
    this.setData({ saving: false });
  },

  toggleHw(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['hwPicks.' + key]: !this.data.hwPicks[key] });
  },

  goHardware() {
    wx.navigateTo({ url: '/pages/hardware/hardware' });
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