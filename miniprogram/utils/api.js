// utils/api.js — wx.request 封装（对应 Web 端 api.js）
const config = require('./config');
const store = require('./store');

function request(path, { method = 'GET', data } = {}) {
  return new Promise((resolve, reject) => {
    const header = {};
    if (data !== undefined) header['Content-Type'] = 'application/json';
    const token = store.getToken();
    if (token) header['Authorization'] = 'Bearer ' + token;
    wx.request({
      url: config.API_BASE + '/api' + path,
      method,
      data,
      header,
      success(res) {
        if (res.statusCode === 401) {
          store.clear();
          wx.reLaunch({ url: '/pages/auth/auth' });
          reject(new Error('请先登录'));
          return;
        }
        if (res.statusCode >= 400) {
          const msg = (res.data && res.data.error) || '请求失败 (' + res.statusCode + ')';
          const err = new Error(msg);
          err.status = res.statusCode;
          err.errors = (res.data && res.data.errors) || null;
          reject(err);
          return;
        }
        resolve(res.data);
      },
      fail() {
        reject(new Error('网络错误：请确认后端服务已启动（node server.js）'));
      }
    });
  });
}

module.exports = { request };
