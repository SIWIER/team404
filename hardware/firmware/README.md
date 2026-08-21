# 🔋 防丢标签固件 · 烧录与接线说明

配合 `tag_firmware/tag_firmware.ino` 使用，目标硬件：ESP32-C3 SuperMini（M5StickC 变体见文末）。

## 一、接线表

| ESP32-C3 SuperMini 引脚 | 接到 | 说明 |
|---|---|---|
| GPIO5 | 有源蜂鸣器 **+**（正极） | 蜂鸣器 **-** 接 GND |
| GPIO4 | 按钮一脚 | 按钮另一脚接 GND（可选，本地寻呼） |
| 5V 引脚 | 锂电池正极（经开关） | 板载降压到 3.3V；或直接 USB 供电 |
| GND | 电池负极 / 蜂鸣器负极 | |

## 二、烧录步骤（Arduino IDE，免费）

1. 安装 Arduino IDE（arduino.cc 下载）
2. 文件 → 首选项 → 附加开发板管理器网址，粘贴：
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. 工具 → 开发板 → 开发板管理器 → 搜索 `esp32` → 安装（by Espressif）
4. 工具 → 开发板 → 选 **ESP32C3 Dev Module**
5. 用 USB-C 数据线连接板子 → 工具 → 端口 → 选出现的新串口
6. 打开 `tag_firmware.ino` → 点"上传"（→箭头）

## 三、固件配置（改代码最上面的配置区）

| 配置 | 说明 |
|---|---|
| `WIFI_SSID / WIFI_PASS` | 你家 WiFi（须与后端电脑同一网络） |
| `SERVER_HOST` | 跑后端电脑的局域网 IP（cmd 里 `ipconfig` 查 IPv4） |
| `DEVICE_ID` | 系统中注册的设备 ID（见下） |
| `TOKEN` | 登录令牌（见下） |

**注册设备**：微信小程序或网页 → 硬件设备页 →「＋ 注册设备」→ 类型选"防丢标签"→ 得到 ID（如 `dev-xxxx`）→ 填入 `DEVICE_ID`。

**获取 TOKEN**（后端电脑上执行，输出的一长串就是令牌）：
```bash
node -e "fetch('http://127.0.0.1:8081/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'xiaoming',password:'123456',remember:true})}).then(r=>r.json()).then(d=>console.log(d.token))"
```
> 建议团队建一个专用账号（如 `home-gateway`）做设备令牌，别用个人账号。

## 四、工作流程（固件与服务器的完整闭环）

```
固件每 3 秒: GET  /api/hardware/devices/{id}/pending
   └─ 有指令(beep/ping) → 蜂鸣 8 秒 → POST .../ack 回报
固件每 30 秒: POST /api/hardware/devices/{id}/report  （在线心跳）
用户在手机/网页点「🔔 蜂鸣」→ 服务器记录指令 → 固件轮询到 → 响
```

打开串口监视器（工具 → 串口监视器，115200 波特率）能看到每一步日志：
上电短哔三声 = WiFi 连上了；`📨 收到指令` = 有人呼叫；`✅ ack` = 回报成功。

## 五、常见问题

| 现象 | 排查 |
|---|---|
| 上电没响三声 | WiFi 没连上：SSID/密码/距离；串口监视器看日志 |
| 手机点蜂鸣没反应 | TOKEN 不对；DEVICE_ID 与注册 ID 不一致；后端 IP 不对 |
| pending 返回 401 | TOKEN 过期：重新获取并烧录 |
| 串口乱码 | 监视器波特率选 115200 |

## 六、M5StickC PLUS2 变体（买了半成品开发板的看这里）

M5StickC 自带蜂鸣器和电池，把代码里的蜂鸣部分替换为 M5 库调用即可：
1. 开发板管理器搜索安装 **M5StickC** 库
2. 代码顶部加 `#include <M5StickC.h>`，setup 里加 `M5.begin();`
3. `beep()` 函数体换成 `M5.Beep.beepOn(); delay(ms); M5.Beep.beepOff();`
   （若你的库版本没有 Beep 对象，改用 GPIO 直驱：把 BUZZER_PIN 改为 M5StickC 的蜂鸣器引脚并保留原 beep 实现）
4. 其余（WiFi/轮询/上报/ack）逻辑完全不变——这就是"半成品"的省事之处。
