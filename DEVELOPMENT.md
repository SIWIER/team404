# 👥 协作开发指南（DEVELOPMENT）

欢迎加入找眼镜助手开发。本文档约定**团队怎么一起改代码、不互相踩脚**。

---

## 1. 一图看懂项目结构（谁改什么一目了然）

```
find-my-glasses-pro/
├─ server.js                 # 入口/装配（改路由注册时动它）
├─ src/
│  ├─ config.js              # 配置中心（加配置项动它）
│  ├─ core/                  # 基础设施【少数人维护】
│  │  ├─ db.js               #   SQLite + 迁移
│  │  ├─ http.js             #   路由/中间件/响应
│  │  ├─ auth.js             #   密码/令牌
│  │  ├─ ws.js               #   WebSocket
│  │  ├─ ratelimit.js        #   限流
│  │  └─ logger.js           #   日志
│  └─ modules/               # 业务模块【按模块认领，互不越界】
│     ├─ accounts/           #   账户/画像/户型   → 成员 A
│     ├─ reason/             #   引导推理引擎     → 成员 B
│     ├─ data/               #   统计与数据分析   → 成员 C
│     └─ hardware/           #   硬件接入端口     → 成员 D
├─ public/                   # 前端【页面认领】
│  ├─ index.html / css/      #   壳与样式【专人】
│  └─ js/
│     ├─ main.js api.js router.js store.js ui.js charts.js   # 公共层【专人】
│     └─ views/xxx.view.js   #   每个页面一个文件，一人一页
├─ test/                     # 测试【谁写功能谁写测试】
├─ scripts/                  # smoke 自检等工具脚本
├─ docs/                     # SDD/DEMO 文档【专人】
└─ hardware/                 # 3D 外壳模型【硬件成员】
```

**铁律：模块之间只通过 `src/modules/xxx/xxx.routes.js` 暴露的 REST 接口通信，禁止跨模块直接 require 对方的 service 内部实现。**（例外：accounts.getPublicUser、hardware.getLastHint 属公开能力，已在 SDD 登记。）

---

## 2. 起步三步（新成员）

```bash
git clone <仓库地址>
cd find-my-glasses-pro
node server.js        # 零依赖，不需要 npm install
node --test           # 跑测试，98 条应全绿
node scripts/smoke.js # 演示前自检
```

要求：Node.js ≥ 22.5（内置 sqlite）。本地 `.env` 自己建（复制 `.env.example`），**API Key 各人用各人的，绝不提交**。

---

## 3. 协作流程（Git 分支模型）

```
main ──────────────────────────────▶ 永远可运行、可演示
  │
  ├─ feat/xxx-模块-功能   每人一条分支，干完提 Pull Request
  │
  └─ fix/xxx
```

1. 开工前：从最新 main 拉新分支：`git checkout -b feat/reason-追问分支 main`
2. 开发中：小步提交，提交信息用中文写清楚："feat(reason): 新增路过房间追问"
3. 完成前：本地跑 `node --test` 全绿 + `node --check` 无错
4. 提 Pull Request（Gitee/GitHub 网页点"新建 PR"），**至少 1 名成员 Review 通过后才能合并**
5. 合并后：本地 `git pull` 继续

**冲突预防**：每人只改自己认领的文件；公共文件（router.js、server.js、style.css）改动尽量小，并在 PR 说明里标出。

---

## 4. 代码规范（统一风格，审阅省事）

- **命名**：文件/路由 `kebab-case`；函数/变量 `camelCase`；常量 `UPPER_SNAKE`
- **模块结构**：每个模块固定 `xxx.service.js`（业务）+ `xxx.routes.js`（HTTP），路由只做参数校验和转调，逻辑全在 service
- **前端**：每个页面一个 `views/xxx.view.js`，导出 `renderXxx(root)`；跨页面只 import `../api.js` `../store.js` `../ui.js` `../charts.js`
- **API 变更**：改动或新增接口 → 同步更新 `docs/SDD.md` 第 4 节接口表，PR 里贴接口示例
- **中文**：注释、提交信息、文档用中文；代码标识符用英文
- **提交前自检**：
  ```bash
  node --check server.js src/modules/<你的模块>/*.js
  node --test
  ```

---

## 5. 如何新增一个功能（以"新增模块 x 为例"模板）

1. `src/modules/x/x.service.js`：业务逻辑（操作 db 用 `require('../../core/db')` 的 `getDb()`）
2. `src/modules/x/x.routes.js`：`registerRoutes(router)`，统一 `ctx.res.ok()/ctx.res.error()`
3. `server.js`：`xRoutes.registerRoutes(router)` 一行
4. 需要新表/新字段：在 `src/core/db.js` 的 `MIGRATIONS` 数组**末尾追加**（只增不改，版本号 +1）
5. `public/js/views/x.view.js` + `router.js` 注册路由 + `home.view.js` 加菜单卡
6. `test/m-x.test.js`：照抄现有测试的 `spawn` 服务器模式，独立端口 1808x、独立测试库
7. 更新 `docs/SDD.md` 与 README 模块表

---

## 6. 任务管理建议（团队 3~6 人）

- 用仓库的 **Issues** 当任务板：标题格式 `[M2][推理] 路过房间追问`
- 认领后 assign 给自己；PR 里写 `fixes #编号` 自动关闭 Issue
- 每轮迭代：周一认领 → 周五 PR → 周末演示 main

---

## 7. 持续集成（CI）

提交/PR 到仓库会自动跑测试（配置见 `.github/workflows/test.yml`，Gitee 用 Gitee Go 同理）。**测试红灯的 PR 不要合并。**

本地等价命令：`node --test`

---

## 8. 常见坑

| 坑 | 解法 |
|---|---|
| 提交了 `.env` 或 `data/*.db` | 立刻 `git rm --cached` 并轮换 Key（`.gitignore` 已配置，别用 `-f` 强加） |
| 端口 8081 被占 | 改 `.env` 的 `PORT` |
| 改了别人模块的文件 | PR 里说明原因，找对方 Review |
| 测试跑不过 | 先删 `data/test_*.db*` 再跑（测试自清理，旧库可能残留） |
