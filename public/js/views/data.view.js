// js/views/data.view.js — 数据统计与分析可视化
import { api } from '../api.js';
import { store } from '../store.js';
import { esc, toast, roomEmoji } from '../ui.js';
import { barChart, donutChart, timelineChart, vBarChart } from '../charts.js';

const PAGE_SIZE = 8;
let offset = 0;
let totalRecords = 0;

export async function renderData(root) {
  root.innerHTML = `<div class="page-title">📊 数据统计与分析</div><div class="center" style="padding:40px;">加载中…</div>`;
  try {
    const d = await api('/data/stats');
    offset = 0;
    renderStats(root, d);
    await loadRecords(root);
  } catch (e) {
    root.innerHTML = `<div class="card soon"><div class="ico">⚠️</div><div class="t">${esc(e.message)}</div></div>`;
  }
}

function renderStats(root, d) {
  const s = d.mine;
  const u = store.user;
  const fmtDur = (sec) => sec == null ? '—' : (sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`);

  root.innerHTML = `
    <div class="page-title">📊 数据统计与分析</div>
    <p class="page-sub">数据库累计 ${s.total} 条记录，持续学习你的习惯</p>

    <div class="toolbar">
      <button class="btn ghost sm" id="btn-export">⬇️ 导出数据 (JSON)</button>
      <button class="btn ghost sm" id="btn-import">⬆️ 导入数据</button>
      <input type="file" id="import-file" accept=".json,application/json" class="hidden">
    </div>

    <div class="stat-cards">
      <div class="stat-card"><div class="v">${s.total}</div><div class="k">找回记录总数</div></div>
      <div class="stat-card"><div class="v">${s.successRate}%</div><div class="k">找回成功率</div></div>
      <div class="stat-card"><div class="v">${fmtDur(s.avgDur)}</div><div class="k">平均找回用时</div></div>
      <div class="stat-card"><div class="v">${s.last30}</div><div class="k">近 30 天记录</div></div>
    </div>

    <div class="card insights">
      <div class="chart-title">💡 智能分析（基于你的数据自动生成）</div>
      <ol>${(s.insights || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    </div>

    <div class="grid two">
      <div class="chart-wrap">
        <div class="chart-title">🏆 高频找回地点 Top ${Math.min(s.topLocations.length, 8)}</div>
        <div id="c-top"></div>
      </div>
      <div class="chart-wrap">
        <div class="chart-title">🏠 找回位置 · 房间分布</div>
        <div id="c-room"></div>
      </div>
    </div>
    <div class="grid two">
      <div class="chart-wrap">
        <div class="chart-title">📅 近 30 天找回趋势（按天）</div>
        <div id="c-time"></div>
      </div>
      <div class="chart-wrap">
        <div class="chart-title">🕐 丢眼镜时段分布</div>
        <div id="c-tod"></div>
      </div>
    </div>

    <div class="chart-wrap" style="margin-bottom:18px;">
      <div class="chart-title">🔥 户型热力：各房间历史找回次数</div>
      <div id="c-heat"></div>
    </div>

    <div class="card">
      <div class="chart-title">🕓 找回记录（可分页、可删除）</div>
      <div id="records-box"><div class="center" style="padding:24px;">加载记录中…</div></div>
    </div>`;

  barChart(root.querySelector('#c-top'), s.topLocations.slice(0, 8).map((x) => ({ name: x.name, count: x.count })), { unit: ' 次' });
  donutChart(root.querySelector('#c-room'), s.roomDist);
  timelineChart(root.querySelector('#c-time'), s.timeline);
  vBarChart(root.querySelector('#c-tod'), s.timeDist);
  renderHeat(root.querySelector('#c-heat'), s, u.profile.homeLayout || []);

  root.querySelector('#btn-export').onclick = doExport;
  root.querySelector('#btn-import').onclick = () => root.querySelector('#import-file').click();
  root.querySelector('#import-file').onchange = (e) => doImport(e.target.files[0], root);
}

// 户型热力：有坐标时按户型图网格着色，否则按列表
function renderHeat(box, s, layout) {
  if (!layout.length) {
    box.innerHTML = `<div class="empty">尚未填写家庭户型：<a href="#/profile">去画像页填写</a> 后可查看房间热力</div>`;
    return;
  }
  const countOf = (room) => {
    const it = s.roomDist.find((x) => x.name === room);
    return it ? it.count : 0;
  };
  const placed = layout.filter((r) => r.x != null && r.y != null);
  const extra = s.roomDist.filter((x) => !layout.some((r) => r.name === x.name));

  let heatHtml;
  if (placed.length) {
    const max = Math.max(1, ...placed.map((r) => countOf(r.name)));
    const w = Math.min(10, Math.max(...placed.map((r) => r.x)) + 1);
    const h = Math.min(10, Math.max(...placed.map((r) => r.y)) + 1);
    let cells = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = placed.find((p) => p.x === x && p.y === y);
        if (r) {
          const c = countOf(r.name);
          const ratio = c / max;
          const alpha = c ? 0.12 + ratio * 0.5 : 0;
          cells += `<div class="heat-cell" style="background:${c ? `rgba(61,123,253,${alpha.toFixed(2)})` : '#f6f8fb'}">
            <div class="tile-emoji">${roomEmoji(r.name)}</div>
            <div class="tile-name">${esc(r.name)}</div>
            <div class="tile-count">${c} 次</div>
          </div>`;
        } else {
          cells += '<div class="heat-cell blank"></div>';
        }
      }
    }
    heatHtml = `<div class="heat-floor" style="grid-template-columns: repeat(${w}, 1fr);">${cells}</div>`;
  } else {
    const max = Math.max(1, ...layout.map((r) => countOf(r.name)));
    heatHtml = `<div class="heat-grid">${layout.map((r) => {
      const c = countOf(r.name);
      const ratio = c / max;
      const alpha = c ? 0.1 + ratio * 0.5 : 0;
      return `
      <div class="heat-tile" style="background:${c ? `rgba(61,123,253,${alpha.toFixed(2)})` : '#f6f8fb'}">
        <div class="tile-emoji">${roomEmoji(r.name)}</div>
        <div class="tile-name">${esc(r.name)}</div>
        <div class="tile-count">${c} 次</div>
      </div>`;
    }).join('')}</div>`;
  }

  box.innerHTML = heatHtml + (extra.length ? `
    <div class="tag-list" style="margin-top:10px;">${extra.map((x) => `<span class="tag" title="该房间不在你的户型中">${roomEmoji(x.name)} ${esc(x.name)}：${x.count} 次</span>`).join('')}</div>` : '') +
    `<p class="hint" style="margin-top:8px;">颜色越深代表该房间找回次数越多；布局来自你的户型图，可在画像页拖拽调整。</p>`;
}

// ---------- 记录分页 ----------
async function loadRecords(root) {
  const box = root.querySelector('#records-box');
  try {
    const d = await api(`/data/records?limit=${PAGE_SIZE}&offset=${offset}`);
    totalRecords = d.total;
    if (!d.items.length) {
      box.innerHTML = `<div class="empty">暂无记录</div>`;
      return;
    }
    const rows = d.items.map((r) => `
      <tr>
        <td class="nowrap">${esc((r.startedAt || '').slice(0, 16).replace('T', ' '))}</td>
        <td>${esc(r.foundLocation || '—')}</td>
        <td>${esc(r.foundRoom || '—')}</td>
        <td>${r.confidence != null ? Math.round(r.confidence) + '%' : '—'}</td>
        <td>${r.durationSec != null ? r.durationSec + 's' : '—'}</td>
        <td>${r.success ? '<span class="pill ok">找到</span>' : '<span class="pill no">未找到</span>'}</td>
        <td class="nowrap">
          ${r.hasConversation ? '<span title="含完整问答转录">💬</span>' : ''}
          <button class="btn ghost sm del" data-id="${r.id}">删除</button>
        </td>
      </tr>`).join('');
    const pages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
    const cur = Math.floor(offset / PAGE_SIZE) + 1;
    box.innerHTML = `
      <div class="table-scroll">
        <table class="tbl">
          <thead><tr><th>时间</th><th>位置</th><th>房间</th><th>置信度</th><th>用时</th><th>结果</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="pager">
        <span class="muted">共 ${totalRecords} 条 · 第 ${cur}/${pages} 页</span>
        <div class="btn-row" style="margin:0;">
          <button class="btn ghost sm" id="pg-prev" ${cur <= 1 ? 'disabled' : ''}>← 上一页</button>
          <button class="btn ghost sm" id="pg-next" ${cur >= pages ? 'disabled' : ''}>下一页 →</button>
        </div>
      </div>`;
    box.querySelector('#pg-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); loadRecords(root); };
    box.querySelector('#pg-next').onclick = () => { offset += PAGE_SIZE; loadRecords(root); };
    box.querySelectorAll('.del').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('确认删除这条记录？删除后统计将更新。')) return;
        try {
          await api('/data/records/' + b.dataset.id, { method: 'DELETE' });
          toast('已删除 ✓');
          renderData(document.getElementById('app'));
        } catch (e) { toast(e.message); }
      };
    });
  } catch (e) {
    box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ---------- 导入导出 ----------
async function doExport() {
  try {
    const data = await api('/data/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `find-glasses-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 JSON 数据 ✓');
  } catch (e) { toast(e.message); }
}

async function doImport(file, root) {
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('JSON 解析失败，请检查文件'); return; }
  const records = Array.isArray(data) ? data : (data.records || null);
  if (!records) { toast('文件格式不正确（应为记录数组或包含 records 字段的导出文件）'); return; }
  if (!confirm(`确认导入 ${records.length} 条记录？`)) return;
  try {
    const r = await api('/data/import', { method: 'POST', body: { records } });
    toast(`导入完成：成功 ${r.imported} 条${r.skipped ? `，跳过 ${r.skipped} 条` : ''} ✓`);
    renderData(root);
  } catch (e) { toast(e.message); }
}
