// src/config.js — 配置中心：.env 文件 + 环境变量 + 默认值（零依赖）
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// 极简 .env 加载（不覆盖已存在的环境变量）
function loadEnvFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
      }
    }
  } catch { /* 文件不存在则忽略 */ }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = (k, d) => {
  const v = process.env[k];
  return v === undefined || v === '' ? d : v;
};
const envNum = (k, d) => { const n = Number(env(k, d)); return Number.isFinite(n) ? n : d; };
const envBool = (k, d) => (env(k, '') === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(env(k, '')).toLowerCase()));

const config = {
  root: ROOT,
  port: envNum('PORT', 8081),
  dbFile: path.join(ROOT, env('DB_FILE', 'data/find_glasses.db')),
  token: {
    secret: env('TOKEN_SECRET', 'dev-secret-not-for-production'),
    ttlHours: envNum('TOKEN_TTL_HOURS', 24),
    ttlHoursRemember: envNum('TOKEN_TTL_HOURS_REMEMBER', 720)
  },
  llm: {
    enabled: envBool('LLM_ENABLED', true),
    baseUrl: env('LLM_BASE_URL', 'https://api.deepseek.com'),
    apiKey: env('LLM_API_KEY', ''),
    model: env('LLM_MODEL', 'deepseek-chat'),
    timeoutMs: envNum('LLM_TIMEOUT_MS', 25000),
    // 视觉模型（户型图照片识别专用；OpenAI 兼容的多模态接口）
    // 与上面的文本模型相互独立：文本模型 deepseek-chat 不支持读图，故单独配置
    vision: {
      enabled: envBool('LLM_VISION_ENABLED', true),
      baseUrl: env('LLM_VISION_BASE_URL', ''),
      apiKey: env('LLM_VISION_API_KEY', ''),
      model: env('LLM_VISION_MODEL', ''),
      timeoutMs: envNum('LLM_VISION_TIMEOUT_MS', 40000)
    }
  },
  hardware: {
    simulatorEnabled: envBool('SIMULATOR_ENABLED', true),
    simulatorIntervalMs: envNum('SIMULATOR_INTERVAL_MS', 8000),
    hintFreshMs: envNum('HINT_FRESH_MS', 10 * 60 * 1000)
  },
  // 微信登录（小程序一键登录 / 账号绑定）。注意：secret 不入库、不进日志
  wx: {
    appId: env('WX_APPID', ''),
    secret: env('WX_SECRET', ''),
    // 未绑定 openid 的微信用户首次登录时是否自动建号
    autoRegister: envBool('WX_AUTO_REGISTER', true),
    // 测试/开发用：设置后 code2session 直接返回该 openid（跳过真实微信调用）
    mockOpenid: env('WX_MOCK_OPENID', ''),
    // bindToken 有效期（毫秒），用于"需绑定已有账号"流程
    bindTokenTtlMs: envNum('WX_BIND_TOKEN_TTL_MS', 10 * 60 * 1000),
    // code2session 接口超时
    code2sessionTimeoutMs: envNum('WX_CODE2SESSION_TIMEOUT_MS', 8000)
  }
};

module.exports = config;
