# 📦 物品数字化存放系统 · ItemVault

<p align="center">
  <b>拍照记录每件物品的位置 · 想找时四种方式一步定位</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/微信小程序-原生%20WXML-blue" alt="小程序">
  <img src="https://img.shields.io/badge/Node.js-≥22.5%20零依赖-339933" alt="零依赖">
  <img src="https://img.shields.io/badge/测试-138%20项全绿-brightgreen" alt="测试">
  <img src="https://img.shields.io/badge/SQLite-WAL-4479A1" alt="SQLite">
  <img src="https://img.shields.io/badge/Chinese--CLIP-本地向量检索-orange" alt="CLIP">
</p>

> 从「找眼镜」出发，长成了通用的物品存放管家：**任意物品**拍照入库、按
> 「目录 → 房间 → 收纳家具 → 子位置」归档，再用**文字 / 照片 / 描述 / 问答**四种方式找回。
> 微信小程序 + Web 双端，同一套零依赖 Node.js 后端。

---

## ✨ 核心亮点

| 亮点 | 说明 |
|---|---|
| 📸 **拍照录入 + AI 自动识别** | 拍一张照片，视觉大模型自动识别物品名称、外观描述与建议存放位置，回填表单确认即存 |
| 🗺️ **五级位置链** | 目录（家/公司/宿舍…）→ 户型图房间 → 收纳家具 → 子位置（一层/抽屉…），每件物品都有精确的"地址" |
| 🔍 **四种查找方式** | ⌨️ 文字检索 · 📷 拍照找同款 · ✍️ 描述找物品 · 🗣️ 问答回忆推理——总有办法一步定位 |
| 🧠 **本地向量检索（Chinese-CLIP）** | 照片/描述编码为向量，SQLite 存储 + 暴力余弦；图图检索还带**双路融合**（照片先经视觉模型"翻译"成文字再匹配纯文字物品），准确率实测 0.33→0.92 |
| 🏠 **户型图 + 存放热力** | 每个目录独立户型图（10×10 网格、房间按面积多格、内部家具模块），支持**拍照识别户型**与拖拽布置；统计页把物品数叠加到户型图上，哪里存了什么一眼看清 |
| 📊 **存放统计** | 物品总量 / 照片覆盖 / 目录与房间分布 / 收纳家具 Top / 近 30 天趋势 / 最近录入 |
| 📡 **硬件接入端口** | 定位器 / 近场呼唤器 / 防丢标签，REST 上下行 + 手写 WebSocket 实时推送；**无硬件也完整可用**（推理自动启用无硬件补偿） |
| 🔒 **隐私优先** | 数据只属于账号本人；照片落盘本地 `data/uploads/`；图片路径防目录穿越；识别图片不进日志 |

## 📱 小程序功能地图（亮点全览）

```
登录/注册 ──(注册引导：有无硬件设备)──► 首页（当前目录户型图 + 目录切换）
   │
   ├─ 📦 物品管理      拍照录入→自动识别名→四级位置选择 ｜ 检索页：文字/拍照找同款/文字找物品
   │                   结果列表：缩略图 + 位置链「家→书房→书架→二层」→ 点开跳户型图高亮房间
   ├─ 🔍 找物品引导     四策略入口：问答回忆 / 文字检索 / 拍照找同款 / 描述找物品
   │                   问答向导按你的户型动态生成房间选项，推理结果带逐条依据
   ├─ 🏠 户型图配置     目录管理（家/公司/宿舍…）、房间拖拽布置、房间内部模块（书桌/书架/壁橱…）
   │                   📷 拍照识别户型：拍一张户型图自动生成房间网格，确认即应用
   ├─ 📊 存放统计       物品总量/照片覆盖/目录与房间分布/收纳家具 Top/户型存放热力/最近录入
   ├─ 📡 硬件设备       设备卡片/指令/注册/WS 实时事件流（无硬件用户自动隐藏模拟设备）
   └─ 🧠 我的存放偏好   收纳习惯/常用存放位置/硬件设备
```

**演示账号**：`xiaoming / 123456`（登记眼镜盒定位器，硬件联动演示）、`xiaohong / 123456`（无设备，降级演示）

## 🚀 快速开始

