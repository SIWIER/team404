// src/modules/data/data.service.js — 数据统计/洞察/记录管理/导入导出
'use strict';
const { getDb } = require('../../core/db');
const accounts = require('../accounts/accounts.service');

const TIME_BUCKETS = ['早上', '上午', '中午', '下午', '晚上', '深夜'];

function timeBucket(isoStr) {
  const h = new Date(isoStr).getHours();
  if (h >= 5 && h < 8) return '早上';
  if (h >= 8 && h < 11) return '上午';
  if (h >= 11 && h < 13) return '中午';
  if (h >= 13 && h < 17) return '下午';
  if (h >= 17 && h < 22) return '晚上';
  return '深夜';
}

function round(n, d = 1) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function aggregate(rows, key) {
  const map = {};
  for (const r of rows) {
    const k = r[key] || '未知';
    map[k] = (map[k] || 0) + 1;
  }
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// 个人统计 + 智能洞察
function userStats(userId) {
  const db = getDb();
  const all = db.prepare('SELECT * FROM loss_records WHERE user_id = ? ORDER BY id DESC').all(userId);
  const found = all.filter((r) => r.success === 1);
  const total = all.length;
  const successCount = found.length;
  const withDur = found.filter((r) => r.duration_sec != null);
  const avgDur = withDur.length ? Math.round(withDur.reduce((a, r) => a + r.duration_sec, 0) / withDur.length) : null;

  // 近 30 天时间线（按天）
  const now = Date.now();
  const dayMap = {};
  for (const r of all) {
    const t = new Date(r.started_at).getTime();
    if (t && now - t <= 30 * 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      dayMap[day] = (dayMap[day] || 0) + 1;
    }
  }
  const timeline = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0]));

  // 时段分布
  const timeDistMap = {};
  for (const r of all) {
    try {
      const b = timeBucket(r.started_at);
      timeDistMap[b] = (timeDistMap[b] || 0) + 1;
    } catch {}
  }
  const timeDist = TIME_BUCKETS.filter((b) => timeDistMap[b]).map((b) => ({ name: b, count: timeDistMap[b] }));

  // 近 7 天 vs 前 7 天（找回次数趋势）
  const inRange = (r, from, to) => { const t = new Date(r.started_at).getTime(); return t >= from && t < to; };
  const last7 = all.filter((r) => inRange(r, now - 7 * 86400000, now)).length;
  const prev7 = all.filter((r) => inRange(r, now - 14 * 86400000, now - 7 * 86400000)).length;

  const stats = {
    total,
    successCount,
    successRate: total ? round(successCount / total * 100, 0) : 0,
    avgDur,
    last30: timeline.reduce((a, [, c]) => a + c, 0),
    last7,
    prev7,
    topLocations: aggregate(found, 'found_location'),
    roomDist: aggregate(found, 'found_room'),
    timeline,
    timeDist,
    recent: all.slice(0, 10).map(publicRecord)
  };

  return { ...stats, insights: buildInsights(stats) };
}

function publicRecord(r) {
  return {
    id: r.id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    foundLocation: r.found_location,
    foundRoom: r.found_room,
    confidence: r.confidence,
    success: !!r.success,
    durationSec: r.duration_sec,
    clues: (() => { try { return JSON.parse(r.clues || '{}'); } catch { return {}; } })(),
    hasConversation: !!(r.conversation && r.conversation !== '[]')
  };
}

// 全局统计（跨用户，匿名汇总）
function globalStats() {
  const db = getDb();
  const rows = db.prepare('SELECT found_room, success FROM loss_records WHERE success = 1').all();
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  return { total: rows.length, users, roomDist: aggregate(rows, 'found_room') };
}

