// js/api.js — fetch 封装：自动附带令牌、统一错误
import { store } from './store.js';

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (store.token) headers['Authorization'] = 'Bearer ' + store.token;
  const r = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    store.clear();
    if (location.hash !== '#/auth') location.hash = '#/auth';
  }
  if (!r.ok) {
    const err = new Error(data.error || `请求失败 (${r.status})`);
    err.status = r.status;
    err.errors = data.errors || null;
    err.ok = data.ok === true;
    throw err;
  }
  return data;
}
