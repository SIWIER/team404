// js/views/home.view.js — 首页：个性化智能体 + 模块菜单 + 房间细致布局搜查
import { store } from '../store.js';
import { api } from '../api.js';
import { esc, roomEmoji, toast } from '../ui.js';

// 房间 → 常见家具（用于房间细致布局搜查）；未收录的房间给通用清单
const ROOM_FURNITURE = {
  '卧室': ['床', '床头柜', '书桌/电脑桌', '衣柜', '窗台', '梳妆台'],
  '卫生间': ['洗手台', '马桶', '浴室置物架/镜柜', '毛巾架', '洗衣机', '浴缸/淋浴间'],
  '客厅': ['沙发', '茶几', '电视柜', '置物架', '地毯'],
  '厨房': ['操作台', '灶台', '水槽', '冰箱', '橱柜'],
  '厨房/餐厅': ['操作台', '餐桌', '灶台', '冰箱', '橱柜'],
  '餐厅': ['餐桌', '餐椅', '餐边柜'],
  '书房': ['书桌/电脑桌', '书架', '文件柜', '窗台'],
  '玄关': ['鞋柜', '挂钩', '换鞋凳'],
  '走廊': ['鞋柜/矮柜', '挂钩', '窗台'],
  '阳台': ['洗衣机', '晾衣架', '窗台', '置物架'],
  '衣帽间': ['衣柜', '置物架', '抽屉柜'],
  '储物间': ['货架', '储物箱', '抽屉柜']
};

const FURNITURE_EMOJI = {
  '床': '🛏️', '床头柜': '🗄️', '书桌/电脑桌': '🖥️', '衣柜': '👕', '窗台': '🪟', '梳妆台': '🪞',
  '洗手台': '🚰', '马桶': '🚽', '浴室置物架/镜柜': '🪞', '毛巾架': '🧺', '洗衣机': '🧺', '浴缸/淋浴间': '🛁',
  '沙发': '🛋️', '茶几': '🪑', '电视柜': '📺', '置物架': '🗄️', '地毯': '🧶',
  '操作台': '🍳', '灶台': '🍳', '水槽': '🚰', '冰箱': '🧊', '橱柜': '🗄️',
  '餐桌': '🍽️', '餐椅': '🪑', '餐边柜': '🗄️',
  '书架': '📚', '文件柜': '🗄️',
  '鞋柜': '👟', '鞋柜/矮柜': '👟', '挂钩': '🧷', '换鞋凳': '🪑',
  '晾衣架': '🧺', '货架': '🗄️', '储物箱': '📦', '抽屉柜': '🗄️',
  '地面': '🧹', '桌面': '🪑'
};

function furnitureEmoji(name) {
  return FURNITURE_EMOJI[name] || '🪑';
}

// 房间家具 = 该房间类型的常见家具 + 用户在画像里填写的常用位置（去重）
function furnitureFor(room) {
  const base = (ROOM_FURNITURE[room.name] || ['置物架', '抽屉柜', '桌面', '地面']).map((name) => ({
    name, emoji: furnitureEmoji(name)
  }));
  const extra = (room.spots || [])
    .filter((s) => !base.some((f) => f.name === s))
    .map((name) => ({ name, emoji: furnitureEmoji(name) }));
  return [...base, ...extra];
}

