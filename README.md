# 👓 找眼镜助手 · 正式版（FindMyGlasses Pro）

帮家中（寝室）无眼镜者找回丢失眼镜的 Web 应用。零外部依赖：Node.js 内置 `http` + `node:sqlite`，无需 `npm install`。

## 启动

```bash
node server.js      # 或双击 start.bat
```

打开 **http://localhost:8081**（端口可用 `.env` 的 `PORT` 修改；演示版占用 8080，互不影响）。

演示账号：`xiaoming / 123456`、`xiaohong / 123456`

## 模块进度

| 模块 | 状态 |
|---|---|
| M0 架构与工程基础（分层/配置/日志/路由/迁移/ES 模块化前端） | ✅ 完成 |
| M1 账户与个性化智能体（注册/登录/会话/画像/**家庭布局户型**） | ✅ 完成 |
| M2 引导推理引擎（常识知识库/条件化问答/LLM+回退/找到与未找到闭环/**户型感知**） | ✅ 完成 |
| M3 数据库与数据分析可视化（统计指标/智能洞察/图表/户型热力/分页管理/导入导出） | ✅ 完成 |
| M4 硬件接入端口（设备注册/协议/REST 上下行/WebSocket 实时/模拟器/推理联动） | ✅ 完成 |
| M5 集成测试与部署文档（全流程回归/限流/smoke 自检/Docker/SDD/演示脚本） | ✅ 完成（本迭代提交） |

## 目录结构

```
find-my-glasses-pro/
├─ server.js                 # 入口：装配 + 静态资源
├─ start.bat                 # 一键启动
├─ .env.example              # 环境变量模板（复制为 .env 使用）
├─ src/
│  ├─ config.js              # 配置中心（.env + 环境变量）
│  ├─ core/                  # 通用基础设施
│  │  ├─ db.js               # SQLite + 迁移机制
│  │  ├─ http.js             # 路由/中间件/响应封装
│  │  ├─ auth.js             # scrypt 密码 + HMAC 无状态令牌
│  │  └─ logger.js           # 分级日志
│  ├─ modules/accounts/      # M1 账户模块（service + routes 分层）
│  └─ seed/seed.js           # 预置演示数据
└─ public/                   # 前端（ES 模块，无构建）
   ├─ index.html
   ├─ css/style.css
   └─ js/
      ├─ main.js             # 入口
      ├─ store.js / api.js / router.js / ui.js
      └─ views/              # auth / home / profile / placeholder
```

## M1 API（REST）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（返回字段级校验错误 422） |
| POST | `/api/auth/login` | 登录（`remember` 可选，返回 HMAC 令牌） |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户（需 `Authorization: Bearer <token>`） |
| PUT | `/api/auth/profile` | 更新个性化智能体画像（含 `homeLayout` 家庭布局：房间+描述+放置点） |

家庭布局对推理的作用：① 流程中"最后在哪个房间/路过哪些房间"选项按你的户型生成；② 户型中没有的房间（如无玄关/走廊）其位置自动降权；③ 户型中自定义的放置点成为推理候选；④ 户型信息注入大模型提示词；⑤ **户型图拖曳编辑器**（房间网格坐标）按**距离远近**衰减权重、**路过房间**加权。支持房间：卧室/卫生间/客厅/厨房/餐厅/书房/玄关/**走廊**/阳台/衣帽间/储物间。

**无硬件设备场景**：全程可只靠引导推理使用；推理结果页的"设备协助"面板按实际接入的设备自适应（无设备时显示引导文案），设备页无设备时显示空态引导，所有硬件接口在无设备时优雅返回 404 而非报错。

## M2 API（REST）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/reason/flow` | 引导问答流程（声明式条件分支） |
| POST | `/api/reason/infer` | 推理：`{facts}` → 排序候选 + 依据 + 摘要（LLM 优先，自动回退本地引擎） |
| POST | `/api/reason/record` | 记录找回结果（成功/未找到，含对话转录） |

推理引擎分层：`knowledge.js`（常识知识库，可扩充）→ `engine.js`（本地评分引擎）→ `llm.client.js`（大模型适配，超时/重试/JSON 容错/词汇表对齐）→ `reason.service.js`（编排 + 回退）。

## M3 API（REST）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data/stats` | 个人统计（指标/分布/趋势/智能洞察）+ 全局统计 |
| GET | `/api/data/records?limit=&offset=` | 记录分页列表 |
| DELETE | `/api/data/records/:id` | 删除本人记录 |
| GET | `/api/data/export` | 导出 JSON 数据快照 |
| POST | `/api/data/import` | 导入记录（校验，单次 ≤200 条） |

可视化（前端 SVG 零依赖）：高频地点条形图、房间分布环图、近 30 天趋势、时段分布、**户型房间热力图**；智能洞察由数据自动生成自然语言建议。

## M4 API（硬件接入端口）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/hardware/devices` | 设备列表 + 最近事件 |
| POST | `/api/hardware/devices` | 注册设备 `{id?,name,type(locator/nfc/tag),room?}` |
| DELETE | `/api/hardware/devices/:id` | 删除设备 |
| POST | `/api/hardware/devices/:id/report` | **上行端口**：设备上报 `{room,distance_m,rssi_dbm,battery}` |
| POST | `/api/hardware/devices/:id/command` | **下行端口**：下发指令 `{command: locate/ping/beep}` |
| GET | `/api/hardware/events?limit=` | 事件日志 |
| POST | `/api/hardware/simulate` | 演示：触发一次模拟事件 |
| WS | `/ws?token=<token>` | 实时推送 `device_event` / `device_update`（RFC6455 手写实现，零依赖） |

模拟器：`SIMULATOR_ENABLED=true` 时每 8 秒自动产生设备事件。定位器最近上报（10 分钟内）自动作为**强证据注入推理引擎与 LLM 提示词**。

## 测试与自检

```bash
node --test            # 全量回归（46 项：单元 + HTTP 端到端 + WebSocket 协议级）
node scripts/smoke.js  # 演示前一键自检（9 项链路，含真实 LLM 验证）
```

## 部署

- Windows：`start.bat` ｜ Linux/macOS：`./start.sh` ｜ 通用：`node server.js`
- Docker：`docker build -t find-my-glasses . && docker run -p 8081:8081 -v fmg-data:/app/data find-my-glasses`
- 环境变量见 `.env.example`（`TOKEN_SECRET` 生产必须修改；LLM Key 放 `.env`，已 gitignore）
- 备份：停服后拷贝 `data/find_glasses.db`，或使用应用内 JSON 导入/导出

## 文档

- `docs/SDD.md`：完整软件设计说明书（架构/数据/接口/模块/安全/测试/部署/演进）
- `docs/DEMO.md`：10 分钟演示脚本（含断网降级彩蛋）
