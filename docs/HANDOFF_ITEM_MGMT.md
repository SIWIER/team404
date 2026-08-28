# 🔁 物品数字化存放系统 · 跨对话续接引导文案

> 把下面整段粘贴给新对话的 AI 即可无缝接手。

```
我在继续开发「找眼镜助手 / 物品数字化存放系统」。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404，main 分支）。
动手前请先读（按顺序）：
1. docs/PROJECT_PROGRESS.md —— 项目进度与分工
2. docs/SDD.md —— 架构与全部接口契约（第 4 节接口表）
3. docs/HARDWARE_RFID.md —— 硬件方向（无实物设计）
4. docs/VIDEO_SCRIPT.md —— 演示视频台词（演示口径）
5. DEVELOPMENT.md —— 协作规范（迁移只增不改/测试全绿/模块边界）
6. miniprogram/README.md —— 小程序开发约定

项目现状（截至 commit ce82362 之后）：
- 产品已从"找眼镜"转型为「物品数字化存放系统」：每个用户可有多个目录（家/公司/宿舍…，
  src/modules/spaces，迁移 v9），每个目录独立一份户型图（10×10 细网格，房间按面积多格 cells、
  furn 家具模块），profiles.home_layout 恒等于当前目录户型图，推理引擎与旧接口零改动兼容。
- 小程序：首页目录切换 + 户型图预览；pages/layout/ 独立户型配置页（色块拼合/扩大缩小/悬浮标签）；
  pages/layout-scan/ 拍照识别户型（视觉模型 deepseek-v4-flash-vision-exp，自动禁用思维链）；
  推理页（无硬件补偿：画像 hardware 为空时强化行为/历史证据并锐化排名）；数据统计页；硬件页（无硬件用户不显示模拟设备）。
- 演示账号：xiaoming / 123456（登记眼镜盒定位器，硬件联动演示）、xiaohong / 123456（无设备演示）。
- 测试：node --test 应全绿（当前 122 项）。git 连不上先测代理：127.0.0.1:7890，在监听则
  git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 <命令>。

本次任务：实现「物品管理」（P1 起，团队已确认三项决策）：
【决策】①三种识别：图文（拍照→识别物品文字信息）、图图（拍照→找相同物品）、文图（文字→匹配物品图片）；
        ②图图/文图走 Chinese-CLIP 本地部署（向量库先用 SQLite 存向量+暴力余弦，参考
          github.com/OFA-Sys/Chinese-CLIP 与 github.com/Weydon-Ding/VectorGallery）；
        ③物品照片多端同步：上传后端本地存储（data/uploads/）。

【数据模型】迁移 v10 新增 items 表（后端 src/core/db.js 的 MIGRATIONS 末尾追加，只增不改）：
  items: id, user_id, space_id, name, desc, image_path, room, furn, sub_pos,
         clip_vec(可空，CLIP 向量), created_at, updated_at
  位置三级链 = 目录(space) → 房间(room，对应户型图房间名) → 收纳家具(furn) → 子位置(sub_pos，如"一层/二层")。

【后端】新模块 src/modules/items/items.service.js + items.routes.js，server.js 注册：
  POST /api/items       录入：{spaceId, name?, desc?, image(base64), mimeType, room, furn, subPos}
                        （图片解码保存到 data/uploads/{userId}/{itemId}.jpg，path 入库；name 未填时可由图文识别预填）
  GET  /api/items?q=&space_id=   检索：文字走 SQL LIKE 匹配 name/desc；返回物品列表（含位置链字段）
  DELETE /api/items/:id  删除物品（同时删图片文件）
  GET  /api/items/:id/image  返回图片 base64 JSON（{image, mimeType}，前端拼 data URL 渲染；核心 http 仅支持 JSON）
  （P2 再加：POST /api/items/search-image 图图/文图向量检索、POST /api/items/recognize 图文识别）
  注意模块边界：只 require 公开能力（accounts.getPublicUser 等）；零第三方依赖。

【小程序】新页面 pages/items/：录入页（拍照→预览→自动识别名→三级位置选择器）+ 检索页（文字/拍照检索→
  结果列表：缩略图+名称+位置链"家→书房→书架→二层"，点开跳 pages/layout/ 高亮房间）。app.json 注册。

【测试】新增 test/m9.items.test.js（照 m8.spaces.test.js 模式：独立端口 18094、独立测试库、登录 xiaoming）。

【验收】node --test 全绿；node --check 通过新文件；提交信息 feat(items): 中文说明；推送到 origin main。

【安全】绝不改动/粘贴 .env 内容；图片路径校验防目录穿越；用户数据只查本人 user_id。
```
