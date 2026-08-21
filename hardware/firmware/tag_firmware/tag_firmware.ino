// ============================================================
//  找眼镜助手 · 防丢标签固件 v1（tag_firmware.ino）
//  硬件：ESP32-C3 SuperMini（或任意 ESP32 开发板）
//  接线：有源蜂鸣器 + → GPIO5，- → GND
//        手动按钮（可选）→ GPIO4 ↔ GND
//  功能：连 WiFi → 轮询服务器待执行指令 → 收到 beep/ping 蜂鸣
//        → 回报已执行(ack) → 定期上报状态
//  依赖：仅 ESP32 内置 WiFi.h / HTTPClient.h，零第三方库
// ============================================================

// ---------- ① 配置区（按你的环境修改） ----------
const char* WIFI_SSID  = "你的WiFi名";
const char* WIFI_PASS  = "你的WiFi密码";
const char* SERVER_HOST = "192.168.1.5";     // 跑后端的电脑局域网 IP
const int   SERVER_PORT = 8081;
const String DEVICE_ID  = "tag-01";          // 与系统中注册的设备 ID 一致
const String TOKEN      = "";                // 登录后拿到的令牌（见 README 如何获取）

// ---------- ② 参数（一般不用改） ----------
#define BUZZER_PIN 5
#define BUTTON_PIN 4            // 注意：经典 ESP32 的 GPIO0 是烧录键，勿用
#define POLL_INTERVAL_MS   3000 // 指令轮询周期
#define REPORT_INTERVAL_MS 30000// 状态上报周期
#define BEEP_DURATION_MS   8000 // 每次蜂鸣时长
#define HTTP_TIMEOUT_MS    5000

// ============================================================
#include <WiFi.h>
#include <HTTPClient.h>

unsigned long lastPoll = 0;
unsigned long lastReport = 0;
String lastAck = "";             // 防止同一条指令重复执行

// 蜂鸣：断断续续响，比长鸣更易循声
void beep(int durationMs) {
  unsigned long t0 = millis();
  while (millis() - t0 < (unsigned long)durationMs) {
    digitalWrite(BUZZER_PIN, HIGH); delay(120);
    digitalWrite(BUZZER_PIN, LOW);  delay(120);
  }
}

// HTTP 请求（GET/POST），返回状态码，body 通过 out 传出
int httpRequest(const String& method, const String& path, const String& body, String& out) {
  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) + path;
  http.begin(url);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (TOKEN.length()) http.addHeader("Authorization", "Bearer " + TOKEN);
  http.addHeader("Content-Type", "application/json");
  int code = 0;
  if (method == "GET")      code = http.GET();
  else if (method == "POST") code = http.POST(body);
  out = http.getString();
  http.end();
  return code;
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println();
  Serial.println("👓 防丢标签启动，连接 WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi 已连接，IP: " + WiFi.localIP().toString());
    // 上电自检：短哔三声
    for (int i = 0; i < 3; i++) {
      digitalWrite(BUZZER_PIN, HIGH); delay(80);
      digitalWrite(BUZZER_PIN, LOW);  delay(120);
    }
  } else {
    Serial.println();
    Serial.println("WiFi 连接失败，将持续重试");
  }
}

void loop() {
  // 手动按钮：找不到时摸到标签也能按响
  if (digitalRead(BUTTON_PIN) == LOW) {
    Serial.println("按钮按下，本地蜂鸣");
    beep(3000);
    delay(300);
  }

  if (WiFi.status() != WL_CONNECTED) {
    delay(5000);
    WiFi.reconnect();
    return;
  }

  unsigned long nowMs = millis();

  // ① 轮询待执行指令
  if (nowMs - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = nowMs;
    String body;
    int code = httpRequest("GET", "/api/hardware/devices/" + DEVICE_ID + "/pending", "", body);
    if (code == 200) {
      // 极简解析（避免第三方 JSON 库）：定位 "id" 与 "command" 字段
      int idPos  = body.indexOf("\"id\":");
      int cmdPos = body.indexOf("\"command\":");
      bool isBeep = (cmdPos >= 0) && (body.indexOf("beep", cmdPos) >= 0);
      bool isPing = (cmdPos >= 0) && (body.indexOf("ping", cmdPos) >= 0);
      if ((isBeep || isPing) && idPos >= 0) {
        String evId = body.substring(idPos + 5);
        int comma = evId.indexOf(",");
        if (comma >= 0) evId = evId.substring(0, comma);
        evId.trim();
        if (evId.length() && evId != lastAck) {
          Serial.println("📨 收到指令 " + evId + "，开始蜂鸣...");
          beep(BEEP_DURATION_MS);
          String ackBody = "{\"eventId\":" + evId + "}";
          String out;
          int ackCode = httpRequest("POST", "/api/hardware/devices/" + DEVICE_ID + "/ack", ackBody, out);
          Serial.println("✅ ack 回报: HTTP " + String(ackCode));
          lastAck = evId;
        }
      }
    } else if (code > 0) {
      Serial.println("pending 请求失败: HTTP " + String(code));
    }
  }

  // ② 定期上报状态（v1 上报在线心跳；电量检测留作 v2 扩展）
  if (nowMs - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = nowMs;
    String reportBody = "{\"battery\":null,\"room\":null}";
    String out;
    int code = httpRequest("POST", "/api/hardware/devices/" + DEVICE_ID + "/report", reportBody, out);
    Serial.println("📡 心跳上报: HTTP " + String(code));
  }

  delay(200);
}
