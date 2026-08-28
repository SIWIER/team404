// js/views/profile.view.js — 个人画像（个性化智能体）编辑；户型图配置已独立到 #/layout
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast } from '../ui.js';

export function renderProfile(root) {
  const p = store.user.profile;
  root.innerHTML = `
    <div class="page-title">🧠 个性化智能体</div>
    <p class="page-sub">画像越准确，后续推理越贴合你的习惯；户型图请到「户型图配置」页管理</p>
    <div class="card">
      <div class="field"><label>智能体昵称</label><input id="p-name" class="input" value="${esc(p.agentName)}"></div>
      <div class="field"><label>智能体风格</label><input id="p-style" class="input" value="${esc(p.agentStyle)}" placeholder="例如：温和、爱追问、擅长生活常识"></div>
      <div class="field"><label>生活习惯（每行一条，最多 20 条）</label><textarea id="p-habits" class="input">${esc((p.habits || []).join('\n'))}</textarea></div>
      <div class="field"><label>常用放眼镜地点（每行一条，最多 20 条）</label><textarea id="p-favs" class="input">${esc((p.favoritePlaces || []).join('\n'))}</textarea></div>
      <div class="field"><label>备注（度数 / 眼镜情况等）</label><textarea id="p-notes" class="input">${esc(p.notes || '')}</textarea></div>
      <div class="btn-row">
        <button class="btn" id="p-save">💾 保存画像</button>
        <button class="btn ghost" onclick="location.hash='#/'">← 返回首页</button>
      </div>
    </div>

    <div class="card layout-link" onclick="location.hash='#/layout'">
      <div class="ll-ico">🏠</div>
      <div style="flex:1;">
        <div class="ll-t">户型图配置</div>
        <div class="ll-d">目录管理（家 / 公司 / 宿舍…）、房间拖拽布置与内部模块（书桌 / 书架 / 壁橱…）、标准户型模板，已独立成页 ➜</div>
      </div>
    </div>

    <div class="card">
      <div class="btn-row">
        <button class="btn warn" id="p-delete">⚠️ 注销账号（删除全部个人数据）</button>
      </div>
    </div>`;

  root.querySelector('#p-save').onclick = () => saveBasic(root);
  root.querySelector('#p-delete').onclick = () => deleteAccount(root);
}

async function saveBasic(root) {
  const btn = root.querySelector('#p-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 保存中…';
  try {
    const d = await api('/auth/profile', {
      method: 'PUT',
      body: {
        agentName: root.querySelector('#p-name').value.trim(),
        agentStyle: root.querySelector('#p-style').value.trim(),
        habits: lines(root.querySelector('#p-habits')),
        favoritePlaces: lines(root.querySelector('#p-favs')),
        notes: root.querySelector('#p-notes').value.trim()
      }
    });
    store.setUser(d.user);
    toast('画像已保存 ✓');
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  btn.innerHTML = '💾 保存画像';
}

// 注销账号（永久删除全部个人数据，双重确认）
async function deleteAccount(root) {
  if (!window.confirm('确定要注销账号吗？你的画像、户型、找回记录等全部个人数据将被永久删除，不可恢复。')) return;
  if (!window.confirm('再次确认：注销后数据无法找回，是否仍要注销？')) return;
  try {
    await api('/auth/account', { method: 'DELETE' });
    store.clear();
    toast('账号已注销，感谢使用 👋');
    setTimeout(() => { location.hash = '#/auth'; }, 600);
  } catch (e) { toast(e.message); }
}

function lines(el) {
  return el.value.split('\n').map((s) => s.trim()).filter(Boolean);
}
