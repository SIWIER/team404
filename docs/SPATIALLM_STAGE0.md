# 🧊 SpatialLM 阶段 0 验证手册（视频 → 点云 → 结构化布局）

> 前置：环境已按 `docs/SPATIALLM_ENV.md` 装好（WSL2 + `mast3r`/`spatiallm` 两个 conda 环境 + 模型权重）。
> 目标：验证"手机环绕拍摄房间 → 自动识别结构"这条链路真的走得通、效果可接受。
> 更新于 2026-08-28 ｜ 验证机：拯救者 Y7000（RTX 5060 8GB）/ iPhone 16 Plus

---

## 0. 快速自检（1 分钟）

```bash
wsl -d Ubuntu -u root
source /root/miniconda3/etc/profile.d/conda.sh
conda run -n spatiallm python -c "import torch, spconv, torch_scatter; print('spatiallm 环境 OK, GPU:', torch.cuda.get_device_name(0))"
conda run -n mast3r python -c "import torch; print('mast3r 环境 OK, GPU:', torch.cuda.get_device_name(0))"
```

两个环境都能打印出 GPU 名字（RTX 5060）即通过。

---

## 1. 拍视频（iPhone，成功率关键）

- **设置 → 相机 → 录制视频 → "兼容性最佳"（H.264）**，1080p 30fps
- 白天光线好的客厅/卧室，横屏，**缓慢绕房间一整圈**（门口出发回到门口），30~60 秒
- 别抖；避开大面积纯白墙、玻璃、镜子
- 传到电脑，假设路径 `/mnt/c/Users/<你>/Desktop/room1.mov`（WSL 视角）

---

## 2. 视频 → 点云（MASt3R-SLAM）

```bash
wsl -d Ubuntu -u root
source /root/miniconda3/etc/profile.d/conda.sh
conda activate mast3r
cd /root/MASt3R-SLAM

# 显存压线（8GB）建议先改配置：config/base.yaml 里 sample_freq 改成 2
python main.py --dataset /mnt/c/Users/<你>/Desktop/room1.mov --config config/base.yaml
```

- 跑完在输出目录（`outputs/<时间戳>/`）找 `.ply` 点云文件
- **验收**：`conda run -n spatiallm python -c "import open3d as o3d; o3d.visualization.draw_geometries([o3d.io.read_point_cloud('你的.ply')])"`
  弹出窗口能看到"这是个房间"（地面/墙/家具轮廓）→ 继续；看不出 → 重拍视频（多半拍太快/太暗/白墙太多）
- 记下点云路径，下一步用

> ⚠️ 输出目录确认：运行结束的日志里会有 `save_ply` 相关输出，或直接 `find /root/MASt3R-SLAM/outputs -name "*.ply" | head` 找最新的。

---

## 3. 点云 → 对齐 + 缩放（预处理脚本）

SpatialLM 要求点云"墙竖直、地水平 + 米制尺寸"。用本仓库 `scripts/spatiallm/align.py`：

```bash
cd /root/SpatialLM
conda run -n spatiallm python /mnt/c/<仓库路径>/scripts/spatiallm/align.py 输入.ply aligned.ply
```

脚本自动：去离群点 → 找最大平面（地面）→ 旋转到 z 轴朝上 → 按"墙高 2.5 米"缩放。跑完打印缩放系数。

---

## 4. 点云 → 结构化布局（SpatialLM 推理）

```bash
cd /root/SpatialLM
conda run -n spatiallm python inference.py --point_cloud aligned.ply --output room1.txt --model_path spatiallm-model
cat room1.txt
```

输出是结构化 JSON：墙线段、门、窗、家具包围盒（类别 + 中心 + 尺寸 + 朝向）。

---

## 5. 验收判断（go / no-go）

| 看什么 | ✅ 好 | 🟡 可接受 | ❌ 不行 |
|---|---|---|---|
| 墙/门/窗 | 数量形状基本对 | 位置有点偏 | 乱七八糟 |
| 家具 | 床/沙发/桌子认出且位置朝向对 | 认出一半 | 全错 |
| 尺寸 | 床 ~1.8-2m | 误差 30% 内 | 完全离谱 |

- ✅/🟡 → 进入阶段 1：服务化设计（复用 `scripts/clip-server/` 的 sidecar 模式）
- ❌ → 换房间/换拍摄方式再试一轮（重拍成本 5 分钟）；仍不行 → 退化为"照片识别 + 网格粗摆放"简化方案

---

## 6. 常见坑

| 坑 | 解法 |
|---|---|
| 跑视频报 CUDA out of memory | `config/base.yaml` 的 `sample_freq=2`；跑前关掉 Windows 侧占用显存的程序 |
| iPhone 视频读不进（解码报错） | 确认拍的是 H.264（"兼容性最佳"）；不行用 `ffmpeg -i room1.mov -c:v libx264 room1.mp4` 转一次 |
| 对齐后房间还是歪 | align.py 找错平面（找到墙面了）：换 `distance_threshold` 参数重试 |
| 输出全是墙没有家具 | 1.1 模型支持自定义类别：`--detect_type all --category bed desk ...`（59 类家具可选） |
| 想可视化对照 | 官方 `visualize.py --point_cloud aligned.ply --layout room1.txt --save out.rrd` + `rerun out.rrd` |
