#!/bin/bash
# spatiallm-state.sh — 检查上次运行的进度与产出
echo "==== SLAM 进程 ===="
ps aux | grep -E 'main\.py' | grep -v grep | head -2
echo "==== run2 日志尾部 ===="
tail -12 /root/mast3r-run2.log 2>/dev/null || echo "(无日志)"
echo "==== outputs 里的 ply ===="
find /root/MASt3R-SLAM/outputs -name '*.ply' 2>/dev/null | head -5
find /root/MASt3R-SLAM -maxdepth 2 -name '*.ply' 2>/dev/null | head -5
echo "==== 日志大小 ===="
ls -la /root/mast3r-run2.log 2>/dev/null
echo STATE_DONE
