#!/usr/bin/env node
// 배포용 폴더(dist/) 생성: 앱 실행에 필요한 파일만 복사한다(테스트·펌웨어·node_modules·하드웨어 제외).
// 사용: npm run build:site  →  dist/ 폴더를 Netlify / Cloudflare Pages / GitHub Pages 에 올린다.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const FILES = ['index.html', 'style.css', 'core.js', 'dxf.js', 'nlu.js', 'app.js', 'sw.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'vendor/anthropic.bundle.js', 'data/kngeo24.ggf'];

fs.rmSync(out, { recursive: true, force: true });
for (const f of FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) throw new Error('없는 파일: ' + f);
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(src, path.join(out, f));
}

// 서비스워커가 미리 캐시하는 목록과 배포 파일이 일치하는지 확인한다(빠지면 오프라인에서 앱이 깨짐).
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const listed = [...sw.match(/FILES\s*=\s*\[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
const missing = listed.filter(f => !FILES.includes(f));
if (missing.length) throw new Error('sw.js 에는 있으나 배포 목록에 없음: ' + missing.join(', '));

fs.writeFileSync(path.join(out, '.nojekyll'), '');                                            // GitHub Pages 가 파일을 가공하지 않게
fs.writeFileSync(path.join(out, '_headers'), '/sw.js\n  Cache-Control: no-cache\n/*.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n');   // Netlify / Cloudflare Pages
const ver = (fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/const VER = '([^']+)'/) || [])[1];
fs.writeFileSync(path.join(out, 'VERSION.txt'), 'GNSS-Lite ' + ver + '\nbuilt ' + new Date().toISOString() + '\n');
console.log('dist/ 생성 완료: 파일 %d개, 버전 %s', FILES.length + 3, ver);
