# 找眼镜助手 FindMyGlasses · 软件设计说明书（SDD）

版本 1.0 ｜ 2026-08-20

---

## 1. 项目概述

### 1.1 目标
为"在家（寝室）没戴眼镜的人"提供找回眼镜的智能助手。用户通过**问答式引导**回忆线索，系统结合**生活常识、逻辑推理、个人历史数据与硬件定位信号**推理眼镜最可能的位置。

### 1.2 核心需求映射

| 需求 | 实现模块 |
|---|---|
| 功能模块化，主界面多入口 | 前端路由 + 首页功能卡（找眼镜/数据/设备/画像） |
| 账户登录与区分，个性化智能体 | M1 accounts（多账户 + 画像 + 家庭布局） |
| 问答式引导推理（常识 + 逻辑 + AI） | M2 reason（知识库 + 评分引擎 + LLM 适配 + 回退） |
| 数据库记录/统计/可视化/持续学习 | M3 data（记录/统计/洞察/图表/导入导出） |
| 硬件数据接入端口 | M4 hardware（REST 上下行 + WebSocket + 模拟器） |

### 1.3 术语
- **候选位置**：可能放置眼镜的地点（词汇表 + 用户自定义放置点）
- **事实 facts**：问答收集的本次线索（活动/房间/时段/追问）
- **找回记录 loss_record**：一次寻找的结果（成功/未找到 + 元数据）
- **设备事件 device_event**：硬件上报/指令产生的记录

---

## 2. 总体架构

### 2.1 分层

```
┌─────────────────────────────────────────────┐
│  浏览器前端（public/，ES 模块，无构建）        │
│  main → router → views（auth/home/profile/   │
│  reason/data/hardware）+ charts/ui/store/api │
└──────────────────┬──────────────────────────┘
                   │ HTTP REST + WebSocket
┌──────────────────▼──────────────────────────┐
│  服务层 server.js（http.createServer）        │
│  ├ core/http.js  路由/中间件/响应/参数解析     │
│  ├ core/auth.js  scrypt 密码 + HMAC 令牌      │
│  ├ core/ws.js    WebSocket（RFC6455 手写）    │
│  ├ core/ratelimit.js 登录限流                 │
│  └ core/logger.js 分级日志                    │
│  模块层 src/modules/*  ── 每模块 routes+service│
└──────────────────┬──────────────────────────┘
                   │ node:sqlite（内置）
┌──────────────────▼──────────────────────────┐
│  SQLite 数据库（data/find_glasses.db，WAL）  │
│  版本化迁移 src/core/db.js                   │
└─────────────────────────────────────────────┘
```

### 2.2 技术选型
- **零外部依赖**：Node.js ≥ 22.5（内置 `node:sqlite`、`fetch`、`crypto`），无需 `npm install`
- 前端原生 ES Modules，SVG 手绘图表（无 CDN，离线可用）
- 大模型：OpenAI 兼容接口（默认 DeepSeek），**失败自动回退本地常识引擎**

### 2.3 目录结构

```
find-my-glasses-pro/
├─ server.js              # 装配 + 静态资源 + WS upgrade
├─ src/
│  ├─ config.js           # .env + 环境变量
│  ├─ core/               # db/http/auth/ws/logger/ratelimit
│  ├─ modules/
│  │  ├─ accounts/        # 账户/画像/户型（service + routes）
│  │  ├─ reason/          # knowledge/engine/llm.client/service/routes
│  │  ├─ data/            # 统计/洞察/分页/导入导出
│  │  └─ hardware/        # 设备/上报/指令/事件/模拟器
│  └─ seed/               # 演示数据（幂等）
├─ public/                # 前端
├─ scripts/smoke.js       # 一键自检
├─ test/                  # node --test 测试套件
└─ docs/                  # SDD + 演示脚本
```

---

## 3. 数据设计（SQLite，版本化迁移）

| 表 | 关键字段 | 说明 |
|---|---|---|
| users | username(唯一), password_hash, nickname | 账户（scrypt 哈希） |
| profiles | agent_name, agent_style, habits, favorite_places, **home_layout**, notes | 画像与户型 JSON（房间含 x/y 坐标、w/h 尺寸与 furn 家具格） |
| loss_records | user_id, started_at, found_location, found_room, confidence, success, clues, reasoning, duration_sec, **conversation** | 找回记录（正/负样本） |
| devices | id, name, type(locator/nfc/tag), room, battery, status, last_signal | 硬件设备 |
| device_events | device_id, ts, type(report/command/ping_result/beep), payload | 事件流 |
| meta | key/value | schema_version |

