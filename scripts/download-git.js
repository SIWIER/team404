// scripts/download-git.js — 下载 Git for Windows 便携版（winget 不可用时的备用方案）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

(async () => {
  const api = 'https://api.github.com/repos/git-for-windows/git/releases/latest';
  const res = await fetch(api, {
    headers: { 'User-Agent': 'find-my-glasses-setup', 'Accept': 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error('API 请求失败: ' + res.status);
  const rel = await res.json();
  const asset = rel.assets.find((a) => /PortableGit-.*-64-bit\.7z\.exe$/.test(a.name));
  if (!asset) throw new Error('未找到 PortableGit 资源');
  console.log('最新版本:', rel.tag_name);
  console.log('下载:', asset.name, '(' + Math.round(asset.size / 1024 / 1024) + ' MB)');

  const out = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'PortableGit.exe');
  const dl = await fetch(asset.browser_download_url, {
    headers: { 'User-Agent': 'find-my-glasses-setup' },
    redirect: 'follow'
  });
  if (!dl.ok) throw new Error('下载失败: ' + dl.status);
  await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(out));
  const size = fs.statSync(out).size;
  if (size < asset.size * 0.9) throw new Error('下载不完整: ' + size);
  console.log('已保存:', out, '(' + Math.round(size / 1024 / 1024) + ' MB)');
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
