#!/bin/bash
# SpatialLM 预研环境一键安装（WSL2 Ubuntu / RTX 50 系 Blackwell）
# 用法（WSL 内以 root 运行）: bash ~/spatiallm-setup.sh
# 说明详见 docs/SPATIALLM_ENV.md；日志: ~/spatiallm-setup.log
# 注意: RTX 50 系必须 torch 2.7.1+cu128（官方文档的 cu124 不支持 sm_120）
#
# 2026-08-30 第二台验证机（RTX 5070 Laptop）实测修订：
# 1) /tmp 是 5.9GB tmpfs，pip build isolation 会爆盘 → TMPDIR 指到 /root/tmp + --no-build-isolation
# 2) CUDA 扩展编译需要 CUDA_HOME 指向 conda 环境里的 cuda-toolkit
# 3) flash-attn 是 SpatialLM1.1 推理的**必需**依赖（官方代码无降级），同样无隔离编译
# 4) spconv-cu128 在 PyPI 不存在（只有 cu126 以下）；plain spconv 是 CPU-only 不能用于推理 → 装 spconv-cu126（2.3.8 起支持 sm_120）
# 5) SpatialLM pyproject 的 poetry 写法 ^2.4.1+cu124 被 pip26 拒绝（局部版本标签）→ 安装前 sed 去掉 +cu124
# 6) 推理依赖补 timm（sonata_encoder 导入）与 poetry-core（无隔离构建用）
# 7) MASt3R 子模块偶发卡死（imgui 从 github 克隆 30 分钟不动）→ timeout + 手动浅克隆兜底
set -u
LOG="$HOME/spatiallm-setup.log"
STAGE() { echo "[$(date +%H:%M:%S)] ====== $1 ======" | tee -a "$LOG"; }
OK()   { echo "[$(date +%H:%M:%S)] ✅ $1" | tee -a "$LOG"; }
FAIL() { echo "[$(date +%H:%M:%S)] ❌ $1" | tee -a "$LOG"; }

# 镜像源 + Blackwell 编译目标（sm_120 = RTX 5060/5070 等 50 系显卡）
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export HF_ENDPOINT=https://hf-mirror.com
export TORCH_CUDA_ARCH_LIST="12.0"
# /tmp 是 tmpfs（本机 5.9GB），pip 隔离构建会爆盘 → 全部临时文件放 /root/tmp
export TMPDIR="$HOME/tmp"
mkdir -p "$TMPDIR"

# ---------- 0. 基础工具 ----------
STAGE "apt 基础工具"
apt-get update -y >> "$LOG" 2>&1 && apt-get install -y build-essential git curl wget ca-certificates cmake ninja-build >> "$LOG" 2>&1 && OK "apt 基础工具" || FAIL "apt"
# WSL 部分网络下 IPv6 通道故障导致 pip 极慢/中断：系统级 IPv4 优先
grep -q 'precedence ::ffff:0:0/96' /etc/gai.conf 2>/dev/null || echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf

# ---------- 1. Miniconda ----------
STAGE "Miniconda"
if [ ! -d "$HOME/miniconda3" ]; then
  wget -q https://mirrors.tuna.tsinghua.edu.cn/anaconda/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/mc.sh || wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/mc.sh
  bash /tmp/mc.sh -b -p "$HOME/miniconda3" >> "$LOG" 2>&1 && OK "Miniconda" || FAIL "Miniconda"
fi
source "$HOME/miniconda3/etc/profile.d/conda.sh"
# 只用清华镜像：移除 defaults（新版 conda 会弹 ToS 报错拒绝装包）
conda config --remove-key channels >> "$LOG" 2>&1
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main >> "$LOG" 2>&1
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge >> "$LOG" 2>&1
conda config --set channel_priority flexible >> "$LOG" 2>&1
printf 'channel_priority: flexible\nchannels:\n  - https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge\n  - https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main\n' > "$HOME/miniconda3/.condarc"

