# 📱 微信小程序版 · 开发说明（miniprogram/）

后端**完全复用** `find-my-glasses-pro` 服务（先 `node server.js` 把后端跑起来，端口 8081），小程序只是换了一个前端外壳。

## 一、如何打开工程（新成员 5 分钟）

1. 下载安装**微信开发者工具**（developers.weixin.qq.com/miniprogram/dev/devtools/download.html，免费）
2. 打开工具 → 「导入项目」→ 目录选择本仓库的 `miniprogram/` 文件夹
3. AppID：先选「测试号」（工具自动分配），团队有正式 AppID 后在 `project.config.json` 里改 `appid`
4. 详情 → 本地设置 → 勾选 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**（开发阶段必须）
5. 编译 → 登录 `xiaoming / 123456` 即可使用

## 二、真机预览

- 手机与电脑连**同一 WiFi**；把 `utils/config.js` 的 `API_BASE` 从 `http://127.0.0.1:8081` 改成电脑局域网 IP（如 `http://192.168.1.5:8081`）
- 工具点「预览」→ 手机扫码（手机也要勾选"调试模式"跳过域名校验，或开发版自动跳过）

## 三、结构（与 Web 版一一对应）

```
miniprogram/
├─ app.js / app.json / app.wxss    # 全局（对应 Web 的 index.html/main.js/style.css）
├─ utils/
│  ├─ config.js    # API 地址（唯一需要按环境改的文件）
│  ├─ api.js       # wx.request 封装（对应 Web api.js）
│  ├─ store.js     # 令牌/用户状态（对应 Web store.js）
│  └─ ui.js        # toast/confirm/emoji（对应 Web ui.js）
└─ pages/
   ├─ auth/       # 登录/注册 ✅
   ├─ home/       # 首页菜单 + 画像卡 + 户型图 ✅
   ├─ reason/     # 引导推理（问答→结果→闭环）✅
   ├─ data/       # 统计可视化 🚧（接口已就绪，Canvas 图表开发中）
   ├─ hardware/   # 设备接入 ✅（卡片/指令/注册/WS 实时事件流）
   └─ profile/    # 画像/户型拖拽 ✅（表单 + movable-view 6×6 网格）
```

## 四、页面开发约定（对应 DEVELOPMENT.md 规范）

- 每页四件套：`.js`（Page 逻辑）、`.wxml`（结构）、`.wxss`（样式）、`.json`（页配置）
- 页面只通过 `utils/api.js` 调接口；全局样式放 `app.wxss`，页面样式放各自 `.wxss`
- **禁止**在页面里写死接口地址；所有请求走 `api.request('/xxx')`
- 新增页面：`app.json` 的 `pages` 数组注册 + home 菜单卡片加入口

## 五、进度与分工建议

| 页面 | 状态 | 认领 |
|---|---|---|
| auth / home / reason | ✅ 已完成（可演示核心闭环） | — |
| data（统计+Canvas 图表） | 🚧 | 成员 C |
| hardware（设备+WS 实时） | ✅ 已完成 | 成员 D |
| profile（画像+movable-view 户型拖拽） | ✅ 已完成 | 成员 A |
| 微信一键登录（后端 /api/auth/wxlogin + 前端 wx.login） | 🚧 第二步 | 成员 B |

## 六、常见坑

| 坑 | 解法 |
|---|---|
| 请求报"url not in domain list" | 详情里勾选"不校验合法域名" |
| 真机连不上电脑 | 检查同一 WiFi、防火墙放行 8081、API_BASE 改成局域网 IP |
| 登录后刷新回到登录页 | 令牌存在 wx Storage，正常；用测试号重启工具时 Storage 会清空属正常 |
| 样式和 Web 版不一致 | rpx 自适应单位 + 小程序组件差异，属预期 |
