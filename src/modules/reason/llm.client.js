// src/modules/reason/llm.client.js — 大模型客户端（OpenAI 兼容）+ 结构化输出解析
// 失败/超时/解析异常一律返回 null，由服务层回退到本地引擎
'use strict';
const { LOCATIONS, LOCATION_INDEX } = require('./knowledge');

const vocabText = LOCATIONS.map((l) => `${l.name}(${l.room})`).join('、');

function buildPrompt(facts, historyStats, profile) {
  const historyTop = Object.entries(historyStats.byLocation || {})
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([k, v]) => `${k}:${v.count}次`)
    .join('，');
  const habits = (profile.habits || []).join('、') || '未填写';
  const favs = (profile.favoritePlaces || []).join('、') || '未填写';
  const layoutText = (profile.homeLayout || []).length
    ? profile.homeLayout.map((r) => `${r.name}${r.x != null && r.y != null ? `(网格${r.x},${r.y})` : ''}${r.spots && r.spots.length ? `（常放：${r.spots.join('、')}）` : ''}${r.desc ? `【${r.desc}】` : ''}`).join('；')
    : '未填写（按通用户型考虑）';

  const system = '你是一名帮人在家中找回丢失眼镜的生活常识与逻辑推理助手，熟悉居家生活常识。请基于用户本次描述与其历史找回记录，推理眼镜最可能的位置。';
  const user = `【可选位置词汇表（必须尽量从中选择）】${vocabText}

【用户本次情况】
- 最后做的事：${facts.activity || '不确定'}
- 最后所在房间：${facts.room || '不确定'}
- 大概时段：${facts.timeOfDay || '不确定'}
- 是否刚摘下随手放：${facts.justTookOff || '不确定'}
- 卫生间具体位置线索：${facts.bathPlace || '无'}
- 是否可能放进口袋：${facts.pocket || '不确定'}
- 是否已检查身上：${facts.onPerson || '未提及'}
- 路过过的房间：${(Array.isArray(facts.passedRooms) && facts.passedRooms.length) ? facts.passedRooms.join('、') : '未提及'}（路过的房间也可能随手放下）
- 已检查过的区域（在这些区域找过但没找到，推理时应排除其所在房间）：${(Array.isArray(facts.checkedRooms) && facts.checkedRooms.length) ? facts.checkedRooms.join('、') : '未提及'}
- 硬件定位提示：${facts.deviceHint ? `定位器最近报告眼镜在「${facts.deviceHint.room}」${facts.deviceHint.distance_m != null ? `约 ${facts.deviceHint.distance_m} 米` : ''}（这是强证据，请优先考虑该房间及邻近房间）` : '无'}
- 补充描述：${facts.extra || '无'}

【用户历史找回统计】
- 总找回次数：${historyStats.total}
- 历史高频位置：${historyTop || '暂无'}

【用户个人画像】
- 生活习惯：${habits}
- 常用放眼镜地点：${favs}
- 家庭户型（含网格坐标，相邻格表示相邻房间，推理时请按距离远近考虑）：${layoutText}

请严格只输出一个 JSON 对象（不要 markdown 代码块，不要多余文字），格式如下：
{"topLocation":"位置名","topRoom":"房间","confidence":0到100的数字,"ranked":[{"name":"位置名","room":"房间","probability":数字,"reason":"一句中文依据"}],"summary":"80字以内的中文推理摘要，语气亲切并给出排查顺序"}`;
  return { system, user };
}

async function callChat(cfg, system, user) {
  if (!cfg || !cfg.enabled || !cfg.apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 25000);
  try {
    const url = (cfg.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: cfg.temperature !== undefined ? cfg.temperature : 0.7,
        max_tokens: 900,
        stream: false
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      // eslint-disable-next-line no-console
      console.error('[llm] HTTP', resp.status, errText.slice(0, 300));
      return null;
    }
    const data = await resp.json();
    return data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[llm] 调用失败:', e.name, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 从任意文本中提取首个 JSON 对象（容忍 markdown 代码块/前后废话）
function extractJson(text) {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(t.slice(first, last + 1));
  }
  return JSON.parse(t);
}

// 将模型返回的位置名对齐到词汇表（防跑偏，保证统计口径一致）
function alignName(name) {
  if (!name) return null;
  if (LOCATION_INDEX.has(name)) return name;
  for (const loc of LOCATIONS) {
    if (loc.name.includes(name) || name.includes(loc.name)) return loc.name;
  }
  return null;
}

async function llmInfer(cfg, facts, historyStats, profile) {
  if (!cfg || !cfg.enabled || !cfg.apiKey) return null;
  const { system, user } = buildPrompt(facts, historyStats, profile);

  let content = await callChat(cfg, system, user);
  if (!content) {
    await new Promise((r) => setTimeout(r, 800)); // 简单退避
    content = await callChat(cfg, system, user);  // 重试一次
  }
  if (!content) return null;

  try {
    const raw = extractJson(content);
    if (!raw || !Array.isArray(raw.ranked) || !raw.ranked.length) return null;
    const ranked = raw.ranked
      .map((it) => {
        const name = alignName(it.name) || it.name;
        const loc = LOCATION_INDEX.get(name);
        return {
          name,
          room: loc ? loc.room : (it.room || '其他'),
          probability: Number(it.probability) || 0,
          reason: String(it.reason || '')
        };
      })
      .filter((it) => it.probability > 0)
      .slice(0, 8);
    if (!ranked.length) return null;
    const top = ranked[0];
    return {
      topLocation: top.name,
      topRoom: top.room,
      confidence: Number(raw.confidence) || top.probability,
      ranked,
      summary: String(raw.summary || ''),
      engine: 'llm',
      model: cfg.model
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[llm] 输出解析失败，回退本地引擎:', e.message);
    return null;
  }
}

module.exports = { llmInfer, callChat, extractJson, alignName, buildPrompt };
