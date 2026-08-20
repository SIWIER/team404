// js/charts.js — 轻量 SVG 图表库（无外部依赖）
const COLORS = ['#3d7bfd', '#6a5cff', '#16a6c9', '#22b07d', '#ffb020', '#ff7a59', '#e85d75', '#8a5cf6'];

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function hostOf(host) {
  host.innerHTML = '';
  return host;
}

export function empty(host, msg) {
  host.innerHTML = `<div class="empty">${msg || '暂无数据'}</div>`;
}

// 横向条形图：items = [{name, count}] 或 {label, value}
export function barChart(host, items, opts = {}) {
  hostOf(host);
  if (!items || !items.length) return empty(host);
  const W = 640;
  const rowH = 30, pad = 8, labelW = 128;
  const H = items.length * rowH + pad * 2;
  const svg = svgEl('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}` });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const max = Math.max(...items.map((i) => i.count ?? i.value)) || 1;
  items.forEach((it, idx) => {
    const v = it.count ?? it.value;
    const label = it.name ?? it.label;
    const y = pad + idx * rowH;
    const barW = Math.max(4, (v / max) * (W - labelW - 70));
    const t = svgEl('text', { x: 0, y: y + rowH / 2 + 4, 'font-size': 12, fill: '#7b8794' });
    t.textContent = label.length > 9 ? label.slice(0, 9) + '…' : label;
    svg.appendChild(t);
    svg.appendChild(svgEl('rect', { x: labelW, y: y + 4, width: barW, height: rowH - 12, rx: 6, fill: COLORS[idx % COLORS.length] }));
    const val = svgEl('text', { x: labelW + barW + 8, y: y + rowH / 2 + 4, 'font-size': 12, fill: '#1f2b3a', 'font-weight': 700 });
    val.textContent = v + (opts.unit || '');
    svg.appendChild(val);
  });
  host.appendChild(svg);
}

// 环图：items = [{name, count}]
export function donutChart(host, items) {
  hostOf(host);
  if (!items || !items.length) return empty(host);
  const total = items.reduce((a, i) => a + i.count, 0) || 1;
  const cx = 90, cy = 90, r = 70, ir = 42;
  const svg = svgEl('svg', { width: 260, height: 200, viewBox: '0 0 200 200' });
  let angle = -Math.PI / 2;
  items.forEach((it, idx) => {
    const frac = it.count / total;
    const end = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    svg.appendChild(svgEl('path', {
      d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      fill: COLORS[idx % COLORS.length], stroke: '#fff', 'stroke-width': 2
    }));
    angle = end;
  });
  svg.appendChild(svgEl('circle', { cx, cy, r: ir, fill: '#fff' }));
  const txt = svgEl('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 800, fill: '#1f2b3a' });
  txt.textContent = total + ' 次';
  svg.appendChild(txt);

  const legend = document.createElement('div');
  legend.style.cssText = 'margin-left:18px;font-size:12px;color:#7b8794;line-height:1.9;';
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;background:${COLORS[idx % COLORS.length]};margin-right:7px;`;
    row.appendChild(dot);
    row.appendChild(document.createTextNode(`${it.name} · ${it.count} 次`));
    legend.appendChild(row);
  });
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;';
  wrap.appendChild(svg);
  wrap.appendChild(legend);
  host.appendChild(wrap);
}

// 时间线柱状图：items = [[label, count], ...]
export function timelineChart(host, items) {
  hostOf(host);
  if (!items || !items.length) return empty(host, '近 30 天暂无记录');
  const W = 660, H = 170, padL = 8, padB = 26, top = 12;
  const max = Math.max(...items.map((i) => i[1])) || 1;
  const svg = svgEl('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}` });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const bw = (W - padL * 2) / items.length;
  items.forEach((it, idx) => {
    const [label, val] = it;
    const bh = val ? (val / max) * (H - top - padB) : 2;
    const x = padL + idx * bw + bw * 0.18;
    const y = H - padB - bh;
    svg.appendChild(svgEl('rect', { x, y, width: bw * 0.64, height: bh, rx: 4, fill: val ? COLORS[idx % COLORS.length] : '#e3e9f2' }));
    if (idx % Math.ceil(items.length / 8) === 0 || idx === items.length - 1) {
      const t = svgEl('text', { x: x + bw * 0.32, y: H - padB + 16, 'font-size': 10, fill: '#7b8794', 'text-anchor': 'middle' });
      t.textContent = label.slice(5);
      svg.appendChild(t);
    }
  });
  host.appendChild(svg);
}

// 通用柱状图（竖直）——用于时段分布：items = [{name, count}]
export function vBarChart(host, items, opts = {}) {
  hostOf(host);
  if (!items || !items.length) return empty(host);
  const W = 420, H = 180, padB = 26, top = 16;
  const max = Math.max(...items.map((i) => i.count)) || 1;
  const svg = svgEl('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}` });
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const bw = (W - 20) / items.length;
  items.forEach((it, idx) => {
    const bh = (it.count / max) * (H - top - padB);
    const x = 10 + idx * bw + bw * 0.15;
    const y = H - padB - bh;
    svg.appendChild(svgEl('rect', { x, y, width: bw * 0.7, height: bh, rx: 5, fill: COLORS[idx % COLORS.length] }));
    const t = svgEl('text', { x: x + bw * 0.35, y: H - padB + 16, 'font-size': 11, fill: '#7b8794', 'text-anchor': 'middle' });
    t.textContent = it.name;
    svg.appendChild(t);
    const v = svgEl('text', { x: x + bw * 0.35, y: y - 5, 'font-size': 11, fill: '#1f2b3a', 'font-weight': 700, 'text-anchor': 'middle' });
    v.textContent = it.count;
    svg.appendChild(v);
  });
  host.appendChild(svg);
}
