// src/modules/layout/layout.service.js — 户型图照片识别：视觉大模型 → 合法 homeLayout 候选
// 设计要点：
// 1) 只做「识别 + 清洗」，不落库：候选交给前端预览，用户确认后走 PUT /api/auth/profile 保存
// 2) 视觉调用失败/超时/解析异常一律返回 null，由路由层转成友好错误（不抛栈给用户）
// 3) normalizeLayout 是纯函数：模型输出千奇百怪，全部收敛成 6×6 网格内的合法布局
'use strict';

// 与小程序 ROOM_PRESETS、推理知识库房间保持一致的词表
const ROOM_VOCAB = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
// 常见别名 → 词表标准名（模型爱用同义词，统一口径避免推理引擎认不出）
const ROOM_ALIAS = {
  主卧: '卧室', 次卧: '卧室', 主卧室: '卧室', 次卧室: '卧室', 儿童房: '卧室', 老人房: '卧室', 房间: '卧室',
  卫浴: '卫生间', 洗手间: '卫生间', 厕所: '卫生间', 浴室: '卫生间', 洗漱间: '卫生间',
  起居室: '客厅', 客餐厅: '客厅', 会客厅: '客厅', 大厅: '客厅',
  厨: '厨房', 灶台间: '厨房', 备餐间: '厨房',
  饭厅: '餐厅', 用餐区: '餐厅',
  书屋: '书房', 工作间: '书房', 办公室: '书房', 学习室: '书房',
  门厅: '玄关', 入户: '玄关', 入户花园: '玄关', 鞋柜区: '玄关',
  过道: '走廊', 走道: '走廊', 通道: '走廊', 廊道: '走廊',
  露台: '阳台', 晒台: '阳台', 生活阳台: '阳台', 景观阳台: '阳台',
  衣帽间储物: '衣帽间', 步入式衣柜: '衣帽间', 衣柜间: '衣帽间',
  杂物间: '储物间', 储藏室: '储物间', 收纳间: '储物间', 设备间: '储物间'
};

const GRID = 6;              // 6×6 网格，与小程序编辑器 / accounts.sanitizeLayout 一致
const MAX_ROOMS = 36;        // 与 accounts.sanitizeLayout 的上限一致（= 网格格数）
const MAX_SPOTS = 20;

function clampCell(v) {
  return Math.min(GRID - 1, Math.max(0, Math.round(v)));
}

function isCorridor(name) {
  return String(name || '').includes('走廊');
}

// 把模型给的房间名对齐到词表：精确 → 别名 → 包含匹配 → 保留原名（截断）
function alignRoomName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, '');
  if (!name) return '';
  if (ROOM_VOCAB.includes(name)) return name;
  if (ROOM_ALIAS[name]) return ROOM_ALIAS[name];
  for (const v of ROOM_VOCAB) {
    if (name.includes(v)) return v;
  }
  for (const [alias, v] of Object.entries(ROOM_ALIAS)) {
    if (name.includes(alias)) return v;
  }
  return name.slice(0, 20);   // 词表外的自定义房间名也允许，交给用户在编辑器里改
}

// 曼哈顿相邻判断：走廊多格链要求逐格连通，避免模型给出断开的"飞地"
function pickConnected(cells) {
  if (cells.length <= 1) return cells;
  const out = [cells[0]];
  const rest = cells.slice(1);
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      const c = rest[i];
      if (out.some((o) => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) === 1)) {
        out.push(c);
        rest.splice(i, 1);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * 模型原始输出 → 合法 homeLayout 候选（纯函数，不联网）
 * 规则：坐标裁进 0-5；同房间内去重格；跨房间抢格时先到先得（后来者让位）；
 *       非走廊房间塌缩为单格；走廊保留连通多格链；x/y 恒等于 cells[0]；≤36 房间
 * 拓扑修复：
 *   1) 走廊优先摆放（与模型输出顺序无关），保证走廊链完整不被截断；
 *   2) 与走廊抢格的房间改放到"走廊旁的空格"而不是被丢弃（普通房间互相抢格仍按旧规则丢弃）；
 *   3) adjacent 声明的相邻关系强制成立：声明与走廊相邻 → 贴到走廊旁；
 *      两个房间互列相邻 → 拉近到曼哈顿距离 1（找不到空格则保持原状，不丢房间）。
 */
const DIRS = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }];

