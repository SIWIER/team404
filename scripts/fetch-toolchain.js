// scripts/fetch-toolchain.js — 把 RISC-V 工具链预下载到 arduino-cli 缓存（走 kkgithub 镜像）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const FILE = 'riscv32-esp-elf-14.2.0_20260121-x86_64-w64-mingw32.zip';
const MIRRORS = [
  'https://kkgithub.com/espressif/crosstool-NG/releases/download/esp-14.2.0_20260121/' + FILE,
  'https://ghproxy.net/https://github.com/espressif/crosstool-NG/releases/download/esp-14.2.0_20260121/' + FILE,
  'https://github.com/espressif/crosstool-NG/releases/download/esp-14.2.0_20260121/' + FILE
];
const DEST_DIR = path.join(os.homedir(), 'AppData', 'Local', 'Arduino15', 'staging', 'packages');
const DEST = path.join(DEST_DIR, FILE);

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const len = Number(res.headers.get('content-length') || 0);
  console.log('下载中: ' + url + (len ? ' (' + Math.round(len / 1048576) + ' MB)' : ''));
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(DEST));
  return fs.statSync(DEST).size;
}

(async () => {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  if (fs.existsSync(DEST) && fs.statSync(DEST).size > 100 * 1024 * 1024) {
    console.log('缓存已存在，跳过下载: ' + DEST);
    process.exit(0);
  }
  for (const url of MIRRORS) {
    try {
      const size = await download(url);
      console.log('✅ 完成: ' + Math.round(size / 1048576) + ' MB → ' + DEST);
      process.exit(0);
    } catch (e) {
      console.log('❌ ' + url + ' → ' + e.message);
      try { fs.rmSync(DEST, { force: true }); } catch {}
    }
  }
  console.error('全部镜像失败');
  process.exit(1);
})();
