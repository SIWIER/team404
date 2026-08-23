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
| users | username(唯一), password_hash, nickname, **wechat_openid**(唯一可空) | 账户（scrypt 哈希；微信登录/绑定用 openid 关联，UNIQUE 部分索引） |
| profiles | agent_name, agent_style, habits, favorite_places, **home_layout**, notes | 画像与户型 JSON |
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
| 账户 | GET /api/auth/me · PUT /api/auth/profile | 画像/户型读写 |
| 账户（微信） | POST /api/auth/wxlogin | 小程序 `wx.login` 拿 `code` → 调 jscode2session 换 openid；返回 `mode=login|autoRegister|needBind`（详见 §5.5） |
| 账户（微信） | POST /api/auth/wxbind | `wxlogin` 返回 `needBind` 时使用：拿 `bindToken` + 已有账号密码完成绑定，颁发 token |
| 账户（微信） | GET /api/auth/wxconfig | 前端能力探测：`{enabled, autoRegister}`；未配置 AppID 时 `enabled=false` |
| 推理 | GET /api/reason/flow | 问答流程（房间选项按户型动态化） |
| 推理 | POST /api/reason/infer | `{facts}` → 排序候选+依据+摘要 |
| 推理 | POST /api/reason/record | 保存结果（成功/未找到 + 对话转录） |
| 数据 | GET /api/data/stats · records · export | 统计/分页/导出 |
| 数据 | DELETE /api/data/records/:id · POST /api/data/import | 删除（仅本人）/导入 |
| 硬件 | GET/POST/DELETE /api/hardware/devices(/:id) | 设备管理（含模拟/真实设备标记 isMock） |
| 硬件 | POST …/:id/report · …/:id/command | 上行上报 / 下行指令 |
| 硬件 | GET …/:id/pending · POST …/:id/ack | 真实设备轮询待执行指令 / 执行回报（固件契约） |
| 硬件 | GET /api/hardware/events · POST /api/hardware/simulate | 事件 / 模拟触发 |
| 户型识别 | GET /api/layout/config | 探测视觉模型是否可用 `{visionEnabled}`（前端据此置灰按钮） |
| 户型识别 | POST /api/layout/recognize | 户型图照片 → 候选 homeLayout（限流 5 次/分/IP；不落库） |
| 系统 | GET /api/health | 健康检查 |

**户型图识别接口示例**（`POST /api/layout/recognize`，需登录）：

```jsonc
// 请求：image 为压缩后图片的裸 base64（可带 data URL 前缀，服务端会剥离）
{ "image": "iVBORw0KGgoAAAANS...", "mimeType": "image/png" }

// 200 成功：layout 已清洗为合法网格，可直接提交给 PUT /api/auth/profile
{ "ok": true, "note": "识别到三室一厅，走廊居中",
  "layout": [ { "name": "走廊", "desc": "", "spots": [], "x": 2, "y": 2,
                "cells": [ {"x":2,"y":2}, {"x":2,"y":3} ] } ] }
```

状态码：`401` 未登录 · `422` 参数非法/图片过大/未识别出房间 · `429` 超频 ·
`502` 模型调用或解析失败 · `503` 后端未配置视觉模型（前端降级为手动拖拽）。

**隐私**：上传图片仅在内存中转发给视觉模型，不落盘、不写库、不进日志；识别结果不自动保存，
由用户在小程序预览确认后再走 `PUT /api/auth/profile` 落库（复用其 `sanitizeLayout` 做最终清洗）。

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
**户型图空间感知**：画像中房间带网格坐标（拖曳编辑器摆放，**走廊支持多格链 cells**），引擎按曼哈顿距离衰减——与"最后所在房间"同房间 ×1.8、相邻 ×1.3、隔 2 格 ×1.08、更远 ×0.95；**多格房间距离取最近格**；**同房间/定位加成按房间格数（面积）归一化放大**（1+0.15×(格数-1)，封顶 ×1.5）；"路过哪些房间"多选追问给路过的房间 ×1.6；定位提示同样按距离衰减。
**LLM 适配 llm.client.js**：结构化 JSON 输出、25s 超时、1 次重试、markdown 容错提取、**词汇表对齐**（防跑偏保证统计口径）、户型/历史/硬件提示注入提示词。
**编排 reason.service.js**：LLM 优先 → 失败回退本地引擎（engine 字段标注），自动注入定位器最近上报（10 分钟内）作为强证据。

