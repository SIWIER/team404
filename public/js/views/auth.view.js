// js/views/auth.view.js — 登录 / 注册视图
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast } from '../ui.js';

let tab = 'login';
let busy = false;

export function renderAuth(root) {
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">👓</div>
      <div class="auth-title">找眼镜助手</div>
      <div class="auth-sub">在家里没戴眼镜，也能帮你把眼镜找回来</div>
      <div class="card">
        <div class="tab">
          <button id="tab-login" class="${tab === 'login' ? 'on' : ''}">登录</button>
          <button id="tab-reg" class="${tab === 'reg' ? 'on' : ''}">注册</button>
        </div>
        <div id="auth-form"></div>
      </div>
      <div class="center muted" style="font-size:12px;margin-top:10px;">
        演示账号：xiaoming / 123456 ｜ xiaohong / 123456
      </div>
    </div>`;
  root.querySelector('#tab-login').onclick = () => { tab = 'login'; renderAuth(root); };
  root.querySelector('#tab-reg').onclick = () => { tab = 'reg'; renderAuth(root); };
  renderForm(root.querySelector('#auth-form'));
}

function renderForm(box) {
  if (tab === 'login') {
    box.innerHTML = `
      <div class="field"><label>用户名</label><input id="f-username" class="input" placeholder="如 xiaoming" autocomplete="username"></div>
      <div class="field"><label>密码</label><input id="f-password" class="input" type="password" placeholder="123456" autocomplete="current-password"></div>
      <div class="field" style="display:flex;align-items:center;gap:8px;">
        <input id="f-remember" type="checkbox" checked><label style="margin:0;cursor:pointer;" for="f-remember">记住我（30 天免登录）</label>
      </div>
      <div id="f-error" class="err-msg" style="margin-bottom:10px;"></div>
      <button class="btn block" id="f-submit">登 录</button>`;
  } else {
    box.innerHTML = `
      <div class="field"><label>用户名</label><input id="f-username" class="input" placeholder="2-24 位，字母/数字/中文"></div>
      <div class="field"><label>昵称</label><input id="f-nickname" class="input" placeholder="怎么称呼你"></div>
      <div class="field"><label>密码</label><input id="f-password" class="input" type="password" placeholder="至少 4 位"></div>
      <div class="field"><label>确认密码</label><input id="f-password2" class="input" type="password" placeholder="再输入一次"></div>
      <div id="f-error" class="err-msg" style="margin-bottom:10px;"></div>
      <button class="btn block" id="f-submit">注 册</button>`;
  }
  box.querySelector('#f-submit').onclick = () => submit(box);
  box.querySelector('#f-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(box); });
}

async function submit(box) {
  if (busy) return;
  const errBox = box.querySelector('#f-error');
  const username = box.querySelector('#f-username').value.trim();
  const password = box.querySelector('#f-password').value;

  if (tab === 'reg') {
    const nickname = box.querySelector('#f-nickname').value.trim();
    const password2 = box.querySelector('#f-password2').value;
    if (password !== password2) { errBox.textContent = '两次输入的密码不一致'; return; }
    busy = true; setBusy(box, true);
    try {
      await api('/auth/register', { method: 'POST', body: { username, password, nickname } });
      toast('注册成功，请登录 ✓');
      tab = 'login';
      renderAuth(document.getElementById('app'));
    } catch (e) { showErrors(errBox, e); }
    busy = false; setBusy(box, false);
    return;
  }

  busy = true; setBusy(box, true);
  try {
    const remember = box.querySelector('#f-remember').checked;
    const d = await api('/auth/login', { method: 'POST', body: { username, password, remember } });
    store.setAuth(d.token, d.user);
    toast(`登录成功，欢迎回来 ${d.user.nickname} 👋`);
    location.hash = '#/';
  } catch (e) { showErrors(errBox, e); }
  busy = false; setBusy(box, false);
}

function showErrors(errBox, e) {
  if (e.errors) {
    errBox.textContent = Object.values(e.errors)[0] || '输入有误';
  } else {
    errBox.textContent = e.message || '操作失败';
  }
}

function setBusy(box, on) {
  const btn = box.querySelector('#f-submit');
  btn.disabled = on;
  btn.innerHTML = on ? '<span class="spin"></span> 处理中…' : (tab === 'login' ? '登 录' : '注 册');
}
