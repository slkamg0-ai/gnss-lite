/*
 * GNSS-Lite 브리지 (ESP32 DevKit V1)
 *   UM982 (UART2) ──NMEA──▶ ESP32 ──BLE(NUS)──▶ 폰 앱
 *   폰 핫스팟 ◀─Wi-Fi─▶ ESP32 ──RTCM──▶ UM982   (NTRIP 클라이언트, VRS용 GGA 회신)
 *   BNO085 (I2C) ─────────▶ ESP32 ──$PIMU──▶ 폰 앱
 *
 * 배선(ESP32 DevKit V1):
 *   UM982 TX → GPIO16 (RX2)     UM982 RX ← GPIO17 (TX2)     GND 공통   (UM982 UART 로직 레벨 3.3V 확인!)
 *   BNO085 SDA → GPIO21         SCL → GPIO22                3V3, GND   (Adafruit 4754 STEMMA QT, 주소 0x4A)
 *
 * 프로토콜(라인, XOR 체크섬):
 *   앱→장치  $CFG,ssid|wpw|host|port|mount|user|pw,<값>*CS   /  $CFG,apply,1*CS
 *   장치→앱  UM982 의 GGA/GST 원문,  $PIMU,qw,qx,qy,qz,headingAccDeg,magStatus*CS,  $PSTAT,wifi,ntrip,rtcmBytes,ageSec,ip*CS
 *
 * ⚠ 실기기 미검증 초안: UM982 UART 포트명/출력 명령, BNO085 회전벡터 좌표계(앱 설정의 IMU 프레임), I2C 안정성은 하드웨어로 확인 필요.
 */
#include <WiFi.h>
#include <Preferences.h>
#include <Wire.h>
#include <NimBLEDevice.h>
#include <Adafruit_BNO08x.h>
#include "mbedtls/base64.h"

// ───── 설정 ─────
#define UM_RX      16
#define UM_TX      17
#define UM_BAUD    115200
#define UM_PORT    "COM2"     // 보드의 UART 헤더가 연결된 UM982 포트명 — 제조사 매뉴얼/UPrecise로 확인
#define I2C_SDA    21
#define I2C_SCL    22
#define BNO_ADDR   0x4A       // Adafruit 4754 기본. 점퍼로 0x4B 가능
#define BLE_NAME   "GNSSLite"
#define IMU_HZ     10
#define GGA_TO_CASTER_MS 5000 // VRS 는 주기적으로 현재 위치(GGA)를 요구

static const char *NUS_SVC = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char *NUS_RX  = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";   // 앱 → 장치 (write)
static const char *NUS_TX  = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";   // 장치 → 앱 (notify)

struct Cfg { String ssid, wpw, host, mount, user, pw; int port = 2101; } cfg;
Preferences prefs;
HardwareSerial &UM = Serial2;
Adafruit_BNO08x bno(-1);
NimBLEServer *server; NimBLECharacteristic *txChar;
volatile bool bleConnected = false; volatile uint16_t bleMtu = 23;
WiFiClient caster;
String lastGga, umLine, bleRxLine;
uint32_t rtcmBytes = 0, lastRtcmMs = 0, lastGgaSentMs = 0, lastTryMs = 0, lastStatMs = 0, lastImuMs = 0, wifiTryMs = 0;
bool casterUp = false, applyPending = false;
float q[4] = {1, 0, 0, 0}, accRad = 0; uint8_t magStatus = 0; bool haveImu = false;