迁移：`MIGRATIONS` 数组按版本只增不改；启动时自动升级（v1 建表 → v5 索引与字段）。

---

## 4. 接口设计

### 4.1 鉴权
- 登录返回 HMAC-SHA256 签名令牌（JWT 风格，含 `uid/iat/exp`），有效期 24h（"记住我" 30 天）
- 请求头 `Authorization: Bearer <token>`；受保护接口未登录返回 `401`

### 4.2 REST 一览

| 模块 | 方法/路径 | 说明 |
|---|---|---|
| 账户 | POST /api/auth/register · login · logout | 限流 20 次/分/IP；字段级 422 |
| 账户 | GET /api/auth/me · PUT /api/auth/profile | 画像/户型读写（房间含 x/y、w/h 尺寸、furn 家具格） |
| 推理 | GET /api/reason/flow | 问答流程（房间选项按户型动态化） |
| 推理 | POST /api/reason/infer | `{facts}` → 排序候选+依据+摘要 |
| 推理 | POST /api/reason/record | 保存结果（成功/未找到 + 对话转录） |
| 数据 | GET /api/data/stats · records · export | 统计/分页/导出 |
| 数据 | DELETE /api/data/records/:id · POST /api/data/import | 删除（仅本人）/导入 |
| 硬件 | GET/POST/DELETE /api/hardware/devices(/:id) | 设备管理（含模拟/真实设备标记 isMock） |
| 硬件 | POST …/:id/report · …/:id/command | 上行上报 / 下行指令 |
| 硬件 | GET …/:id/pending · POST …/:id/ack | 真实设备轮询待执行指令 / 执行回报（固件契约） |
| 硬件 | GET /api/hardware/events · POST /api/hardware/simulate | 事件 / 模拟触发 |
| 系统 | GET /api/health | 健康检查 |

### 4.3 WebSocket 协议
- 端点 `/ws?token=<令牌>`；服务端推送：
  - `{"type":"device_event","event":{id,device_id,ts,type,payload}}`
  - `{"type":"device_update","device":{...}}`
- RFC6455 文本帧，服务端实现于 `src/core/ws.js`（握手 SHA-1 accept + 掩码帧解析）

### 4.4 硬件接入契约（真实设备替换模拟实现的方式）
- **上行**：设备周期 `POST /api/hardware/devices/{id}/report`，body `{room, distance_m, rssi_dbm, battery}`
- **下行**：服务端 `POST …/command {command: locate|ping|beep}`，设备侧订阅后执行
- 错误约定：`{error}` + 状态码（401 未登录 / 404 不存在 / 422 参数 / 429 限流 / 500 内部）

---

## 5. 模块设计

### 5.1 reason：引导推理引擎
**知识库 knowledge.js**（可扩充）：25 个常识位置（名称/房间/基础概率/标签）+ 14 种行为 → 位置权重 + 时段常识 + 8 个问答（含声明式分支条件）。

**本地评分引擎 engine.js**（确定性回退）：
```
score(L) = base(L) × 行为加成 × 追问加成 × 空间距离衰减 × 路过房间(1.6)
         × 户型降权(0.35) × 定位提示(按距离: 0格6.0/1格1.8/2格1.2) × 时段(1.4)
         × 历史(1+0.5n) × 偏好(1.35)
候选 = 词汇表位置 + 用户户型自定义放置点
输出 = 前 8 名归一化概率 + 逐条依据 + 中文摘要
```
**户型图空间感知**：画像中房间带网格坐标（拖曳编辑器摆放），引擎按曼哈顿距离衰减——与"最后所在房间"同房间 ×1.8、相邻 ×1.3、隔 2 格 ×1.08、更远 ×0.95；"路过哪些房间"多选追问给路过的房间 ×1.6；定位提示同样按距离衰减。
**LLM 适配 llm.client.js**：结构化 JSON 输出、25s 超时、1 次重试、markdown 容错提取、**词汇表对齐**（防跑偏保证统计口径）、户型/历史/硬件提示注入提示词。
**编排 reason.service.js**：LLM 优先 → 失败回退本地引擎（engine 字段标注），自动注入定位器最近上报（10 分钟内）作为强证据。