export function renderHome(root) {
  const u = store.user;
  const p = u.profile;
  const layout = p.homeLayout || [];
  const spaces = p.spaces || [];
  const active = spaces.find((s) => s.id === p.activeSpaceId);
  const activeName = active ? active.name : '家';
  const layoutCount = layout.filter((r) => r.name).length;
  const furnCount = layout.reduce((n, r) => n + (Array.isArray(r.furn) ? r.furn.length : 0), 0);
  // 多格展开：每个房间的每一格渲染一个 tile（10×10 细网格，名字只显示在首格）
  const expanded = [];
  layout.forEach((r) => {
    const cells = (Array.isArray(r.cells) && r.cells.length)
      ? r.cells
      : ((r.x != null && r.y != null) ? [{ x: r.x, y: r.y }] : []);
    cells.forEach((c, ci) => expanded.push({ x: c.x, y: c.y, room: r, first: ci === 0 }));
  });
  let floorHtml = '';
  if (expanded.length) {
    const w = Math.min(10, Math.max(...expanded.map((c) => c.x)) + 1);
    const h = Math.min(10, Math.max(...expanded.map((c) => c.y)) + 1);
    let cells = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = expanded.find((cc) => cc.x === x && cc.y === y);
        cells += c
          ? `<div class="mini-cell room${c.room.name.includes('走廊') ? ' cor' : ''}" data-idx="${layout.indexOf(c.room)}" title="点击进入房间细致布局">${roomEmoji(c.room.name)}${c.first ? `<span>${esc(c.room.name)}</span>` : ''}</div>`
          : '<div class="mini-cell empty"></div>';
      }
    }
    floorHtml = `<div class="mini-floor" style="grid-template-columns: repeat(${w}, minmax(52px, 72px));">${cells}</div>`;
  }

  root.innerHTML = `
    <div class="hero">
      <div class="hero-title">📦 物品数字化存放系统</div>
      <div class="hero-sub">你好，${esc(u.nickname)} · 为每件物品找到它的位置</div>
    </div>

    <div class="card">
      <div id="home-space-bar" style="margin-bottom:10px;"></div>
      <div class="layout-head">
        <div>
          <div style="font-weight:800;font-size:17px;">${spaceEmoji(activeName)} ${esc(activeName)} 户型图</div>
          <div class="muted" style="font-size:12px;margin-top:2px;">房间 ${layoutCount} · 内部模块 ${furnCount}</div>
        </div>
        <button class="btn ghost sm" onclick="location.hash='#/layout'">✏️ 编辑</button>
      </div>
      ${floorHtml || (layoutCount
        ? '<div class="empty-layout" onclick="location.hash=\'#/layout\'">房间都还没摆放，去户型配置页布置 ➜</div>'
        : '<div class="empty-layout" onclick="location.hash=\'#/layout\'">还没有户型图，去户型配置页开始搭建（把房间方块加进列表即可）➜</div>')}
      <p class="hint" style="margin-top:8px;">点击房间格进入细致布局搜查；拖拽编辑与目录管理在户型配置页；相邻格 = 相邻房间，影响推理「距离远近」权重。</p>
    </div>

    <div class="grid menu">
      <div class="menu-card" onclick="location.hash='#/layout'">
        <span class="badge">户型配置</span>
        <div class="ico">🏠</div><div class="t">户型图配置</div>
        <div class="d">目录管理（家/公司/宿舍…）、房间拖拽布置与内部模块（书桌/书架/壁橱…）。</div>
      </div>
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

  bindFloorCells(root, layout);
  bindSpaceBar(root);
}

// 目录名 → 类型 emoji（家🏠/公司🏢/学校🏫/宿舍🛌）
function spaceEmoji(name) {
  const n = String(name || '');
  if (/公司|办公|单位|企业|office/i.test(n)) return '🏢';
  if (/学校|校园|学院|大学|中学|小学|school/i.test(n)) return '🏫';
  if (/宿舍|公寓|dorm/i.test(n)) return '🛌';
  return '🏠';
}

// ---------- 目录（家/公司/宿舍…）切换 ----------
function bindSpaceBar(root) {
  const bar = root.querySelector('#home-space-bar');
  if (!bar) return;
  const p = store.user.profile;
  const spaces = p.spaces || [];
  const active = spaces.find((s) => s.id === p.activeSpaceId);
  const activeName = active ? active.name : '家';
  if (spaces.length <= 1) {
    bar.innerHTML = `<span class="muted" style="font-size:12px;">当前目录：<b>${spaceEmoji(activeName)} ${esc(activeName)}</b>（在户型配置页可新建家/公司/宿舍等目录）</span>`;
    return;
  }
  bar.innerHTML = '<span class="muted" style="font-size:12px;font-weight:600;">目录：</span>' +
    spaces.map((s) => `<button class="space-chip ${s.id === p.activeSpaceId ? 'on' : ''}" data-id="${s.id}">${spaceEmoji(s.name)} ${esc(s.name)}</button>`).join('');
  bar.querySelectorAll('button[data-id]').forEach((el) => {
    el.onclick = async () => {
      const id = Number(el.dataset.id);
      if (id === store.user.profile.activeSpaceId) return;
      try {
        const d = await api('/spaces/' + id + '/active', { method: 'PUT' });
        store.setUser(d.user);
        renderHome(root);
        const name = (d.user.profile.spaces || []).find((s) => s.id === id);
        toast('已切换到「' + (name ? name.name : '') + '」');
      } catch (e) { toast(e.message); }
    };
  });
}

// ---------- 房间细致布局（家具级搜查） ----------
function bindFloorCells(root, layout) {
  root.querySelectorAll('.mini-cell.room').forEach((cell) => {
    cell.onclick = () => {
      const room = layout[Number(cell.dataset.idx)];
      if (room) openRoomDetail(room);
    };
  });
}

function openRoomDetail(room) {
  const openedAt = Date.now();
  const furniture = furnitureFor(room);
  const searched = []; // 按搜查先后顺序记录

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-panel" role="dialog" aria-modal="true">
      <div class="room-detail-head">
        <div class="room-detail-emoji">${roomEmoji(room.name)}</div>
        <div style="flex:1;">
          <div class="room-detail-name">${esc(room.name)}</div>
          <div class="muted" style="font-size:12px;">${esc(room.desc || '房间细致布局')}</div>
        </div>
        <button class="btn ghost sm" id="rm-close">✕ 关闭</button>
      </div>
      <p class="hint" style="margin:6px 0 12px;">点按家具切换「已搜查 / 未搜查」，初始全部未搜查；找到眼镜后，点击下方按钮记录「最后一次搜查的家具」。</p>
      <div class="furn-grid" id="furn-grid"></div>
      <div class="room-search-bar">
        <div class="muted" id="rm-last">尚未搜查任何家具</div>
        <div class="btn-row">
          <button class="btn good" id="rm-found" disabled>🎯 找到了，记录最后搜查的家具</button>
          <button class="btn ghost" id="rm-notfound" disabled>📝 没找到，记录本次搜索</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const grid = overlay.querySelector('#furn-grid');
  const lastEl = overlay.querySelector('#rm-last');
  const foundBtn = overlay.querySelector('#rm-found');
  const notfoundBtn = overlay.querySelector('#rm-notfound');

  function renderFurn() {
    if (!furniture.length) {
      grid.innerHTML = '<div class="empty">该房间暂无可搜查的家具，可到户型配置页补充常用位置</div>';
    } else {
      grid.innerHTML = furniture.map((f) => {
        const on = searched.includes(f.name);
        return `
          <div class="furn-item ${on ? 'searched' : ''}" data-name="${esc(f.name)}">
            <span class="furn-badge">${on ? '✓ 已搜查' : '未搜查'}</span>
            <div class="furn-emoji">${f.emoji}</div>
            <div class="furn-name">${esc(f.name)}</div>
          </div>`;
      }).join('');
    }
    const last = searched[searched.length - 1];
    lastEl.textContent = last ? `最后搜查：${last}` : '尚未搜查任何家具';
    foundBtn.disabled = !searched.length;
    notfoundBtn.disabled = !searched.length;
    grid.querySelectorAll('.furn-item').forEach((el) => {
      el.onclick = () => {
        const name = el.dataset.name;
        const i = searched.indexOf(name);
        if (i >= 0) searched.splice(i, 1); else searched.push(name);
        renderFurn();
      };
    });
  }
  renderFurn();

  const close = () => overlay.remove();
  overlay.querySelector('#rm-close').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  async function record(success, foundName) {
    const durationSec = Math.round((Date.now() - openedAt) / 1000);
    try {
      await api('/reason/record', {
        method: 'POST',
        body: {
          startedAt: new Date(openedAt).toISOString(),
          foundLocation: success ? foundName : undefined,
          foundRoom: success ? room.name : undefined,
          success,
          durationSec
        }
      });
      close();
      toast(success ? `已记录：眼镜在「${foundName}」找到 ✓` : '已记录本次未找到，数据已更新');
    } catch (e) { toast(e.message); }
  }

  foundBtn.onclick = () => record(true, searched[searched.length - 1]);
  notfoundBtn.onclick = () => record(false);
}
