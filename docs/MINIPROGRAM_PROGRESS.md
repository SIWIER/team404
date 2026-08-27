# 📱 微信小程序功能开发进度（截至 2026-08-21）

> 本文档快照当前 `feat/auth-wxlogin` 分支（含 2 次新提交 `736a1b2`、`b8bdc5b`）。
> 给团队、PM、新成员快速了解「小程序侧」进度用。

---

## 1. 一图总览

| 页面 | 状态 | 完成度 | 认领 | 备注 |
|---|---|---|---|---|
| 登录/注册 (`auth`) | ✅ | 100% | 成员 B（含本 PR 微信登录） | 账号密码 + 微信一键登录 + needBind 绑定 |
| 首页 (`home`) | ✅ | 100% | 成员 D | 菜单卡 + 户型图同步 + 已完成角标 |
| 引导推理 (`reason`) | ✅ | 100% | 成员 B | 问答→推理→结果→闭环（接口复用 Web） |
| 个人画像 (`profile`) | ✅ | 100% | 成员 A | 表单 + 自研户型拖拽（多格走廊/标准模板） |
| 硬件设备 (`hardware`) | ✅ | 100% | 成员 D | 卡片/指令/注册/WS 实时事件流 |
| 数据统计 (`data`) | 🚧 | 5% | 成员 C | 占位页，后端 `/api/data/stats` 已就绪 |
| **整体** | **5/6 页完成** | **~85%** | | |

---

## 2. 文件结构（已就位）

```
miniprogram/
├─ app.js / app.json / app.wxss    # 全局入口与样式
├─ project.config.json             # appid 已固化（本地按需改）
├─ sitemap.json
├─ utils/                          # 4 件套：api/store/ui/config
│  ├─ config.js    # API_BASE / WS_BASE（开发 127.0.0.1，真机改 IP）
│  ├─ api.js       # wx.request 封装（自动带 Bearer；401 自动跳登录）
│  ├─ store.js     # token + user 状态（wx Storage + globalData）
│  └─ ui.js        # toast / confirm / roomEmoji
└─ pages/                          # 6 页 × 4 件套 = 24 个文件
   ├─ auth/      ✅ 登录/注册/微信一键登录/绑定弹窗（**本次新增**）
   ├─ home/      ✅ 菜单 + 户型图 + 完成角标
   ├─ reason/    ✅ 问答→推理→结果闭环
   ├─ data/      🚧 占位（后端接口已就绪，等 ECharts）
   ├─ hardware/  ✅ 设备卡片 + WS 事件流
   └─ profile/   ✅ 画像表单 + 自研户型拖拽（多格走廊链）
```

---

## 4. 各页核心能力

### ✅ auth（本次 PR 主要改动）
- **账号密码登录/注册**：用户名密码校验、记住我、字段级 422 错误展示
- **微信一键登录（本 PR 新增）**：
  - `onLoad` 调 `/auth/wxconfig` 探测后端是否启用（未启用按钮置灰 + 提示）
  - 点击 → `wx.login` 拿 code → `/auth/wxlogin`
  - 后端 `mode=login/autoRegister` → 直接 `wx.reLaunch` 到首页 + 弹"登录成功"
  - 后端 `needBind=true` → 弹出"绑定已有账号"对话框（用户名+密码）
  - 绑定 → `/auth/wxbind` → 跳首页 + 弹"绑定并登录成功"
  - 未配置 WX_APPID 时按钮置灰 + 提示「后端未配置微信登录」
- **降级设计**：账号密码登录路径**完全不受影响**

### ✅ home
- 6 张菜单卡（找眼镜/数据/设备/画像/...）
- 户型图 10×10 同步显示（房间按面积占多格 + 多格走廊渲染 + 外框衬托）
- 已完成页面角标自动点亮（数据页保持"开发中"灰色）

### ✅ reason
- 动态化问答流程（房间选项按用户户型）
- 推理结果本地引擎回退展示
- 找回/未找到闭环

### ✅ profile
- 表单：昵称、agent 风格、习惯、偏好、户型
- **自研触摸拖拽户型编辑器**：
  - 10×10 细网格 + 响应式尺寸 + 虚线参考（房间按面积占多格）
  - 任何房间可**加格扩大/减格缩小**（走廊支持多格链：延长/缩短/整体拖动）
  - 标准户型模板一键排列
  - 已修：交换异动、假交换、重叠、touchend 冒泡等坑
- 隐私说明卡

### ✅ hardware
- 设备卡片 + 在线状态/电量/最近房间
- 指令按钮：定位/蜂鸣/ping
- 注册新设备（locator/nfc/tag）
- WebSocket 实时事件流

