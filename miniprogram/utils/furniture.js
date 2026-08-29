// utils/furniture.js — 房间内部搜查位置（与 Web 端 home.view.js 一致）：
// 已配置的家具模块（furn，精确到格）优先，未配置时回退到常见家具清单
const ROOM_FURNITURE = {
  '卧室': ['床', '床头柜', '书桌/电脑桌', '衣柜', '窗台', '梳妆台'],
  '卫生间': ['洗手台', '马桶', '浴室置物架/镜柜', '毛巾架', '洗衣机', '浴缸/淋浴间'],
  '客厅': ['沙发', '茶几', '电视柜', '置物架', '地毯'],
  '厨房': ['操作台', '灶台', '水槽', '冰箱', '橱柜'],
  '厨房/餐厅': ['操作台', '餐桌', '灶台', '冰箱', '橱柜'],
  '餐厅': ['餐桌', '餐椅', '餐边柜'],
  '书房': ['书桌/电脑桌', '书架', '文件柜', '窗台'],
  '玄关': ['鞋柜', '挂钩', '换鞋凳'],
  '走廊': ['鞋柜/矮柜', '挂钩', '窗台'],
  '阳台': ['洗衣机', '晾衣架', '窗台', '置物架'],
  '衣帽间': ['衣柜', '置物架', '抽屉柜'],
  '储物间': ['货架', '储物箱', '抽屉柜']
};

const FURNITURE_EMOJI = {
  '床': '🛏️', '床头柜': '🗄️', '书桌/电脑桌': '🖥️', '衣柜': '👕', '窗台': '🪟', '梳妆台': '🪞',
  '洗手台': '🚰', '马桶': '🚽', '浴室置物架/镜柜': '🪞', '毛巾架': '🧺', '洗衣机': '🧺', '浴缸/淋浴间': '🛁',
  '沙发': '🛋️', '茶几': '🪑', '电视柜': '📺', '置物架': '🗄️', '地毯': '🧶',
  '操作台': '🍳', '灶台': '🍳', '水槽': '🚰', '冰箱': '🧊', '橱柜': '🗄️',
  '餐桌': '🍽️', '餐椅': '🪑', '餐边柜': '🗄️',
  '书架': '📚', '文件柜': '🗄️',
  '鞋柜': '👟', '鞋柜/矮柜': '👟', '挂钩': '🧷', '换鞋凳': '🪑',
  '晾衣架': '🧺', '货架': '🗄️', '储物箱': '📦', '抽屉柜': '🗄️',
  '地面': '🧹', '桌面': '🪑'
};

function furnitureEmoji(name) {
  // 同名物件自动编号（书桌2/书桌3…）：按基础名查 emoji
  return FURNITURE_EMOJI[String(name || '').replace(/\d+$/, '')] || '🪑';
}

// 常见家具清单：该房间类型的常见家具 + 用户画像里填写的常用位置（去重）
function furnitureFor(room) {
  const key = ROOM_FURNITURE[room.name] ? room.name : String(room.name || '').replace(/\d+$/, '');
  const base = ROOM_FURNITURE[key] || ['置物架', '抽屉柜', '桌面', '地面'];
  const extra = (room.spots || []).filter((s) => !base.includes(s));
  return [...new Set([...base, ...extra])];
}

// 搜查位置：优先用房间内部布局（furn 家具模块，精确到格），未配置时回退到常见家具清单
function searchPositionsFor(room) {
  const interior = (room.furn || []).map((f) => f.name).filter((n) => n);
  if (interior.length) return [...new Set(interior)];
  return furnitureFor(room);
}

module.exports = { searchPositionsFor, furnitureEmoji };
