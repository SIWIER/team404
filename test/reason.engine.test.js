// test/reason.engine.test.js — 本地常识推理引擎单元测试
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const engine = require('../src/modules/reason/engine');

const noHistory = { total: 0, byLocation: {}, records: [] };
const noProfile = { habits: [], favoritePlaces: [] };

function topNames(result, n = 3) {
  return result.ranked.slice(0, n).map((r) => r.name);
}

test('洗澡 + 卫生间 → 卫生间位置进入前三', () => {
  const r = engine.infer({ activity: '洗澡/冲凉', room: '卫生间', timeOfDay: '晚上' }, noHistory, noProfile);
  assert.strictEqual(r.topLocation, '洗手台边');
  const rooms = topNames(r, 3).map((n) => r.ranked.find((x) => x.name === n).room);
  assert.ok(rooms.includes('卫生间'));
  assert.strictEqual(r.engine, 'local');
});

test('追问“放在置物架/镜柜”→ 该位置大幅上升', () => {
  const base = engine.infer({ activity: '洗澡/冲凉', room: '卫生间' }, noHistory, noProfile);
  const withClue = engine.infer({ activity: '洗澡/冲凉', room: '卫生间', bathPlace: '置物架/镜柜' }, noHistory, noProfile);
  const baseScore = base.ranked.find((x) => x.name === '浴室置物架/镜柜').probability;
  const clueScore = withClue.ranked.find((x) => x.name === '浴室置物架/镜柜').probability;
  assert.ok(clueScore > baseScore);
  assert.strictEqual(withClue.topLocation, '浴室置物架/镜柜');
});

test('换衣服 + 好像放口袋 → 口袋类位置上升', () => {
  const r = engine.infer({ activity: '换衣服', pocket: '好像放口袋了' }, noHistory, noProfile);
  const pocketNames = r.ranked.slice(0, 5).map((x) => x.name).filter((n) => n.includes('口袋'));
  assert.ok(pocketNames.length >= 1);
});

test('还没检查身上 → 头顶上进入前三', () => {
  const r = engine.infer({ activity: '玩手机/打电话', justTookOff: '否', onPerson: '还没检查，我去看看' }, noHistory, noProfile);
  assert.ok(topNames(r, 3).includes('头顶上'));
});

test('个人历史影响：床头柜高频 → 排名上升', () => {
  const hs = { total: 10, byLocation: { '床头柜': { count: 5, freq: 0.5 } }, records: [] };
  const without = engine.infer({ activity: '不确定/忘记了' }, noHistory, noProfile);
  const withHist = engine.infer({ activity: '不确定/忘记了' }, hs, noProfile);
  const a = without.ranked.find((x) => x.name === '床头柜').probability;
  const b = withHist.ranked.find((x) => x.name === '床头柜').probability;
  assert.ok(b > a);
  assert.strictEqual(withHist.topLocation, '床头柜');
});

test('画像常用地点影响：床头柜偏好 → 排名上升', () => {
  const p = { favoritePlaces: ['床头柜'] };
  const without = engine.infer({ activity: '不确定/忘记了' }, noHistory, noProfile);
  const withFav = engine.infer({ activity: '不确定/忘记了' }, noHistory, p);
  assert.ok(withFav.ranked.find((x) => x.name === '床头柜').probability > without.ranked.find((x) => x.name === '床头柜').probability);
});

test('无任何线索 → 输出通用排序且前 8 名概率和为 100', () => {
  const r = engine.infer({}, noHistory, noProfile);
  assert.ok(r.ranked.length >= 5);
  const sum = r.ranked.reduce((a, c) => a + c.probability, 0);
  assert.ok(Math.abs(sum - 100) < 1);
  assert.ok(r.summary.length > 10);
});

// ---------- 户型感知 ----------
const layoutNoXuanGuan = [
  { name: '卧室', desc: '', spots: [] },
  { name: '卫生间', desc: '', spots: [] },
  { name: '客厅', desc: '', spots: [] },
  { name: '厨房', desc: '', spots: [] }
];

