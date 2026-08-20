// test/data.service.test.js — 数据服务单元测试（时段分桶/洞察）
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { timeBucket, TIME_BUCKETS } = require('../src/modules/data/data.service');

test('时段分桶边界', () => {
  const t = (h) => timeBucket(`2026-08-20T${String(h).padStart(2, '0')}:00:00`);
  assert.strictEqual(t(6), '早上');
  assert.strictEqual(t(9), '上午');
  assert.strictEqual(t(12), '中午');
  assert.strictEqual(t(15), '下午');
  assert.strictEqual(t(20), '晚上');
  assert.strictEqual(t(23), '深夜');
  assert.strictEqual(t(3), '深夜');
});

test('时段桶常量顺序', () => {
  assert.deepStrictEqual(TIME_BUCKETS, ['早上', '上午', '中午', '下午', '晚上', '深夜']);
});
