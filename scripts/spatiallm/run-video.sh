#!/bin/bash
# spatiallm-run-video.sh — TUM 室内序列 → mp4 视频素材 → MASt3R-SLAM 跑点云（阶段0 验证）
set -u
set -o pipefail
source /root/miniconda3/etc/profile.d/conda.sh
TUMROOT=/root/MASt3R-SLAM/datasets/tum
TUM=$TUMROOT/rgbd_dataset_freiburg1_room

echo "== 1 解压 TUM 序列 =="
mkdir -p "$TUMROOT"
if [ ! -d "$TUM/rgb" ]; then
  tar -xzf "/mnt/e/AI related/find-my-glasses-pro/data/rgbd_dataset_freiburg1_room.tgz" -C "$TUMROOT" 2>&1 | tail -1
fi
ls "$TUM" 2>/dev/null | head -10
echo "帧数: $(ls "$TUM/rgb"/*.png 2>/dev/null | wc -l)"

echo "== 2 转成 mp4 视频素材（30fps H.264，iPhone 拍摄口径一致）=="
ffmpeg -y -loglevel error -framerate 30 -pattern_type glob -i "$TUM/rgb/*.png" -c:v libx264 -pix_fmt yuv420p /root/MASt3R-SLAM/room_tour.mp4
ls -la /root/MASt3R-SLAM/room_tour.mp4

echo "== 3 准备 8GB 显存配置（subsample=2）=="
cat > /root/MASt3R-SLAM/config/video8g.yaml <<'EOF'
inherit: "config/base.yaml"
dataset:
  subsample: 2
EOF
cat /root/MASt3R-SLAM/config/video8g.yaml

echo "== 4 跑 MASt3R-SLAM（视频 → 点云，耗时长，后台跑）=="
cd /root/MASt3R-SLAM
conda run -n mast3r python main.py --dataset room_tour.mp4 --config config/video8g.yaml 2>&1 | tee /root/mast3r-run.log | tail -5
echo "run exit=$?"
echo RUN_DONE