// ───── 유틸 ─────
static String withChecksum(const String &body) {            // body: '$' 와 '*' 제외
  uint8_t x = 0; for (size_t i = 0; i < body.length(); i++) x ^= (uint8_t)body[i];
  char cs[8]; snprintf(cs, sizeof cs, "*%02X\r\n", x); return "$" + body + cs;
}
static bool checkOk(const String &l) {
  int s = l.indexOf('$'), a = l.lastIndexOf('*'); if (s < 0 || a < 0 || a + 3 > (int)l.length()) return false;
  uint8_t x = 0; for (int i = s + 1; i < a; i++) x ^= (uint8_t)l[i];
  return x == (uint8_t)strtol(l.substring(a + 1, a + 3).c_str(), nullptr, 16);
}
void bleSend(const String &s) {                             // MTU 에 맞춰 조각내어 notify
  if (!bleConnected) return;
  size_t chunk = bleMtu > 23 ? bleMtu - 3 : 20;
  for (size_t i = 0; i < s.length(); i += chunk) { txChar->setValue((const uint8_t *)s.c_str() + i, min(chunk, s.length() - i)); txChar->notify(); delay(4); }
}
void loadCfg() {
  prefs.begin("gnsslite", true);
  cfg.ssid = prefs.getString("ssid", ""); cfg.wpw = prefs.getString("wpw", ""); cfg.host = prefs.getString("host", "vrs.ngii.go.kr");
  cfg.port = prefs.getInt("port", 2101); cfg.mount = prefs.getString("mount", ""); cfg.user = prefs.getString("user", ""); cfg.pw = prefs.getString("pw", "");
  prefs.end();
}
void saveCfg() {
  prefs.begin("gnsslite", false);
  prefs.putString("ssid", cfg.ssid); prefs.putString("wpw", cfg.wpw); prefs.putString("host", cfg.host); prefs.putInt("port", cfg.port);
  prefs.putString("mount", cfg.mount); prefs.putString("user", cfg.user); prefs.putString("pw", cfg.pw); prefs.end();
}
void handleCfgLine(const String &l) {                       // $CFG,key,value*CS
  if (!checkOk(l)) return;
  int a = l.indexOf(','), b = l.indexOf(',', a + 1), e = l.lastIndexOf('*'); if (a < 3 || b < 0) return;
  if (l.substring(a - 3, a) != "CFG") return;
  String k = l.substring(a + 1, b), v = l.substring(b + 1, e);
  if (k == "ssid") cfg.ssid = v; else if (k == "wpw") cfg.wpw = v; else if (k == "host") cfg.host = v; else if (k == "port") cfg.port = v.toInt();
  else if (k == "mount") cfg.mount = v; else if (k == "user") cfg.user = v; else if (k == "pw") cfg.pw = v;
  else if (k == "apply") { saveCfg(); applyPending = true; }
}

// ───── BLE ─────
class SrvCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *s, ble_gap_conn_desc *d) override { bleConnected = true; bleMtu = 23; s->updateConnParams(d->conn_handle, 12, 24, 0, 200); }
  void onDisconnect(NimBLEServer *s) override { bleConnected = false; NimBLEDevice::startAdvertising(); }
  void onMTUChange(uint16_t mtu, ble_gap_conn_desc *) override { bleMtu = mtu; }
};
class RxCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c) override {
    std::string v = c->getValue();
    for (char ch : v) { if (ch == '\n') { if (bleRxLine.length()) handleCfgLine(bleRxLine); bleRxLine = ""; } else if (ch != '\r' && bleRxLine.length() < 200) bleRxLine += ch; }
  }
};
void bleInit() {
  NimBLEDevice::init(BLE_NAME); NimBLEDevice::setMTU(185);
  server = NimBLEDevice::createServer(); server->setCallbacks(new SrvCb());
  NimBLEService *svc = server->createService(NUS_SVC);
  txChar = svc->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic *rx = svc->createCharacteristic(NUS_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR); rx->setCallbacks(new RxCb());
  svc->start(); NimBLEAdvertising *adv = NimBLEDevice::getAdvertising(); adv->addServiceUUID(NUS_SVC); adv->setScanResponse(true); adv->start();
}

// ───── NTRIP ─────
String b64(const String &s) { unsigned char out[160]; size_t n = 0; mbedtls_base64_encode(out, sizeof out, &n, (const unsigned char *)s.c_str(), s.length()); return String((char *)out).substring(0, n); }
bool ntripConnect() {
  if (cfg.host == "" || cfg.mount == "") return false;
  caster.stop(); caster.setTimeout(4000);
  if (!caster.connect(cfg.host.c_str(), cfg.port)) return false;
  String req = "GET /" + cfg.mount + " HTTP/1.0\r\nUser-Agent: NTRIP GNSSLite/0.1\r\nAccept: */*\r\nConnection: close\r\n";   // NTRIP v1 호환 요청
  if (cfg.user != "") req += "Authorization: Basic " + b64(cfg.user + ":" + cfg.pw) + "\r\n";
  caster.print(req + "\r\n");
  String st = caster.readStringUntil('\n');                                     // "ICY 200 OK" 또는 "HTTP/1.x 200 OK"
  if (st.indexOf("200") < 0) { caster.stop(); return false; }
  if (st.startsWith("HTTP")) { for (int i = 0; i < 30; i++) { String h = caster.readStringUntil('\n'); if (h.length() <= 1) break; } }   // 헤더 소비
  lastRtcmMs = millis(); return true;
}
void ntripLoop() {
  if (WiFi.status() != WL_CONNECTED) { casterUp = false; return; }
  if (!casterUp || !caster.connected()) {
    casterUp = false;
    if (millis() - lastTryMs > 5000) { lastTryMs = millis(); casterUp = ntripConnect(); }
    return;
  }
  uint8_t buf[512]; int n;
  while ((n = caster.read(buf, sizeof buf)) > 0) { UM.write(buf, n); rtcmBytes += n; lastRtcmMs = millis(); }
  if (millis() - lastRtcmMs > 15000) { caster.stop(); casterUp = false; return; }                        // 데이터 끊김 → 재접속
  if (lastGga.length() && millis() - lastGgaSentMs > GGA_TO_CASTER_MS) { caster.print(lastGga + "\r\n"); lastGgaSentMs = millis(); }
}
void wifiLoop() {
  if (applyPending) { applyPending = false; caster.stop(); casterUp = false; WiFi.disconnect(); wifiTryMs = 0; }
  if (WiFi.status() != WL_CONNECTED && cfg.ssid != "" && millis() - wifiTryMs > 10000) { wifiTryMs = millis(); WiFi.begin(cfg.ssid.c_str(), cfg.wpw.c_str()); }
}

