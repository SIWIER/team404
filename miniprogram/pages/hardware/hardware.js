// pages/hardware/hardware.js — 硬件设备接入：设备管理 + 指令 + WebSocket 实时事件流
// 与偏好设置同步：按画像「硬件声明」过滤设备（case_locator→定位器、uhf_reader→UHF 手持机），
// 注册设备时自动回写对应声明，两页展示同一份数据
const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { toast, confirm, HARDWARE_OWNED_TYPES, HARDWARE_TYPE_LABELS } = require('../../utils/ui');

const TYPE_ICON = { locator: '📡', nfc: '🔊', tag: '🏷️', rfid_reader: '🎛️' };
const TYPE_LABEL = { locator: '定位器', nfc: '近场呼唤器', tag: '防丢标签', rfid_reader: 'UHF 手持机' };
// 设备类型 → 对应的画像声明（注册设备时自动回写，保持两页同步）
const TYPE_TO_OWNED = { locator: 'case_locator', rfid_reader: 'uhf_reader' };
const ACTIONS = {
  locator: [{ c: 'locate', t: '📡 定位扫描', cls: 'warn' }],
  rfid_reader: [{ c: 'locate', t: '📡 扫描', cls: 'warn' }],
  nfc: [{ c: 'ping', t: '🔊 呼唤', cls: 'good' }],
  tag: [{ c: 'ping', t: '🔊 呼叫', cls: 'good' }, { c: 'beep', t: '🔔 蜂鸣', cls: 'ghost' }]
};

function fmtEvent(e) {
  let p = '';
  try { p = JSON.stringify(JSON.parse(e.payload)); } catch (err) { p = e.payload; }
  const icon = { report: '📡', command: '⬇️', ping_result: '🔊', beep: '🔔' }[e.type] || '📟';
  const ack = e.type === 'command' ? (e.acked ? '✅已执行' : '⏳待设备执行') : '';
  return {
    ts: (e.ts || '').slice(11, 19),
    device: e.device_id,
    icon,
    type: e.type,
    payload: p,
    ack,
    ackCls: e.acked ? 'ack-done' : 'ack-wait'
  };
}