# ---------- 2. MASt3R-SLAM（视频 → 点云）----------
STAGE "MASt3R-SLAM 环境（python 3.11 + torch 2.7.1+cu128 + cuda-toolkit 12.9）"
conda create -y -n mast3r python=3.11 >> "$LOG" 2>&1 && OK "mast3r conda 环境" || FAIL "mast3r conda 环境"
MPY="$HOME/miniconda3/envs/mast3r/bin/python"
MPIP="$MPY -m pip"
# 注意：清华镜像不收 +cu128 本地版本轮子，torch 必须走 PyTorch 官方索引
if $MPY -c 'import torch' >> "$LOG" 2>&1; then OK "torch 已安装（跳过下载）"; else
$MPIP install torch==2.7.1+cu128 torchvision==0.22.1+cu128 --index-url https://download.pytorch.org/whl/cu128 >> "$LOG" 2>&1 && OK "torch 2.7.1+cu128（Blackwell 兼容）" || FAIL "torch 安装"
fi
conda install -y -n mast3r -c conda-forge cuda-toolkit=12.9 >> "$LOG" 2>&1 || conda install -y -n mast3r -c conda-forge cuda-toolkit=12.8 >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "cuda-toolkit（编译用 nvcc）" || FAIL "cuda-toolkit"
export CUDA_HOME="$HOME/miniconda3/envs/mast3r"   # CUDA 扩展编译必需（不设报 OSError: CUDA_HOME is not set）
# conda-forge CUDA12 的头文件不在 $PREFIX/include，而在 targets/x86_64-linux/include；
# nvcc 自己会找，但 g++ 编译 #include <cuda.h> 的 C++ 扩展（lietorch）必须显式给路径
export CPLUS_INCLUDE_PATH="$HOME/miniconda3/envs/mast3r/targets/x86_64-linux/include:${CPLUS_INCLUDE_PATH:-}"
export C_INCLUDE_PATH="$HOME/miniconda3/envs/mast3r/targets/x86_64-linux/include:${C_INCLUDE_PATH:-}"

if [ ! -d "$HOME/MASt3R-SLAM" ]; then
  git clone https://github.com/rmurai0610/MASt3R-SLAM.git "$HOME/MASt3R-SLAM" --recursive >> "$LOG" 2>&1
fi
cd "$HOME/MASt3R-SLAM"
git checkout windows 2>/dev/null || true   # WSL 官方建议分支
# 子模块偶发卡死（imgui 小仓库克隆 30 分钟不动）→ timeout 兜底，缺文件的再手动浅克隆
timeout 600 git submodule update --init --recursive >> "$LOG" 2>&1
IMGUI_DIR=thirdparty/in3d/thirdparty/pyimgui/imgui-cpp
if [ ! -f "$IMGUI_DIR/imgui.h" ]; then
  PIN=$(git -C thirdparty/in3d/thirdparty/pyimgui ls-tree HEAD imgui-cpp 2>/dev/null | awk '{print $3}')
  rm -rf "$IMGUI_DIR"
  git clone --depth 1 https://github.com/ocornut/imgui.git "$IMGUI_DIR" >> "$LOG" 2>&1
  if [ -n "$PIN" ]; then (cd "$IMGUI_DIR" && git fetch --depth 1 origin "$PIN" 2>/dev/null && git checkout -q FETCH_HEAD) || true; fi
  [ -f "$IMGUI_DIR/imgui.h" ] && OK "imgui-cpp 手动补齐" || FAIL "imgui-cpp"
fi
# ---- torch 2.7 + Blackwell 兼容补丁（RTX 50 必须用新 torch，MASt3R 老内核写法需修补）----
# 1) pyimgui 的 core.h 是 Cython 构建期生成物；且必须 Cython<3（3.x 收紧 cimport 解析，pyimgui 报 cimgui.pxd not found）
$MPIP install -q 'cython<3'
# 2) torch 2.7 移除了 at::DeprecatedTypeProperties：AT_DISPATCH 宏参数 .type() → .scalar_type()
sed -i 's/AT_DISPATCH_FLOATING_TYPES_AND_HALF(tokens\.type()/AT_DISPATCH_FLOATING_TYPES_AND_HALF(tokens.scalar_type()/' thirdparty/mast3r/dust3r/croco/models/curope/kernels.cu
sed -i 's/AT_DISPATCH_FLOATING_TYPES_AND_HALF(D11\.type()/AT_DISPATCH_FLOATING_TYPES_AND_HALF(D11.scalar_type()/' mast3r_slam/backend/src/matching_kernels.cu
# 3) torch 2.7 移除了 torch::linalg::linalg_norm 命名空间形式
sed -i 's/torch::linalg::linalg_norm/torch::linalg_norm/g' mast3r_slam/backend/src/gn_kernels.cu
# 4) 本体 setup.py 硬编码架构列表只到 compute_86，Blackwell(sm_120) 无内核可用 → 追加
grep -q 'compute_120' setup.py || sed -i 's|"-gencode=arch=compute_86,code=sm_86",|"-gencode=arch=compute_86,code=sm_86",\n        "-gencode=arch=compute_120,code=sm_120",\n        "-gencode=arch=compute_120,code=compute_120",|' setup.py
# 5) 运行期两处环境修复：
#    a. in3d 的 moderngl 需要 libGL.so（WSL 默认没有，WSLg 提供虚拟显示）
apt-get install -y libgl1 libgl-dev libglx-mesa0 libegl1 >> "$LOG" 2>&1
#    b. torch2.6+ torch.load 默认 weights_only=True，MASt3R 旧权重（含 argparse.Namespace）加载失败 → 显式关掉
for f in $(grep -rln 'torch\.load(' --include='*.py' thirdparty/mast3r mast3r_slam 2>/dev/null); do
  grep -q 'weights_only' "$f" || sed -i 's/torch\.load(\([^)]*\))/torch.load(\1, weights_only=False)/g' "$f"
