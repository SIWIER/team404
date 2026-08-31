#!/bin/bash
# spatiallm-launch.sh — 脱离会话重启 SLAM（setsid + no-viz + 直连 env python）
cd /root/MASt3R-SLAM
export PATH=/root/miniconda3/envs/mast3r/bin:$PATH
setsid nohup /root/miniconda3/envs/mast3r/bin/python -u main.py --dataset room_tour.mp4 --config config/video8g.yaml --no-viz > /root/mast3r-run4.log 2>&1 < /dev/null &
sleep 3
PID=$(pgrep -f 'main.py --dataset room_tour' | head -1)
echo "LAUNCHED_PID=$PID"
tail -3 /root/mast3r-run4.log
