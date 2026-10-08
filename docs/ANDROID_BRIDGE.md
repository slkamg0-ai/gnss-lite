# Android 앱 ↔ 웹앱 브리지 규약

Android 앱(`android/`)은 기존 웹앱을 WebView 에 담고, 아래 두 방향의 연결부만 추가한다. 웹앱은 `window.GLNative`가 있을 때만 "내장 USB" 소스를 켜면 된다(브라우저에서는 없음).

```
UM982 ─USB─ [GnssBridge: 시리얼 읽기/쓰기] ──NMEA──▶ window.glNative.onNmea(text)   → 기존 handleNmea
NTRIP 캐스터 ─RTCM─▶ [NtripClient] ─▶ 보드(USB 쓰기)       ◀── 최근 GGA 를 10초마다 캐스터에 보고
```

## 웹 → 네이티브 (`window.GLNative.*`)
| 메서드 | 설명 |
|---|---|
| `listUsb()` | 연결된 USB 장치 JSON 배열 `[{name,vid,pid}]` |
| `connectUsb(baud)` | 보드 연결(권한 팝업 포함). 기본 115200. 즉시 성공 여부(boolean) |
| `disconnectUsb()` | 연결 해제 |
| `ntripSave(host,port,mount,user,pass)` | 계정을 Keystore 로 암호화 저장 |
| `ntripLoad()` | 저장된 계정(비밀번호 제외) JSON, 없으면 `{}` |
| `ntripStartSaved()` | 저장 계정으로 보정 수신 시작(끊기면 5초마다 자동 재연결) |
| `ntripStop()` / `ntripClear()` | 중지 / 저장 계정 삭제 |
| `status()` | 상태 JSON |

## 네이티브 → 웹 (웹앱이 정의해 둘 콜백)
```js
window.glNative = {
  onNmea(text)   { text.split('\n').forEach(handleNmea); },   // '$'로 시작하는 NMEA 문장들(줄바꿈 구분)
  onStatus(json) { const s = JSON.parse(json); /* s.usb, s.ntrip, s.nmea, s.rtcm */ },
};
```
- `usb`: `none | no-device | asking-permission | denied | unsupported | open-failed | connected | error: …`
- `ntrip`: `stopped | connecting | connected | error: …`
- `nmea`: 받은 NMEA 문장 누적 수, `rtcm`: 받은 RTCM 누적 바이트

## 규칙
- NTRIP 비밀번호는 한 번 저장한 뒤 JS 로 되돌려 주지 않는다(`ntripLoad`는 `hasPass`만).
- 웹앱의 Fix 판정은 NMEA GGA 품질 필드(4=FIXED, 5=FLOAT)를 직접 쓰므로 모의 위치 우회(SW Maps)가 필요 없다.
- 미구현(TODO): 웹앱 쪽 `glNative` 연결(소스 "내장 USB"), 포그라운드 서비스(화면이 꺼져도 유지), 네이티브 음성 인식 브리지, 앱 아이콘, 릴리스 서명.