done
$MPIP install -e thirdparty/mast3r --no-build-isolation >> "$LOG" 2>&1 && OK "mast3r 子模块" || FAIL "mast3r 子模块"
$MPIP install -e thirdparty/in3d --no-build-isolation >> "$LOG" 2>&1 && OK "in3d 子模块" || FAIL "in3d 子模块"
# ---- lietorch：PyPI 的预编译轮子是 CUDA11（import 报 libcudart.so.11.0），必须本地源码编译（Blackwell sm_120 + CUDA12）----
# 5) pyproject 里 lietorch 的 git 依赖改成普通依赖，避免 pip 用 --filter=blob:none 部分克隆卡网络（镜像站不支持）
sed -i 's|"lietorch @ git+https://github.com/princeton-vl/lietorch.git"|"lietorch"|' pyproject.toml
if [ ! -d "$HOME/lietorch/.git" ]; then
  rm -rf "$HOME/lietorch"
  git clone --depth 1 https://github.com/princeton-vl/lietorch.git "$HOME/lietorch" >> "$LOG" 2>&1
fi
cd "$HOME/lietorch"
# eigen 是 lietorch 的子模块（浅克隆不带）；拉取失败就复用 MASt3R 的 eigen
if [ ! -f eigen/Eigen/Dense ]; then
  git submodule update --init eigen >> "$LOG" 2>&1
  [ ! -f eigen/Eigen/Dense ] && cp -r "$HOME/MASt3R-SLAM/thirdparty/eigen" eigen
fi
$MPIP install . --no-build-isolation >> "$LOG" 2>&1 && OK "lietorch 源码编译" || FAIL "lietorch 源码编译"
cd "$HOME/MASt3R-SLAM"
$MPIP install --no-build-isolation -e . >> "$LOG" 2>&1 && OK "MASt3R-SLAM 本体" || FAIL "MASt3R-SLAM 本体"
mkdir -p checkpoints
wget -q -nc https://download.europe.naverlabs.com/ComputerVision/MASt3R/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric.pth -P checkpoints/ >> "$LOG" 2>&1
wget -q -nc https://download.europe.naverlabs.com/ComputerVision/MASt3R/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric_retrieval_trainingfree.pth -P checkpoints/ >> "$LOG" 2>&1
wget -q -nc https://download.europe.naverlabs.com/ComputerVision/MASt3R/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric_retrieval_codebook.pkl -P checkpoints/ >> "$LOG" 2>&1
ls -la checkpoints/ | tee -a "$LOG"

# ---------- 3. SpatialLM（点云 → 结构化布局）----------
STAGE "SpatialLM 环境（python 3.11 + torch 2.7.1+cu128）"
conda create -y -n spatiallm python=3.11 >> "$LOG" 2>&1 && OK "spatiallm conda 环境" || FAIL "spatiallm conda 环境"
SPY="$HOME/miniconda3/envs/spatiallm/bin/python"
SPIP="$SPY -m pip"
if $SPY -c 'import torch' >> "$LOG" 2>&1; then OK "torch 已安装（跳过下载）"; else
$SPIP install torch==2.7.1+cu128 torchvision==0.22.1+cu128 --index-url https://download.pytorch.org/whl/cu128 >> "$LOG" 2>&1 && OK "torch 2.7.1+cu128" || FAIL "torch"
fi
conda install -y -n spatiallm -c conda-forge sparsehash >> "$LOG" 2>&1
conda install -y -n spatiallm -c conda-forge cuda-toolkit=12.9 >> "$LOG" 2>&1 || conda install -y -n spatiallm -c conda-forge cuda-toolkit=12.8 >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "cuda-toolkit" || FAIL "cuda-toolkit"
export CUDA_HOME="$HOME/miniconda3/envs/spatiallm"

