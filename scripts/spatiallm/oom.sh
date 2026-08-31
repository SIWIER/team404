#!/bin/bash
# spatiallm-oom.sh — 查 OOM 与系统状态
echo "==== dmesg 里的 kill/OOM ===="
dmesg 2>/dev/null | grep -iE 'killed process|out of memory|oom' | tail -8
echo "==== 内存现状 ===="
free -h
echo "==== conda run 是否还在 ===="
ps aux | grep -E 'conda run|main.py' | grep -v grep | head -3
echo OOM_DONE