Page({
  data: {
    devices: [],
    events: [],
    wsOk: false,
    noHardware: false,   // 画像未登记任何硬件设备 → 不展示全局共享的模拟设备
    missingHint: '',     // 已登记声明但没有对应设备的提示（与偏好设置页一致口径）
    showForm: false,
    name: '',
    typeIndex: 0,
    types: [
      { key: 'locator', label: '📡 定位器（物品盒定位器，上报位置/距离）' },
      { key: 'rfid_reader', label: '🎛️ UHF 手持机（RFID 读取器，扫房间找贴标物品）' },
      { key: 'nfc', label: '🔊 近场呼唤器（近距离蜂鸣应答）' },
      { key: 'tag', label: '🏷️ 防丢标签（寻物标签）' }
    ]
  },

  onShow() {
    this.refresh();
    this.connectWs();
  },
  onHide() { this.closeWs(); },
  onUnload() { this.closeWs(); },

  async refresh() {
    try {
      // 与偏好设置同步：按画像「硬件声明」过滤设备类型，未登记任何硬件 → 空态引导
      const u = store.getUser();
      const owned = (u && u.profile && u.profile.hardware) || [];
      const ownedTypes = owned.map((k) => HARDWARE_OWNED_TYPES[k]).filter(Boolean);
      if (!ownedTypes.length) {
        this.setData({ devices: [], events: [], noHardware: true, missingHint: '' });
        return;
      }
      this.setData({ noHardware: false });
      const d = await api.request('/hardware/devices');
      const all = d.devices || [];
      const devices = all
        .filter((x) => ownedTypes.includes(x.type))
        .map((x) => ({
          ...x,
          icon: TYPE_ICON[x.type] || '📟',
          label: TYPE_LABEL[x.type] || x.type,
          actions: ACTIONS[x.type] || [],
          on: x.status === 'online'
        }));
      const visibleIds = new Set(devices.map((x) => x.id));
      // 事件流同样只显示"可见设备"的事件，避免出现声明之外的设备
      const events = (d.events || []).filter((e) => visibleIds.has(e.device_id)).map(fmtEvent);
      // 已登记但还没有设备的类型 → 给注册引导提示
      const missing = owned
        .filter((k) => HARDWARE_OWNED_TYPES[k] && !all.some((x) => x.type === HARDWARE_OWNED_TYPES[k]));
      const missingHint = missing.length
        ? '已登记「' + missing.map((k) => (k === 'uhf_reader' ? 'UHF 手持机' : '物品盒定位器')).join('、') + '」但还没有对应设备：点上方「＋ 注册设备」接入，或检查固件连接。'
        : '';
      this.setData({ devices, events, missingHint });
    } catch (e) { toast(e.message); }
  },

  // ---------- 实时事件流（WebSocket） ----------
  connectWs() {
    if (this.ws) return;
    const token = store.getToken();
    if (!token) return;
    const task = wx.connectSocket({
      url: config.WS_BASE + '/ws?token=' + encodeURIComponent(token)
    });
    this.ws = task;
    task.onOpen(() => this.setData({ wsOk: true }));
    task.onClose(() => { this.setData({ wsOk: false }); this.ws = null; });
    task.onError(() => { try { task.close({}); } catch (e) {} });
    task.onMessage((res) => {
      let data;
      try { data = JSON.parse(res.data); } catch (e) { return; }
      if (data.type === 'device_event' && data.event) {
        // 只显示当前可见设备（按声明过滤后）的事件
        const visible = new Set(this.data.devices.map((x) => x.id));
        if (!visible.has(data.event.device_id)) return;
        const line = fmtEvent(data.event);
        this.setData({ events: [line, ...this.data.events].slice(0, 60) });
      } else if (data.type === 'device_update') {
        this.refresh();
      }
    });
  },
  closeWs() {
    if (this.ws) { try { this.ws.close({}); } catch (e) {} this.ws = null; }
  },

  // ---------- 操作 ----------
  async doCmd(e) {
    const { id, cmd } = e.currentTarget.dataset;
    try {
      const r = await api.request(`/hardware/devices/${id}/command`, { method: 'POST', data: { command: cmd } });
      toast(r.message);
      this.refresh();
    } catch (err) { toast(err.message); }
  },
  async doDel(e) {
    if (!(await confirm('确认删除该设备？'))) return;
    try {
      await api.request('/hardware/devices/' + e.currentTarget.dataset.id, { method: 'DELETE' });
      toast('已删除 ✓');
      this.refresh();
    } catch (err) { toast(err.message); }
  },
  async doSim() {
    try {
      const r = await api.request('/hardware/simulate', { method: 'POST' });
      toast(r.message);
      this.refresh();
    } catch (err) { toast(err.message); }
  },

  // ---------- 注册设备 ----------
  toggleForm() { this.setData({ showForm: !this.data.showForm }); },
  onName(e) { this.setData({ name: e.detail.value }); },
  onType(e) { this.setData({ typeIndex: Number(e.detail.value) }); },
  async doRegister() {
    const type = this.data.types[this.data.typeIndex].key;
    try {
      const r = await api.request('/hardware/devices', { method: 'POST', data: { name: this.data.name, type } });
      // 同步偏好设置：注册了某类设备 → 自动把对应声明写进画像，两页保持一致
      const ownedKey = TYPE_TO_OWNED[type];
      if (ownedKey) {
        try {
          const u = store.getUser() || {};
          const owned = u.profile && Array.isArray(u.profile.hardware) ? u.profile.hardware : [];
          if (!owned.includes(ownedKey)) {
            const d = await api.request('/auth/profile', {
              method: 'PUT',
              data: { hardware: owned.concat([ownedKey]) }
            });
            store.setUser(d.user);
            toast('已注册并同步到偏好设置 ✓');
          } else {
            toast(`已注册：${r.device.id}（真实设备，等待固件接入）✓`);
          }
        } catch (e) {
          toast(`已注册：${r.device.id}（真实设备，等待固件接入）✓`);
        }
      } else {
        toast(`已注册：${r.device.id}（真实设备，等待固件接入）✓`);
      }
      this.setData({ showForm: false, name: '' });
      this.refresh();
    } catch (err) { toast(err.message); }
  },

  goHome() { wx.reLaunch({ url: '/pages/home/home' }); },
  goProfile() { wx.navigateTo({ url: '/pages/profile/profile' }); }
});
