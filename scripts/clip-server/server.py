#!/usr/bin/env python3
# scripts/clip-server/server.py — Chinese-CLIP 本地推理服务（参考实现，未经实机联调）
# 用途：为「物品管理」的图图/文图向量检索提供 图片/文字 → 单位向量 编码服务。
# 契约（与 src/modules/items/items.clip.js 对齐）：
#   POST /encode/image  {"image": "<裸 base64>"}   → {"vector": [512 个 float], "dim": 512}
#   POST /encode/text   {"text": "..."}            → 同上
# 依赖：pip install torch torchvision cn_clip pillow numpy（github.com/OFA-Sys/Chinese-CLIP）
# 启动：python server.py --port 8899 --model ViT-B-16 [--device cuda]
import argparse
import base64
import io
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import torch
from PIL import Image

import cn_clip.clip as clip
from cn_clip.clip import load_from_name

MODEL = None
PREPROCESS = None
DEVICE = "cpu"


def load(model_name):
    global MODEL, PREPROCESS
    m, p = load_from_name(model_name, device=DEVICE, download_root="./")
    m.eval()
    MODEL, PREPROCESS = m, p
    print(f"[clip-server] 模型 {model_name} 已加载（{DEVICE}）")


def to_list(t):
    # 单位向量（L2 归一化）：后端直接点积 = 余弦相似度
    t = t / t.norm(dim=-1, keepdim=True)
    return t[0].detach().cpu().numpy().astype(np.float32).tolist()


def encode_image(b64):
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    with torch.no_grad():
        feat = MODEL.encode_image(PREPROCESS(img).unsqueeze(0).to(DEVICE))
    return to_list(feat)


def encode_text(text):
    with torch.no_grad():
        feat = MODEL.encode_text(clip.tokenize([text]).to(DEVICE))
    return to_list(feat)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/health"):
            return self._send(200, {"ok": True, "service": "chinese-clip"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/encode/image":
                vec = encode_image(str(body.get("image", "")))
                return self._send(200, {"vector": vec, "dim": len(vec)})
            if self.path == "/encode/text":
                vec = encode_text(str(body.get("text", ""))[:100])
                return self._send(200, {"vector": vec, "dim": len(vec)})
            self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001 — 服务保持可用，错误以 JSON 返回
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        pass  # 静默访问日志


def main():
    global DEVICE
    ap = argparse.ArgumentParser(description="Chinese-CLIP 编码服务（契约见 scripts/clip-server/README.md）")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--model", default="ViT-B-16")
    ap.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()

    DEVICE = args.device
    load(args.model)
    server = HTTPServer((args.host, args.port), Handler)
    print(f"[clip-server] 监听 http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
