#!/bin/bash
# SpatialLM 预研环境一键安装（WSL2 Ubuntu / RTX 50 系 Blackwell）
# 用法（WSL 内以 root 运行）: bash ~/spatiallm-setup.sh
# 说明详见 docs/SPATIALLM_ENV.md；日志: ~/spatiallm-setup.log
# 注意: RTX 50 系必须 torch 2.7.1+cu128（官方文档的 cu124 不支持 sm_120）
set -u
LOG="$HOME/spatiallm-setup.log"
STAGE() { echo "[$(date +%H:%M:%S)] ====== $1 ======" | tee -a "$LOG"; }
OK()   { echo "[$(date +%H:%M:%S)] ✅ $1" | tee -a "$LOG"; }
FAIL() { echo "[$(date +%H:%M:%S)] ❌ $1" | tee -a "$LOG"; }

# 镜像源 + Blackwell 编译目标（sm_120 = RTX 5060 等 50 系显卡）
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export HF_ENDPOINT=https://hf-mirror.com
export TORCH_CUDA_ARCH_LIST="12.0"

# ---------- 0. 基础工具 ----------
STAGE "apt 基础工具"
apt-get update -y >> "$LOG" 2>&1 && apt-get install -y build-essential git curl wget ca-certificates cmake ninja-build >> "$LOG" 2>&1 && OK "apt 基础工具" || FAIL "apt"

# ---------- 1. Miniconda ----------
STAGE "Miniconda"
if [ ! -d "$HOME/miniconda3" ]; then
  wget -q https://mirrors.tuna.tsinghua.edu.cn/anaconda/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/mc.sh || wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/mc.sh
  bash /tmp/mc.sh -b -p "$HOME/miniconda3" >> "$LOG" 2>&1 && OK "Miniconda" || FAIL "Miniconda"
fi
source "$HOME/miniconda3/etc/profile.d/conda.sh"
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main >> "$LOG" 2>&1
conda config --add channels https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge >> "$LOG" 2>&1
conda config --set channel_priority flexible >> "$LOG" 2>&1

# ---------- 2. MASt3R-SLAM（视频 → 点云）----------
STAGE "MASt3R-SLAM 环境（python 3.11 + torch 2.7.1+cu128 + cuda-toolkit 12.9）"
conda create -y -n mast3r python=3.11 >> "$LOG" 2>&1 && OK "mast3r conda 环境" || FAIL "mast3r conda 环境"
MPY="$HOME/miniconda3/envs/mast3r/bin/python"
MPIP="$MPY -m pip"
$MPIP install torch==2.7.1+cu128 torchvision==0.22.1+cu128 >> "$LOG" 2>&1 && OK "torch 2.7.1+cu128（Blackwell 兼容）" || FAIL "torch 安装"
conda install -y -n mast3r -c conda-forge cuda-toolkit=12.9 >> "$LOG" 2>&1 || conda install -y -n mast3r -c conda-forge cuda-toolkit=12.8 >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "cuda-toolkit（编译用 nvcc）" || FAIL "cuda-toolkit"

if [ ! -d "$HOME/MASt3R-SLAM" ]; then
  git clone https://github.com/rmurai0610/MASt3R-SLAM.git "$HOME/MASt3R-SLAM" --recursive >> "$LOG" 2>&1
fi
cd "$HOME/MASt3R-SLAM"
git checkout windows 2>/dev/null || true   # WSL 官方建议分支
git submodule update --init --recursive >> "$LOG" 2>&1
$MPIP install -e thirdparty/mast3r >> "$LOG" 2>&1 && OK "mast3r 子模块" || FAIL "mast3r 子模块"
$MPIP install -e thirdparty/in3d >> "$LOG" 2>&1 && OK "in3d 子模块" || FAIL "in3d 子模块"
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
$SPIP install torch==2.7.1+cu128 torchvision==0.22.1+cu128 >> "$LOG" 2>&1 && OK "torch 2.7.1+cu128" || FAIL "torch"
conda install -y -n spatiallm -c conda-forge sparsehash >> "$LOG" 2>&1
conda install -y -n spatiallm -c conda-forge cuda-toolkit=12.9 >> "$LOG" 2>&1 || conda install -y -n spatiallm -c conda-forge cuda-toolkit=12.8 >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "cuda-toolkit" || FAIL "cuda-toolkit"

if [ ! -d "$HOME/SpatialLM" ]; then
  git clone https://github.com/manycore-research/SpatialLM.git "$HOME/SpatialLM" >> "$LOG" 2>&1
fi
cd "$HOME/SpatialLM"
$SPIP install -e . --no-deps >> "$LOG" 2>&1 && OK "spatiallm 包（跳过 poetry，手动装依赖）" || FAIL "spatiallm 包"
# 推理所需依赖（numpy 固定 1.26 以兼容 open3d 0.18）
$SPIP install "numpy==1.26.4" transformers==4.46.1 safetensors pandas einops scipy scikit-learn toml tokenizers huggingface_hub shapely bbox terminaltables "open3d==0.18.0" addict poethepoet tqdm >> "$LOG" 2>&1 && OK "推理依赖" || FAIL "推理依赖"

STAGE "编译依赖（spconv / torch-scatter / flash-attn，失败可后续手动修）"
$SPIP install torch-scatter >> "$LOG" 2>&1 || $SPIP install torch-scatter -f https://data.pyg.org/whl/torch-2.7.0+cu128.html >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "torch-scatter" || FAIL "torch-scatter"
$SPIP install spconv-cu128 >> "$LOG" 2>&1 || $SPIP install spconv >> "$LOG" 2>&1
[ $? -eq 0 ] && OK "spconv" || FAIL "spconv（SpatialLM1.1 必需，若失败需手动编译）"
$SPIP install flash-attn >> "$LOG" 2>&1 && OK "flash-attn（可选加速）" || FAIL "flash-attn（可选，不影响推理，可跳过）"

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