if [ ! -d "$HOME/SpatialLM" ]; then
  git clone https://github.com/manycore-research/SpatialLM.git "$HOME/SpatialLM" >> "$LOG" 2>&1
fi
cd "$HOME/SpatialLM"
# pip26 拒绝 poetry 的 ^2.4.1+cu124 局部版本写法 → 去标签后再装
sed -i 's/\^2\.4\.1+cu124/\^2.4.1/g; s/\^0\.19\.1+cu124/\^0.19.1/g' pyproject.toml
$SPIP install poetry-core >> "$LOG" 2>&1
$SPIP install -e . --no-deps --no-build-isolation >> "$LOG" 2>&1 && OK "spatiallm 包（跳过 poetry，手动装依赖）" || FAIL "spatiallm 包"
# 推理所需依赖（numpy 固定 1.26 以兼容 open3d 0.18；timm 是 sonata_encoder 必需导入）
$SPIP install "numpy==1.26.4" transformers==4.46.1 safetensors pandas einops scipy scikit-learn toml tokenizers huggingface_hub shapely bbox terminaltables "open3d==0.18.0" addict poethepoet tqdm timm >> "$LOG" 2>&1 && OK "推理依赖" || FAIL "推理依赖"

STAGE "编译依赖（torch-scatter / spconv-cu126 / flash-attn）"
$SPIP install torch-scatter >> "$LOG" 2>&1 || $SPIP install torch-scatter -f https://data.pyg.org/whl/torch-2.7.0+cu128.html >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "torch-scatter" || FAIL "torch-scatter"
# spconv-cu128 在 PyPI 不存在；plain spconv 是 CPU-only（推理必报 not implemented for CPU ONLY build）
# → 用 spconv-cu126（2.3.8 起支持 sm_120，与 torch 2.7.1+cu128 实测兼容）
$SPIP install 'spconv-cu126>=2.3.8' -i https://pypi.org/simple >> "$LOG" 2>&1 && OK "spconv-cu126" || FAIL "spconv（SpatialLM1.1 必需，失败需源码编译）"
# flash-attn 是 1.1 Qwen 点编码器的必需依赖（无降级，assert 直接失败）→ 无隔离源码编译（约 10-25 分钟）
$SPIP install flash-attn --no-build-isolation >> "$LOG" 2>&1 && OK "flash-attn（必需）" || FAIL "flash-attn（必需，失败需排查编译环境）"

# ---------- 4. 模型权重 ----------
STAGE "下载模型权重（SpatialLM1.1-Qwen-0.5B + 官方测试点云）"
cd "$HOME/SpatialLM"
$SPIP install "huggingface_hub[cli]" >> "$LOG" 2>&1
$SPY -m huggingface_hub.commands.huggingface_cli download manycore-research/SpatialLM1.1-Qwen-0.5B --local-dir spatiallm-model >> "$LOG" 2>&1 && OK "模型权重" || FAIL "模型权重下载"
$SPY -m huggingface_hub.commands.huggingface_cli download manycore-research/SpatialLM-Testset pcd/scene0000_00.ply --repo-type dataset --local-dir . >> "$LOG" 2>&1 && OK "测试点云" || FAIL "测试点云下载"

# ---------- 5. 官方示例验证 ----------
STAGE "官方示例验证（scene0000_00.ply → test.txt）"
cd "$HOME/SpatialLM"
$SPY inference.py --point_cloud pcd/scene0000_00.ply --output test.txt --model_path spatiallm-model >> "$LOG" 2>&1
if [ -s test.txt ]; then
  OK "官方示例推理成功，前 30 行见下："
  head -30 test.txt | tee -a "$LOG"
else
  FAIL "官方示例推理失败（看日志尾部）"
fi

echo "========================" | tee -a "$LOG"
echo "全部阶段结束，日志: $LOG" | tee -a "$LOG"
grep "❌" "$LOG" || echo "无失败项 🎉" | tee -a "$LOG"
