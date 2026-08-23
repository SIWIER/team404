# 🔁 新对话交接提示词（跨会话继续开发的正确姿势）

> 对话有上下文限制，但**项目不会失忆**：代码在磁盘 + GitHub，知识在文档。
> 新开一个对话时，把下面的提示词整段粘贴给 AI，它读文件后就能无缝接手。
> 用法：复制「通用模板」，把【】里的内容替换成你要做的任务。

---

## 通用模板（复制这段）

```
我在继续开发一个已有项目「找眼镜助手」（帮人找回丢失眼镜的智能助手）。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404）。
动手前请先读这些文件了解现状（用 read 工具按顺序读）：
1. docs/PROJECT_PROGRESS.md —— 项目进度、目录结构、任务池
2. DEVELOPMENT.md —— 协作规范（模块边界/命名/测试要求）
3. docs/SDD.md —— 架构与全部接口契约
4. docs/SURVEY.md —— 调查问卷设计与结论（如任务与问卷有关）
5. miniprogram/README.md —— 小程序开发约定（如任务涉及小程序）

本次任务：【用一句话写清楚要做什么】

要求：
1. 严格遵守 DEVELOPMENT.md 规范，不越界改别人的模块
2. 后端改接口要同步更新 docs/SDD.md 接口表
3. 改完必须运行 node --test，全绿才算完成
4. 提交信息格式：feat(模块): 中文说明（用 git 提交）
5. 绝不改动 .env；绝不把 .env 内容粘贴出来
6. 先读文档和现有代码，再动手；拿不准的地方先问
```

## 示例：成员 A 的任务（已填好，直接复制可用）

```
我在继续开发一个已有项目「找眼镜助手」。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404）。
动手前请先读：
1. docs/PROJECT_PROGRESS.md（重点看第 7 节任务池中"成员 A"的待办）
2. DEVELOPMENT.md
3. docs/SDD.md
4. docs/SURVEY.md（问卷第 10/11/14 题结论会影响画像页设计）
5. miniprogram/README.md

本次任务：完成成员 A 的待办——微信小程序「个性化智能体」页
（miniprogram/pages/profile/，当前是占位页）。
功能对齐 Web 版 public/js/views/profile.view.js：
- 智能体昵称/风格/生活习惯/常用地点/备注 的表单编辑（调 PUT /api/auth/profile）
- 家庭布局编辑器：房间增删改 + 6×6 户型图拖拽摆放
  （小程序用 movable-area/movable-view 实现拖拽，坐标 x/y 与 Web 版一致）
- 户型预览网格 + 保存
- 若问卷第 14 题隐私接受度低，页面底部加一句"数据仅用于本地推理"说明
接口参考：PUT /api/auth/profile（homeLayout 支持 x/y），见 docs/SDD.md。
要求：
1. 每页四件套 js/wxml/wxss/json；样式风格参考 pages/home/home.wxss
2. 后端零改动（接口已就绪）；不改其他页面
3. 完成后运行 node --test（后端测试应 55 项全绿，小程序页无测试但需 node --check 语法通过）
4. git 提交：feat(mp): 小程序画像页（表单+movable-view户型拖拽）
5. 给出"我怎么在微信开发者工具里验证"的步骤清单
```

## 示例：成员 B 的任务（已填好，直接复制可用）

```
我在继续开发一个已有项目「找眼镜助手」。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404）。
动手前请先读：
1. docs/PROJECT_PROGRESS.md（重点看第 7 节任务池中"成员 B"的待办）
2. DEVELOPMENT.md（新增模块/迁移/测试的规范）
3. docs/SDD.md（第 4 节接口表与第 6 节安全设计）
4. miniprogram/README.md（小程序登录页现状在 pages/auth/）

本次任务：完成成员 B 的待办——微信一键登录（团队已定"两者都要"策略：
账号密码登录保留 + 微信登录/绑定）。

后端（零依赖实现，用 Node 内置 fetch）：
1. 迁移 v7：users 表加 wechat_openid TEXT 列（UNIQUE 可空）
2. 配置：.env 与 .env.example 加 WX_APPID / WX_SECRET（绝不入库、绝不打印）；
   另加 WX_AUTO_REGISTER（true/false，决定未绑定 openid 时自动建号还是要求绑定）
3. 新接口（同步更新 docs/SDD.md 接口表）：
   - POST /api/auth/wxlogin  {code}
     → 调 https://api.weixin.qq.com/sns/jscode2session 换 openid
     → 已绑定：返回 {ok, token, user}（沿用现有 issueToken）
     → 未绑定且 WX_AUTO_REGISTER=true：自动注册新用户（昵称"微信用户xxxx"）返回 token
     → 未绑定且关闭自动注册：返回 {ok, needBind: true, bindToken}（bindToken 为短时效一次性凭证）
   - POST /api/auth/wxbind  {bindToken, username, password}
     → 校验现有账号密码 → 把 openid 写入该用户 → 返回 token（未注册的微信用户可先在登录页注册再绑定）
4. 测试 mock 方案：code2session 请求封装成可注入函数，测试环境（WX_MOCK_OPENID 环境变量）
   直接返回固定 openid，不真实调微信；测试覆盖：绑定登录/自动注册/错误 code/重复绑定/密码错误
5. 前端小程序 pages/auth/：登录页加「微信一键登录」按钮（wx.login 拿 code → 调接口）；
   needBind 时弹出"绑定已有账号"表单（用户名+密码）；成功后 wx.reLaunch 到首页；
   后端未配置 WX_APPID 时按钮置灰并提示"未配置微信登录"

要求：
1. 严格遵守 DEVELOPMENT.md：新迁移只增不改（版本号 v7）；service+routes 分层
2. 前端每页四件套；不改其他页面逻辑
3. 完成后 node --test 全绿（现有 55 项不能破），新增测试放在 test/ 下
4. git 提交：feat(auth): 微信一键登录与账号绑定
5. 给出"我怎么在微信开发者工具里验证"的步骤清单（含无 AppID 时的降级行为）
安全红线：WX_SECRET 与 .env 一律不粘贴输出、不入库、不进日志。
```