// 智能洞察（自然语言）
function buildInsights(s) {
  const out = [];
  if (s.total === 0) {
    return ['还没有找回记录：去「找眼镜」完成一次引导推理，数据会在这里积累并反哺推理'];
  }
  const topLoc = s.topLocations[0];
  if (topLoc) {
    out.push(`你的眼镜最常出现在「${topLoc.name}」（${topLoc.count} 次），下次可以先直奔这里`);
  }
  const topRoom = s.roomDist[0];
  if (topRoom) {
    out.push(`${round(topRoom.count / s.successCount * 100, 0)}% 的找回发生在「${topRoom.name}」房间`);
  }
  const topTime = s.timeDist[0];
  if (topTime) {
    out.push(`你最常在「${topTime.name}」时段丢眼镜（${topTime.count} 次），这个时段要多留意随手放`);
  }
  if (s.avgDur != null) {
    const m = Math.floor(s.avgDur / 60);
    out.push(m > 0 ? `平均 ${m} 分 ${s.avgDur % 60} 秒找回，${m <= 5 ? '找得挺快，推理很有效' : '建议优先使用设备定位辅助'}` : `平均 ${s.avgDur} 秒找回，效率很高`);
  }
  if (s.total >= 3) {
    out.push(`近 7 天找回 ${s.last7} 次${s.prev7 > 0 ? `，${s.last7 > s.prev7 ? '比前 7 天增多' : s.last7 < s.prev7 ? '比前 7 天减少' : '与前 7 天持平'}` : ''}`);
  }
  return out.slice(0, 5);
}

// 记录分页
function listRecords(userId, { limit = 10, offset = 0 }) {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) AS c FROM loss_records WHERE user_id = ?').get(userId).c;
  const items = db.prepare('SELECT * FROM loss_records WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(userId, Math.min(Math.max(Number(limit) || 10, 1), 50), Math.max(Number(offset) || 0, 0));
  return { total, items: items.map(publicRecord) };
}

function deleteRecord(userId, id) {
  const db = getDb();
  const info = db.prepare('DELETE FROM loss_records WHERE id = ? AND user_id = ?').run(id, userId);
  return info.changes > 0;
}

// 导出（完整数据快照）
function exportData(userId) {
  const db = getDb();
  const user = accounts.getPublicUser(userId);
  const records = db.prepare('SELECT * FROM loss_records WHERE user_id = ? ORDER BY id ASC').all(userId)
    .map(publicRecord);
  return {
    app: 'find-my-glasses',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { username: user.username, nickname: user.nickname, profile: user.profile },
    records
  };
}

// 导入（校验并插入）
function importData(userId, records) {
  if (!Array.isArray(records)) return { error: '数据格式不正确（应为记录数组）' };
  if (records.length > 200) return { error: '单次最多导入 200 条' };
  const db = getDb();
  const ins = db.prepare(`
    INSERT INTO loss_records
      (user_id, started_at, ended_at, found_location, found_room, confidence, success, clues, reasoning, duration_sec, conversation)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  let imported = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const r of records) {
      const loc = String((r && r.foundLocation) || '').trim();
      if (!loc || loc.length > 100) { skipped++; continue; }
      const room = String((r && r.foundRoom) || '').trim().slice(0, 50);
      const started = String((r && r.startedAt) || new Date().toISOString()).slice(0, 40);
      ins.run(
        userId, started,
        (r.endedAt && String(r.endedAt).slice(0, 40)) || null,
        loc, room || null,
        (r.confidence != null && Number.isFinite(Number(r.confidence))) ? Number(r.confidence) : null,
        r.success === false ? 0 : 1,
        JSON.stringify(r.clues && typeof r.clues === 'object' ? r.clues : {}),
        String((r && r.reasoning) || '').slice(0, 2000),
        (r.durationSec != null && Number.isFinite(Number(r.durationSec))) ? Number(r.durationSec) : null,
        JSON.stringify(Array.isArray(r.conversation) ? r.conversation.slice(0, 50) : [])
      );
      imported++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { error: '导入失败：' + e.message };
  }
  return { imported, skipped };
}

module.exports = { userStats, globalStats, listRecords, deleteRecord, exportData, importData, timeBucket, TIME_BUCKETS };
