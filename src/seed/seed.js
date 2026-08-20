// src/seed/seed.js — 预置演示数据（各部分幂等：仅在对应表为空时写入）
'use strict';
const { getDb } = require('../core/db');
const accounts = require('../modules/accounts/accounts.service');
const logger = require('../core/logger');

function iso(daysAgo, hour) {
  return new Date(Date.now() - daysAgo * 86400000 - hour * 3600000).toISOString();
}

function seedUsers() {
  const db = getDb();
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;

  const demoUsers = [
    { username: 'xiaoming', password: '123456', nickname: '小明', profile: {
      agentName: '小明的小镜助手', agentStyle: '温和耐心，爱追问细节，擅长结合生活常识推理',
      habits: ['睡前喜欢刷手机，常随手把眼镜放床头', '出门前常一边找钥匙一边找眼镜', '习惯在书桌前办公'],
      favoritePlaces: ['床头柜', '书桌/电脑桌', '沙发缝隙/靠垫间'],
      homeLayout: [
        { name: '卧室', desc: '1.5 米床，床头有床头柜', spots: ['床头柜', '书桌/电脑桌', '窗台'], x: 0, y: 0 },
        { name: '卫生间', desc: '干湿分离', spots: ['洗手台边', '浴室置物架/镜柜'], x: 1, y: 0 },
        { name: '客厅', desc: '三人沙发 + 茶几', spots: ['沙发缝隙/靠垫间', '茶几'], x: 2, y: 0 },
        { name: '厨房/餐厅', desc: '开放式', spots: ['餐桌', '厨房操作台'], x: 1, y: 1 },
        { name: '书房', desc: '有书架和电脑桌', spots: ['书架'], x: 2, y: 1 }
      ],
      notes: '近视 300 度，只有一副眼镜，丢了很着急'
    } },
    { username: 'xiaohong', password: '123456', nickname: '小红', profile: {
      agentName: '小红的小镜助手', agentStyle: '细致有条理，优先结合她高频地点判断',
      habits: ['化妆护肤后常把眼镜放洗手台', '睡前眼镜必须放床头柜'],
      favoritePlaces: ['洗手台边', '床头柜'],
      homeLayout: [
        { name: '卧室', desc: '带飘窗', spots: ['床头柜', '飘窗'], x: 0, y: 0 },
        { name: '卫生间', desc: '', spots: ['洗手台边'], x: 1, y: 0 },
        { name: '客厅', desc: '', spots: [], x: 2, y: 0 },
        { name: '厨房/餐厅', desc: '', spots: ['厨房操作台'], x: 1, y: 1 },
        { name: '玄关', desc: '有鞋柜', spots: ['鞋柜'], x: 3, y: 0 },
        { name: '走廊', desc: '连接卧室与客厅', spots: ['走廊挂钩'], x: 3, y: 1 }
      ],
      notes: '低度近视，有时会忘记自己把眼镜推到了头顶'
    } }
  ];

  for (const d of demoUsers) {
    const r = accounts.register(d);
    if (r.error) { logger.warn('[seed] 注册失败:', r.error); continue; }
    accounts.updateProfile(r.user.id, d.profile);
    logger.info(`[seed] 已创建演示账号 ${d.username} / ${d.password}`);
  }
}

function seedLossRecords() {
  const db = getDb();
  if (db.prepare('SELECT COUNT(*) AS c FROM loss_records').get().c > 0) return;

  const byName = (uname) => {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
    return u ? u.id : null;
  };
  const ins = db.prepare(`INSERT INTO loss_records
    (user_id, started_at, ended_at, found_location, found_room, confidence, success, clues, reasoning, duration_sec)
    VALUES (?,?,?,?,?,?,1,?,?,?)`);

  const datasets = {
    xiaoming: [
      [1, 22, '床头柜', '卧室', 88, 130, '睡觉前随手放'],
      [4, 8, '洗手台边', '卫生间', 74, 210, '早上洗漱摘了眼镜'],
      [7, 21, '沙发缝隙/靠垫间', '客厅', 81, 300, '看电视时摘下'],
      [10, 23, '床/被窝里', '卧室', 79, 150, '躺床上玩手机睡着'],
      [13, 9, '书桌/电脑桌', '卧室', 90, 90, '在家办公摘眼镜'],
      [16, 20, '外套口袋', '随身', 66, 240, '出门回来塞口袋'],
      [19, 7, '头顶上', '随身', 71, 45, '其实一直架在头顶'],
      [22, 13, '餐桌', '厨房/餐厅', 69, 180, '吃午饭随手放'],
      [25, 22, '床头柜', '卧室', 85, 160, '睡前刷手机又放床头'],
      [28, 8, '浴室置物架/镜柜', '卫生间', 77, 200, '洗澡前摘了']
    ],
    xiaohong: [
      [2, 9, '洗手台边', '卫生间', 82, 150, '早上护肤摘了眼镜'],
      [5, 22, '床头柜', '卧室', 91, 100, '睡前放床头'],
      [11, 21, '床头柜', '卧室', 89, 120, '睡前放床头'],
      [17, 8, '头顶上', '随身', 68, 60, '一直架在头顶'],
      [23, 12, '厨房操作台', '厨房/餐厅', 70, 190, '做饭摘了放台面'],
      [26, 22, '床头柜', '卧室', 90, 110, '睡前放床头']
    ]
  };

  let n = 0;
  for (const [uname, recs] of Object.entries(datasets)) {
    const uid = byName(uname);
    if (!uid) continue;
    for (const [d, h, loc, room, conf, dur, act] of recs) {
      const started = iso(d, h);
      ins.run(uid, started, iso(d, h + Math.round(dur / 3600 * 2)), loc, room, conf,
        JSON.stringify({ activity: act }), `通过引导推理定位到「${loc}」`, dur);
      n++;
    }
  }
  logger.info(`[seed] 已预置 ${n} 条历史找回记录`);
}

function seed() {
  seedUsers();
  seedLossRecords();
}

module.exports = { seed };