## 示例：成员 C 的任务（已填好，直接复制可用）

```
我在继续开发一个已有项目「找眼镜助手」。
代码在本机：E:\AI related\find-my-glasses-pro（Git 仓库，远程 https://github.com/SIWIER/team404）。
动手前请先读：
1. docs/PROJECT_PROGRESS.md（重点看第 7 节任务池中"成员 C"的待办）
2. DEVELOPMENT.md（前端页面约定）
3. docs/SDD.md（第 4 节数据接口）
4. miniprogram/README.md（小程序结构）
5. docs/SURVEY.md（问卷第 9/10 题结论可作为页面文案素材）
6. 参考现有完成页：miniprogram/pages/home/ 与 pages/hardware/（风格、组件用法照它们来）

本次任务：完成成员 C 的待办——小程序「数据统计与分析」页（miniprogram/pages/data/，当前占位页）。
功能对齐 Web 版 public/js/views/data.view.js，后端零改动（接口已就绪）：

1. 顶部统计卡：总记录 / 找回成功率 / 平均用时 / 近 30 天次数
2. 智能洞察列表（GET /api/data/stats → mine.insights，自然语言自动生成）
3. 四张图表：
   - 高频地点条形图（topLocations）
   - 房间分布环图（roomDist）
   - 近 30 天趋势柱状图（timeline）
   - 时段分布柱状图（timeDist）
   实现：推荐 ECharts 小程序版 ec-canvas（从 github.com/ecomfe/echarts-for-weixin
   拷贝 ec-canvas 组件到 miniprogram/ 并按 README 注册），图表数据映射参照 Web 版
   public/js/views/data.view.js（字段名完全一致）
4. 户型热力：普通 view 网格实现（不需要 canvas）——按用户 homeLayout 的 x/y 坐标排格子，
   每个房间 tile 背景色 = rgba(61,123,253, 0.1~0.6) 按"该房间找回次数/最大次数"线性映射；
   不在户型里的房间以虚线框补充展示
5. 记录表：分页列表（GET /api/data/records?limit=10&offset=，页面 onReachBottom 触底加载更多）
   每行显示时间/位置/房间/置信度/用时/结果徽章；支持删除（DELETE /api/data/records/:id，
   wx.showModal 确认后调接口并刷新）
6. 导入导出（简化版）：导出 = GET /api/data/export 结果 wx.setClipboardData 复制 JSON；
   导入 = 粘贴 JSON 文本框解析后 POST /api/data/import（records 数组）

要求：
1. 每页四件套 js/wxml/wxss/json；样式风格与 home/hardware 页一致（rpx、card、btn 等复用 app.wxss）
2. 后端零改动；不改其他页面
3. 完成后 node --check 通过小程序 js，node --test 后端 55 项全绿
4. git 提交：feat(mp): 小程序数据统计页（图表+热力+分页+导入导出）
5. 给出"我怎么在微信开发者工具里验证"的步骤清单（建议用 xiaoming 账号，有 10 条种子数据）
```

---

## 注意事项

1. **新对话没有记忆**：AI 不会自动知道我们聊过什么，一切以仓库文档为准——所以重要决定都要落到文档里（这也是本文件存在的原因）。
2. **调查问卷的数据**：回收后把结论填进 `docs/SURVEY.md` 第四节，任何新对话读它就能用上（例如"60% 受访者选小程序"）。
3. **安全红线照样适用**：新对话里同样不要粘贴 `.env` 内容；新 AI 若要读取项目文件，提醒它跳过 `.env` 和 `data/`。
4. **GitHub 连不上的排查顺序（本机经验，按此顺序来，不要反复空转重试）**：
   - 本机直连 GitHub 不稳定（443 超时/连接重置），通常依赖**本地代理**；
   - 先测代理端口是否在监听：`Test-NetConnection 127.0.0.1:7890`（常见端口 7890/7897/1080/10809/8888）；
   - 在监听 → git 命令加临时参数走代理：
     `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 <命令>`
     （或一次性 `git config --global http.proxy http://127.0.0.1:7890`，取消用 `git config --global --unset http.proxy`）；
   - 没在监听 → 直接提醒用户先开代理/加速器，等网络恢复再继续。
