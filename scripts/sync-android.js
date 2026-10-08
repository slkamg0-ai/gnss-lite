#!/usr/bin/env node
// 웹앱(dist/)을 Android 프로젝트의 assets/www 로 복사한다. 웹앱을 고친 뒤 APK 를 만들기 전에 실행.
// 사용: npm run android:sync
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'build-site.js')], { stdio: 'inherit' });

const src = path.join(root, 'dist');
const dst = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(src, dst, { recursive: true });
console.log('android assets 동기화 완료 → %s', path.relative(root, dst));
