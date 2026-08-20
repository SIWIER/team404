// src/core/logger.js — 分级日志（控制台 + 文件）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const LOG_DIR = path.join(config.root, 'data');
let fileStream = null;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function ensureStream() {
  if (!fileStream) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fileStream = fs.createWriteStream(path.join(LOG_DIR, 'server.log'), { flags: 'a' });
    } catch { fileStream = null; }
  }
  return fileStream;
}

function write(level, args) {
  const line = `[${ts()}] [${level}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  // 控制台：错误走 stderr
  if (level === 'ERROR') console.error(line); else console.log(line);
  const s = ensureStream();
  if (s) s.write(line + '\n');
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => { if (process.env.DEBUG) write('DEBUG', a); }
};