### 5.2 accounts：账户与个性化
scrypt（N=16384）密码 + 时间恒定比较；画像含**家庭布局**（≤10 房间 × ≤20 放置点 + **户型图网格坐标 x/y** + **多格形状 cells**：走廊可占多个相邻格，x/y 恒等于 cells[0] 以兼容 Web 版与推理引擎）；户型联动：流程房间/路过房间选项、引擎距离衰减与降权、自定义候选、LLM 提示词。

### 5.5 微信登录（accounts.wx）
**核心契约**：账号密码登录保留 + 微信登录/绑定并存。
- **code 换 openid**：`POST /api/auth/wxlogin {code}` → 后端调 `https://api.weixin.qq.com/sns/jscode2session` 换 `openid`（Node 内置 `fetch`，零依赖）。函数封装为可注入 `setCode2Session()`，测试用 `WX_MOCK_OPENID` 环境变量直接返回固定 openid，不真实调微信。
- **三种 mode**：
  - `login` —— `openid` 已绑定用户 → 直接颁发 token（默认 remember=true，30 天）
  - `autoRegister` —— 未绑定且 `WX_AUTO_REGISTER=true` → 自动创建新用户（昵称 `微信用户xxxx`，随机占位密码），颁发 token
  - `needBind` —— 未绑定且 `WX_AUTO_REGISTER=false` → 颁发 HMAC 签名一次性 `bindToken`（10 分钟过期），前端弹窗收集已有账号密码
- **绑定**：`POST /api/auth/wxbind {bindToken, username, password}` → 校验密码 → 把 `openid` 写入该用户（unique 部分索引）→ 颁发 token
- **能力探测**：`GET /api/auth/wxconfig` → `{enabled, autoRegister}`；未配置 `WX_APPID`/`WX_MOCK_OPENID` 时 `enabled=false`，前端按钮置灰
- **安全**：openid 持久化到 `users.wechat_openid`（UNIQUE 部分索引，NULL 不参与）；`WX_SECRET` 仅读取 `.env`，不入库不进日志；自动注册用户使用不可登录的随机占位密码，必须经 `wxbind` 才能用密码登录（避免与未来"账号密码"流程冲突）
- **未配置降级**：`/api/auth/wxlogin` 在未配置 WX_APPID 时返回 `503 {code: 'WX_NOT_CONFIGURED'}`；前端应通过 `/wxconfig` 提前发现并把按钮置灰

### 5.3 data：数据与分析
统计指标 + 自然语言洞察（高频地点/房间占比/时段/效率趋势）+ SVG 图表 + 户型热力 + 分页管理 + JSON 导入导出（≤200 条/次）。

### 5.4 hardware：硬件端口
设备注册（locator/nfc/tag）、上下行双通道、事件日志、模拟器（8s 心跳）、`getLastHint()` 供推理联动。

### 5.5 layout：户型图照片识别
**目的**：降低户型录入成本——原本需在小程序手动拖十来个房间方块，现在拍一张户型图即可生成初稿。

- `layout.service.js`
  - `recognizeLayout(cfg, base64, mime)`：OpenAI 兼容的多模态调用（`content` 数组 +
    `image_url` 传 data URL），低温 0.2 求稳定；超时/失败重试一次；`extractJson()` 容错解析；
    任何异常返回 `null` 交由路由层转友好错误
  - `normalizeLayout(raw)`：**纯函数**，把模型的自由输出收敛成合法布局——坐标裁进 0-5、
    房间内去重格、跨房间抢格先到先得、非走廊房间塌缩单格、走廊只保留连通链（剔除飞地）、
    `x/y` 对齐 `cells[0]`、≤10 房间。**输出契约与 `accounts.sanitizeLayout` 完全对齐**
  - `alignRoomName(raw)`：别名归一（主卧→卧室、过道→走廊、洗手间→卫生间…），
    保证房间名落在推理知识库认识的词表内；词表外的自定义名保留
- `layout.routes.js`：`GET /config` 探测可用性；`POST /recognize` 需登录 + 限流 5 次/分，
  校验 mime 白名单与 base64 体积后转调 service
- **模块边界**：不 require accounts 内部实现；保存走 `PUT /api/auth/profile` 公开接口。
  `extractJson` 与 reason 模块同策略但各自实现，不跨模块引用（遵守 DEVELOPMENT.md 铁律）
- **视觉模型独立配置**：文本模型 `deepseek-chat` 不支持读图，故 `LLM_VISION_*` 与
  `LLM_*` 相互独立；未配置时接口返回 503，小程序按钮置灰，手动拖拽路径不受影响
