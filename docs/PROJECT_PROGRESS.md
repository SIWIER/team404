# 📋 找眼镜助手 · 项目进度与团队交接文档

> 本文档可发给团队新成员，用于**快速理解项目现状、接手开发**。
> 更新于 2026-08-20 ｜ 当前代码基线：Git 仓库 main 分支（3 次提交）

> 🔄 2026-08-27 更新（物品管理系统方向）：新增**目录（家/公司/宿舍…）**，每个目录独立一套户型图；房间可**双击展开内部模块**（书桌/书架/壁橱等，`furn` 字段）；后端 `/api/spaces*` 接口 + 迁移 v9，详见 `docs/SDD.md` 第 4 节。

---

## 0. 项目是什么（30 秒版）

帮"在家没戴眼镜的人"找回丢失眼镜的智能助手：

1. **模块化主界面**，多入口功能卡
2. **多账户登录** + 每人个性化智能体（画像/生活习惯/**家庭户型图**）
3. **问答式引导推理**：AI 结合生活常识、逻辑推理与个人历史数据，给出眼镜最可能的位置
4. **数据库 + 统计可视化**：找回记录持续积累，反哺推理
5. **硬件数据接入端口**：定位器/近场呼唤器/防丢标签（REST + WebSocket）

---

## 1. 现状总览（四个交付物）

| # | 交付物 | 位置 | 状态 | 端口 |
|---|---|---|---|---|
| 1 | Web 演示版 | `E:\AI related\find-my-glasses\` | ✅ 可演示（6 点演示用） | 8080 |
| 2 | Web 正式版（协作开发主仓库） | `E:\AI related\find-my-glasses-pro\` | ✅ M0-M5 全部完成 | 8081 |
| 3 | 微信小程序版（原生 WXML） | `find-my-glasses-pro\miniprogram\` | 🔨 骨架 + 核心三页完成 | 复用 8081 |
| 4 | 防丢标签 3D 外壳 | `find-my-glasses-pro\hardware\` | ✅ 可打印 STL 已导出 | — |

**关键结论：小程序/新前端无需改后端**——后端只出 JSON 接口，接口契约在 `docs/SDD.md` 第 4 节。

---

## 2. 开发历程时间线（我们走过了什么）

1. **演示版**（4 小时冲刺）：零依赖 Node + sqlite，四大模块一次成型，接入了真实 DeepSeek 大模型（失败自动回退内置常识引擎）
2. **正式版 M0-M5**（按模块迭代，每模块提交示例评审）：
   - M0 架构基础（分层/core/迁移/日志/ES 模块前端）
   - M1 账户与个性化智能体（scrypt + HMAC 令牌、画像）
   - M2 引导推理引擎（常识知识库 25 位置 14 行为、评分引擎、LLM 适配+回退、条件化问答、找到/未找到闭环）
   - M3 数据统计可视化（指标/智能洞察/SVG 图表/户型热力/分页/导入导出）
   - M4 硬件端口（设备注册、REST 上下行、手写 RFC6455 WebSocket、模拟器、定位注入推理）
   - M5 集成测试与部署（54 项测试、smoke 自检、限流、Docker、SDD/演示文档）
3. **用户反馈迭代**：
   - 画像增加**家庭布局/户型图**辅助推理
   - 新增**走廊**房间（全链路）
   - **无硬件设备**场景优雅降级
   - **户型图拖曳编辑器**（网格坐标）+ 空间感知推理（距离衰减 + "路过房间"追问加权）
4. **硬件探索**：确定防丢标签方案（ESP32-C3 + 蜂鸣器 + 锂电池），OpenSCAD 完成外壳模型并导出 STL
5. **协作化改造**：安装 Git、初始化仓库、DEVELOPMENT.md 协作指南、CI 配置、.editorconfig
6. **小程序迁移**：原生 WXML 工程骨架 + 登录/首页/推理三页完成
7. **物品数字化存放系统转型**：多目录（家/公司/宿舍…）+ 每目录独立户型图 + 房间内部模块；
   **物品管理模块**（`src/modules/items/`，迁移 v10）：拍照录入（图片落盘 `data/uploads/`、
   三级位置链）、文字检索、图文识别（LLM_VISION 自动识别名称/位置）、图图/文图向量检索
   （Chinese-CLIP 本地部署 + SQLite 存向量 + 暴力余弦，未部署自动降级）；
   小程序 `pages/items/` 录入页（拍照→预览→自动识别名→目录→房间→收纳家具→子位置四级选择）
   + 检索页（文字/拍照找同款/文字找物品 → 缩略图+位置链列表 → 跳户型图高亮房间）。

---

## 3. 目录结构与团队分工（照抄认领）

```
find-my-glasses-pro/
├─ server.js                 # 入口/装配【专人】
├─ src/
│  ├─ core/                  # 基础设施：db/http/auth/ws/ratelimit/logger【专人】
│  └─ modules/
│     ├─ accounts/           # 账户/画像/户型   → 成员 A
│     ├─ reason/             # 推理引擎/LLM     → 成员 B
│     ├─ data/               # 统计与数据分析   → 成员 C
│     └─ hardware/           # 硬件接入端口     → 成员 D
├─ public/                   # Web 前端（已完成）
│  └─ js/views/*.view.js     # 每页面一文件
├─ miniprogram/              # 微信小程序（3/6 页完成）
├─ test/                     # 98 项自动化测试
├─ scripts/smoke.js          # 演示前一键自检
├─ hardware/                 # 3D 外壳模型与 STL
└─ docs/                     # SDD / DEMO / 本文档
```

**铁律**：模块间只通过 REST 接口通信，不跨模块 require 对方内部实现。

---

## 4. 如何运行（新成员 5 分钟）

前提：Node.js ≥ 22.5（零依赖，**不需要 npm install**）。

```bash
# Web 正式版
cd find-my-glasses-pro
node server.js            # 或双击 start.bat → http://localhost:8081

# 测试（改完代码先跑这个）
node --test               # 136 项应全绿

# 演示前自检
node scripts/smoke.js
```

**演示账号**：`xiaoming / 123456`（小明，无走廊户型）、`xiaohong / 123456`（小红，含走廊）

**小程序**：微信开发者工具导入 `miniprogram/` → 测试号 → 勾选"不校验合法域名" → 编译（详见 `miniprogram/README.md`）

---

## 5. 接口摘要（完整版见 docs/SDD.md 第 4 节）

| 模块 | 主要接口 |
|---|---|
| 账户 | POST `/api/auth/register|login|logout` · GET `/api/auth/me` · PUT `/api/auth/profile`（含 homeLayout 户型坐标） |
| 账户（微信） | POST `/api/auth/wxlogin`（返回 `mode=login|autoRegister|needBind`）· POST `/api/auth/wxbind`（bindToken+账号密码绑定）· GET `/api/auth/wxconfig`（能力探测） |
| 推理 | GET `/api/reason/flow` · POST `/api/reason/infer` · POST `/api/reason/record` |
| 数据 | GET `/api/data/stats|records|export` · DELETE `/api/data/records/:id` · POST `/api/data/import` |
| 硬件 | GET/POST/DELETE `/api/hardware/devices(/:id)` · POST `…/:id/report`（上行）· POST `…/:id/command`（下行）· WS `/ws?token=` 实时推送 |
| 目录 | GET/POST `/api/spaces` · PUT/DELETE `/api/spaces/:id` · PUT `…/:id/layout|active` |
| 物品 | POST `/api/items` · GET `/api/items?q=` · GET/DELETE `/api/items/:id(/:image)` · POST `/api/items/recognize`（图文识别）· POST `/api/items/search-image`（图图/文图向量）· GET `/api/items/config` |
| 系统 | GET `/api/health` |

鉴权：`Authorization: Bearer <token>`（HMAC 签名，登录获得）。

**推理引擎权重速览**（`src/modules/reason/engine.js` 可调）：
`基础概率 × 行为加成 × 追问加成 × 户型距离衰减(连续: 同房1.8×面积因子 / 相邻1.3 / d≥1按1.3×0.85^(d-1)衰减下限0.6) × 路过房间(1.6) × 定位提示(同房6.0×面积因子 / 1.8×0.75^(d-1)衰减, <0.8视为无信号) × 时段(1.4) × 历史(1+0.5n) × 偏好(1.35)；面积因子=1+0.32×log₂(格数)封顶2.0`

---

## 6. 协作约定（新成员必读 DEVELOPMENT.md）

- 分支：`main`（永远可演示）← 每人 `feat/xxx` 分支 → PR → 至少 1 人 Review → 合并
- 提交信息：`feat(模块): 中文说明`
- 本地过 `node --test` + `node --check` 再提 PR
- CI：推送自动跑全部测试（`.github/workflows/test.yml`），红灯不合并
- 任务管理：仓库 Issues 认领，`fixes #编号` 关联

---

## 7. 待办事项（下一步工作池）

| 优先级 | 事项 | 认领建议 |
|---|---|---|
| 🔴 高 | 小程序 data 页（ECharts ec-canvas 图表 + 户型热力网格） | 成员 C |
| ✅ 完成 | 小程序 profile 页（画像表单 + movable-view 户型拖拽 + 隐私说明） | 成员 A |
| ✅ 完成 | 微信一键登录（后端 `/api/auth/wxlogin` + 前端 wx.login + 自动注册/绑定二选一） | 成员 B |
| ✅ 完成 | 小程序 hardware 页（设备卡片/指令/注册/WS 实时事件流） | 成员 D |
| ✅ 完成 | 设备轮询契约（GET pending + POST ack + 模拟/真实设备区分） | 成员 D |
| ✅ 完成 | 防丢标签固件 v1（`hardware/firmware/`，零第三方库，待实机联调） | 成员 D |
| 🟢 低 | 3D 外壳按实板微调、组装测试（STL 已可打印） | 成员 D |
| ✅ 完成 | **户型图照片智能识别**（后端 `layout` 模块 + 小程序 `layout-scan` 页；视觉模型识图 → 预览确认 → 应用到户型网格） | 成员 E |
| ✅ 完成 | **物品管理 P1+P2**（后端 `items` 模块：录入/文字检索/图文识别/图图文图向量检索；小程序 `pages/items/` 录入+检索页；m9/m10 测试） | — |
| ⏳ 待做 | 部署 Chinese-CLIP 本地服务并实机联调图图/文图检索（参考 `scripts/clip-server/`，未部署自动降级） | — |
| ⏳ 待做 | 演示数据：给 xiaoming 预置几件带照片的示例物品（seed） | — |

> 📋 需求调查问卷已存档于 `docs/SURVEY.md`（含回收结论填写模板）；跨对话交接模板见 `docs/HANDOFF_PROMPT.md`——任何新对话粘贴对应提示词即可继续任一成员的任务。

---

## 8. 🔒 隐私与安全约定（重要，人人必读）

1. **大模型 API Key 属于个人，绝不共享、绝不提交**：
   - Key 只放在**本地 `.env`**（已 gitignore，从未进过 Git 历史）
   - 每名成员自己申请自己的 Key，填入自己本地的 `.env`（复制 `.env.example`）
   - 没有 Key 也能开发：推理会自动回退"内置常识引擎"，功能不减
2. **压缩分享整个项目文件夹给别人之前**，必须删除：
   - 正式版 `.env` 文件
   - 演示版 `find-my-glasses\config.json`（里面含 Key，**目前只有这台电脑有**）
3. 生产部署前：修改 `.env` 的 `TOKEN_SECRET` 为随机长字符串
4. 提交代码前自查：`git status` 确认没有 `.env`、`data/*.db` 被加进暂存区

---

## 9. 关键文件索引

| 想了解 | 看这里 |
|---|---|
| 架构/数据/接口/安全/部署全貌 | `docs/SDD.md` |
| 10 分钟演示脚本 | `docs/DEMO.md` |
| 团队怎么一起改代码 | `DEVELOPMENT.md` |
| 小程序怎么跑、进度分工 | `miniprogram/README.md` |
| 3D 外壳怎么打印 | `hardware/tag_case.scad`（文件头注释） |
| 测试怎么写的 | `test/*.test.js`（照抄模式即可） |