```bash
# 1) 主后端（零依赖，无需 npm install）
node server.js            # 或双击 start.bat → http://localhost:8081

# 2)（可选）Chinese-CLIP 本地服务——「拍照找同款/文字找物品」需要
#    部署一次即可：scripts/clip-server/README.md（双击 start-clip.bat 启动，端口 8899）
#    未部署时自动降级：向量检索接口返回 503，其余功能不受影响

# 3) 微信小程序：微信开发者工具导入 miniprogram/ → 测试号 → 勾选"不校验合法域名" → 编译
```

> 一键启动全部后端：双击根目录 `start-all.bat`（主服务 8081 + CLIP 8899）。
> 视觉识别（图文/户型）走云端视觉大模型，在 `.env` 配 `LLM_VISION_*` 即可，未配置自动降级。

## 🏗️ 技术栈

- **后端**：Node.js ≥ 22.5 零第三方依赖——内置 `http` 路由、`node:sqlite`（WAL + 版本化迁移）、scrypt 密码 + HMAC 无状态令牌、手写 RFC6455 WebSocket、内存限流
- **AI 能力**：云端视觉大模型（图文识别 / 户型识别，失败自动降级）+ 本地 Chinese-CLIP（图图/文图向量）+ 内置常识推理引擎（LLM 回退，完全离线可用）
- **小程序**：原生 WXML 四件套页面 + movable-view 拖拽户型编辑器，后端完全复用同一套 REST 接口
- **数据**：SQLite 单文件（`data/find_glasses.db`），照片本地落盘 `data/uploads/`

## 🔌 接口速览（完整契约见 `docs/SDD.md` §4）

| 模块 | 代表接口 |
|---|---|
| 账户/微信 | `POST /api/auth/register|login|wxlogin` · `PUT /api/auth/profile` |
| 目录/户型 | `GET|POST /api/spaces` · `PUT /api/spaces/:id/layout|active` · `POST /api/layout/recognize` |
| 物品管理 | `POST /api/items` · `GET /api/items?q=` · `GET /api/items/stats` · `POST /api/items/recognize` · `POST /api/items/search-image` |
| 找物品引导 | `GET /api/reason/flow` · `POST /api/reason/infer` · `POST /api/reason/record` |
| 硬件 | `GET|POST /api/hardware/devices` · `POST …/:id/report|command` · `WS /ws?token=` |

## ✅ 测试与质量

```bash
node --test            # 138 项全绿：单元 + HTTP 端到端 + WebSocket 协议级 + 微信登录 + 户型识别 + 物品 P1/P2
node scripts/smoke.js  # 演示前一键自检（含真实 LLM 验证）
```

CI：推送自动跑全部测试（`.github/workflows/test.yml`），红灯不合并。

## 📚 文档

| 文档 | 内容 |
|---|---|
| `docs/SDD.md` | 软件设计说明书：架构 / 数据 / 全部接口契约 / 模块设计 / 安全 / 测试 / 部署 |
| `docs/PROJECT_PROGRESS.md` | 项目进度与团队交接（新成员先读它） |
| `docs/DEMO.md` · `docs/VIDEO_SCRIPT.md` | 演示脚本与视频台词 |
| `docs/HARDWARE_RFID.md` | UHF RFID 找物品硬件方向（无实物设计） |
| `docs/SPATIALLM_ENV.md` | SpatialLM 房间实景扫描预研（视频→点云→结构化布局） |
| `miniprogram/README.md` | 小程序开发与真机预览说明 |
| `DEVELOPMENT.md` | 团队协作规范（分支/提交/模块边界） |

## 🗺️ 演进路线

- [x] 物品管理 P1+P2：录入 / 文字检索 / 图文识别 / 图图·文图向量检索（Chinese-CLIP 本地部署）
- [x] 产品口径统一：登录 / 引导 / 找物品 / 存放统计 / 偏好页全面「物品存放」化
- [x] 多目录（家/公司/宿舍）+ 每目录独立户型图 + 房间内部模块
- [ ] SpatialLM 房间实景扫描 → 户型图自动建模（环境已就绪，阶段 0 验证中）
- [ ] 演示数据 seed：预置带照片的示例物品
- [ ] Web 端与小程序口径完全对齐

---

**团队仓库**：[github.com/SIWIER/team404](https://github.com/SIWIER/team404) · 分支 `main` 永远可运行可演示 · 提交信息 `feat(模块): 中文说明`
