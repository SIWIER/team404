// pages/reason/reason.js — 引导推理：问答向导 → 推理结果 → 找到/未找到闭环
const api = require('../../utils/api');
const store = require('../../utils/store');
const { toast } = require('../../utils/ui');

Page({
  data: {
    phase: 'loading',       // loading | questions | confirm | inferring | result | found | notfound
    step: 0,
    progress: [],
    question: null,         // {id, q, type, opts:[{label, emoji, active}]}
    textAnswer: '',
    multiLabel: '',
    confirmList: [],
    engineTag: '',
    result: null,
    ranked: [],
    devices: { locator: null, nfc: null },
    devOut: '',
    foundLoc: '',
    durSec: 0
  },

  // 页面实例状态（不进 data，避免重复渲染）
  flow: [],
  answers: {},
  conversation: [],
  startTs: 0,
  multiArr: [],
  resultObj: null,

  onLoad() {
    if (!store.getUser()) { wx.reLaunch({ url: '/pages/auth/auth' }); return; }
    this.start();
  },

  async start() {
    this.flow = [];
    this.answers = {};
    this.conversation = [];
    this.multiArr = [];
    this.startTs = Date.now();
    this.setData({ phase: 'loading' });
    try {
      const d = await api.request('/reason/flow');
      this.flow = d.flow || [];
      this.setData({ phase: 'questions' });
      this.renderStep();
    } catch (e) {
      toast(e.message);
    }
  },

  visibleQuestions() {
    return this.flow.filter((q) => !q.showWhen || q.showWhen.values.includes(this.answers[q.showWhen.field]));
  },

  renderStep() {
    const vs = this.visibleQuestions();
    const step = this.data.step;
    if (step >= vs.length) return this.renderConfirm();
    const q = vs[step];
    const progress = vs.map((_, i) => ({ cls: i < step ? 'done' : (i === step ? 'cur' : '') }));
    const opts = (q.opts || []).map((o) => {
      let active = false;
      if (q.type === 'multi') active = this.multiArr.includes(o[0]);
      else if (q.type === 'choice') active = this.answers[q.id] === o[0];
      return { label: o[0], emoji: o[1], active };
    });
    const multiLabel = q.type === 'multi'
      ? (this.multiArr.length ? `下一步 →（已选 ${this.multiArr.length} 个）` : '没路过，跳过 →')
      : '';
    this.setData({
      phase: 'questions',
      question: { id: q.id, q: q.q, type: q.type, opts },
      progress,
      textAnswer: this.answers[q.id] || '',
      multiLabel
    });
  },

  pickChoice(e) {
    const q = this.data.question;
    const label = e.currentTarget.dataset.val;
    this.answers[q.id] = label;
    this.conversation.push({ q: q.q, a: label });
    this.setData({ step: this.data.step + 1 });
    this.renderStep();
  },

  toggleMulti(e) {
    const label = e.currentTarget.dataset.val;
    const i = this.multiArr.indexOf(label);
    if (i >= 0) this.multiArr.splice(i, 1); else this.multiArr.push(label);
    this.renderStep();
  },

  nextStep() {
    const q = this.data.question;
    if (q.type === 'text') {
      const v = (this.data.textAnswer || '').trim();
      if (v) { this.answers[q.id] = v; this.conversation.push({ q: q.q, a: v }); }
    } else if (q.type === 'multi') {
      this.answers[q.id] = [...this.multiArr];
      this.conversation.push({ q: q.q, a: this.multiArr.length ? this.multiArr.join('、') : '没路过' });
    }
    this.multiArr = [];
    this.setData({ step: this.data.step + 1 });
    this.renderStep();
  },

  prevStep() {
    this.multiArr = [];
    this.setData({ step: Math.max(0, this.data.step - 1) });
    this.renderStep();
  },

  onTextInput(e) {
    this.setData({ textAnswer: e.detail.value });
  },

  renderConfirm() {
    const confirmList = this.conversation.map((c) => ({ q: c.q, a: c.a }));
    this.setData({ phase: 'confirm', confirmList });
  },

  restart() {
    this.setData({ step: 0 });
    this.start();
  },

  async confirmInfer() {
    this.setData({ phase: 'inferring' });
    try {
      const d = await api.request('/reason/infer', { method: 'POST', data: { facts: this.answers } });
      const r = d.result;
      this.resultObj = r;
      const engineTag = r.engine === 'llm'
        ? '🤖 大模型推理'
        : (r.engine === 'local-fallback' ? '🧩 内置引擎（LLM 回退）' : '🧩 内置常识引擎');
      const ranked = (r.ranked || []).map((x) => ({
        name: x.name, room: x.room,
        pct: Math.round(x.probability * 10) / 10,
        reasons: x.reason ? [x.reason] : (x.reasons || [])
      }));
      this.setData({
        phase: 'result',
        result: r,
        engineTag,
        ranked,
        devOut: ''
      });
      this.loadDevices();
    } catch (e) {
      toast(e.message);
      this.setData({ phase: 'questions' });
      this.renderStep();
    }
  },

  // 设备协助：按实际接入自适应
  async loadDevices() {
    try {
      const d = await api.request('/hardware/devices');
      const list = d.devices || [];
      this.setData({
        devices: {
          locator: list.find((x) => x.type === 'locator') || null,
          nfc: list.find((x) => x.type === 'nfc') || null
        }
      });
    } catch (e) {
      this.setData({ devices: { locator: null, nfc: null } });
    }
  },

  async deviceAction(e) {
    const { id, cmd } = e.currentTarget.dataset;
    this.setData({ devOut: '[发送指令…]' });
    try {
      const r = await api.request(`/hardware/devices/${id}/command`, { method: 'POST', data: { command: cmd } });
      this.setData({ devOut: r.message });
      toast('设备结果已就绪，可点「重新推理」');
    } catch (err) {
      this.setData({ devOut: err.message });
    }
  },

  reinfer() {
    this.confirmInfer();
  },

  async foundIt(e) {
    const { loc, room } = e.currentTarget.dataset;
    const durSec = Math.round((Date.now() - this.startTs) / 1000);
    try {
      await api.request('/reason/record', {
        method: 'POST',
        data: {
          startedAt: new Date(this.startTs).toISOString(),
          foundLocation: loc, foundRoom: room,
          confidence: this.resultObj.confidence, success: true,
          facts: this.answers, reasoning: this.resultObj.summary,
          durationSec: durSec, conversation: this.conversation
        }
      });
      this.setData({ phase: 'found', foundLoc: loc, durSec });
    } catch (err) { toast(err.message); }
  },

  async saveNotFound() {
    const durSec = Math.round((Date.now() - this.startTs) / 1000);
    try {
      await api.request('/reason/record', {
        method: 'POST',
        data: {
          startedAt: new Date(this.startTs).toISOString(),
          success: false, facts: this.answers,
          reasoning: (this.resultObj && this.resultObj.summary) || '',
          durationSec: durSec, conversation: this.conversation
        }
      });
      this.setData({ phase: 'notfound', durSec });
    } catch (err) { toast(err.message); }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});
