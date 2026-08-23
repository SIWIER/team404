// src/modules/layout/layout.routes.js — 户型图识别 HTTP 路由（REST）
// 路由只做参数校验与转调，识别逻辑全在 layout.service.js
'use strict';
const { validate, v } = require('../../core/auth');
const { rateLimit } = require('../../core/ratelimit');
const config = require('../../config');
const svc = require('./layout.service');

// 视觉调用按次计费，限制每 IP 每分钟 5 次，防止额度被刷
const visionLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 });

const MIME_WHITELIST = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
// base64 长度上限：约 1.4MB 原图（*4/3 后仍稳过 core/http.js 的 2MB 请求体限制）
const MAX_BASE64_LEN = 1_900_000;

function registerRoutes(router) {
  // 探测视觉识别是否可用（前端据此决定按钮是否置灰，与微信登录的 wxconfig 同思路）
  router.get('/api/layout/config', async (ctx) => {
    ctx.res.ok({ visionEnabled: svc.visionReady(config.llm.vision) });
  });

  // 识别户型图照片 → 返回候选布局（不落库，由前端确认后调 PUT /api/auth/profile 保存）
  router.post('/api/layout/recognize', visionLimiter, async (ctx) => {
    if (!ctx.user) return ctx.res.error('请先登录', 401);

    if (!svc.visionReady(config.llm.vision)) {
      return ctx.res.error('后端未配置视觉模型，无法识别户型图（可继续手动拖拽编辑）', 503);
    }

    const b = ctx.body || {};
    const errs = validate(b, {
      image: [v.required('请上传户型图照片')],
      mimeType: [v.required('缺少图片类型')]
    });
    if (errs) return ctx.res.json({ ok: false, errors: errs }, 422);

    const mimeType = String(b.mimeType).toLowerCase().trim();
    if (!MIME_WHITELIST.includes(mimeType)) {
      return ctx.res.json({ ok: false, errors: { mimeType: '仅支持 png / jpeg / webp 格式' } }, 422);
    }

    // 去掉可能带的 data URL 前缀，只留裸 base64
    const image = String(b.image).replace(/^data:[^;]+;base64,/, '');
    if (image.length > MAX_BASE64_LEN) {
      return ctx.res.json({ ok: false, errors: { image: '图片过大，请压缩后重试' } }, 422);
    }
    if (!/^[A-Za-z0-9+/=\s]+$/.test(image)) {
      return ctx.res.json({ ok: false, errors: { image: '图片数据格式不正确' } }, 422);
    }

    const r = await svc.recognizeLayout(config.llm.vision, image, mimeType);
    if (!r) return ctx.res.error('识别失败，请换一张更清晰的户型图，或手动拖拽编辑', 502);
    if (!r.layout.length) {
      return ctx.res.json({ ok: false, error: r.note || '没能从图中识别出房间，请换一张更清晰的户型图' }, 422);
    }

    ctx.res.ok({ layout: r.layout, note: r.note, model: r.model });
  });
}

module.exports = { registerRoutes };
