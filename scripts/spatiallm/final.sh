#!/bin/bash
# spatiallm-final.sh — 查看 run3 日志与结果
echo "==== 日志大小 ===="
ls -la /root/mast3r-run3.log
echo "==== 日志尾部 50 行 ===="
tail -50 /root/mast3r-run3.log
echo "==== 找 ply（全盘）===="
find /root/MASt3R-SLAM -name '*.ply' 2>/dev/null | head -5
find /root -maxdepth 3 -name '*.ply' 2>/dev/null | head -5
echo FINAL_DONE
