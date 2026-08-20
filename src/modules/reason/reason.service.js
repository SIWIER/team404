// src/modules/reason/reason.service.js — 引导推理业务逻辑
'use strict';
const { getDb } = require('../../core/db');
const config = require('../../config');
const logger = require('../../core/logger');
const accounts = require('../accounts/accounts.service');
const hardware = require('../hardware/hardware.service');
const engine = require('./engine');
const { llmInfer } = require('./llm.client');

// 用户历史找回统计（供推理与 M3 分析共用）
function historyStats(userId) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT found_location, found_room, success, started_at FROM loss_records WHERE user_id = ? AND success = 1'
  ).all(userId);
  const total = rows.length;
  const byLocation = {};
  for (const r of rows) {
    const loc = r.found_location || '未知';
    byLocation[loc] = (byLocation[loc] || 0) + 1;
  }
  const freq = {};
  for (const k in byLocation) freq[k] = { count: byLocation[k], freq: byLocation[k] / total };
  return { total, byLocation: freq, records: rows };
}

// 核心推理：LLM 优先，失败回退本地常识引擎；自动注入硬件定位提示
async function infer(userId, facts) {
  const profile = accounts.getPublicUser(userId).profile;
  const hs = historyStats(userId);
  facts = { ...(facts || {}) };

  // 硬件联动：若定位器最近有上报，作为强证据注入
  try {
    const hint = hardware.getLastHint();
    if (hint && !facts.deviceHint) facts.deviceHint = hint;
  } catch (e) { logger.warn('[reason] 获取硬件提示失败:', e.message); }

  let result = await llmInfer(config.llm, facts, hs, profile);
  if (!result) {
    result = engine.infer(facts, hs, profile);
    result.engine = 'local-fallback';
    logger.warn(`[reason] LLM 不可用，用户 ${userId} 使用本地引擎`);
  }
  return result;
}

// 保存一次找回结果（成功/未找到都记录，形成数据闭环）
function record(userId, payload) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO loss_records
      (user_id, started_at, ended_at, found_location, found_room, confidence, success, clues, reasoning, duration_sec, conversation)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      userId,
      payload.startedAt || now,
      now,
      payload.foundLocation || null,
      payload.foundRoom || null,
      payload.confidence != null ? Number(payload.confidence) : null,
      payload.success ? 1 : 0,
      JSON.stringify(payload.facts || {}),
      payload.reasoning || '',
      payload.durationSec != null ? Number(payload.durationSec) : null,
      JSON.stringify(payload.conversation || [])
    );
  return { id: Number(info.lastInsertRowid) };
}

module.exports = { historyStats, infer, record };
