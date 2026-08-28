// src/modules/items/items.vision.js — 图文识别：拍照 → 识别物品文字信息（名称/描述/建议位置）
// 团队决策①"图文"：用户拍一张物品照片，视觉模型读出物品名称、外观描述与建议存放位置，
// 回填到录入表单（用户可改），确认后才走 POST /api/items 落库。
// 设计要点（与 layout 模块同策略、各自实现，遵守"模块间不互相 require"铁律）：
// 1) 只识别不落库、不写日志：图片仅在内存中转发给视觉模型
// 2) 调用失败/超时/解析异常一律返回 null，由路由层转成友好错误
// 3) 复用 LLM_VISION_* 配置（与户型识别同一视觉模型，接口互不影响）
'use strict';

// 房间词表与别名（与 layout.service / 小程序户型编辑器保持一致，保证回填的房间名能被位置选择器认到）
const ROOM_VOCAB = ['卧室', '卫生间', '客厅', '厨房', '餐厅', '书房', '玄关', '走廊', '阳台', '衣帽间', '储物间'];
const ROOM_ALIAS = {
  主卧: '卧室', 次卧: '卧室', 儿童房: '卧室', 卫浴: '卫生间', 洗手间: '卫生间', 厕所: '卫生间',
  浴室: '卫生间', 起居室: '客厅', 饭厅: '餐厅', 用餐区: '餐厅', 书屋: '书房', 工作间: '书房',
  办公室: '书房', 门厅: '玄关', 过道: '走廊', 走道: '走廊', 露台: '阳台', 晒台: '阳台',
  杂物间: '储物间', 储藏室: '储物间', 收纳间: '储物间'
};

const MAX_NAME = 40;   // 与 items 表录入上限一致
const MAX_DESC = 200;
const MAX_POS = 20;    // room/furn/subPos 各自上限

function s(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

// 模型给的房间名对齐到词表（回填位置选择器时能自动命中户型里的房间）
function alignRoomName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, '');
  if (!name) return '';
  if (ROOM_VOCAB.includes(name)) return name;
  if (ROOM_ALIAS[name]) return ROOM_ALIAS[name];
  for (const v of ROOM_VOCAB) if (name.includes(v)) return v;
  for (const [alias, v] of Object.entries(ROOM_ALIAS)) if (name.includes(alias)) return v;
  return name.slice(0, MAX_POS);   // 词表外也保留（自定义房间），交给用户确认
}

function buildItemPrompt() {
  return `你是一个物品识别助手。用户拍摄了一张物品照片，请识别照片中的物品并输出它的文字信息。

【输出字段】
- name：物品名称（简短，如"黑色折叠雨伞"、"白色无线鼠标"，不要品牌型号堆砌）
- desc：一句话外观描述（颜色/材质/尺寸/明显特征，便于日后检索）
- room：最可能存放的房间，尽量从词表选：${ROOM_VOCAB.join('、')}；拿不准就留空字符串
- furn：建议收纳家具（如 书桌/书架/床头柜/壁橱/柜子/抽屉），拿不准留空
- subPos：家具内的子位置提示（如 一层/二层/抽屉），拿不准留空
- note：一句话说明识别依据

【输出格式】严格只输出一个 JSON 对象，不要 markdown 代码块，不要任何多余文字：
{"name":"物品名","desc":"描述","room":"房间或空","furn":"家具或空","subPos":"子位置或空","note":"识别依据"}
如果照片里看不清或没有物品，返回 {"name":"","note":"原因说明"}。`;
}

// 从任意文本中提取首个 JSON 对象（容忍 markdown 代码块 / 前后废话；与 layout 模块同策略各自实现）
function extractItemJson(text) {
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
    // 关掉思维链后 content 直接输出 JSON。仅对 deepseek 系模型加该参数（OpenAI 系遇未知字段会 400）。
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
            { type: 'text', text: buildItemPrompt() },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
          ]
        }],
        temperature: 0.2,      // 识图任务要稳定，低温
        max_tokens: 400,
        stream: false,
        ...extraBody
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      // 只记状态码，不记响应体（可能回显图片内容）
      // eslint-disable-next-line no-console
      console.error('[items-vision] HTTP', resp.status);
      return null;
    }
    const data = await resp.json();
    return data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[items-vision] 调用失败:', e.name, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 识别物品照片 → { name, desc, room, furn, subPos, note, model }；未配置或失败返回 null
 * 图片仅在内存中转发给模型，不落盘、不写库、不进日志
 */
async function recognizeItem(cfg, imageBase64, mimeType) {
  if (!visionReady(cfg)) return null;

  let content = await callVision(cfg, imageBase64, mimeType);
  if (!content) {
    await new Promise((r) => setTimeout(r, 800));            // 简单退避
    content = await callVision(cfg, imageBase64, mimeType);  // 重试一次
  }
  if (!content) return null;

  try {
    const raw = extractItemJson(content);
    return {
      name: s(raw && raw.name, MAX_NAME),
      desc: s(raw && raw.desc, MAX_DESC),
      room: alignRoomName(raw && raw.room),
      furn: s(raw && raw.furn, MAX_POS),
      subPos: s(raw && raw.subPos, MAX_POS),
      note: s(raw && raw.note, 200),
      model: cfg.model
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[items-vision] 输出解析失败:', e.message);
    return null;
  }
}

module.exports = { recognizeItem, extractItemJson, alignRoomName, visionReady, buildItemPrompt, ROOM_VOCAB };
