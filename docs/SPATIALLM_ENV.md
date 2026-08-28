# 🧊 SpatialLM 环境配置要求（房间实景扫描预研）

> 目标：手机环绕拍摄房间内景 → 自动识别房间结构 → 小程序户型图上自动"建模"。
> 本文档记录预研阶段的**环境配置要求**与已踩过的坑，供团队其他成员复用。
> 更新于 2026-08-28 ｜ 状态：阶段 0 环境安装中（验证机：拯救者 Y7000 / RTX 5060 / Win11 + WSL2）

---

## 0. 方案链路（30 秒版）

```
iPhone 环绕视频（H.264, 1080p, 30~60s）
  → MASt3R-SLAM：视频逐帧重建 → 稠密点云 .ply
  → 对齐（墙面摆正到 x/y 平面）+ 缩放（按墙高 ~2.5m 校准米制）
  → SpatialLM（1.1-Qwen-0.5B）：点云 → 结构化 JSON（墙/门/窗/家具包围盒）
  → Node 后端 → 户型图网格 + furn 模块自动摆放（规划中）
```

两个开源项目：

| 项目 | 作用 | 仓库 |
|---|---|---|
| MASt3R-SLAM | 视频 → 点云（全链路最重、最慢的一环） | github.com/rmurai0610/MASt3R-SLAM |
| SpatialLM | 点云 → 结构化布局（NeurIPS 2025，群核科技） | github.com/manycore-research/SpatialLM |

SpatialLM 只吃点云不吃视频，所以两个都要装。

---

## 1. 硬件要求

| 项目 | 最低要求 | 本机实测（拯救者 Y7000） |
|---|---|---|
| 显卡 | NVIDIA ≥8GB 显存 | RTX 5060 Laptop 8GB ✅ 压线达标 |
| 内存 | ≥16GB | 16GB ✅ |
| 磁盘剩余 | ≥30GB（两个仓库 + torch + 权重 + 点云） | 99GB ✅ |

⚠️ 必须 NVIDIA 显卡（CUDA），AMD/核显不可用。8GB 是压线配置：SLAM 跑视频时把 `config/base.yaml` 的 `sample_freq` 调成 2 省显存，跑模型时关掉游戏/浏览器。

---

## 2. 系统要求（Windows 开发机）

- Windows 10/11 + **WSL2**（原生 Linux 亦可，跳过 WSL 部分）
- WSL 发行版：Ubuntu 24.04/26.04（本机 26.04 已验证可用）
- **不要在 Windows 裸机装**——torchsparse/spconv 等编译包在 Windows 上不可行

**WSL2 安装步骤（管理员 PowerShell）：**

```powershell
wsl --install -d Ubuntu
```

- 若提示"未启用虚拟化"：管理员 PowerShell 运行 `Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All` 后**重启**
- 内存配置：新建 `C:\Users\<你>\.wslconfig`：

```
[wsl2]
memory=12GB
swap=8GB
processors=8
```

写好后 `wsl --shutdown` 生效。显卡直通验证：WSL 内跑 `nvidia-smi` 能看到显卡即通（无需在 WSL 里另装驱动）。

---

## 3. 🔥 关键坑：RTX 50 系（Blackwell sm_120）必须用新版 torch

两个开源项目官方文档给的 torch 版本（MASt3R-SLAM 2.5.1 cu124 / SpatialLM 2.4.1 cu124）**在 RTX 50 系上不可用**：这些版本不含 sm_120 架构的内核，运行时报 `CUDA error: no kernel image is available` 或 `CUBLAS_STATUS_ARCH_MISMATCH`。

**RTX 50 系统一用：`torch==2.7.1+cu128` + `torchvision==0.22.1+cu128`**（PyTorch 2.7 起正式支持 Blackwell 消费卡）。30 系/40 系老卡按官方文档版本装即可。

---

## 4. 软件版本矩阵（本机验证方案）

| 组件 | 版本 | 说明 |
|---|---|---|
| Python | 3.11 | `mast3r` / `spatiallm` 两个 conda 环境分开装 |
| torch / torchvision | 2.7.1+cu128 | Blackwell 兼容（见第 3 节） |
| CUDA toolkit | 12.9（conda-forge） | 仅编译用（nvcc）；conda-forge 没有 12.9 时退回 12.8 |
| MASt3R-SLAM | main + `windows` 分支 | WSL 用户官方建议 `git checkout windows` |
| SpatialLM | 1.1-Qwen-0.5B | 模型 ~2GB；1.0 系列需编译 torchsparse，更麻烦，不推荐 |
| spconv / torch-scatter | 最新版 | SpatialLM1.1 的 Sonata 编码器**必需** |
| flash-attn | 可选 | 推理代码有优雅降级，装不上不影响功能 |
| gcc | 14.x | Ubuntu 26.04 自带，CUDA 12.9 支持 |
| 磁盘产物 | ~15GB | torch 3GB + toolkit 3GB + 权重 3GB + 仓库等 |

