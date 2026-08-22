// scripts/download-arduino-cli.js — 下载 arduino-cli（带重试，GitHub 网络不稳时更稳）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const URL = 'https://github.com/arduino/arduino-cli/releases/latest/download/arduino-cli_latest_Windows_64bit.zip';
const OUT = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'arduino-cli.zip');

async function attempt(n) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000); // 单次 3 分钟超时
  try {
    console.log(`第 ${n} 次尝试下载...`);
    const res = await fetch(URL, { redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(OUT));
    const size = fs.statSync(OUT).size;
    if (size < 5 * 1024 * 1024) throw new Error('文件过小，疑似不完整: ' + size);
    console.log('下载完成: ' + Math.round(size / 1024 / 1024) + ' MB');
    return true;
  } catch (e) {
    console.log('失败: ' + e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  for (let i = 1; i <= 4; i++) {
    if (await attempt(i)) process.exit(0);
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.error('4 次尝试均失败');
  process.exit(1);
})();
