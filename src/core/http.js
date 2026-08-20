// src/core/http.js — 轻量路由/中间件/响应封装（基于 Node http）
'use strict';
const logger = require('./logger');

// 响应工具挂在 res 上
function attach(res) {
  res.json = (data, status = 200) => {
    const body = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  };
  res.error = (message, status = 400, extra = {}) => {
    res.json({ error: message, ...extra }, status);
  };
  res.ok = (data = {}) => res.json({ ok: true, ...data });
  return res;
}

// 读取 JSON 请求体（限 2MB）
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { req.destroy(); return resolve({ _tooLarge: true }); }
      data += c;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({ _invalid: true }); }
    });
    req.on('error', () => resolve({}));
  });
}

// 路径模式匹配：/api/user/:id -> {params:{id}, match}
function compile(pattern) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (k) => {
    keys.push(k.slice(1));
    return '([^/]+)';
  }) + '/?$');
  return { keys, regex };
}

class Router {
  constructor() {
    this.routes = [];   // {method, pattern, keys, regex, handlers:[]}
    this.middlewares = [];
  }
  use(fn) { this.middlewares.push(fn); }
  _add(method, pattern, ...handlers) {
    const { keys, regex } = compile(pattern);
    this.routes.push({ method, pattern, keys, regex, handlers });
  }
  get(p, ...h) { this._add('GET', p, ...h); }
  post(p, ...h) { this._add('POST', p, ...h); }
  put(p, ...h) { this._add('PUT', p, ...h); }
  delete(p, ...h) { this._add('DELETE', p, ...h); }

  // 中间件按顺序执行，ctx 可被修改（如 ctx.user）
  async runMiddlewares(ctx, handlers) {
    for (const fn of handlers) {
      if (ctx.ended) return;
      await fn(ctx);
    }
  }

  async handle(req, res) {
    attach(res);
    const url = new URL(req.url, 'http://localhost');
    const ctx = {
      req, res,
      method: req.method,
      pathname: decodeURIComponent(url.pathname),
      query: Object.fromEntries(url.searchParams.entries()),
      params: {},
      body: null,
      ended: false
    };
    const start = Date.now();
    res.on('finish', () => {
      logger.info(`[http] ${ctx.method} ${ctx.pathname} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    try {
      await this.runMiddlewares(ctx, this.middlewares);
      if (ctx.ended) return;
      // 匹配路由
      for (const r of this.routes) {
        if (r.method !== ctx.method) continue;
        const m = r.regex.exec(ctx.pathname);
        if (!m) continue;
        ctx.params = {};
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        if (ctx.body === null && ['POST', 'PUT', 'DELETE'].includes(ctx.method)) {
          ctx.body = await readBody(req);
          if (ctx.body._tooLarge) return res.error('请求体过大', 413);
          if (ctx.body._invalid) return res.error('JSON 格式错误', 400);
        }
        await this.runMiddlewares(ctx, r.handlers);
        return;
      }
      res.error('接口不存在', 404);
    } catch (e) {
      logger.error('[http] 未捕获异常:', e.stack || e.message);
      if (!res.headersSent) res.error('服务器内部错误', 500);
    }
  }
}

// 常用中间件
const authGuard = (requireAuth) => (ctx) => {
  // 由模块注入的 ctx.user（见 core/auth.js 的 requireUser）
  if (requireAuth && !ctx.user) {
    ctx.res.error('请先登录', 401);
    ctx.ended = true;
  }
};

module.exports = { Router, attach, readBody, authGuard };