### 5.2 accounts：账户与个性化
scrypt（N=16384）密码 + 时间恒定比较；画像含**家庭布局**（≤10 房间 × ≤20 放置点 + **户型图网格坐标 x/y** + **房间内部尺寸 w/h** + **房间家具 furn**，w/h 取值 1-12 格，缺省时前端按 12×12 展示）；户型联动：流程房间/路过房间选项、引擎距离衰减与降权、自定义候选、LLM 提示词。房间尺寸与家具由画像页户型图上**双击房间**弹出的 12×12 网格编辑器设定：左上角方块为起点、右下角滑块为终点，拖动滑块确定房间大致尺寸；编辑器内可选择家具并放置，家具选项**按房间类型自适应**——通用家具（柜子/架子/窗台/桌子）任何房间都有，卧室附加「床」，卫生间/厕所附加「洗手池/便池/浴池」，客厅附加「沙发/电视」，厨房附加「灶台/冰箱/洗手池」，自定义及其他房间含全部家具；在房间范围内点击格子放置、再次点击删除，上下左右相邻的相同家具自动合并为一块，家具格存于房间 `furn` 字段（`{name,x,y}` 数组）；纯前端交互，复用 `PUT /api/auth/profile` 保存。

### 5.3 data：数据与分析
统计指标 + 自然语言洞察（高频地点/房间占比/时段/效率趋势）+ SVG 图表 + 户型热力 + 分页管理 + JSON 导入导出（≤200 条/次）。

### 5.4 hardware：硬件端口
设备注册（locator/nfc/tag）、上下行双通道、事件日志、模拟器（8s 心跳）、`getLastHint()` 供推理联动。

---

## 6. 安全设计
- 密码：scrypt + 独立盐；令牌：HMAC-SHA256 签名 + 过期，恒定时间比较防时序攻击
- 登录/注册限流（20 次/分/IP）；越权防护（记录/设备删除校验归属）
- 前端所有用户输入经 `esc()` HTML 转义；静态文件路径穿越校验；JSON body 限 2MB
- API Key 存放 `.env`（已 gitignore），不入库不入前端

---

## 7. 测试策略
`node --test`（无第三方测试框架），分类：
- **单元**：引擎评分（7 项）、时段分桶（2 项）
- **HTTP 端到端**：账户 7、推理 8、数据 8、硬件 8、集成旅程 1、限流 1
- **协议级**：WebSocket 握手 101 + 广播 + 无效令牌 401（原始 socket，2 项）
- **自检**：`node scripts/smoke.js` —— 演示前跑通 9 项链路（含真实 LLM 验证）

---

## 8. 部署与运维

### 8.1 环境变量（.env）
| 变量 | 默认 | 说明 |
|---|---|---|
| PORT | 8081 | 服务端口 |
| DB_FILE | data/find_glasses.db | 数据库路径 |
| TOKEN_SECRET | — | **生产必须改**为随机长字符串 |
| TOKEN_TTL_HOURS / _REMEMBER | 24 / 720 | 会话时长 |
| LLM_ENABLED / _BASE_URL / _API_KEY / _MODEL / _TIMEOUT_MS | — | 大模型配置 |
| SIMULATOR_ENABLED / _INTERVAL_MS | true / 8000 | 硬件模拟器 |

### 8.2 启动方式
- Windows：`start.bat` ｜ Linux/macOS：`./start.sh` ｜ 通用：`node server.js`
- Docker：`docker build -t find-my-glasses . && docker run -p 8081:8081 -v fmg-data:/app/data find-my-glasses`
- 日志：控制台 + `data/server.log`（追加）

### 8.3 备份
数据备份 = 拷贝 `data/find_glasses.db`（WAL 模式建议先停止服务）；应用内提供 JSON 导入/导出作为逻辑备份。

---

## 9. 演进路线
1. 真实硬件接入（BLE 定位器/蜂鸣标签按 §4.4 契约替换模拟器）
2. 前端迁移微信小程序（REST/WS 接口可复用）
3. 家庭共享空间（多成员共享设备与统计）
4. 户型图拖拽编辑器（房间相对位置 + 热力叠加）✅ 已实现
5. 消息推送/语音问答（无眼镜场景的语音交互）