test('户型没有玄关 → 「玄关/鞋柜」跌出候选前 8', () => {
  const without = engine.infer({ activity: '回家进门' }, noHistory, noProfile);
  const withLayout = engine.infer({ activity: '回家进门' }, noHistory, { ...noProfile, homeLayout: layoutNoXuanGuan });
  assert.ok(without.ranked.some((x) => x.name === '玄关/鞋柜'));
  assert.ok(!withLayout.ranked.some((x) => x.name === '玄关/鞋柜'));
});

test('户型自定义放置点「飘窗」成为候选并因同房间被加权', () => {
  const p = { ...noProfile, homeLayout: [{ name: '卧室', desc: '', spots: ['飘窗'] }, { name: '卫生间', desc: '', spots: [] }] };
  const r = engine.infer({ activity: '刚起床', room: '卧室' }, noHistory, p);
  const item = r.ranked.find((x) => x.name === '飘窗');
  assert.ok(item, '自定义放置点应出现在候选列表');
  assert.ok(item.reasons.some((t) => t.includes('同房间位置')), '应因同房间加权');
});

test('户型中「厨房」与知识库「厨房/餐厅」区域互通', () => {
  const p = { ...noProfile, homeLayout: layoutNoXuanGuan };
  const base = engine.infer({ activity: '做饭/吃饭' }, noHistory, p);
  const withRoom = engine.infer({ activity: '做饭/吃饭', room: '厨房' }, noHistory, p);
  const baseTop = base.ranked.find((x) => x.name === '厨房操作台');
  const roomTop = withRoom.ranked.find((x) => x.name === '厨房操作台');
  assert.ok(baseTop && roomTop);
  assert.ok(roomTop.probability > baseTop.probability);
});

// ---------- 户型图空间感知（拖拽编辑器坐标） ----------
test('路过房间加权：路过的房间位置概率上升', () => {
  const p = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '客厅', spots: [], x: 1, y: 0 }
  ] };
  const base = engine.infer({ room: '卧室' }, noHistory, p);
  const passed = engine.infer({ room: '卧室', passedRooms: ['客厅'] }, noHistory, p);
  const a = base.ranked.find((x) => x.name === '茶几');
  const b = passed.ranked.find((x) => x.name === '茶几');
  assert.ok(a && b);
  assert.ok(b.probability > a.probability);
  assert.ok(b.reasons.some((t) => t.includes('路过')));
});

test('户型图距离衰减：相邻房间位置权重高于远处房间', () => {
  const nearP = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '卫生间', spots: [], x: 1, y: 0 }
  ] };
  const farP = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '卫生间', spots: [], x: 4, y: 3 }
  ] };
  const near = engine.infer({ room: '卧室' }, noHistory, nearP);
  const far = engine.infer({ room: '卧室' }, noHistory, farP);
  const a = near.ranked.find((x) => x.name === '洗手台边');
  const b = far.ranked.find((x) => x.name === '洗手台边');
  assert.ok(a && b);
  assert.ok(a.probability > b.probability);
  assert.ok(a.reasons.some((t) => t.includes('相距 1 格')));
  assert.ok(b.reasons.some((t) => t.includes('离得较远')));
});

test('定位提示按户型图距离衰减：邻近房间加权，远处不加', () => {
  const p = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '卫生间', spots: [], x: 1, y: 0 },
    { name: '书房', spots: [], x: 4, y: 3 }
  ] };
  // 距离计算：曼哈顿距离
  assert.strictEqual(engine.roomDist(p.homeLayout, '卧室', '卫生间'), 1);
  assert.strictEqual(engine.roomDist(p.homeLayout, '卧室', '书房'), 7);
  const r = engine.infer({ deviceHint: { room: '卧室', distance_m: 2 } }, noHistory, p);
  const bath = r.ranked.find((x) => x.name === '洗手台边');
  assert.ok(bath.reasons.some((t) => t.includes('定位器')));
  assert.ok(bath.reasons.some((t) => t.includes('相距 1 格')));
  // 非卧室/非邻近房间不应获得定位提示加权
  const far = r.ranked.filter((x) => x.room !== '卧室' && x.room !== '卫生间');
  assert.ok(far.length >= 0);
  for (const item of far) {
    assert.ok(!item.reasons.some((t) => t.includes('定位器')), `${item.name} 不应有定位器加权`);
  }
});

