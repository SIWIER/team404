# scripts/clip-server — Chinese-CLIP 本地推理服务（参考实现）

「物品管理」图图/文图检索（`POST /api/items/search-image`）需要把 **图片/文字编码成向量**，
再由后端做暴力余弦检索（向量存 `items.clip_vec`）。向量推理用 **Chinese-CLIP** 本地部署
（github.com/OFA-Sys/Chinese-CLIP，中文图文对齐模型，参考 Weydon-Ding/VectorGallery 的工程思路）。

本目录提供一个**最小参考服务** `server.py`：零框架、契约与后端 `src/modules/items/items.clip.js` 完全对齐。

## 契约（与后端对齐）

| 接口 | 请求 | 响应 |
|---|---|---|
| `POST /encode/image` | `{"image": "<裸 base64>"}` | `{"vector": [512 个 float], "dim": 512}` |
| `POST /encode/text`  | `{"text": "..."}` | 同上 |

- 向量须为**单位向量**（L2 归一化），后端直接做点积 = 余弦相似度
- 服务只做编码，不碰业务数据；物品照片由后端从 `data/uploads/` 读出后以 base64 送来
- 未部署时后端自动降级：`/api/items/search-image` 返回 503，文字检索不受影响

## 安装（需要 Python 3.9+，本机已实测通过）

在仓库根目录执行（Windows PowerShell）：

```powershell
# 1) 建虚拟环境（隔离依赖，不污染系统 Python）
python -m venv scripts/clip-server/.venv
$py = "scripts\clip-server\.venv\Scripts\python.exe"

# （可选）直连 pytorch.org 不通时，先设置代理再继续（127.0.0.1:7890 按实际代理端口改）
$env:HTTP_PROXY='http://127.0.0.1:7890'; $env:HTTPS_PROXY='http://127.0.0.1:7890'

# 2) 先装 CPU 版 torch（务必用 CPU 索引：PyPI 默认 Windows 轮子带 CUDA，体积数 GB）
& $py -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 3) 装 cn_clip（--no-deps）+ 推理所需依赖。
#    注意：cn_clip 声明依赖 lmdb==1.3.0，它只有源码包、Windows 编译要 MSVC；
#    lmdb 只用于 cn_clip 的训练数据加载，本服务只做推理 → 用 --no-deps 跳过
& $py -m pip install cn_clip --no-deps
& $py -m pip install timm tqdm six pillow numpy
```

有 NVIDIA 显卡时，第 2 步换成 `pip install torch torchvision`（CUDA 版），启动时加 `--device cuda`。
纯 CPU 也能跑：ViT-B-16 单张图约 1-3 秒。

## 启动

```powershell
scripts\clip-server\.venv\Scripts\python scripts\clip-server\server.py --port 8899 --model ViT-B-16
# 常用模型：ViT-B-16（推荐，速度快）/ RN50 / ViT-L-14 / ViT-L-14-336
# 首次启动自动从 HuggingFace 下载权重到 scripts/clip-server/models/（ViT-B-16 约 700MB）
# 提示：模型下载完成后才监听端口；一直不响应可看控制台进度
```

或**双击 `scripts/clip-server/start-clip.bat`** 一键启动（等价于上面命令）。
停止服务：关掉窗口，或 `Ctrl+C`。

然后在后端 `.env` 配置（**只改自己本地的 .env，绝不提交**），或启动后端时注入环境变量：

```
CLIP_ENABLED=true
CLIP_BASE_URL=http://127.0.0.1:8899
CLIP_DIM=512
CLIP_TIMEOUT_MS=15000
```

## 验证

```powershell
curl.exe -X POST http://127.0.0.1:8899/encode/text -H "Content-Type: application/json" -d "{\"text\":\"眼镜\"}"
# → {"vector": [...512 个 float...], "dim": 512}
curl.exe http://127.0.0.1:8899/health
# → {"ok": true, "service": "chinese-clip"}
```

小程序「物品管理 → 检索 → 拍照找同款 / 文字找物品」即可走通向量检索链路。

## 备注

- `server.py` 为**参考实现**（std lib http.server + cn_clip）；按需换成 FastAPI / ONNX Runtime
  （onnxruntime + cn_clip 导出的 ONNX 模型，CPU 更快）均可，只要守住上面的 HTTP 契约即可。
- 后端检索是 SQLite 存向量 + 暴力余弦（起步方案）：几百条物品无压力；量大后再换向量索引。
- 部署产物（`.venv/`、`models/`）已被本目录 `.gitignore` 排除，不会误提交。
