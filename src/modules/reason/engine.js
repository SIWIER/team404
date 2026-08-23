// src/modules/reason/engine.js — 本地常识推理引擎（离线、确定性，作为 LLM 回退）
// 输入：本次事实 facts + 用户历史统计 historyStats + 个人画像 profile（含户型图坐标）
// 输出：候选位置排序 + 推理依据 + 自然语言摘要
'use strict';
const { LOCATIONS, LOCATION_INDEX, ACTIVITIES, TIME_HINTS } = require('./knowledge');

// 各因素权重（可调）
const W = {
  roomMatch: 1.8,          // 记得最后所在房间 → 同房间位置
  nightBedroom: 1.4,       // 晚上/深夜 → 卧室位置
  historyPerHit: 0.5,      // 历史每找回一次 → ×(1 + n*0.5)，封顶 5 次
  favorite: 1.35,          // 画像常用地点
  deviceHint: 6.0,         // 定位器最近报告 → 该房间位置（强证据，压倒性）
  pocketYes: 2.6,          // 追问：好像放口袋了
  pocketNo: 0.6,           // 追问：没放口袋（压低随身口袋类）
  passedRoom: 1.6,         // 追问：路过过的房间
  checkedRoom: 0.05        // 勾选已检查过的区域 → 该房间概率大幅降低
};

// 户型图网格上的曼哈顿距离 → 乘法器
const ROOM_DIST_BOOST = { 0: 1.8, 1: 1.3, 2: 1.08 }; // 更远 ×0.95
const ROOM_DIST_FAR = 0.95;
const HINT_DIST_BOOST = { 0: 6.0, 1: 1.8, 2: 1.2 };  // 更远不加权

// 条件追问 → 位置乘法器（单一系数，避免与行为加成过度叠加）
const BATH_PLACE_BOOST = {
  '洗手台边': { '洗手台边': 1.8, '浴室置物架/镜柜': 1.15 },
  '置物架/镜柜': { '浴室置物架/镜柜': 2.0, '洗手台边': 1.15 },
  '毛巾架': { '毛巾架': 2.0, '浴室置物架/镜柜': 1.15 }
};
const ON_PERSON_BOOST = { '头顶上': 3.5, '衣领/胸口口袋': 3.0, '外套口袋': 2.2 };

// 房间名去编号：卧室2 → 卧室（复数同类型房间用编号区分，推理按类型归并）
function roomTypeOf(room) {
  return room ? String(room).replace(/\d+$/, '') : room;
}

// 「厨房/餐厅」与独立的「厨房」「餐厅」视为同一区域；同名不同编号的房间视为同类型
function roomMatches(candidateRoom, factRoom) {
  if (!factRoom) return false;
  const c = roomTypeOf(candidateRoom);
  const f = roomTypeOf(factRoom);
  if (c === f) return true;
  return c === '厨房/餐厅' && (f === '厨房' || f === '餐厅');
}
function roomInLayout(room, layoutRooms) {
  return Array.isArray(layoutRooms) && layoutRooms.some((r) => roomMatches(room, r));
}

// 户型图中房间的锚点坐标（兼容 厨房/餐厅 家族；编号房间精确匹配后按类型回退）
function roomPos(layout, room) {
  if (!room || room === '不确定') return null;
  const t = roomTypeOf(room);
  for (const r of layout) {
    if (r && r.x != null && r.y != null && r.name === room) return { x: r.x, y: r.y };
  }
  for (const r of layout) {
    if (r && r.x != null && r.y != null) {
      if (t === '厨房/餐厅' && (r.name === '厨房' || r.name === '餐厅')) return { x: r.x, y: r.y };
      if (roomTypeOf(r.name) === t) return { x: r.x, y: r.y };
    }
  }
  return null;
}

// 户型图中房间的所有网格格（多格走廊链/单格房间；兼容 厨房/餐厅 家族；无坐标 → 空数组）
function roomCells(layout, room) {
  if (!room || room === '不确定') return [];
  const cells = [];
  for (const r of layout) {
    if (!r) continue;
    const nameOk = r.name === room || (room === '厨房/餐厅' && (r.name === '厨房' || r.name === '餐厅'));
    if (!nameOk) continue;
    if (Array.isArray(r.cells) && r.cells.length) {
      r.cells.forEach((c) => { if (c && c.x != null && c.y != null) cells.push({ x: c.x, y: c.y }); });
    } else if (r.x != null && r.y != null) {
      cells.push({ x: r.x, y: r.y });
    }
  }
  return cells;
}

