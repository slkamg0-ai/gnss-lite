# Android 앱 (WebView + 네이티브 USB/NTRIP)

기존 웹앱을 WebView 에 담고 UM982 보드의 USB 시리얼과 NTRIP 을 앱이 직접 처리한다(SW Maps 불필요). 웹↔네이티브 규약은 `../docs/ANDROID_BRIDGE.md`.

## 빌드 (Windows)
도구는 저장소 밖 `C:\Users\prince-renovo\dev\` 에 있다: `jdk-17`, `android-sdk`(platform-tools, android-34, build-tools 34.0.0), `gradle-dist\gradle-8.7`.

```powershell
$env:TEMP = "C:\Users\prince-renovo\dev\tmp"; $env:TMP = $env:TEMP     # 임시 경로가 길면 Gradle 이 루프백 오류를 낸다
$env:JAVA_HOME = "C:\Users\prince-renovo\dev\jdk-17"
cd C:\Users\prince-renovo\gnss-lite
npm run android:sync                                                   # 웹앱을 assets/www 로 복사
cd android; .\gradlew.bat assembleDebug --no-daemon
```
산출물: `app/build/outputs/apk/debug/app-debug.apk`. 폰에 설치: USB 디버깅을 켠 뒤 `adb install -r app-debug.apk`.

`android/local.properties` 는 git 에서 제외된다. 없으면 `sdk.dir=C\:/Users/prince-renovo/dev/android-sdk` (슬래시 경로) 로 만든다.

## 상태
뼈대만 있고 폰에서 실행해 본 적 없다. 웹앱 쪽 `glNative` 연결(위치 소스 "내장 USB")과 NTRIP 입력 화면, 포그라운드 서비스, 음성 브리지, 아이콘, 서명은 TODO.
