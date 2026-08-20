// src/core/ws.js — 极简 WebSocket 服务端（零依赖，RFC6455 手写实现）
// 仅支持文本帧；用于向浏览器实时推送设备事件
'use strict';
const crypto = require('node:crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

// ---------- 帧编解码 ----------
function encodeFrame(payloadStr, opcode = 1) {
  const payload = Buffer.from(payloadStr, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// 解析客户端帧（必须掩码）；返回 null 表示数据不足
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  let mask = null;
  if (masked) { if (buf.length < offset + 4) return null; mask = buf.subarray(offset, offset + 4); offset += 4; }
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, consumed: offset + len };
}

function handleFrame(conn, f) {
  if (f.opcode === 8) { // close
    try { conn.socket.write(encodeFrame('', 8)); } catch {}
    conn.socket.end();
    conn.closed = true;
    clients.delete(conn);
    return;
  }
  if (f.opcode === 9) { // ping → pong
    try { conn.socket.write(encodeFrame(f.payload.toString('utf8'), 10)); } catch {}
    return;
  }
  if (f.opcode === 1 && conn.onMessage) { // text
    let msg = null;
    try { msg = JSON.parse(f.payload.toString('utf8')); } catch {}
    if (msg) conn.onMessage(msg, conn);
  }
}

// ---------- 升级握手 ----------
// onAuth(req) 返回 false/null 拒绝，否则返回用户对象
function handleUpgrade(req, socket, onAuth) {
  const user = onAuth ? onAuth(req) : true;
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  const conn = { socket, user, closed: false, onMessage: null };
  clients.add(conn);
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const f = parseFrame(buffer);
      if (!f) break;
      buffer = buffer.subarray(f.consumed);
      handleFrame(conn, f);
      if (conn.closed) break;
    }
  });
  const cleanup = () => clients.delete(conn);
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  conn.send = (obj) => {
    try { socket.write(encodeFrame(JSON.stringify(obj))); } catch {}
  };
}

function broadcast(obj, { exclude } = {}) {
  for (const c of clients) {
    if (c === exclude) continue;
    c.send(obj);
  }
}

module.exports = { handleUpgrade, broadcast };