// ---------- 走廊房间 ----------
test('回家进门：有走廊的户型走廊位置进入候选，无走廊则降权', () => {
  const withHall = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '客厅', spots: [], x: 1, y: 0 },
    { name: '走廊', spots: [], x: 2, y: 0 }
  ] };
  const withoutHall = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '客厅', spots: [], x: 1, y: 0 }
  ] };
  const a = engine.infer({ activity: '回家进门' }, noHistory, withHall);
  const b = engine.infer({ activity: '回家进门' }, noHistory, withoutHall);
  assert.ok(a.ranked.some((x) => x.name === '走廊矮柜/鞋柜'));
  assert.ok(!b.ranked.some((x) => x.name === '走廊矮柜/鞋柜'));
});
// ---------- 已检查区域（勾选排除） ----------
test('勾选已检查区域 → 该房间候选大幅降权并给出理由', () => {
  const base = engine.infer({ activity: '洗澡/冲凉', room: '卫生间', timeOfDay: '晚上' }, noHistory, noProfile);
  const checked = engine.infer({ activity: '洗澡/冲凉', room: '卫生间', timeOfDay: '晚上', checkedRooms: ['卫生间'] }, noHistory, noProfile);
  assert.strictEqual(base.topLocation, '洗手台边');
  const baseBath = base.ranked.find((x) => x.name === '洗手台边');
  const checkedBath = checked.ranked.find((x) => x.name === '洗手台边');
  assert.ok(baseBath, '基准场景应包含洗手台边候选');
  assert.strictEqual(checkedBath, undefined, '已检查卫生间后洗手台边应跌出候选前 8');
  assert.notStrictEqual(checked.topRoom, '卫生间', '已检查卫生间后首推不应再是卫生间');
  assert.ok(checked.summary.includes('排除'));
});

test('勾选「厨房」→ 「厨房/餐厅」家族位置同样降权', () => {
  const base = engine.infer({ activity: '做饭/吃饭' }, noHistory, noProfile);
  const checked = engine.infer({ activity: '做饭/吃饭', checkedRooms: ['厨房'] }, noHistory, noProfile);
  const a = base.ranked.find((x) => x.name === '餐桌');
  const b = checked.ranked.find((x) => x.name === '餐桌');
  assert.ok(a, '基准场景应包含餐桌候选');
  assert.strictEqual(b, undefined, '勾选厨房后餐桌应跌出候选前 8');
  assert.notStrictEqual(checked.topRoom, '厨房/餐厅');
});

test('多房间勾选：摘要列出已排除区域', () => {
  const r = engine.infer({ activity: '不确定/忘记了', checkedRooms: ['卧室', '客厅'] }, noHistory, noProfile);
  assert.ok(r.summary.includes('卧室'));
  assert.ok(r.summary.includes('客厅'));
});
test('定位强证据与已检查区域并存：候选仍在但保留已检查提示', () => {
  const p = { ...noProfile, homeLayout: [
    { name: '卧室', spots: [], x: 0, y: 0 },
    { name: '卫生间', spots: [], x: 1, y: 0 }
  ] };
  const r = engine.infer(
    { activity: '洗澡/冲凉', room: '卫生间', deviceHint: { room: '卫生间', distance_m: 1 }, checkedRooms: ['卫生间'] },
    noHistory, p
  );
  const bath = r.ranked.find((x) => x.name === '洗手台边');
  assert.ok(bath, '定位强证据下候选应仍在列表中');
  assert.ok(bath.reasons.some((t) => t.includes('检查过')));
  assert.ok(bath.reasons.some((t) => t.includes('定位器')));
});
// ---------- 复数同类型房间（编号区分） ----------
test('房间类型归一：卧室2/卧室3 → 卧室，厨房/餐厅 不变', () => {
  assert.strictEqual(engine.roomTypeOf('卧室2'), '卧室');
  assert.strictEqual(engine.roomTypeOf('卧室12'), '卧室');
  assert.strictEqual(engine.roomTypeOf('厨房/餐厅'), '厨房/餐厅');
  assert.strictEqual(engine.roomTypeOf('主卧'), '主卧');
});

