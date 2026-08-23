// js/views/home.view.js — 首页：个性化智能体 + 模块菜单
import { store } from '../store.js';
import { esc, roomEmoji } from '../ui.js';

export function renderHome(root) {
  const u = store.user;
  const p = u.profile;
  const habits = (p.habits || []).map((h) => `<span class="tag">${esc(h)}</span>`).join('') || '<span class="muted" style="font-size:12px;">暂无生活习惯记录</span>';
  const favs = (p.favoritePlaces || []).map((h) => `<span class="tag">📍 ${esc(h)}</span>`).join('') || '<span class="muted" style="font-size:12px;">暂无常用地点</span>';
  const layout = p.homeLayout || [];
  const placed = layout.filter((r) => r.x != null && r.y != null);
  const layoutHtml = layout.length
    ? layout.map((r) => `<span class="tag">${roomEmoji(r.name)} ${esc(r.name)}${(r.spots || []).length ? ` · ${r.spots.length} 处` : ''}</span>`).join('')
    : '<span class="tag"><a href="#/profile">🏠 未填写户型，去填写可提升推理准确度 →</a></span>';
  let floorHtml = '';
  if (placed.length) {
    const w = Math.min(6, Math.max(...placed.map((r) => r.x)) + 1);
    const h = Math.min(6, Math.max(...placed.map((r) => r.y)) + 1);
    let cells = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = placed.find((p) => p.x === x && p.y === y);
        cells += r
          ? `<div class="mini-cell">${roomEmoji(r.name)}<span>${esc(r.name)}</span></div>`
          : '<div class="mini-cell empty"></div>';
      }
    }
    floorHtml = `<div class="mini-floor" style="grid-template-columns: repeat(${w}, minmax(52px, 72px));">${cells}</div>
      <div class="muted" style="font-size:11px;margin-top:4px;">户型图（拖拽编辑见画像页；相邻格 = 相邻房间，影响推理距离权重）</div>`;
  }

  root.innerHTML = `
    <div class="page-title">你好，${esc(u.nickname)} 👋</div>
    <p class="page-sub">这是你的专属智能体，选择一项功能开始吧。</p>

    <div class="card">
      <div class="profile-head">
        <div class="avatar">${esc(u.nickname.slice(0, 1))}</div>
        <div style="flex:1;">
          <div style="font-weight:800;font-size:17px;">${esc(p.agentName)}</div>
          <div class="muted" style="font-size:13px;">${esc(p.agentStyle)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">账号 ${esc(u.username)} · 注册于 ${esc(u.createdAt.slice(0, 10))}</div>
        </div>
        <button class="btn ghost sm" onclick="location.hash='#/profile'">✏️ 编辑画像</button>
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
        <div class="muted" style="font-size:12px;font-weight:600;">生活习惯</div>
        <div class="tag-list">${habits}</div>
        <div class="muted" style="font-size:12px;font-weight:600;margin-top:8px;">常用放眼镜地点</div>
        <div class="tag-list">${favs}</div>
        <div class="muted" style="font-size:12px;font-weight:600;margin-top:8px;">🏠 家庭户型（辅助推理）</div>
        <div class="tag-list">${layoutHtml}</div>
        ${floorHtml}
      </div>
    </div>

    <div class="grid menu">
      <div class="menu-card" onclick="location.hash='#/reason'">
        <span class="badge">智能引导</span>
        <div class="ico">🔍</div><div class="t">引导推理找眼镜</div>
        <div class="d">一问一答，回忆场景，AI 结合常识与你的历史数据推理位置。</div>
      </div>
      <div class="menu-card" onclick="location.hash='#/data'">
        <span class="badge">统计可视化</span>
        <div class="ico">📊</div><div class="t">数据统计与分析</div>
        <div class="d">找回记录、高频地点、房间热力、时段趋势与智能洞察。</div>
      </div>
      <div class="menu-card" onclick="location.hash='#/hardware'">
        <span class="badge">硬件端口</span>
        <div class="ico">📡</div><div class="t">硬件设备接入</div>
        <div class="d">定位器 / 近场呼唤器 / 防丢标签，REST + 实时推送。</div>
      </div>
    </div>`;
}