### 🚧 data
- 占位页（仅返回首页按钮）
- 后端 `/api/data/stats` 接口已就绪：找回记录、高频地点、房间热力、趋势图、智能洞察
- 待开发：ECharts `ec-canvas` 集成 + 户型热力网格（成员 C 认领）

---

## 5. 本次新增能力（feat(auth) 微信一键登录）

### 后端（已合并到 feat/auth-wxlogin）
- **DB 迁移 v7**：`users` 表新增 `wechat_openid` 列（UNIQUE 部分索引，NULL 不参与唯一性）
- **新接口**：
  - `POST /api/auth/wxlogin` → 返回 `mode=login|autoRegister|needBind` 三态
  - `POST /api/auth/wxbind` → bindToken + 账号密码 → 写 openid
  - `GET /api/auth/wxconfig` → `{enabled, autoRegister}` 探测
- **新模块**：`src/modules/accounts/accounts.wx.service.js`
  - `code2session` 函数**可注入**（测试用 `setCode2Session()`）
  - mock 模式：`WX_MOCK_OPENID` 环境变量直接返回固定 openid，跳过真实微信
  - bindToken：HMAC 签名 + 10 分钟过期
  - 自动注册：随机占位密码（必须经 wxbind 才能用密码登录，安全设计）
- **未配置降级**：缺 `WX_APPID` 且缺 `WX_MOCK_OPENID` 时 `/wxlogin` 返回 `503 WX_NOT_CONFIGURED`

### 测试（test/m6.wxauth.test.js，新增 9 项）
- 总计 **68/68 全绿**（基线 59 + 新增 9，零回归）
- 覆盖：探测、绑定登录、自动注册、needBind 密码校验、bindToken 伪造、openid 重复绑定 409、未配置降级 503

### 小程序（auth 四件套）
- 仅修改 `pages/auth/*` 4 个文件，其他页面零改动
- **零新依赖**（继续用 wx 原生 API）

---

## 6. 运行与验证

### 后端
```bash
cd find-my-glasses-pro
# .env 推荐本地开发：
#   WX_APPID=
#   WX_SECRET=
#   WX_MOCK_OPENID=mock_local_test
node server.js    # http://localhost:8081
```

### 小程序
1. 微信开发者工具 → 导入 `miniprogram/`
2. AppID 选「**测试号**」（本地 mock 模式不需要正式 AppID）
3. 详情 → 本地设置 → 勾上「**不校验合法域名**」
4. 编译 → 登录页底部绿色「微信一键登录」按钮亮起 → 点击进入

### 真机预览
- 手机电脑同 WiFi
- `utils/config.js` 的 `API_BASE` 改成电脑局域网 IP

---

## 7. 已知未完成

- 🚧 **data 页（成员 C）**：ECharts `ec-canvas` 集成 + 户型热力网格。接口已就绪，纯前端工作。
- 🟢 **3D 外壳按实板微调（成员 D）**：STL 已可打印，待实板试装
- 🟡 **测试号 vs 真 AppID 路径说明**：本期本地默认走 mock，正式上线需补 WX_APPID/WX_SECRET（见 `docs/WECHAT_LOGIN_VERIFY.md`）

---

## 8. 安全红线（小程序特别提醒）

1. **AppSecret 永不落盘、永不进 Git**（`.env` gitignored）
2. **本地开发用 mock**，不要把真实 AppSecret 写到 `.env.example` 或注释里
3. **真机预览前**，确保 `.env` 只在本机（不复制到云笔记/聊天/邮件）
4. **生产部署**前重置一次 AppSecret（上线后任何泄露过的 secret 视为已泄露）

---

## 9. 相关文档索引

| 想了解 | 看这里 |
|---|---|
| 项目整体进度 | `docs/PROJECT_PROGRESS.md` |
| 后端架构与接口契约 | `docs/SDD.md`（§5.5 是本 PR 新增的微信登录章节） |
| 微信开发者工具验证步骤 | `docs/WECHAT_LOGIN_VERIFY.md`（**本 PR 新增**） |
| 协作流程与分支模型 | `DEVELOPMENT.md` |
| 小程序模块说明 | `miniprogram/README.md` |

---

## 10. 本 PR 提交清单

```
b8bdc5b docs: 微信开发者工具验证步骤清单
736a1b2 feat(auth): 微信一键登录与账号绑定
```

`736a1b2` 包含 11 个文件改动（+877 / -7）：
- 后端 5 文件：db.js / config.js / accounts.wx.service.js（新）/ accounts.routes.js / .env.example
- 小程序 3 文件：auth.js / auth.wxml / auth.wxss
- 测试 1 新文件：test/m6.wxauth.test.js
- 文档 2 文件：docs/SDD.md / docs/PROJECT_PROGRESS.md