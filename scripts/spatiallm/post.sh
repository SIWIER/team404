#!/bin/bash
# spatiallm-post.sh — 点云产出后的 对齐 → SpatialLM 推理 全自动
set -u
set -o pipefail
source /root/miniconda3/etc/profile.d/conda.sh
SPY=/root/miniconda3/envs/spatiallm/bin/python

echo "== 1 找最新 ply =="
PLY=$(find /root/MASt3R-SLAM/outputs -name '*.ply' 2>/dev/null | sort | tail -1)
if [ -z "$PLY" ]; then
  echo "❌ 还没找到 ply（SLAM 可能还在跑或失败）"
  exit 1
fi
echo "ply: $PLY ($(du -h "$PLY" | cut -f1))"

echo "== 2 对齐 + 缩放（align.py）=="
ALIGN=/mnt/e/AI\ related/find-my-glasses-pro/scripts/spatiallm/align.py
cd /root/SpatialLM
conda run -n spatiallm python "$ALIGN" "$PLY" /root/SpatialLM/aligned.ply 2>&1 | tail -5
ls -la /root/SpatialLM/aligned.ply 2>/dev/null || { echo "❌ align 失败"; exit 1; }

echo "== 3 SpatialLM 推理（点云 → 结构化布局）=="
conda run -n spatiallm python inference.py --point_cloud /root/SpatialLM/aligned.ply --output /root/SpatialLM/room_layout.txt --model_path spatiallm-model 2>&1 | tail -8
echo "---- room_layout.txt ----"
head -40 /root/SpatialLM/room_layout.txt 2>/dev/null
echo POST_DONE
