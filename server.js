// server.js — 服务入口：装配配置/数据库/路由/静态资源
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./src/config');
const logger = require('./src/core/logger');
const { init: initDb } = require('./src/core/db');
const { Router } = require('./src/core/http');
const { attachUser, verifyToken } = require('./src/core/auth');
const { seed } = require('./src/seed/seed');
const ws = require('./src/core/ws');

// 各模块路由（后续模块在此注册）
const accountsRoutes = require('./src/modules/accounts/accounts.routes');
const reasonRoutes = require('./src/modules/reason/reason.routes');
const dataRoutes = require('./src/modules/data/data.routes');
const hardwareRoutes = require('./src/modules/hardware/hardware.routes');
const hardware = require('./src/modules/hardware/hardware.service');
const accounts = require('./src/modules/accounts/accounts.service');

// ---------- 初始化 ----------
initDb();
seed();
hardware.seedDevices();
hardware.startSimulator();

const router = new Router();
router.use(attachUser); // 全局：解析 Bearer 令牌 → ctx.user
router.get('/api/health', (ctx) => ctx.res.ok({ time: new Date().toISOString(), version: require('./package.json').version }));
accountsRoutes.registerRoutes(router);
reasonRoutes.registerRoutes(router);
dataRoutes.registerRoutes(router);
hardwareRoutes.registerRoutes(router);

// 静态资源（public/）
const PUBLIC = path.join(config.root, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(res, pathname) {
  const p = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    await router.handle(req, res);
  } else {
    serveStatic(res, url.pathname);
  }
});

// WebSocket 实时通道：/ws?token=<令牌>，推送设备事件与设备状态
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') { socket.destroy(); return; }
  ws.handleUpgrade(req, socket, (r) => {
    const payload = verifyToken(url.searchParams.get('token') || '');
    if (!payload) return null;
    return accounts.getPublicUser(payload.uid);
  });
});

server.listen(config.port, () => {
  logger.info('============================================');
  logger.info('  👓 找眼镜助手 · 正式版服务已启动');
  logger.info(`  地址：http://localhost:${config.port}`);
  logger.info('  演示账号：xiaoming / 123456（或 xiaohong / 123456）');
  logger.info('============================================');
});
