# 🔁 物品数字化存放系统 · 跨对话续接引导文案

> 把下面整段粘贴给新对话的 AI 即可无缝接手。

```
我在继续开发「找眼镜助手 / 物品数字化存放系统」。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404，main 分支）。
动手前请先读（按顺序）：
1. docs/PROJECT_PROGRESS.md —— 项目进度与分工
2. docs/SDD.md —— 架构与全部接口契约（第 4 节接口表；物品模块见 §5.7）
3. docs/HARDWARE_RFID.md —— 硬件方向（无实物设计）
4. docs/VIDEO_SCRIPT.md —— 演示视频台词（演示口径）
5. DEVELOPMENT.md —— 协作规范（迁移只增不改/测试全绿/模块边界）
6. miniprogram/README.md —— 小程序开发约定

项目现状（截至 commit <本提交>）：
- 产品已转型「物品数字化存放系统」：多目录（家/公司/宿舍…，src/modules/spaces，迁移 v9），
  每目录独立户型图（10×10 细网格、房间按面积多格、furn 家具模块），profiles.home_layout 恒等于当前目录户型图。
- 物品管理 P1+P2 已完成（src/modules/items/，迁移 v10 items 表）：
  · P1：POST /api/items 录入（图片 base64 落盘 data/uploads/{userId}/ + 三级位置）、
    GET /api/items?q=&space_id= 文字检索（返回 spaceName/locationFull 完整位置链）、
    GET /api/items/:id/image 图片回读、DELETE /api/items/:id 删除（连图片）。
  · P2：GET /api/items/config 能力探测；POST /api/items/recognize 图文识别（LLM_VISION，
    限流 5 次/分/IP，keyFn 命名空间隔离）；POST /api/items/search-image 图图/文图向量检索
    （{image}|{text} 二选一 → Chinese-CLIP 向量 + 暴力余弦 top10；向量存 items.clip_vec，
    懒回填每次 ≤20 条；未部署 503 CLIP_NOT_CONFIGURED，参考 scripts/clip-server/）。
- Chinese-CLIP 已在本机部署并端到端验证通过：scripts/clip-server/.venv（torch 2.13.0+cpu +
  cn_clip 1.6.0，lmdb 用 --no-deps 跳过——仅训练用）、权重 scripts/clip-server/models/
  （ViT-B-16，718MB）、双击 scripts/clip-server/start-clip.bat 启动（端口 8899）；
  本机 .env 已追加 CLIP_BASE_URL=http://127.0.0.1:8899（其他机器需各自部署/配置）。
  实测：图图检索同图排首位 score=1.0、异图 0.88；文图检索排序正确。
- 小程序：pages/items/ 录入页（拍照→预览→自动识别名→目录→房间→收纳家具→子位置四级选择）
  + 检索页（文字/拍照找同款/文字找物品 → 缩略图+位置链列表 → 点开跳 pages/layout/?highlight=房间名 高亮）；
  首页「物品管理」入口；app.json 已注册。
- 演示账号：xiaoming/123456（眼镜盒定位器演示）、xiaohong/123456（无设备演示）。
- 测试：node --test 应全绿（当前 136 项）。端口占用：m1-m5=18081-18086、ws=18085、m6=18087+18088-18092、
  m7=18093+18094、m9=18095、m8=18096、m10=18100+18101-18103；新增测试请从 18104 起。
  git 连不上先测代理：127.0.0.1:7890，在监听则
  git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 <命令>。

【下一步工作池（按需认领）】
1. 给 xiaoming 预置几件带照片的示例物品（seed，演示物品管理页更直观）。
2. 小程序 items 页真机联调（微信开发者工具导入 miniprogram/，见 README）。
3. 图文识别提示词按实测效果微调（items.vision.js 的 buildItemPrompt）。
4. 团队其他成员的机器：按 scripts/clip-server/README.md 部署 CLIP 服务 + 各自 .env 配 CLIP_BASE_URL。

【验收】node --test 全绿；node --check 通过新文件；提交信息 feat(items): 中文说明；推送到 origin main。

【安全】绝不改动/粘贴 .env 内容；图片路径校验防目录穿越（items.service.safeImagePath / items.clip.readItemImage）；
数据只查本人 user_id。
```