function normalizeLayout(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.rooms) ? raw.rooms : []);
  if (!list.length) return [];

  const seenName = new Set();
  const uniqueName = (base) => {
    if (!seenName.has(base)) { seenName.add(base); return base; }
    let n = 2;
    while (seenName.has(base + n)) n++;
    seenName.add(base + n);
    return base + n;
  };

  // ---- 第一遍：解析（只做字段清洗，不摆格） ----
  const parsed = [];
  for (const item of list) {
    if (parsed.length >= MAX_ROOMS) break;
    const name = alignRoomName(item && item.name);
    if (!name) continue;

    let cells = [];
    let hadCells = false;
    if (item && Array.isArray(item.cells) && item.cells.length) {
      hadCells = true;
      cells = item.cells;
    } else if (item && item.x !== undefined && item.y !== undefined) {
      cells = [{ x: item.x, y: item.y }];
    }

    // 数值校验 + 裁剪 + 房间内去重
    const seen = new Set();
    let valid = [];
    for (const c of cells) {
      const cx = Number(c && c.x);
      const cy = Number(c && c.y);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const cell = { x: clampCell(cx), y: clampCell(cy) };
      const k = cell.x + ',' + cell.y;
      if (seen.has(k)) continue;
      seen.add(k);
      valid.push(cell);
    }
    if (hadCells && !valid.length) continue;   // 给了 cells 但全是废格 → 丢弃（与旧行为一致）

    // 非走廊房间只占一格；走廊保留连通多格链
    if (!isCorridor(name)) {
      valid = valid.slice(0, 1);
    } else {
      valid = pickConnected(valid).slice(0, GRID * GRID);
    }

    parsed.push({
      name: uniqueName(name),
      desc: String((item && item.desc) || '').trim().slice(0, 100),
      spots: Array.isArray(item && item.spots)
        ? item.spots.slice(0, MAX_SPOTS).map((s) => String(s).trim().slice(0, 30)).filter(Boolean)
        : [],
      adjacent: Array.isArray(item && item.adjacent)
        ? item.adjacent.map((s) => String(s).trim()).filter(Boolean).slice(0, 20)
        : [],
      cells: valid
    });
  }

  // ---- 第二遍：摆格（走廊优先，其余保持原顺序） ----
  const taken = new Set();
  const out = [];
  const keyOf = (c) => c.x + ',' + c.y;
  const freeNear = (targets) => {
    const seen = new Set();
    const res = [];
    for (const t of targets) {
      for (const d of DIRS) {
        const nx = t.x + d.x;
        const ny = t.y + d.y;
        if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
        const k = nx + ',' + ny;
        if (taken.has(k) || seen.has(k)) continue;
        seen.add(k);
        res.push({ x: nx, y: ny });
      }
    }
    return res;
  };
  const firstFree = () => {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!taken.has(x + ',' + y)) return { x, y };
      }
    }
    return null;
  };
  const nearest = (cands, from) => {
    let best = cands[0];
    let bd = Math.abs(best.x - from.x) + Math.abs(best.y - from.y);
    for (const c of cands) {
      const d = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  const order = parsed.map((_, i) => i)
    .sort((a, b) => (isCorridor(parsed[a].name) ? 0 : 1) - (isCorridor(parsed[b].name) ? 0 : 1));

  for (const i of order) {
    const p = parsed[i];
    if (!p.cells.length) {   // 无格（托盘态）房间保留，x/y 为 null
      out.push({ ...p, x: null, y: null, cells: [] });
      continue;
    }

    if (isCorridor(p.name)) {
      // 走廊优先占格；冲突格只可能来自更早的走廊
      const cells = p.cells.filter((c) => !taken.has(keyOf(c)));
      if (!cells.length) continue;
      cells.forEach((c) => taken.add(keyOf(c)));
      out.push({ ...p, x: cells[0].x, y: cells[0].y, cells });
      continue;
    }

    const cell = p.cells[0];
    if (!taken.has(keyOf(cell))) {
      taken.add(keyOf(cell));
      out.push({ ...p, x: cell.x, y: cell.y, cells: [cell] });
      continue;
    }
    // 与走廊抢格：救援到走廊旁（最近优先），没有则任意空位，都没有才丢弃
    const corridorRoom = out.find((r) => isCorridor(r.name) && r.cells.length);
    if (!corridorRoom) continue;                 // 普通房间互抢 → 丢弃（旧行为，先到先得）
    const near = freeNear(corridorRoom.cells);
    let spot = near.length ? nearest(near, cell) : firstFree();
    if (!spot) continue;                         // 网格满 → 丢弃
    taken.add(keyOf(spot));
    out.push({ ...p, x: spot.x, y: spot.y, cells: [spot] });
  }

  // ---- 第三遍：adjacent 拓扑修复 ----
  const roomIdx = (nm) => {
    let i = out.findIndex((r) => r.name === nm);
    if (i >= 0) return i;
    return out.findIndex((r) => r.name.startsWith(nm));
  };
  const constraints = out.map((r) => {
    const set = [];
    for (const nm of r.adjacent) {
      const i = roomIdx(nm);
      if (i >= 0 && !set.includes(i)) set.push(i);
    }
    return set;
  });
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const isNear = (cells, targets) => cells.some((c) => targets.some((t) => manhattan(c, t) === 1));
  const reloc = (i, targets) => {
    const r = out[i];
    if (!r.cells.length || isCorridor(r.name) || isNear(r.cells, targets)) return;
    const cands = freeNear(targets);
    if (!cands.length) return;
    const spot = nearest(cands, r.cells[0]);
    r.cells.forEach((c) => taken.delete(keyOf(c)));
    taken.add(keyOf(spot));
    r.cells = [spot];
    r.x = spot.x;
    r.y = spot.y;
  };

  const corridorIdx = out.findIndex((r) => isCorridor(r.name));

  // 3a) 声明连走廊的房间 → 贴到走廊旁
  if (corridorIdx >= 0) {
    const cCells = out[corridorIdx].cells;
    for (let i = 0; i < out.length; i++) {
      if (i === corridorIdx) continue;
      if (constraints[i].includes(corridorIdx) || constraints[corridorIdx].includes(i)) {
        reloc(i, cCells);
      }
    }
  }

  // 3b) 走廊门前让位：声明连走廊的房间若仍未贴到走廊旁，而走廊门前
  //     被"未声明连走廊"的普通房间占着格 → 两者交换位置（套内空间不得挡住主房间的走廊门）
  if (corridorIdx >= 0) {
    const cCells = out[corridorIdx].cells;
    const corridorFront = new Set();
    for (const t of cCells) {
      for (const d of DIRS) {
        const nx = t.x + d.x;
        const ny = t.y + d.y;
        if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) corridorFront.add(nx + ',' + ny);
      }
    }
    const wantsCorridor = (r, i) => constraints[i].includes(corridorIdx);
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      if (i === corridorIdx || !r.cells.length || isCorridor(r.name)) continue;
      if (!wantsCorridor(r, i)) continue;
      if (isNear(r.cells, cCells)) continue;                 // 已贴走廊
      let donor = -1;
      for (let j = 0; j < out.length; j++) {
        const o = out[j];
        if (j === corridorIdx || !o.cells.length || isCorridor(o.name)) continue;
        if (wantsCorridor(o, j)) continue;
        if (corridorFront.has(keyOf(o.cells[0]))) { donor = j; break; }
      }
      if (donor < 0) continue;
      const donorCell = out[donor].cells[0];
      const rCell = r.cells[0];
      taken.delete(keyOf(donorCell));
      taken.delete(keyOf(rCell));
      taken.add(keyOf(donorCell));
      taken.add(keyOf(rCell));
      out[donor].cells = [rCell];
      out[donor].x = rCell.x;
      out[donor].y = rCell.y;
      r.cells = [donorCell];
      r.x = donorCell.x;
      r.y = donorCell.y;
    }
  }

  // 3c) 房间两两相邻约束：优先移动"不连走廊"的一方，保护主房间的走廊门
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (!a.cells.length || isCorridor(a.name)) continue;
    for (const j of constraints[i]) {
      if (j <= i) continue;
      const b = out[j];
      if (!b.cells.length || isCorridor(b.name)) continue;
      if (isNear(a.cells, b.cells)) continue;
      const bWantsCorridor = corridorIdx >= 0 && constraints[j].includes(corridorIdx);
      const aWantsCorridor = corridorIdx >= 0 && constraints[i].includes(corridorIdx);
      if (bWantsCorridor && !aWantsCorridor) { reloc(i, b.cells); }
      else { reloc(j, a.cells); }
    }
  }

  // adjacent 只用于修复拓扑，不外露、不落库（保持与 accounts.sanitizeLayout 的输出契约一致）
  for (const r of out) delete r.adjacent;
  return out;
}

