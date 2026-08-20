// js/views/placeholder.view.js — 未完成模块占位页
import { esc } from '../ui.js';

export function renderPlaceholder(root, title, desc) {
  root.innerHTML = `
    <div class="card soon">
      <div class="ico">🚧</div>
      <div class="t">「${esc(title)}」模块开发中</div>
      <div class="d">${esc(desc || '该模块将在后续迭代中上线，敬请期待。')}</div>
      <div class="btn-row" style="justify-content:center;">
        <button class="btn ghost" onclick="location.hash='#/'">← 返回首页</button>
      </div>
    </div>`;
}