test('户型含卧室与卧室2：编号房间坐标精确匹配，自定义放置点独立', () => {
  const p = { ...noProfile, homeLayout: [
    { name: '卧室', spots: ['飘窗'], x: 0, y: 0 },
    { name: '卧室2', spots: ['梳妆台'], x: 2, y: 1 },
    { name: '客厅', spots: [], x: 1, y: 0 }
  ] };
  assert.strictEqual(engine.roomDist(p.homeLayout, '卧室', '客厅'), 1);
  assert.strictEqual(engine.roomDist(p.homeLayout, '卧室2', '客厅'), 2);
  const r = engine.infer({ room: '卧室2' }, noHistory, p);
  const desk = r.ranked.find((x) => x.name === '梳妆台');
  assert.ok(desk, '卧室2 的自定义放置点应成为候选');
  assert.ok(desk.reasons.some((t) => t.includes('卧室2')), '应提示与卧室2 同房间');
});

test('勾选「卧室2」→ 卧室2 与同类型卧室位置跌出候选前 8', () => {
  const p = { ...noProfile, homeLayout: [
    { name: '卧室', spots: ['飘窗'], x: 0, y: 0 },
    { name: '卧室2', spots: ['梳妆台'], x: 2, y: 1 },
    { name: '客厅', spots: [], x: 1, y: 0 }
  ] };
  const r = engine.infer({ room: '卧室2', checkedRooms: ['卧室2'] }, noHistory, p);
  const names = r.ranked.map((x) => x.name);
  assert.ok(!names.includes('梳妆台'), '卧室2 放置点应跌出前 8');
  assert.ok(!names.includes('飘窗'), '同类型卧室的放置点应按类型归并降权');
  assert.ok(r.summary.includes('卧室2'));
});

// ---------- 走廊多格链（cells） ----------
const corridorLayout = [
  { name: '走廊', spots: ['走廊挂钩'], x: 2, y: 2, cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }] },
  { name: '卫生间', spots: [], x: 3, y: 4 },
  { name: '书房', spots: [], x: 4, y: 4 }
];

test('多格走廊：距离取最近格（而非锚点格）', () => {
  // 卫生间(3,4) 距走廊最近格 (2,4)=1；距锚点(2,2)=3
  assert.strictEqual(engine.roomDist(corridorLayout, '走廊', '卫生间'), 1);
  // 书房(4,4) 距走廊最近格 (2,4)=2；距锚点(2,2)=4
  assert.strictEqual(engine.roomDist(corridorLayout, '走廊', '书房'), 2);
});

test('多格走廊：定位提示按最近格加权相邻房间', () => {
  const p = { ...noProfile, homeLayout: corridorLayout };
  const r = engine.infer({ deviceHint: { room: '走廊', distance_m: 3 } }, noHistory, p);
  const bath = r.ranked.find((x) => x.name === '洗手台边');
  assert.ok(bath, '卫生间位置应在候选');
  assert.ok(bath.reasons.some((t) => t.includes('定位器')));
  assert.ok(bath.reasons.some((t) => t.includes('相距 1 格')));
});

test('同房间面积加成：多格走廊的同房间权重高于单格（同一布局对照）', () => {
  const single = { ...noProfile, homeLayout: [
    { name: '走廊', spots: [], x: 2, y: 2, cells: [{ x: 2, y: 2 }] },
    { name: '卫生间', spots: [], x: 3, y: 4 },
    { name: '书房', spots: [], x: 4, y: 4 }
  ] };
  const multi = { ...noProfile, homeLayout: corridorLayout };
  const a = engine.infer({ room: '走廊' }, noHistory, single);
  const b = engine.infer({ room: '走廊' }, noHistory, multi);
  const locA = a.ranked.find((x) => x.name === '走廊矮柜/鞋柜');
  const locB = b.ranked.find((x) => x.name === '走廊矮柜/鞋柜');
  assert.ok(locA && locB);
  assert.ok(locB.probability > locA.probability);
  assert.ok(locB.reasons.some((t) => t.includes('面积加成')));
});
