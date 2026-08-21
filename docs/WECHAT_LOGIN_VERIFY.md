# 微信开发者工具验证步骤 · 微信一键登录（成员 B 交付）

> 配套后端分支 `feat/auth-wxlogin`，对应提交 `736a1b2`。
> 验证目标：账号密码登录 + 微信登录/绑定 两条路径在「有 AppID」/「无 AppID」两种环境下都符合预期。

---

## 0. 前置准备

- 电脑已装 Node.js ≥ 22.5；后端零依赖，直接 `node server.js` 跑
- 装「微信开发者工具」：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
- 团队已注册微信小程序 AppID（个人测试号也可，工具会自动分配）

---

## 1. 启动后端（两个分支任选）

### A. 有正式 AppID（生产路径）
```bash
cd E:\AI related\find-my-glasses-pro
# 编辑 .env（不要提交、复制粘贴到聊天）
#   WX_APPID=wx你的appid
#   WX_SECRET=你的secret
#   WX_AUTO_REGISTER=true
#   # WX_MOCK_OPENID 留空
node server.js
```
控制台应出现 `👓 找眼镜助手 · 正式版服务已启动` 与 `地址：http://localhost:8081`。

### B. 无 AppID（本地降级 / CI）
```bash
cd E:\AI related\find-my-glasses-pro
# .env 留空 WX_APPID / WX_SECRET，但设置：
#   WX_MOCK_OPENID=mock_openid_xxx
#   WX_AUTO_REGISTER=true
node server.js
```
**降级行为**：`/api/auth/wxlogin` 不再调真实 jscode2session；直接返回 `WX_MOCK_OPENID` 指定的固定 openid。
登录页会显示「微信一键登录」按钮可点，但实际登录的是用固定 openid 自动注册的测试账号。

---

## 2. 能力探测（任选其一手动验证）

```bash
curl http://127.0.0.1:8081/api/auth/wxconfig
```
- A 环境：`{"ok":true,"enabled":true,"autoRegister":true}`
- B 环境：同上（因为设了 `WX_MOCK_OPENID`）
- 都没设：会返回 `enabled: false`，登录页按钮自动置灰

```bash
# 有 AppID 但不传 code
curl -X POST http://127.0.0.1:8081/api/auth/wxlogin -H "Content-Type: application/json" -d "{}"
# → 422 + errors.code
# 缺 WX_APPID 且缺 WX_MOCK_OPENID
# → 503 + code: "WX_NOT_CONFIGURED"
```

---

## 3. 微信开发者工具导入小程序

1. 工具 → 「导入项目」
2. 项目目录：仓库的 `miniprogram/`
3. AppID：选「测试号」先验证（不绑真 AppID 也行）；有正式 AppID 在 `project.config.json` 改 `appid`
4. 详情 → 本地设置 → 勾选「**不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**」（开发阶段必须）
5. 编译

---

## 4. 验证「账号密码登录」未受影响

1. 切到「登录」Tab
2. 输入 `xiaoming / 123456` → 点「登录」→ 跳首页 → OK
3. 切「注册」Tab → 注册一个 `test_xxx / 123456 / 测试昵称` → 自动切回「登录」→ 用新账号登录 → OK

> 验证目标：原 M1 登录注册链路没被微信登录破坏。

---

## 5. 验证「微信一键登录」— 场景 ① 已有绑定（WX_AUTO_REGISTER=true）

> 准备：先用 步骤 4 的账号密码登录一次，再走「设置 → 账号安全 → 绑定微信」（本期先用接口直接绑定，UI 在后续迭代）

**手动绑定（用 curl 模拟一次 wxbind 流程）**：

