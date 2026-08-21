// pages/hardware/hardware.js — 硬件设备接入：设备管理 + 指令 + WebSocket 实时事件流
const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { toast, confirm } = require('../../utils/ui');

const TYPE_ICON = { locator: '📡', nfc: '🔊', tag: '🏷️' };
const TYPE_LABEL = { locator: '定位器', nfc: '近场呼唤器', tag: '防丢标签' };
const ACTIONS = {
  locator: [{ c: 'locate', t: '📡 定位扫描', cls: 'warn' }],
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
    showForm: false,
    name: '',
    typeIndex: 0,
    types: [
      { key: 'locator', label: '📡 定位器（上报位置/距离）' },
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
      const d = await api.request('/hardware/devices');
      const devices = (d.devices || []).map((x) => ({
        ...x,
        icon: TYPE_ICON[x.type] || '📟',
        label: TYPE_LABEL[x.type] || x.type,
        actions: ACTIONS[x.type] || [],
        on: x.status === 'online'
      }));
      this.setData({ devices, events: (d.events || []).map(fmtEvent) });
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
      toast(`已注册：${r.device.id}（真实设备，等待固件接入）✓`);
      this.setData({ showForm: false, name: '' });
      this.refresh();
    } catch (err) { toast(err.message); }
  },

  goHome() { wx.reLaunch({ url: '/pages/home/home' }); }
});
