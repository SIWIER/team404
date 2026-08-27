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
 */
function normalizeLayout(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.rooms) ? raw.rooms : []);
  if (!list.length) return [];

  const taken = new Set();     // 全局已占格 "x,y"，实现跨房间让位
  const out = [];

  for (const item of list) {
    if (out.length >= MAX_ROOMS) break;
    const name = alignRoomName(item && item.name);
    if (!name) continue;

    // 收集候选格：优先 cells，退化到 x/y 单格
    let cells = [];
    if (item && Array.isArray(item.cells) && item.cells.length) {
      cells = item.cells;
    } else if (item && item.x !== undefined && item.y !== undefined) {
      cells = [{ x: item.x, y: item.y }];
    }

    // 裁剪 + 数值校验 + 房间内去重
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

    // 非走廊房间只占一格（与编辑器行为一致：改名离开走廊会塌缩）
    if (!isCorridor(name)) {
      valid = valid.slice(0, 1);
    } else {
      valid = pickConnected(valid).slice(0, GRID * GRID);
    }

    // 跨房间让位：剔除已被先前房间占用的格
    valid = valid.filter((c) => !taken.has(c.x + ',' + c.y));
    if (!valid.length) continue;   // 全被占完 → 丢弃该房间（用户可在编辑器手动补）
    valid.forEach((c) => taken.add(c.x + ',' + c.y));

    const spots = Array.isArray(item && item.spots)
      ? item.spots.slice(0, MAX_SPOTS).map((s) => String(s).trim().slice(0, 30)).filter(Boolean)
      : [];

    out.push({
      name,
      desc: String((item && item.desc) || '').trim().slice(0, 100),
      spots,
      x: valid[0].x,
      y: valid[0].y,
      cells: valid
    });
  }

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
- 相邻房间在图中相邻，就让它们的格子也相邻；尽量还原真实的相对方位
- 最多识别 ${MAX_ROOMS} 个房间；同名房间（如两个卧室）可以重复出现

【输出格式】严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何多余文字：
{"rooms":[{"name":"房间名","cells":[{"x":0,"y":0}],"desc":"可选的简短说明"}],"note":"一句话说明识别到的户型概况"}

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