```bash
# 1) 拿到登录 token
TOKEN=$(curl -s -X POST http://127.0.0.1:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"xiaoming","password":"123456"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

# 2) 触发 wxlogin 拿 bindToken（仅在 WX_AUTO_REGISTER=false 时才返回 needBind）
#    所以这里走：先创建用户 A；关 WX_AUTO_REGISTER=true 时，code 直接拿来当 wxlogin，
#    由于 openid 首次出现 → mode=autoRegister 自动建号，得到 token
curl -s -X POST http://127.0.0.1:8081/api/auth/wxlogin \
  -H "Content-Type: application/json" -d '{"code":"fake"}' | head -c 500
# 期望：{"ok":true,"mode":"autoRegister","token":"...","user":{"id":N,"username":"wx_...","nickname":"微信用户XXXXXX"}}
```

**在小程序里**：
1. 退出登录（小程序右上角 → 退出）
2. 在登录页底部点绿色「**微信一键登录**」按钮
3. 第一次：直接进入首页（自动注册的 `微信用户XXXXXX`）
4. 退出后再次点微信一键登录 → 同一 openid 命中 → 同一个账号直接进入首页 → OK

---

## 6. 验证「微信一键登录」— 场景 ② 未绑定 + needBind（WX_AUTO_REGISTER=false）

> **目的**：验证「自动注册」关闭时，未绑定 openid 的微信用户会被引导到「绑定已有账号」弹窗

```bash
# 临时关闭自动注册并重启后端
# .env: WX_AUTO_REGISTER=false
# 终止旧 node server.js 进程后重启
node server.js
```

小程序里：
1. 退出登录
2. 点「微信一键登录」→ **弹出「绑定已有账号」对话框**
3. 输入 `xiaoming / 123456` → 点「绑定并登录」→ 跳首页，昵称是「小明」 → OK
4. 退出登录 → 再点「微信一键登录」→ 直接进首页（openid 已绑 xiaoming） → OK
5. 故意输错密码 → 弹窗内显示「用户名或密码错误」→ OK

> 安全红线：未注册微信的用户即使点微信登录，也必须先有账号密码才能绑定；自动注册用户使用不可登录的占位密码（必须经 wxbind 才能用密码登录）。

---

## 7. 验证「未配置降级」

```bash
# 清空 WX_APPID / WX_SECRET / WX_MOCK_OPENID，重启后端
node server.js
```

小程序里：
1. 退出登录
2. 登录页底部：「微信一键登录」按钮**置灰 + 提示「后端未配置微信登录（缺少 WX_APPID）」** → OK
3. 此时账号密码登录照常可用 → OK

---

## 8. 真机预览（可选）

- 手机与电脑同 WiFi
- `miniprogram/utils/config.js` 的 `API_BASE` 改为电脑局域网 IP（如 `http://192.168.1.5:8081`）
- 工具点「预览」→ 手机扫码
- 注意：手机微信客户端需开启调试模式（开发者工具 → 详情 → 本地设置 → 调试基础库 ≥ 2.0 即可；测试号会自动跳过域名校验）

---

## 9. 错误码速查

| 现象 | 原因 | 解决 |
|---|---|---|
| 登录页按钮不显示 | API_BASE 配错 / 后端没起 | 确认 `node server.js` 运行、`/api/health` 返回 200 |
| 按钮置灰 + 提示「未配置」 | 缺 WX_APPID 且缺 WX_MOCK_OPENID | 二选一：填 WX_APPID（生产）或 WX_MOCK_OPENID（本地） |
| 报 `url not in domain list` | 没勾「不校验合法域名」 | 工具 → 详情 → 本地设置 → 勾上 |
| 真机连不上 | 电脑防火墙 / 不同 WiFi | 关电脑防火墙或放行 8081；手机电脑同 WiFi；API_BASE 用局域网 IP |
| `wx.login` 失败 | AppID 失效 / 工具没登录 | 工具右上角扫码登录；AppID 用测试号先验证 |

---

## 10. 自动化测试一行验证

```bash
cd E:\AI related\find-my-glasses-pro
node --test    # 期望：68 项全绿（基线 59 + 新增 9）
```

> 若在沙箱/受限环境遇到 `spawn EPERM`，加 `--experimental-test-isolation=none` 即可绕过（本地正常环境不需要）。
