#!/bin/bash
# spatiallm-prog2.sh — 看运行进度（进程/输出目录）
echo "==== python 进程 ===="
ps aux | grep 'main.py' | grep -v grep | awk '{print $2, $3"%cpu", $4"%mem", $10}'
echo "==== outputs 目录 ===="
ls -la /root/MASt3R-SLAM/outputs/ 2>/dev/null | head -8
echo "==== 最新目录内容 ===="
LATEST=$(ls -t /root/MASt3R-SLAM/outputs/*/ 2>/dev/null | head -1)
echo "latest: $LATEST"
ls "$LATEST" 2>/dev/null | head -10
echo PROG2_DONE
