// src/modules/items/items.routes.js — 物品管理 HTTP 路由（REST）
// P1：录入/文字检索/取图/删除；P2：图文识别（recognize）、图图/文图向量检索（search-image）、能力探测（config）
// 路由只做参数校验与转调，逻辑全在 service / vision / clip
'use strict';
const { validate, v } = require('../../core/auth');
const { rateLimit } = require('../../core/ratelimit');
const config = require('../../config');
const svc = require('./items.service');
const vision = require('./items.vision');
const clip = require('./items.clip');

// 图文识别走视觉模型按次计费，限制每 IP 每分钟 5 次。
// keyFn 必须带命名空间：core/ratelimit 的桶按 key 计数，若与登录限流共用纯 IP 桶会互相串扰
// （本接口 5 次/分 vs 登录 20 次/分），登录几次就会把识别额度顶掉。
const recognizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyFn: (ctx) => {
    const fwd = ctx.req.headers['x-forwarded-for'];
    const ip = fwd ? String(fwd).split(',')[0].trim() : (ctx.req.socket.remoteAddress || 'unknown');
    return 'items:recognize:' + ip;
  }
});

const MIME_WHITELIST = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
// base64 长度上限：约 1.4MB 原图（*4/3 后仍稳过 core/http.js 的 2MB 请求体限制）
const MAX_BASE64_LEN = 1_900_000;
// 向量检索返回条数（clip.TOP_N）
const SEARCH_TOP_N = 10;

function requireUser(ctx) {
  if (!ctx.user) { ctx.res.error('请先登录', 401); ctx.ended = true; return false; }
  return true;
}

// 图片字段通用校验：mime 白名单 + base64 体积与字符集（识别/图图检索共用）
function imageErrors(b) {
  const errs = {};
  if (!b.image) { errs.image = '请上传物品照片'; return errs; }
  const mimeType = String(b.mimeType || '').toLowerCase().trim();
  if (!MIME_WHITELIST.includes(mimeType)) { errs.mimeType = '仅支持 png / jpeg / webp 格式'; return errs; }
  const image = String(b.image).replace(/^data:[^;]+;base64,/, '');
  if (image.length > MAX_BASE64_LEN) { errs.image = '图片过大，请压缩后重试'; return errs; }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(image)) { errs.image = '图片数据格式不正确'; return errs; }
  return null;
}

function stripBase64(b64) {
  return String(b64 || '').replace(/^data:[^;]+;base64,/, '');
}

function registerRoutes(router) {
  // 能力探测：前端据此把「图文识别」「图找物/文找物」按钮置灰（与 /api/layout/config、wxconfig 同思路）
  router.get('/api/items/config', (ctx) => {
    ctx.res.ok({
      recognizeEnabled: vision.visionReady(config.llm.vision),
      clipEnabled: clip.ready(config.clip)
    });
  });

  // 录入物品（图片 base64 + 三级位置；名称可空，由前端图文识别预填）
  router.post('/api/items', (ctx) => {
    if (!requireUser(ctx)) return;
    const b = ctx.body || {};
    const errs = validate(b, {
      name: [v.maxLen(40)],
      desc: [v.maxLen(200)],
      room: [v.maxLen(20)],
      furn: [v.maxLen(20)],
      subPos: [v.maxLen(20)]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
    if (!b.name && !b.image) return ctx.res.error('请填写物品名称或上传照片', 422);
    const item = svc.addItem(ctx.user.id, b);
    ctx.res.ok({ item });
  });

  // 检索（文字）：?q=关键词&space_id=可选目录
  router.get('/api/items', (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.res.ok({ items: svc.listItems(ctx.user.id, { q: ctx.query.q, spaceId: ctx.query.space_id }) });
  });

  // 物品图片（base64 JSON，前端拼 data URL）
  router.get('/api/items/:id/image', (ctx) => {
    if (!requireUser(ctx)) return;
    const img = svc.imageBase64(ctx.user.id, ctx.params.id);
    if (!img) return ctx.res.error('物品不存在或无图片', 404);
    ctx.res.ok(img);
  });

  // 删除物品（连同图片文件）
  router.delete('/api/items/:id', (ctx) => {
    if (!requireUser(ctx)) return;
    if (!svc.deleteItem(ctx.user.id, ctx.params.id)) return ctx.res.error('物品不存在', 404);
    ctx.res.ok();
  });

  // 图文识别：拍照 → 物品文字信息（名称/描述/建议位置）。不落库，回填录入表单后由用户确认保存。
  router.post('/api/items/recognize', recognizeLimiter, async (ctx) => {
    if (!requireUser(ctx)) return;

    if (!vision.visionReady(config.llm.vision)) {
      return ctx.res.error('后端未配置视觉模型，无法识别物品（仍可手动填写名称与位置）', 503);
    }

    const b = ctx.body || {};
    const errs = imageErrors(b);
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);

    const r = await vision.recognizeItem(config.llm.vision, stripBase64(b.image), String(b.mimeType).toLowerCase().trim());
    if (!r) return ctx.res.error('识别失败，请换一张更清晰的照片，或手动填写', 502);
    if (!r.name) {
      return ctx.res.json({ ok: false, error: r.note || '没能从照片中识别出物品，请换一张更清晰的照片' }, 422);
    }

    ctx.res.ok({ item: { name: r.name, desc: r.desc, room: r.room, furn: r.furn, subPos: r.subPos }, note: r.note, model: r.model });
  });

  // 图图/文图向量检索：{image(base64)+mimeType} 或 {text} 二选一 → Chinese-CLIP 向量 + 暴力余弦 top10
  router.post('/api/items/search-image', async (ctx) => {
    if (!requireUser(ctx)) return;

    if (!clip.ready(config.clip)) {
      return ctx.res.json({
        ok: false,
        code: 'CLIP_NOT_CONFIGURED',
        error: '向量检索服务未配置（需本地部署 Chinese-CLIP，参考 scripts/clip-server/），文字检索不受影响'
      }, 503);
    }

    const b = ctx.body || {};
    const hasImage = !!b.image;
    const hasText = String(b.text || '').trim() !== '';
    if (hasImage === hasText) {
      return ctx.res.json({ ok: false, errors: { query: '请提供物品照片（图找物）或文字描述（文找物），二选一' } }, 422);
    }

    let vec = null;
    if (hasImage) {
      const errs = imageErrors(b);
      if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);
      vec = await clip.embedImage(config.clip, stripBase64(b.image));
    } else {
      if (String(b.text).trim().length > 100) {
        return ctx.res.json({ ok: false, errors: { text: '描述文字最多 100 字' } }, 422);
      }
      vec = await clip.embedText(config.clip, b.text);
    }
    if (!vec) {
      return ctx.res.json({ ok: false, code: 'CLIP_UNAVAILABLE', error: '向量服务调用失败，请确认 Chinese-CLIP 服务已启动' }, 502);
    }

    const rows = await clip.searchRaw(config.clip, ctx.user.id, vec, b.spaceId, SEARCH_TOP_N);
    ctx.res.ok({
      matchBy: hasImage ? 'image' : 'text',
      results: rows.map((x) => ({
        item: svc.toPublic(x.row),
        score: Math.round(x.score * 1000) / 1000
      }))
    });
  });
}

module.exports = { registerRoutes };
