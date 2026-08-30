#!/bin/bash
# spatiallm-fix3f.sh — MASt3R 全套 torch 2.7 / Blackwell 补丁 + 重建
set -u
set -o pipefail
export TMPDIR=/root/tmp
mkdir -p /root/tmp
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export CUDA_HOME=/root/miniconda3/envs/mast3r
export TORCH_CUDA_ARCH_LIST="12.0"
export MAX_JOBS=6
MPY=/root/miniconda3/envs/mast3r/bin/python
cd /root/MASt3R-SLAM

echo "== 1 装 Cython（pyimgui 的 core.h 是 Cython 构建期生成物）=="
$MPY -m pip install -q cython && echo OK_cython || echo FAIL_cython

echo "== 2 打 torch 2.7 兼容补丁 =="
# 2.1 curope: AT_DISPATCH 宏不再接受 DeprecatedTypeProperties（.type() → .scalar_type()）
sed -i 's/AT_DISPATCH_FLOATING_TYPES_AND_HALF(tokens\.type()/AT_DISPATCH_FLOATING_TYPES_AND_HALF(tokens.scalar_type()/' thirdparty/mast3r/dust3r/croco/models/curope/kernels.cu
# 2.2 matching_kernels: 同上
sed -i 's/AT_DISPATCH_FLOATING_TYPES_AND_HALF(D11\.type()/AT_DISPATCH_FLOATING_TYPES_AND_HALF(D11.scalar_type()/' mast3r_slam/backend/src/matching_kernels.cu
# 2.3 gn_kernels: torch 2.7 移除了 torch::linalg::linalg_norm 命名空间形式
sed -i 's/torch::linalg::linalg_norm/torch::linalg_norm/g' mast3r_slam/backend/src/gn_kernels.cu
grep -c 'scalar_type()' thirdparty/mast3r/dust3r/croco/models/curope/kernels.cu mast3r_slam/backend/src/matching_kernels.cu
grep -c 'torch::linalg_norm' mast3r_slam/backend/src/gn_kernels.cu

echo "== 3 setup.py 架构列表加 sm_120（Blackwell 必需）=="
if ! grep -q 'compute_120' setup.py; then
  sed -i 's|"-gencode=arch=compute_86,code=sm_86",|"-gencode=arch=compute_86,code=sm_86",\n        "-gencode=arch=compute_120,code=sm_120",\n        "-gencode=arch=compute_120,code=compute_120",|' setup.py
fi
grep -n 'gencode' setup.py | head -10

echo "== 4 清残留构建产物 =="
rm -rf thirdparty/mast3r/build thirdparty/mast3r/dust3r/croco/models/curope/build
rm -rf thirdparty/in3d/thirdparty/pyimgui/build thirdparty/in3d/build
rm -rf build
$MPY -m pip uninstall -y curope 2>/dev/null | tail -1

echo "== 5 重建 mast3r 子模块（含 curope）=="
$MPY -m pip install -e thirdparty/mast3r --no-build-isolation > /root/mast3r-build4.log 2>&1
echo "mast3r_exit=$?"; tail -4 /root/mast3r-build4.log

echo "== 6 重建 in3d 子模块（含 pyimgui）=="
$MPY -m pip install -e thirdparty/in3d --no-build-isolation > /root/in3d-build4.log 2>&1
echo "in3d_exit=$?"; tail -4 /root/in3d-build4.log

echo "== 7 重建 MASt3R-SLAM 本体 =="
$MPY -m pip install -e . --no-build-isolation > /root/main-build4.log 2>&1
echo "main_exit=$?"; tail -4 /root/main-build4.log

echo "== 8 验证 =="
$MPY -c "import mast3r, in3d; print('mast3r/in3d import OK')" && echo OK_IMPORT || echo FAIL_IMPORT
echo FIX3F_ALL_DONE