// 两个房间在户型图上的曼哈顿距离：多格房间取「最近格」；任一无坐标 → null
function roomDist(layout, roomA, roomB) {
  const a = roomCells(layout, roomA);
  const b = roomCells(layout, roomB);
  if (!a.length || !b.length) return null;
  let best = Infinity;
  for (const ca of a) {
    for (const cb of b) {
      const d = Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
      if (d < best) best = d;
    }
  }
  return best;
}

// 房间格数（面积近似）；同房间加成按格数小幅放大，封顶 1.5 倍
function areaFactor(layout, room) {
  const n = roomCells(layout, room).length;
  return Math.min(1.5, 1 + 0.15 * (n - 1));
}

function infer(facts, historyStats, profile) {
  facts = facts || {};
  const activity = ACTIVITIES[facts.activity] ? facts.activity : '不确定/忘记了';
  const rule = ACTIVITIES[activity];
  const favPlaces = (profile && profile.favoritePlaces) || [];
  const layout = Array.isArray(profile && profile.homeLayout) ? profile.homeLayout : [];
  const layoutRooms = layout.map((r) => r.name);

  // 候选位置 = 常识词汇表 + 用户户型里的自定义放置点
  const custom = [];
  if (layout.length) {
    for (const room of layout) {
      for (const spot of (room.spots || [])) {
        if (!LOCATION_INDEX.has(spot) && !custom.some((c) => c.name === spot)) {
          custom.push({ name: spot, room: room.name, base: 0.035, tags: ['custom'] });
        }
      }
    }
  }
  const candidates = LOCATIONS.concat(custom);

  const scored = candidates.map((L) => {
    let s = L.base;
    const reasons = [];

    // 1) 行为常识
    const actBoost = rule.boost[L.name];
    if (actBoost) {
      s *= actBoost;
      reasons.push(`行为「${activity}」：${rule.hint}（×${actBoost.toFixed(1)}）`);
    }

    // 2) 条件追问：卫生间具体位置
    if (facts.bathPlace && facts.bathPlace !== '不记得') {
      const b = (BATH_PLACE_BOOST[facts.bathPlace] || {})[L.name];
      if (b) { s *= b; reasons.push(`你记得大概放在「${facts.bathPlace}」附近（×${b.toFixed(2)}）`); }
    }

    // 3) 条件追问：口袋
    if (facts.pocket === '好像放口袋了') {
      if (L.tags.includes('pocket')) { s *= W.pocketYes; reasons.push('你可能把眼镜放进了口袋（×' + W.pocketYes.toFixed(1) + '）'); }
    } else if (facts.pocket === '没有') {
      if (L.tags.includes('pocket')) { s *= W.pocketNo; reasons.push('你记得没放口袋，口袋类位置概率降低'); }
    }

    // 4) 条件追问：是否在身上
    if (facts.onPerson === '还没检查，我去看看') {
      const b = ON_PERSON_BOOST[L.name];
      if (b) { s *= b; reasons.push(`身上的位置还没检查，此类位置概率大幅上升（×${b.toFixed(1)}）`); }
    }

    // 5) 最后所在房间：户型图有坐标时按「距离远近」衰减（多格房间取最近格），否则直接匹配
    const dRoom = roomDist(layout, facts.room, L.room);
    if (dRoom !== null) {
      let mult = ROOM_DIST_BOOST[dRoom] !== undefined ? ROOM_DIST_BOOST[dRoom] : ROOM_DIST_FAR;
      if (dRoom === 0) {
        // 同房间：按格数（面积）小幅放大——房间越大，随手放的概率越高
        mult = W.roomMatch * areaFactor(layout, facts.room);
      }
      s *= mult;
      if (dRoom === 0) reasons.push(`你记得最后在「${facts.room}」，同房间位置 ×${mult.toFixed(2)}（含面积加成）`);
      else if (mult > 1) reasons.push(`你记得最后在「${facts.room}」，此处与它相距 ${dRoom} 格（邻近，×${mult}）`);
      else reasons.push(`你记得最后在「${facts.room}」，此处离得较远（相距 ${dRoom} 格，×${mult}）`);
    } else if (facts.room && facts.room !== '不确定' && roomMatches(L.room, facts.room)) {
      s *= W.roomMatch;
      reasons.push(`你记得最后在「${facts.room}」，同房间位置 ×${W.roomMatch}`);
    }

    // 6) 路过过的房间（多选追问）：途中可能随手放下
    const passed = Array.isArray(facts.passedRooms) ? facts.passedRooms : [];
    if (passed.length && passed.some((p) => roomMatches(L.room, p))) {
      s *= W.passedRoom;
      reasons.push(`你路过过「${L.room}」，途中可能随手放下（×${W.passedRoom}）`);
    }

    // 6b) 已检查过的房间（找过没找到）→ 概率大幅降低
    const checked = Array.isArray(facts.checkedRooms) ? facts.checkedRooms : [];
    if (checked.length && checked.some((c) => roomMatches(L.room, c))) {
      s *= W.checkedRoom;
      reasons.push(`你已经检查过「${L.room}」没找到，基本可排除（×${W.checkedRoom}）`);
    }

    // 7) 户型感知：你家没有的房间 → 降权；自定义放置点已作为候选加入
    if (layout.length && L.room !== '随身' && !roomInLayout(L.room, layoutRooms)) {
      s *= 0.35;
      reasons.push(`你的户型里没有「${L.room}」房间（×0.35）`);
    }
    if (layout.length && L.tags.includes('custom')) {
      s *= 1.15;
      reasons.push('这是你户型中自定义的放置点（×1.15）');
    }

    // 8) 硬件定位提示：按与定位房间的户型图距离衰减（多格房间取最近格）
    if (facts.deviceHint && facts.deviceHint.room) {
      const dText = facts.deviceHint.distance_m != null ? `约 ${facts.deviceHint.distance_m} 米` : '信号已收到';
      const dH = roomDist(layout, facts.deviceHint.room, L.room);
      if (dH !== null) {
        let mult = HINT_DIST_BOOST[dH];
        if (mult && dH === 0) mult = W.deviceHint * areaFactor(layout, facts.deviceHint.room);
        if (mult) {
          s *= mult;
          reasons.push(`📡 定位器报告在「${facts.deviceHint.room}」（${dText}），此处${dH === 0 ? '同房间' : `相距 ${dH} 格`}（×${mult.toFixed(2)}）`);
        }
      } else if (roomMatches(L.room, facts.deviceHint.room)) {
        s *= W.deviceHint;
        reasons.push(`📡 定位器最近报告：眼镜在「${facts.deviceHint.room}」方向（${dText}，×${W.deviceHint}）`);
      }
    }

    // 9) 时段常识
    if (facts.timeOfDay && (facts.timeOfDay === '晚上' || facts.timeOfDay === '深夜') && L.room === '卧室') {
      s *= W.nightBedroom;
      reasons.push(`${facts.timeOfDay}多回卧室，卧室位置 ×${W.nightBedroom}`);
    }

    // 10) 个人历史（个性化依据，权重适中）
    const h = (historyStats.byLocation || {})[L.name];
    if (h && h.count > 0) {
      const mult = 1 + Math.min(h.count, 5) * W.historyPerHit;
      s *= mult;
      reasons.push(`你过去 ${historyStats.total} 次里有 ${h.count} 次在这里找到（×${mult.toFixed(2)}）`);
    }

    // 11) 个人偏好地点
    if (favPlaces.includes(L.name)) {
      s *= W.favorite;
      reasons.push('这是你画像里标记的常用地点（×' + W.favorite + '）');
    }

    return { name: L.name, room: L.room, score: s, reasons };
  });

  // 取前 8 名，并对其归一化（展示为候选内相对概率，和 = 100%）
  const top8 = scored.sort((a, b) => b.score - a.score).slice(0, 8);
  const sum8 = top8.reduce((a, c) => a + c.score, 0) || 1;
  const ranked = top8.map((c) => ({
    ...c,
    probability: Math.round((c.score / sum8) * 1000) / 10
  }));

  const top = ranked[0];
  return {
    topLocation: top.name,
    topRoom: top.room,
    confidence: top.probability,
    ranked,
    activity,
    timeHint: facts.timeOfDay && TIME_HINTS[facts.timeOfDay] ? TIME_HINTS[facts.timeOfDay] : null,
    summary: buildSummary(top, ranked, activity, facts, historyStats),
    engine: 'local'
  };
}

function buildSummary(top, ranked, activity, facts, hs) {
  const checked = Array.isArray(facts.checkedRooms) ? facts.checkedRooms : [];
  const checkedPart = checked.length
    ? `已排除你检查过没找到的「${checked.join('、')}」。`
    : '';
  const histPart = hs && hs.total > 0
    ? `结合你最近 ${hs.total} 次找回记录与本次行为「${activity}」，`
    : `根据生活常识和「${activity}」这一行为，`;
  const timePart = facts.timeOfDay && TIME_HINTS[facts.timeOfDay] ? `（${facts.timeOfDay}：${TIME_HINTS[facts.timeOfDay]}）` : '';
  const topReasons = top.reasons.slice(0, 2).join('；');
  return `${histPart}眼镜最可能在「${top.name}」（${top.room}），置信度约 ${top.probability}%。${timePart} ${checkedPart}主要依据：${topReasons || '通用放置习惯'}。建议优先检查这里，再依次排查：${ranked.slice(1, 4).map((r) => r.name).join('、')}。`;
}

module.exports = { infer, roomDist, roomPos, roomTypeOf, roomCells };