- **选型实测**（同一张五房间测试户型图，含中间竖向走廊）：
  `gpt-4o` 房间齐全 + 走廊多格链正确（约 4s，推荐）；`gpt-4o-mini` 漏走廊只认出 4 房间；
  旧 DeepSeek 推理型模型 token 全部计入 `reasoning_content` 而 `content` 返回空
  （`finish_reason: length`），不可用；
  **`deepseek-v4-flash-vision-exp` 可用**：`callVision` 对 deepseek 系模型自动加
  `thinking:{type:'disabled'}`，禁用思维链后 `content` 直接输出 JSON（OpenAI 系不加该参数，避免未知字段 400）。
  更换服务商前先确认模型支持 `image_url` 多模态输入

---

## 6. 安全设计
- 密码：scrypt + 独立盐；令牌：HMAC-SHA256 签名 + 过期，恒定时间比较防时序攻击
- 登录/注册限流（20 次/分/IP）；越权防护（记录/设备删除校验归属）
- 前端所有用户输入经 `esc()` HTML 转义；静态文件路径穿越校验；JSON body 限 2MB
- API Key 存放 `.env`（已 gitignore），不入库不入前端
- **微信登录**：openid 与用户一一绑定（UNIQUE 部分索引，允许多用户未绑定 NULL 状态）；`WX_SECRET` 仅在服务端内存中使用，不入库不进日志；自动注册用户使用不可登录的占位密码，强制走 `wxbind` 才能用密码登录，避免"未注册微信"绕过"必须先注册"约束

---

## 7. 测试策略
`node --test`（无第三方测试框架），分类：
- **单元**：引擎评分（7 项）、时段分桶（2 项）
- **HTTP 端到端**：账户 7、推理 8、数据 8、硬件 8、集成旅程 1、限流 1
- **协议级**：WebSocket 握手 101 + 广播 + 无效令牌 401（原始 socket，2 项）
- **户型识别**：`normalizeLayout` 纯函数清洗（坐标裁剪/去重/抢格让位/走廊连通/别名对齐等）
  + HTTP 层 401/503/422/429（19 项，全程离线不产生付费调用）
- **自检**：`node scripts/smoke.js` —— 演示前跑通 9 项链路（含真实 LLM 验证）

- **微信登录**：`wxlogin/wxbind/wxconfig` 三接口与三种 mode（成员 B，含子服务器隔离用例）

当前全量：`node --test` → **98 项全绿**（新增测试务必保持全绿再提 PR）。

> **两条易踩的测试隔离约定**（都已实际踩过）：
> 1. 清空环境变量要**赋空串**而非 `delete`：`src/config.js` 的 `loadEnvFile` 只跳过已存在于
>    `process.env` 的键，`delete` 掉的键会被本机 `.env` 的真实配置重新填上——
>    "未配置视觉模型 → 503" 会因此变成真实付费调用并返回 502。
> 2. **端口必须全局唯一**：`node --test` 并行跑各测试文件，撞端口会连到别人的服务器上，
>    表现为莫名其妙的断言失败（ECONNRESET / 配置读串）。现有占用：
>    m1-m5 = 18081-18086、ws = 18085、m6 = 18087 + 子服务器 18088-18092、
>    m7 = 18093 + 子服务器 18094。新增测试请从 18095 起。

---

## 8. 部署与运维

### 8.1 环境变量（.env）
| 变量 | 默认 | 说明 |
|---|---|---|
| PORT | 8081 | 服务端口 |
| DB_FILE | data/find_glasses.db | 数据库路径 |
| TOKEN_SECRET | — | **生产必须改**为随机长字符串 |
| TOKEN_TTL_HOURS / _REMEMBER | 24 / 720 | 会话时长 |
| LLM_ENABLED / _BASE_URL / _API_KEY / _MODEL / _TIMEOUT_MS | — | 大模型配置（文本推理） |
| LLM_VISION_ENABLED / _BASE_URL / _API_KEY / _MODEL / _TIMEOUT_MS | true / — / — / — / 40000 | 视觉模型配置（户型图识别；留空则该功能返回 503 降级） |
| SIMULATOR_ENABLED / _INTERVAL_MS | true / 8000 | 硬件模拟器 |
| WX_APPID / WX_SECRET | — | 微信小程序 AppID / Secret（Secret 务必 gitignore；只在本机后端使用） |
| WX_AUTO_REGISTER | true | 未绑定 openid 的微信用户首次登录是否自动建号；`false` 时返回 `needBind` + bindToken |
| WX_MOCK_OPENID | — | 设置后 `wxlogin` 直接返回该 openid（测试/CI 跳过真实微信调用） |
| WX_BIND_TOKEN_TTL_MS | 600000 | `needBind` 流程一次性凭证有效期 |
| WX_CODE2SESSION_TIMEOUT_MS | 8000 | 调 jscode2session 的超时 |

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
