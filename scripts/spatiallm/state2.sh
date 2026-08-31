#!/bin/bash
# spatiallm-state2.sh — 确认 python 是否还活着
echo "==== 所有 python 进程 ===="
ps aux | grep python | grep -v grep | head -6
echo "==== GPU ===="
nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader
echo "==== 日志大小/尾部 ===="
ls -la /root/mast3r-run3.log
tail -20 /root/mast3r-run3.log
echo STATE2_DONE