// ───── UM982 / IMU ─────
void umInit() {
  UM.begin(UM_BAUD, SERIAL_8N1, UM_RX, UM_TX); delay(200);
  // 출력 주기(초). 명령 문법·포트명은 UM982 매뉴얼로 확인할 것 (미검증)
  UM.print("GPGGA " UM_PORT " 0.5\r\n"); UM.print("GPGST " UM_PORT " 0.5\r\n");
  UM.print("GPGSV " UM_PORT " 1\r\n"); UM.print("GPGSA " UM_PORT " 1\r\n");           // 위성 신호(고도각·방위·C/N0)·사용 위성 — 명령 문법은 매뉴얼로 확인
}
void umLoop() {
  while (UM.available()) {
    char c = UM.read();
    if (c == '\n') {
      if (umLine.length() > 6 && umLine[0] == '$') {
        bool gga = umLine.indexOf("GGA,") == 3, gst = umLine.indexOf("GST,") == 3, gsv = umLine.indexOf("GSV,") == 3, gsa = umLine.indexOf("GSA,") == 3;
        if (gga) lastGga = umLine;
        if (gga || gst || gsv || gsa) bleSend(umLine + "\r\n");        // GSV/GSA: 위성 신호 기록·스카이 플롯용
      }
      umLine = "";
    } else if (c != '\r' && umLine.length() < 200) umLine += c;
  }
}
void imuInit() {
  Wire.begin(I2C_SDA, I2C_SCL); Wire.setClock(400000);
  if (!bno.begin_I2C(BNO_ADDR, &Wire)) { Serial.println("BNO085 not found"); return; }
  bno.enableReport(SH2_ROTATION_VECTOR, 1000000 / IMU_HZ / 2);              // 자력계 포함, 절대 방위
}
void imuLoop() {
  if (bno.wasReset()) bno.enableReport(SH2_ROTATION_VECTOR, 1000000 / IMU_HZ / 2);
  sh2_SensorValue_t v;
  while (bno.getSensorEvent(&v)) if (v.sensorId == SH2_ROTATION_VECTOR) {
    q[0] = v.un.rotationVector.real; q[1] = v.un.rotationVector.i; q[2] = v.un.rotationVector.j; q[3] = v.un.rotationVector.k;
    accRad = v.un.rotationVector.accuracy; magStatus = v.status & 0x03; haveImu = true;
  }
  if (haveImu && millis() - lastImuMs >= 1000 / IMU_HZ) {
    lastImuMs = millis();
    char b[96]; snprintf(b, sizeof b, "PIMU,%.5f,%.5f,%.5f,%.5f,%.2f,%u", q[0], q[1], q[2], q[3], accRad * 57.29578f, magStatus);
    bleSend(withChecksum(b));
  }
}
void statLoop() {
  if (millis() - lastStatMs < 1000) return; lastStatMs = millis();
  uint32_t age = casterUp ? (millis() - lastRtcmMs) / 1000 : 999;
  String b = "PSTAT," + String(WiFi.status() == WL_CONNECTED) + "," + String(casterUp) + "," + String(rtcmBytes) + "," + String(age) + "," + (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("-"));
  bleSend(withChecksum(b));
}

void setup() {
  Serial.begin(115200); loadCfg(); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  bleInit(); umInit(); imuInit();
}
void loop() { wifiLoop(); ntripLoop(); umLoop(); imuLoop(); statLoop(); delay(1); }
