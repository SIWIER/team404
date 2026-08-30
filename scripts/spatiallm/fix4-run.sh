#!/bin/bash
# spatiallm-fix4.sh — 修 libGL 缺失 + torch.load weights_only 补丁 → 重跑
set -u
set -o pipefail
cd /root/MASt3R-SLAM

echo "== 1 装 mesa OpenGL 库（moderngl 需要 libGL.so；WSLg 提供虚拟显示）=="
export DEBIAN_FRONTEND=noninteractive
apt-get install -y libgl1 libgl-dev libglx-mesa0 libegl1 2>&1 | tail -1
ls /usr/lib/x86_64-linux-gnu/libGL.so* 2>/dev/null | head -3

echo "== 2 torch.load 补丁（torch2.6+ 默认 weights_only=True 会拒绝旧权重）=="
grep -rln 'torch\.load(' --include='*.py' . 2>/dev/null | grep -v thirdparty/in3d | head -10
for f in $(grep -rln 'torch\.load(' --include='*.py' . 2>/dev/null | grep -v thirdparty/in3d); do
  if ! grep -q 'weights_only' "$f"; then
    sed -i 's/torch\.load(\([^)]*\))/torch.load(\1, weights_only=False)/g' "$f"
    echo "patched: $f"
  fi
done

echo "== 3 重跑 MASt3R-SLAM（视频 → 点云）=="
source /root/miniconda3/etc/profile.d/conda.sh
conda run -n mast3r python main.py --dataset room_tour.mp4 --config config/video8g.yaml 2>&1 | tee /root/mast3r-run2.log | tail -6
echo "run exit=$?"
echo FIX4_DONE
