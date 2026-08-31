#!/bin/bash
# spatiallm-prep3.sh — 查 systemd + main.py 可视化参数
echo "==== PID 1 ===="
ps -p 1 -o comm=
echo "==== main.py 参数（可视化相关）===="
grep -n 'add_argument' /root/MASt3R-SLAM/main.py | grep -iE 'viz|headless|view|offline|demo|log' | head -10
echo "==== 全部参数 ===="
grep -n 'add_argument' /root/MASt3R-SLAM/main.py | head -20
echo PREP3_DONE