pip 建议走清华镜像（`PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`），模型下载走 `HF_ENDPOINT=https://hf-mirror.com`。

---

## 5. 一键安装脚本

本仓库 `scripts/spatiallm/setup.sh`（在 WSL 内以 root 运行）：

```bash
# 方式一：脚本拷进 WSL 后运行
cp /mnt/c/<仓库路径>/scripts/spatiallm/setup.sh ~/ && wsl -d Ubuntu -u root -- bash ~/spatiallm-setup.sh

# 方式二：直接从 Windows 侧执行（注意 // 开头防 Git Bash 路径转换）
wsl.exe -d Ubuntu -u root -- bash //mnt/c/<仓库路径>/scripts/spatiallm/setup.sh
```

脚本自动完成：基础工具 → Miniconda → `mast3r` 环境（torch+MASt3R-SLAM+权重）→ `spatiallm` 环境（依赖+spconv/torch-scatter）→ 模型权重 → 官方示例点云验证。每阶段 ✅/❌ 标记，失败不中断，最后汇总失败项；日志写到 `~/spatiallm-setup.log`。全程约 1~2 小时（大头是下载与编译）。

---

## 6. 手机拍摄要求（iPhone）

- **设置 → 相机 → 录制视频 → 选"兼容性最佳"（H.264）** ← 关键，默认 H.265 SLAM 读不了
- 1080p 30fps，横屏
- 光线好的客厅/卧室（白天最佳），**缓慢绕房间一整圈**（门口出发回到门口），30~60 秒，别抖
- 避开大面积纯白墙（SLAM 特征太少）、玻璃、镜子、亮面地板

---

## 7. 验证路径

1. **官方示例点云跑通推理**（安装脚本最后自动做）：`pcd/scene0000_00.ply` → 输出墙/门/窗/家具 JSON，证明工具链没问题
2. **自家视频全链路**：MASt3R-SLAM 出点云 → 对齐缩放（按墙高 2.5m 校准）→ SpatialLM 推理 → 人工评估效果
3. 效果验收后再进入服务化设计（复用 `scripts/clip-server/` 的 sidecar 模式）

---

## 8. 常见坑速查

| 坑 | 解法 |
|---|---|
| RTX 50 系报 `no kernel image` / `ARCH_MISMATCH` | torch 换 2.7.1+cu128（见第 3 节） |
| pip 下载 download.pytorch.org 极慢（46kB/s）且反复中断 | WSL 的 IPv6 通道问题：`curl -4` 直下轮子再 `pip install` 本地文件（本机实测 16 秒下完 991MB） |
| pip 报 `Invalid wheel filename (wrong number of parts)` | pip 26 会校验轮子**文件名格式**，手动下载后必须保留规范名（如 `torch-2.7.1+cu128-cp311-...whl`），不能改名成 `torch.whl` |
| WSL 里 `git clone` GitHub 秒断（1ms）| Windows hosts 被加速器劫持（Watt Toolkit 等把 github.com→127.0.0.1），WSL 继承后连的是 WSL 自己的回环。解法：`/etc/wsl.conf` 设 `generateHosts=false`，`/etc/hosts` 里给 github.com 写真实 IP（如 `20.205.243.166`） |
| WSL2 报虚拟化未启用 | 启用"虚拟机平台"组件 + 重启 |
| flash-attn 编译失败 | 可跳过（推理自动降级）；spconv 失败则必须修 |
| iPhone 视频读不进 | 确认是 H.264（"兼容性最佳"） |
| SLAM 跑视频爆显存 | `config/base.yaml` 里 `sample_freq=2` |
| huggingface 下载慢 | `HF_ENDPOINT=https://hf-mirror.com` |
| Git Bash 下路径被改（`D:/Git/mnt/...`） | 用 `//mnt/c/...` 双斜杠写法 |
| WSL 下 MASt3R-SLAM 卡共享内存 | `git checkout windows` 分支 |