function buildVisionPrompt() {
  return `这是一张住宅户型图照片。请识别出图中的房间，并把它们摆进一个 ${GRID}×${GRID} 的方格地图。

【房间名词汇表（尽量只从中选择）】${ROOM_VOCAB.join('、')}

【坐标规则】
- 坐标系：x 向右递增，y 向下递增，取值均为 0 到 ${GRID - 1} 的整数
- 每个房间占一个格子，用 cells 数组表示，如 "cells":[{"x":2,"y":3}]
- 唯一例外：走廊/过道可以占多个格子，必须是逐格相连的链，如 "cells":[{"x":2,"y":2},{"x":2,"y":3},{"x":2,"y":4}]
- 不同房间不能占用同一个格子
- 同名房间请自行编号区分（如两个卧室分别写 "卧室" 和 "卧室2"）
- 最多识别 ${MAX_ROOMS} 个房间

【相邻关系与动线（重要：程序会按此校验并修正布局）】
- adjacent 列出的是"有门相通"的房间名（只写词表里的名字）；仅仅共墙但没有门的不要列
- 两个互列 adjacent 的房间，其格子必须上下左右紧挨（曼哈顿距离为 1）
- 与走廊相邻的房间，其格子必须紧挨走廊链的某一格
- 【动线规则——先想清楚"人从走廊进入每个房间要经过哪扇门"，再写 adjacent】
  1. 主房间（卧室/客厅/餐厅/厨房/书房等）的门通常直接开向走廊：这些房间的 adjacent 必须写上「走廊」
  2. 套内卫生间（卧室自带的独立卫生间）：门开在卧室里、不直接通走廊 → 它只与卧室相邻
     （adjacent 只写卧室），不要写「走廊」，不要挡在走廊和卧室之间
  3. 公卫（走廊边的公用卫生间）：门开向走廊 → adjacent 写「走廊」
  4. 衣帽间/储物间：通常从卧室或玄关进入，不走走廊门；阳台：从客厅或卧室进入
  5. 一句话：走廊直接相连的一定是主房间；套内空间挂在主房间后面，形成"走廊→主房间→套内"的动线

【输出格式】严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何多余文字：
{"rooms":[{"name":"房间名","cells":[{"x":0,"y":0}],"adjacent":["相邻房间名"],"desc":"可选的简短说明"}],"note":"一句话说明识别到的户型概况"}

如果图片看不清或不是户型图，返回 {"rooms":[],"note":"原因说明"}。`;
}

// 从任意文本中提取首个 JSON 对象（容忍 markdown 代码块 / 前后废话）
// 与 reason/llm.client.js 的 extractJson 同策略，但模块间不互相 require（遵守模块边界铁律）
function extractJson(text) {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* 继续尝试裸 JSON */ } }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(t.slice(first, last + 1));
  }
  return JSON.parse(t);
}

function visionReady(cfg) {
  return !!(cfg && cfg.enabled && cfg.apiKey && cfg.baseUrl && cfg.model);
}

// 单次视觉调用：OpenAI 兼容的多模态 messages 格式（content 为数组）
async function callVision(cfg, imageBase64, mimeType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 40000);
  try {
    const url = String(cfg.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
    // DeepSeek V4 系视觉模型（deepseek-v4-flash-vision-exp 实测）支持 thinking:{type:'disabled'}：
    // 关掉思维链后 content 直接输出 JSON，省 token 省时间。
    // 仅对 deepseek 系模型加该参数；OpenAI 系（gpt-4o 等）遇到未知字段会返回 400，故不加。
    const extraBody = /deepseek/i.test(String(cfg.model || '')) ? { thinking: { type: 'disabled' } } : {};
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildVisionPrompt() },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        }],
        temperature: 0.2,      // 识图任务要稳定，低温
        max_tokens: 1200,
        stream: false,
        ...extraBody
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      // 只记状态码，不记响应体（可能回显图片内容）
      // eslint-disable-next-line no-console
      console.error('[vision] HTTP', resp.status);
      return null;
    }
    const data = await resp.json();
    return data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[vision] 调用失败:', e.name, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 识别户型图照片 → { layout, note }；未配置或失败返回 null
 * 图片仅在内存中转发给模型，不落盘、不写库、不进日志
 */
async function recognizeLayout(cfg, imageBase64, mimeType) {
  if (!visionReady(cfg)) return null;

  let content = await callVision(cfg, imageBase64, mimeType);
  if (!content) {
    await new Promise((r) => setTimeout(r, 800));           // 简单退避
    content = await callVision(cfg, imageBase64, mimeType); // 重试一次
  }
  if (!content) return null;

  try {
    const raw = extractJson(content);
    const layout = normalizeLayout(raw);
    return {
      layout,
      note: String((raw && raw.note) || '').slice(0, 200),
      model: cfg.model
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[vision] 输出解析失败:', e.message);
    return null;
  }
}

module.exports = {
  recognizeLayout,
  normalizeLayout,
  alignRoomName,
  extractJson,
  visionReady,
  buildVisionPrompt,
  ROOM_VOCAB,
  GRID,
  MAX_ROOMS
};
