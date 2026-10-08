/* 간이측량기 앱 — 위치수신 · 스테이크아웃 · 측량 · 도면 · 출력 */
(() => {
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f3 = v => (v == null || !isFinite(v)) ? '–' : v.toFixed(3);
const fSign = (v, d = 3) => (v == null || !isFinite(v)) ? '–' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const fLen = v => { v = Math.abs(v); return v < 1 ? (v * 100).toFixed(1) + ' cm' : v.toFixed(2) + ' m'; };
const VER = '0.1.0';

// ───────────── 상태 / 저장 ─────────────
const KEY = 'gnsslite.v1';
const defState = () => ({ v: 1, settings: { crs: 'EPSG:5186', antH: 1.8, avgSec: 5, tol: 0.03, reqFix: true, source: 'sim', baud: 115200 },
  calib: { pairs: [] }, bridge: { ssid: '', wpw: '', host: 'vrs.ngii.go.kr', port: 2101, mount: '', user: '', pw: '' }, points: [], segs: [], curSeg: null, curSta: 0, shots: {}, seq: 1 });
let S = load();
function load() {
  try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && j.v === 1) { const d = defState(); return Object.assign(d, j, { settings: Object.assign(d.settings, j.settings) }); } } catch (e) {}
  return defState();
}
function save() { trackUndo(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { if (!save.warned) { save.warned = true; try { toast('⚠ 저장 실패 — 저장공간을 확인하고 지금 백업하세요'); } catch (x) {} } } }

// ───────────── 실행 취소 ─────────────
// 모든 변경은 save() 를 거치므로, 저장 시점마다 “데이터 부분”(점·선형·측정결과·면적)이 바뀌었는지 비교해 이전 상태를 스택에 쌓는다.
// 설정·위치·보정·DXF 배경·화면 이동은 대상이 아님.
const UNDO = []; let lastSig = null, undoTimer = null;
const UNDO_KEYS = ['points', 'segs', 'shots', 'pshots', 'areas', 'seq', 'areaCur', 'curSeg'];
const dataSig = () => JSON.stringify(Object.fromEntries(UNDO_KEYS.map(k => [k, S[k]])));
function undoLabel(a, b) {
  try {
    const A = JSON.parse(a), B = JSON.parse(b), n = o => Array.isArray(o) ? o.length : Object.keys(o || {}).length, j = JSON.stringify;
    if (n(B.shots) !== n(A.shots) || n(B.pshots) !== n(A.pshots)) return (n(B.shots) + n(B.pshots)) > (n(A.shots) + n(A.pshots)) ? '확정 측정' : '측정 결과 삭제';
    if (j(B.shots) !== j(A.shots) || j(B.pshots) !== j(A.pshots)) return '측정 결과 갱신';
    if (n(B.points) !== n(A.points)) return n(B.points) > n(A.points) ? '점 추가' : '점 삭제';
    if (j(B.points) !== j(A.points)) return '점 수정';
    if (n(B.segs) !== n(A.segs)) return n(B.segs) > n(A.segs) ? '선형 추가' : '선형 삭제';
    if (j(B.segs) !== j(A.segs)) return '선형 편집';
    if (n(B.areas) !== n(A.areas)) return n(B.areas) > n(A.areas) ? '면적 추가' : '면적 삭제';
    return '면적 편집';
  } catch (e) { return '변경'; }
}
function trackUndo() {
  if (lastSig === null) return; const sig = dataSig(); if (sig === lastSig) return;
  const label = undoLabel(lastSig, sig); UNDO.push({ sig: lastSig, label }); if (UNDO.length > 30) UNDO.shift(); lastSig = sig; showUndoBar(label);
}
function showUndoBar(label) {
  const bar = document.getElementById('undoBar'); if (!bar) return;
  document.getElementById('undoTxt').textContent = label; bar.hidden = false; clearTimeout(undoTimer); undoTimer = setTimeout(() => { bar.hidden = true; }, 6000); refreshUndoBtn();
}
function refreshUndoBtn() { const b = document.getElementById('undoBtn'); if (b) { b.disabled = !UNDO.length; b.textContent = '↶' + (UNDO.length ? ' ' + UNDO.length : ''); } }
function undo() {
  const u = UNDO.pop(); if (!u) { toast('되돌릴 작업이 없습니다'); return; }
  const d = JSON.parse(u.sig); UNDO_KEYS.forEach(k => { S[k] = d[k]; });
  if (!S.segs.find(s => s.id === S.curSeg) && S.segs.length) S.curSeg = S.segs[0].id;
  S.curSta = 0; lastSig = dataSig(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  document.getElementById('undoBar').hidden = true; refreshUndoBtn(); refreshAll(); toast('되돌림: ' + u.label);
}
function refreshAll() { buildStake(); renderSurvey(); renderAreas(); renderSegs(); dirty = true; }
S.settings.tilt = Object.assign({ on: false, decl: -8.5, max: 3, yawOff: 0, axis: null, frame: 'ENU', imuSrc: 'phone' }, S.settings.tilt);
S.bridge = Object.assign(defState().bridge, S.bridge);
let CAL = GL.solveCalibration(S.calib.pairs);
const uid = () => Math.random().toString(36).slice(2, 9);

// ───────────── 위치 파이프라인 ─────────────
let L = null;            // 최신 에포크 {lat,lon,alt,fix,sats,hdop,sdH,sdV,src,raw,site,t}
let sampler = null, dirty = true, tab = 'stake';
let IMU = null, imuTap = null;   // imuTap: IMU 수신 이벤트 훅(캘리브레이션 수집)
// IMU 입력 게이트: 'phone'(폰 내장 센서, ENU) / 'ext'(ESP32·BNO085 등 외부) / 'sim'(데모). 설정의 imuSrc 와 맞는 것만 받는다.
function setImu(q, mag, accDeg, src, enu) {
  const T = S.settings.tilt;
  if (src === 'phone' && (T.imuSrc !== 'phone' || S.settings.source === 'sim')) return;
  if (src === 'ext' && T.imuSrc !== 'ext') return;
  IMU = { q, mag, accDeg, enu, src, t: Date.now(), seq: (IMU ? IMU.seq : 0) + 1 };
  if (imuTap) imuTap(IMU);
}
const imuQ = () => GL.qToEnu(IMU.q, IMU.enu ? 'ENU' : S.settings.tilt.frame);   // 세계 프레임 → ENU 로 통일한 쿼터니언          // {q,mag,accDeg,t,seq} — ESP32(BNO085) 또는 시뮬레이터

// 안테나 위치 → 지면(폴 끝) 위치. 기울기 보정이 켜져 있으면 IMU로 폴 기울기를 보상한다.
function computeRaw(p, alt) {
  const T = S.settings.tilt, h = S.settings.antH;
  if (!isFinite(alt)) return { raw: { n: p.n, e: p.e, z: NaN }, tilt: T.on ? { missing: true, why: '고도 정보 없음' } : null };
  if (!T.on) return { raw: { n: p.n, e: p.e, z: alt - h }, tilt: null };
  if (!T.axis || !IMU || Date.now() - IMU.t > 1000) return { raw: { n: p.n, e: p.e, z: alt - h }, tilt: { missing: true, why: !T.axis ? '수평 캘리브레이션 필요' : 'IMU 수신 없음' } };
  const ti = GL.tiltInfo(imuQ(), T.axis, T.decl, T.yawOff), magOk = IMU.mag >= 2, lim = GL.allowedTilt(h, +S.settings.tol || 0.03, T.max, magOk);
  const c = GL.tiltCompensate({ n: p.n, e: p.e, z: alt }, h, ti);
  // 자력 불량: 방위를 믿을 수 없으므로 수평 보정은 하지 않고(높이만 보정), 기울기를 허용오차 안으로 제한
  return { raw: { n: magOk ? c.n : p.n, e: magOk ? c.e : p.e, z: c.z }, tilt: { theta: ti.theta, az: ti.az, lim, magOk, ok: ti.theta <= lim, dh: c.dh } };
}
// 시험용 Fix 통계(소스 연결 후): 첫 FIXED까지 시간, 등급별 비율, FIXED 이탈·재획득, 수신 끊김(3초 이상 무수신)
const FS = { t0: null, first: null, n: 0, c: {}, lastT: 0, gaps: 0, lost: null, reacq: [], drops: 0 };
function fsReset() { Object.assign(FS, { t0: null, first: null, n: 0, c: {}, lastT: 0, gaps: 0, lost: null, reacq: [], drops: 0 }); }
function fsFeed(fix, now) {
  if (FS.t0 == null) FS.t0 = now;
  if (FS.lastT && now - FS.lastT > 3000) FS.gaps++;
  FS.lastT = now; FS.n++; FS.c[fix] = (FS.c[fix] || 0) + 1;
  const fx = fix === 'FIXED';
  if (fx && FS.first == null) FS.first = (now - FS.t0) / 1000;
  if (!fx && FS.first != null && FS.lost == null) { FS.lost = now; FS.drops++; }
  if (fx && FS.lost != null) { FS.reacq.push((now - FS.lost) / 1000); FS.lost = null; }
}
function fsText() {
  if (!FS.n) return '통계 없음 — 위치 수신 전';
  const c = FS.c, pct = v => (100 * (v || 0) / FS.n).toFixed(0), el = (Date.now() - FS.t0) / 1000, mm = Math.floor(el / 60), ss = String(Math.floor(el % 60)).padStart(2, '0');
  const ra = FS.reacq.length ? ` (재획득 평균 ${(FS.reacq.reduce((a, b) => a + b, 0) / FS.reacq.length).toFixed(0)}초)` : '';
  return `연결 후 ${mm}:${ss} · 첫 FIXED ${FS.first == null ? '아직' : FS.first.toFixed(0) + '초'} · FIXED ${pct(c.FIXED)}% · FLOAT ${pct(c.FLOAT)}% · 기타 ${pct(FS.n - (c.FIXED || 0) - (c.FLOAT || 0))}% · FIXED 이탈 ${FS.drops}회${ra} · 수신 끊김 ${FS.gaps}회`;
}
// 수신 진단: 현장에서 막혔을 때 원인을 한 번에 보고할 수 있도록 최근 60초의 갱신 간격·정확도·Fix·고도 유무를 모은다(좌표는 저장하지 않음)
const DG = { ep: [], lastSampErr: '', lastSampOk: '' };
function dgFeed(ep, now) { DG.ep.push({ t: now, fix: ep.fix, sdH: ep.sdH, sdV: ep.sdV, alt: ep.alt != null && isFinite(ep.alt) }); const cut = now - 60000; while (DG.ep.length && DG.ep[0].t < cut) DG.ep.shift(); }
function dgStats() {
  const e = DG.ep; if (!e.length) return null;
  const dts = []; for (let i = 1; i < e.length; i++) dts.push((e[i].t - e[i - 1].t) / 1000);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length, sd = e.map(x => x.sdH).filter(v => v != null && isFinite(v));
  return { n: e.length, hz: dts.length ? 1 / mean(dts) : null, dtMax: dts.length ? Math.max(...dts) : null, fixedPct: 100 * e.filter(x => x.fix === 'FIXED').length / e.length,
    sdMin: sd.length ? Math.min(...sd) : null, sdMax: sd.length ? Math.max(...sd) : null, sdLast: sd.length ? sd[sd.length - 1] : null, altPct: 100 * e.filter(x => x.alt).length / e.length, ageLast: (Date.now() - e[e.length - 1].t) / 1000 };
}
function diagReport() {
  const s = S.settings, d = dgStats(), w = $('#warn'), warn = w && !w.hidden ? w.textContent : '(경고 없음)';
  const f = (v, k) => v == null || !isFinite(v) ? '–' : (+v).toFixed(k), cm = v => v == null ? '–' : (v * 100).toFixed(1);
  return ['[간이측량기 진단] ' + new Date().toISOString(), 'GNSS-Lite v' + VER + ' · ' + location.host, 'UA: ' + navigator.userAgent,
    `설정: 소스=${s.source} 좌표계=${s.crs} 안테나높이=${s.antH} 평균=${s.avgSec}s 허용오차=${s.tol} FIXED만측량=${s.reqFix} 기울기보정=${s.tilt.on}(${s.tilt.imuSrc})`,
    '위치 소스 상태: ' + ($('#srcStatus') ? $('#srcStatus').textContent : '–'), '경고: ' + warn,
    d ? `최근 60초: 갱신 ${d.n}회(${f(d.hz, 2)} Hz, 최대 간격 ${f(d.dtMax, 1)}s, 마지막 갱신 ${f(d.ageLast, 1)}s 전), FIXED ${f(d.fixedPct, 0)}%, 수평정확도 최소/최대/마지막 ${cm(d.sdMin)}/${cm(d.sdMax)}/${cm(d.sdLast)} cm, 고도 포함 ${f(d.altPct, 0)}%` : '최근 60초: 위치 수신 없음',
    'Fix 통계: ' + fsText(), '마지막 측정: ' + (DG.lastSampErr ? '실패 — ' + DG.lastSampErr : DG.lastSampOk || '(없음)')].join('\n');
}
function onEpoch(ep) {
  const p = GL.toProjected(S.settings.crs, ep.lat, ep.lon), r = computeRaw(p, ep.alt == null ? NaN : ep.alt);
  L = Object.assign({}, ep, { raw: r.raw, tilt: r.tilt, site: GL.applyCalibration(CAL, r.raw), t: Date.now() });
  fsFeed(ep.fix, L.t); dgFeed(ep, L.t);
  logEpoch(L);
  if (sampler) feedSampler();
  dirty = true;
}

// ── 소스: 데모(가상) ──
const SIM = { n: 0, e: 0, fix: 'FIXED', timer: null, o: null, tilt: 0, taz: 0, magOk: true };
const SIM_DECL = -8.5;   // 시뮬레이터 세계의 실제 자북 편차 (설정값과 같아야 방위가 맞음)
const SIM_MOUNT = (() => { const a = [0.3, -0.5, 0.8], n = Math.hypot(...a), sn = Math.sin(0.55) / n; return [Math.cos(0.55), a[0] * sn, a[1] * sn, a[2] * sn]; })();   // IMU가 폴에 임의 각도로 장착된 상태
function simImuQ() {
  const th = SIM.tilt * Math.PI / 180; if (!th) return SIM_MOUNT.slice();
  const ma = (SIM.taz - SIM_DECL) * Math.PI / 180, u = [Math.sin(th) * Math.sin(ma), Math.sin(th) * Math.cos(ma)], n = Math.hypot(u[0], u[1]), sn = Math.sin(th / 2) / n;
  return GL.qMul([Math.cos(th / 2), -u[1] * sn, u[0] * sn, 0], SIM_MOUNT);
}
function simOrigin() { const o = GL.toProjected(S.settings.crs, 37.19, 126.75); return { n: Math.round(o.n), e: Math.round(o.e) }; }
function simGround(n, e) { const o = SIM.o; return 10.45 - 0.004 * ((n - o.n) * 0.6 + (e - o.e) * 0.8) + 0.03 * Math.sin((e - o.e) / 7); }
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += Math.random(); return (u - 3) / 0.7071; };
// 데모용 가상 하늘: GSV/GSA 문장을 실제 파서 경로(handleNmea)로 흘려보냄 (낮은 고도 위성에 가끔 다중경로성 C/N0 감쇠)
const SIM_SATS = (() => { const out = []; let k = 0; [['GP', 10, 1], ['GL', 6, 65], ['GA', 6, 2], ['GB', 7, 6]].forEach(([tk, n, base]) => { for (let i = 0; i < n; i++, k++) out.push({ tk, prn: base + i * 3, az0: (k * 47) % 360, el0: 8 + (k * 29) % 75, k }); }); return out; })();
function simSky() {
  const t = Date.now() / 1000, by = {}, pad = v => String(v).padStart(2, '0'), sysId = { GP: 1, GL: 2, GA: 3, GB: 4 };
  SIM_SATS.forEach(s => {
    const el = Math.max(3, Math.min(88, s.el0 + 8 * Math.sin(t / 900 + s.k))), az = (s.az0 + t * 0.004) % 360; let cn = 30 + 0.2 * el + gauss() * 1.2;
    if (el < 25 && Math.sin(t / 40 + s.k * 2) > 0.6) cn -= 7;
    (by[s.tk] = by[s.tk] || []).push({ prn: s.prn, el: Math.round(el), az: Math.round(az), cn: Math.round(cn), used: el >= 12 });
  });
  Object.entries(by).forEach(([tk, list]) => {
    const total = Math.ceil(list.length / 4);
    for (let m = 0; m < total; m++) handleNmea(GL.nmeaChecksumAppend(`${tk}GSV,${total},${m + 1},${list.length},` + list.slice(m * 4, m * 4 + 4).map(x => `${pad(x.prn)},${pad(x.el)},${String(x.az).padStart(3, '0')},${pad(x.cn)}`).join(',')));
    const used = list.filter(x => x.used).slice(0, 12).map(x => pad(x.prn)); while (used.length < 12) used.push('');
    handleNmea(GL.nmeaChecksumAppend(`GNGSA,A,3,${used.join(',')},1.8,0.9,1.5,${sysId[tk]}`));
  });
}
function simTick() {
  SIM.k = (SIM.k || 0) + 1; if (SIM.k % 5 === 1) simSky();
  const sd = { FIXED: 0.008, FLOAT: 0.15, SINGLE: 1.2 }[SIM.fix];
  const th = SIM.tilt * Math.PI / 180, az = SIM.taz * Math.PI / 180, h = S.settings.antH;      // 안테나는 폴 끝에서 h·sinθ 만큼 기울어진 쪽에 있음
  const n = SIM.n + h * Math.sin(th) * Math.cos(az) + gauss() * sd, e = SIM.e + h * Math.sin(th) * Math.sin(az) + gauss() * sd;
  const ll = GL.fromProjected(S.settings.crs, e, n);
  setImu(simImuQ(), SIM.magOk ? 3 : 1, 2, 'sim', true);
  onEpoch({ lat: ll.lat, lon: ll.lon, alt: simGround(SIM.n, SIM.e) + h * Math.cos(th) + gauss() * sd * 1.5, fix: SIM.fix, sats: SIM.fix === 'FIXED' ? 27 : 14,
    hdop: 0.6, sdH: sd, sdV: sd * 1.5, src: 'sim' });
}
function simStart() {
  SIM.o = simOrigin();
  if (!SIM.n) { SIM.n = SIM.o.n - 3; SIM.e = SIM.o.e - 4; }
  clearInterval(SIM.timer); SIM.timer = setInterval(simTick, 200); simTick();
}
function simStop() { clearInterval(SIM.timer); SIM.timer = null; }

// ── 소스: 폰 GPS (Geolocation — SW Maps/Lefebure 모의위치 사용) ──
let geoId = null;
function geoStart() {
  if (!('geolocation' in navigator)) { srcStatus('이 브라우저는 위치 API 미지원'); return; }
  srcStatus('위치 권한 요청 중…');
  geoId = navigator.geolocation.watchPosition(pos => {
    const c = pos.coords; srcStatus('수신 중 · 정확도 ' + (c.accuracy != null ? c.accuracy.toFixed(3) + ' m' : '–') + (c.altitude == null ? ' · 고도 없음' : ''));
    onEpoch({ lat: c.latitude, lon: c.longitude, alt: c.altitude, fix: GL.fixFromAccuracy(c.accuracy), sats: null, hdop: null,
      sdH: c.accuracy, sdV: c.altitudeAccuracy != null ? c.altitudeAccuracy : null, src: 'geo' });
  }, err => srcStatus('위치 오류: ' + err.message), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function geoStop() { if (geoId != null) navigator.geolocation.clearWatch(geoId); geoId = null; }

// ── 소스: USB 시리얼 NMEA (Web Serial) ──
let port = null, reader = null, gst = null;
async function serialConnect() {
  if (!('serial' in navigator)) { toast('Web Serial 미지원 — Android Chrome(USB OTG) 또는 PC Chrome/Edge 필요'); return; }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: +S.settings.baud });
    srcStatus('연결됨 · NMEA 대기 중…'); $('#btnSerial').textContent = '연결 해제';
    const dec = new TextDecoder(), feed = GL.makeLineBuffer(handleNmea);
    reader = port.readable.getReader();
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; feed(dec.decode(value, { stream: true })); } } catch (e) { srcStatus('수신 종료: ' + e.message); } })();
  } catch (e) { srcStatus('연결 실패: ' + e.message); port = null; }
}
async function serialDisconnect() {
  try { if (reader) { await reader.cancel(); reader.releaseLock(); } if (port) await port.close(); } catch (e) {}
  reader = null; port = null; $('#btnSerial').textContent = '연결'; srcStatus('연결 해제됨');
}
function handleNmea(line) {
  logNmea(line);
  const m = GL.parseNmea(line); if (!m) return;
  if (m.type === 'GSV' || m.type === 'GSA') { skyUpdate(m); return; }
  if (m.type === 'IMU') { setImu(m.q, m.mag, m.accDeg, 'ext', false); return; }
  if (m.type === 'STAT') { srcStatus('Wi-Fi ' + (m.wifi ? '연결' : '끊김') + ' · NTRIP ' + (m.ntrip ? '접속' : '끊김') + ' · RTCM ' + m.rtcm + ' B · 마지막 ' + m.age + 's' + (m.text ? ' · ' + m.text : '')); return; }
  if (m.type === 'GST') { gst = { sdH: Math.hypot(m.sdLat, m.sdLon), sdV: m.sdAlt, t: Date.now() }; return; }
  if (m.type === 'GGA' && m.fix > 0) {
    const g = gst && Date.now() - gst.t < 3000 ? gst : null;
    onEpoch({ lat: m.lat, lon: m.lon, alt: m.alt, fix: GL.fixClass(m.fix), sats: m.sats, hdop: m.hdop, age: m.age, sdH: g ? g.sdH : null, sdV: g ? g.sdV : null, src: S.settings.source });
  }
}
async function um982Cfg() {
  if (!port || !port.writable) { toast('먼저 시리얼 연결'); return; }
  const w = port.writable.getWriter();
  try { await w.write(new TextEncoder().encode('GPGGA COM1 1\r\nGPGST COM1 1\r\n')); toast('명령 전송됨 (UM982 매뉴얼로 응답 확인)'); } finally { w.releaseLock(); }
}

// ── 소스: ESP32 브리지 (Web Bluetooth, Nordic UART Service) — NTRIP·UM982·BNO085 통합 ──
const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e', NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e', NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
let bleDev = null, bleRx = null;
async function bleConnect() {
  if (!navigator.bluetooth) { toast('Web Bluetooth 미지원 — Android Chrome(HTTPS) 필요'); return; }
  try {
    bleDev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'GNSSLite' }], optionalServices: [NUS] });
    bleDev.addEventListener('gattserverdisconnected', () => { srcStatus('BLE 연결 끊김'); $('#btnBle').textContent = 'ESP32 연결 (BLE)'; bleRx = null; });
    const svc = await (await bleDev.gatt.connect()).getPrimaryService(NUS), tx = await svc.getCharacteristic(NUS_TX);
    bleRx = await svc.getCharacteristic(NUS_RX);
    const dec = new TextDecoder(), feed = GL.makeLineBuffer(handleNmea);
    tx.addEventListener('characteristicvaluechanged', e => feed(dec.decode(e.target.value, { stream: true })));
    await tx.startNotifications(); srcStatus('BLE 연결됨 · 데이터 대기 중…'); $('#btnBle').textContent = '연결 해제';
  } catch (e) { srcStatus('BLE 연결 실패: ' + e.message); }
}
async function bleSend(line) {
  if (!bleRx) throw new Error('BLE 미연결');
  const b = new TextEncoder().encode(line + String.fromCharCode(13, 10)); for (let i = 0; i < b.length; i += 20) await bleRx.writeValueWithoutResponse(b.slice(i, i + 20));
}
const CFG_FIELDS = { ssid: 'cfgSsid', wpw: 'cfgWpw', host: 'cfgHost', port: 'cfgPort', mount: 'cfgMount', user: 'cfgUser', pw: 'cfgPw' };
async function sendBridgeCfg() {
  try {
    for (const k of Object.keys(CFG_FIELDS)) { const v = String(S.bridge[k] == null ? '' : S.bridge[k]); if (v.includes(',')) throw new Error('쉼표(,)가 들어간 값이 있습니다: ' + k); await bleSend(GL.nmeaChecksumAppend('CFG,' + k + ',' + v)); }
    await bleSend(GL.nmeaChecksumAppend('CFG,apply,1')); toast('설정 전송 완료 — 장치가 재접속합니다');
  } catch (e) { toast(e.message); }
}

function stopSource() { simStop(); geoStop(); nativeStop(); if (port) serialDisconnect(); if (bleDev && bleDev.gatt.connected) bleDev.gatt.disconnect(); IMU = null; L = null; fsReset(); }
function startSource() {
  stopSource();
  const s = S.settings.source;
  if (s === 'sim') simStart(); else if (s === 'geo') geoStart(); else if (s === 'native') nativeStart(); else if (s === 'ble') srcStatus('“ESP32 연결”을 눌러 GNSSLite 장치를 선택하세요'); else srcStatus('“연결”을 눌러 시리얼 포트를 선택하세요');
  renderSettings(); if (tab === 'stake') buildStake(); dirty = true;
}
const SRC_HELP = {
  geo: 'SW Maps 또는 Lefebure NTRIP Client에서 UM982(+NTRIP)를 연결하고 “모의 위치(Mock location)”를 켠 뒤, 개발자옵션 ▸ 모의 위치 앱으로 지정하세요. 이 앱은 폰이 받는 위치를 그대로 쓰며, Fix 종류는 보고된 정확도(σ)로 추정합니다.',
  native: 'Android 앱이 UM982 보드를 USB로 직접 읽고 NTRIP 보정 정보도 직접 받아 보드에 넣습니다. SW Maps가 필요 없습니다. 보드를 꽂고 아래에 NTRIP 계정을 한 번 저장하면 다음부터는 자동으로 연결됩니다.',
  serial: 'USB-OTG로 UM982의 NMEA(GGA, 가능하면 GST)를 직접 읽습니다. 수신기에 보정정보가 공급되는 구성에서만 RTK가 됩니다.',
  ble: 'ESP32가 폰 핫스팟으로 NTRIP 보정정보를 받아 UM982에 넣고, UM982 위치(NMEA)와 BNO085 자세($PIMU)를 BLE로 보냅니다. 폰 앱 하나로 RTK+기울기 보정까지 처리합니다.',
  sim: '가상 위치로 화면·계산·출력 흐름을 연습/검증하는 모드입니다. 실측 데이터가 아닙니다 (점에 SIM 표시).',
};
function srcStatus(t) { $('#srcStatus').textContent = t; }

// ── 소스: 내장 USB (Android 앱: 보드 USB 직결 + NTRIP 을 앱이 처리, 규약은 docs/ANDROID_BRIDGE.md) ──
const NATIVE = window.GLNative || null;
let NST = null;
const NSTAT = {
  usb: { none: '미연결', 'no-device': '보드를 USB로 연결하세요', 'asking-permission': 'USB 권한 팝업에서 허용하세요', denied: 'USB 권한이 거부됨 — 다시 꽂아 허용하세요', unsupported: '지원하지 않는 USB 장치', 'open-failed': 'USB 열기 실패', connected: '보드 연결됨' },
  ntrip: { stopped: '보정 꺼짐', connecting: '보정 서버 접속 중…', connected: '보정 수신 중' },
};
function nativeStatusText(s) {
  const u = NSTAT.usb[s.usb] || s.usb, n = NSTAT.ntrip[s.ntrip] || s.ntrip;
  return 'USB: ' + u + ' · ' + n + ' · NMEA ' + s.nmea + '줄 · RTCM ' + (s.rtcm / 1024).toFixed(1) + ' KB';
}
window.glNative = {
  onNmea(text) { if (S.settings.source !== 'native') return; String(text).split('\n').forEach(l => { if (l) handleNmea(l); }); },
  onStatus(json) { try { NST = JSON.parse(json); } catch (e) { return; } if (S.settings.source === 'native') srcStatus(nativeStatusText(NST)); },
};
function nativeStart() {
  if (!NATIVE) { srcStatus('이 소스는 Android 앱에서만 쓸 수 있습니다'); return; }
  try {
    const c = JSON.parse(NATIVE.ntripLoad() || '{}');
    if (c.host) { $('#ntHost').value = c.host; $('#ntPort').value = c.port; $('#ntMount').value = c.mount; $('#ntUser').value = c.user; }
    $('#ntPw').placeholder = c.hasPass ? '(저장됨 — 바꿀 때만 입력)' : '';
    NATIVE.connectUsb(+S.settings.baud || 115200);
    if (c.host && c.hasPass) NATIVE.ntripStartSaved();
    NST = JSON.parse(NATIVE.status()); srcStatus(nativeStatusText(NST));
  } catch (e) { srcStatus('내장 USB 오류: ' + e.message); }
}
function nativeStop() { if (!NATIVE) return; try { NATIVE.ntripStop(); NATIVE.disconnectUsb(); } catch (e) {} }

// ───────────── 평균 측정 ─────────────
function sample(sec) {
  return new Promise((resolve, reject) => {
    if (!L) return reject(new Error('위치 수신 없음'));
    if (sampler) return reject(new Error('측정 중'));
    sampler = { sec, buf: [], tStart: 0, t0: Date.now(), resets: 0, resolve, reject };
    $('#sampling').hidden = false; $('#sFill').style.width = '0%'; $('#sTxt').textContent = '측정 준비…'; dirty = true;
    sampler.guard = setInterval(() => {
      const sp = sampler; if (!sp) return; const lag = L ? (Date.now() - L.t) / 1000 : 99;
      if (lag > 2) $('#sTxt').textContent = `위치 갱신이 느림 (마지막 갱신 ${lag.toFixed(1)}초 전, n=${sp.buf.length})`;     // 갱신 자체가 멈춘 경우를 구분해서 보여 줌
      if (Date.now() - sp.t0 > 60000) endSampler(new Error(`60초 내 조건 미충족 (n=${sp.buf.length}, 리셋 ${sp.resets}, 마지막 Fix ${L ? L.fix : '없음'}, 마지막 갱신 ${lag.toFixed(1)}초 전)`));
    }, 500);
    feedSampler();
  });
}
function endSampler(err, res) {
  if (!sampler) return; const s = sampler; sampler = null; clearInterval(s.guard); $('#sampling').hidden = true;
  if (err) DG.lastSampErr = err.message; else { DG.lastSampErr = ''; DG.lastSampOk = `성공 n=${res.count}, Fix ${res.fix}, 정밀도 ${(res.sdH * 100).toFixed(1)}/${(res.sdV * 100).toFixed(1)} cm`; }
  err ? s.reject(err) : s.resolve(res);
}
function feedSampler() {
  const s = sampler, ok = !S.settings.reqFix || L.fix === 'FIXED';
  const tl = L.tilt, tiltBad = tl && (tl.missing || !tl.ok);
  if (!ok && s.buf.length && isFinite(L.site.z) && !tiltBad && (s.miss = (s.miss || 0) + 1) <= 2) return;   // 정확도 값이 출렁여 한두 번 FIXED가 풀려도 평균을 처음부터 다시 하지 않고 그 순간만 건너뜀
  if (ok) s.miss = 0;
  if (!ok || !isFinite(L.site.z) || tiltBad) { if (s.buf.length) s.resets++; s.buf = []; s.tStart = 0; s.miss = 0;
    $('#sTxt').textContent = !ok ? 'FIXED 대기… (' + L.fix + ')' : tiltBad ? (tl.missing ? tl.why : '기울기 ' + tl.theta.toFixed(1) + '° > 한계 ' + tl.lim.toFixed(1) + '° — 폴을 세우세요') : '고도값 없음'; $('#sFill').style.width = '0%'; return; }
  if (!s.tStart) s.tStart = Date.now();
  s.buf.push({ site: L.site, raw: L.raw, fix: L.fix, sats: L.sats, hdop: L.hdop, sdH: L.sdH, sdV: L.sdV, age: L.age, th: L.tilt && !L.tilt.missing ? L.tilt.theta : null });
  const el = (Date.now() - s.tStart) / 1000;
  $('#sFill').style.width = Math.min(100, el / s.sec * 100) + '%'; $('#sTxt').textContent = `측정 중 ${Math.min(el, s.sec).toFixed(1)} / ${s.sec}s · n=${s.buf.length}`;
  if (el >= s.sec && s.buf.length >= 3) {
    const g = k => GL.meanSd(s.buf.map(x => x.site[k])), r = k => GL.meanSd(s.buf.map(x => x.raw[k]));
    const N = g('n'), E = g('e'), Z = g('z');
    endSampler(null, { n: N.mean, e: E.mean, z: Z.mean, sdH: Math.hypot(N.sd, E.sd), sdV: Z.sd, count: s.buf.length, fix: L.fix,
      raw: { n: r('n').mean, e: r('e').mean, z: r('z').mean }, feat: sampFeat(s), skyF: skyFeatures(skySnapshot()) });
  }
}
function sampFeat(s) {
  const b = s.buf, a = k => avg(b.map(x => x[k]).filter(v => v != null && isFinite(v)));
  return { waitS: (Date.now() - s.t0) / 1000, resets: s.resets || 0, fixedFrac: b.filter(x => x.fix === 'FIXED').length / b.length, sats: a('sats'), hdop: a('hdop'), sdRepH: a('sdH'), sdRepV: a('sdV'),
    ageDiff: a('age'), thMean: a('th'), thMax: b.some(x => x.th != null) ? Math.max(...b.map(x => x.th || 0)) : null };
}
$('#sCancel').onclick = () => endSampler(new Error('취소됨'));
const measure = () => sample(Math.max(1, +S.settings.avgSec || 5));
function buzz(ms) { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) {} }

// ───────────── 선형(구간) / 측점 ─────────────
// 선형 = 꼭짓점(이름,N,E,Z|null) 목록. kind: 'pipe'(관로: 관저고·터파기) / 'line'(일반: 계획고·절성토).
const seg = () => S.segs.find(s => s.id === S.curSeg) || S.segs[0];
const stas = sg => sg ? GL.makeAlignment(sg.pts, +sg.interval || 5, { startCh: +sg.startCh || 0, lat: +sg.lat || 0, drop: +sg.drop || 0, vertices: sg.verts !== false, round: !!sg.round }) : [];
const shotKey = (sg, st) => sg.id + ':' + Math.round(st.d * 1000);
const KIND = { pipe: { z: '관저고', dz: '굴착저면', cut: '터파기', fill: '성토' }, line: { z: '계획고', dz: '설계고', cut: '절토', fill: '성토' } };
const kindOf = sg => KIND[sg && sg.kind] || KIND.pipe;
function newSeg(name, kind) {
  const o = simOrigin(), pipe = kind !== 'line';
  return { id: uid(), name: name || (pipe ? '관로 ' : '선형 ') + (S.segs.length + 1), kind: pipe ? 'pipe' : 'line',
    pts: [{ name: pipe ? 'MH1' : '', n: o.n, e: o.e, z: pipe ? 10.000 : null }, { name: pipe ? 'MH2' : '', n: o.n + 30, e: o.e + 40, z: pipe ? 9.700 : null }],
    interval: 5, startCh: 0, lat: 0, drop: 0, verts: true, round: false };
}
function migrate() {                       // 구버전(2점 구간 a/b + offset + 인덱스 키 결과) → 다점 선형 + 누가거리 키
  S.segs.forEach(sg => {
    if (!sg.pts && sg.a && sg.b) {
      const old = GL.makeStations(sg.a, sg.b, +sg.interval || 5, +sg.offset || 0), keys = {};
      Object.keys(S.shots).forEach(k => { if (k.startsWith(sg.id + ':')) { const i = +k.split(':')[1]; if (old[i]) keys[k] = sg.id + ':' + Math.round(old[i].d * 1000); } });
      Object.entries(keys).forEach(([k, nk]) => { const v = S.shots[k]; delete S.shots[k]; S.shots[nk] = v; });
      sg.pts = [sg.a, sg.b]; sg.drop = +sg.offset || 0; delete sg.a; delete sg.b; delete sg.offset;
    }
    sg.kind = sg.kind || 'pipe'; sg.interval = sg.interval || 5; sg.startCh = sg.startCh || 0; sg.lat = sg.lat || 0; sg.drop = sg.drop || 0; if (sg.verts === undefined) sg.verts = true;
  });
}
S.areas = S.areas || []; S.pshots = S.pshots || {}; S.stakeMode = S.stakeMode || 'line'; S.ptTarget = S.ptTarget || null;
S.dxf = Object.assign({ name: '', hidden: {}, on: true, labels: true }, S.dxf);
if (!S.segs.length) { const g = newSeg('우수관 A-1 (데모)'); S.segs.push(g); S.curSeg = g.id; save(); }
migrate();
if (!S.curSeg || !S.segs.find(s => s.id === S.curSeg)) S.curSeg = S.segs[0].id;

// ───────────── 화면 전환 ─────────────
function go(t) {
  tab = t; $$('.tab').forEach(x => x.hidden = x.id !== 'tab-' + t); $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === t));
  if (t === 'stake') buildStake(); if (t === 'survey') { renderSurvey(); renderAreas(); } if (t === 'segs') renderSegs(); if (t === 'settings') renderSettings();
  if (t === 'map') { requestAnimationFrame(fitView); renderLayers(); dxfInfoUpdate(); }
  dirty = true; $('main').scrollTop = 0;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
let toastT; function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2600); }

// ───────────── 상단 상태 ─────────────
function updateTop() {
  const b = $('#fixBadge'), fix = L ? L.fix : 'NONE', st = Date.now() - (L ? L.t : 0);
  b.className = 'badge ' + (L ? fix.toLowerCase() : 'none'); b.textContent = L ? fix : 'NO FIX';
  $('#vSats').textContent = L && L.sats != null ? L.sats : '–';
  const tl = L && L.tilt, vt = $('#vTilt');
  vt.textContent = !S.settings.tilt.on ? 'OFF' : !tl ? '–' : tl.missing ? '?' : tl.theta.toFixed(1) + '°';
  vt.className = tl && !tl.missing ? (!tl.ok ? 'tbad' : tl.theta > tl.lim * 0.7 ? 'tw' : '') : (S.settings.tilt.on ? 'tbad' : '');
  if (tab === 'settings') updateTiltLive();
  $('#vAcc').textContent = L && L.sdH != null ? (L.sdH >= 1 ? L.sdH.toFixed(1) + 'm' : `${(L.sdH * 100).toFixed(1)}/${L.sdV != null ? (L.sdV * 100).toFixed(1) : '–'}`) : '–';   // 1 m 이상이면 미터로 짧게(칸 겹침 방지)
  $('#vSrc').textContent = { sim: '데모', geo: '폰 GPS', serial: '시리얼', ble: 'BLE', native: '내장 USB' }[S.settings.source];
  $('#vN').textContent = L ? f3(L.site.n) : '–'; $('#vE').textContent = L ? f3(L.site.e) : '–'; $('#vZ').textContent = L ? f3(L.site.z) : '–';
  let w = '';
  if (!L) w = '위치 수신 없음 — 설정에서 소스 확인'; else if (st > 3000) w = `수신 끊김 (${(st / 1000).toFixed(0)}초)`;
  else if (S.settings.reqFix && fix !== 'FIXED') w = `FIXED 아님(${fix}) — 측량 잠김`; else if (!isFinite(L.site.z)) w = '고도 정보 없음 — 높이 측량 불가';
  else if (L.tilt && L.tilt.missing) w = 'IMU: ' + L.tilt.why + ' — 측량 잠김';
  else if (L.tilt && !L.tilt.ok) w = '기울기 ' + L.tilt.theta.toFixed(1) + '° > 한계 ' + L.tilt.lim.toFixed(1) + '°' + (L.tilt.magOk ? '' : ' (자력 불량)') + ' — 측량 잠김';
  else if (L.tilt && !L.tilt.magOk) w = '자력 불량 — 방위 보정 꺼짐(높이만 보정), 폴을 수직으로';
  else if (S.settings.source === 'sim') w = '데모 모드 — 가상 위치입니다';
  $('#warn').hidden = !w; $('#warn').textContent = w;
}

// ───────────── 찾기(스테이크아웃): 선형·관로 / 점 ─────────────
const ptKey = t => t.id || ('x:' + t.n.toFixed(3) + ',' + t.e.toFixed(3));
const PTW = { cut: '높음', fill: '낮음' };
function ptTargets() { const list = S.points.map(p => ({ id: p.id, name: p.name, n: p.n, e: p.e, z: p.z })); const t = S.ptTarget; if (t && !t.id) list.unshift(t); return list; }
function curTarget() {
  if (S.stakeMode === 'pt') { const t = S.ptTarget; return t ? { mode: 'pt', name: t.name, n: t.n, e: t.e, z: (t.z != null && isFinite(t.z)) ? +t.z : null, az: 0, key: ptKey(t) } : null; }
  const sg = seg(), ss = stas(sg), st = ss[S.curSta];
  return st ? { mode: 'line', sg, ss, st, name: st.name, n: st.n, e: st.e, z: st.z, inv: st.inv, az: st.az, key: shotKey(sg, st) } : null;
}
function buildStake() {
  $$('#modeSw button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.stakeMode));
  $('#linePanel').hidden = S.stakeMode !== 'line'; $('#ptPanel').hidden = S.stakeMode !== 'pt';
  if (S.stakeMode === 'line') buildLinePanel(); else buildPtPanel();
  showShot(); $('#simPad').hidden = S.settings.source !== 'sim'; dirty = true;
}
function buildLinePanel() {
  const sel = $('#segSel'); sel.innerHTML = S.segs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join(''); sel.value = S.curSeg;
  const sg = seg(), ss = stas(sg); if (S.curSta >= ss.length) S.curSta = 0;
  if (!sg) return; const info = GL.alignInfo(sg.pts);
  $('#segInfo').innerHTML = `<span>연장 <b>${f3(info.len)}</b> m</span>` + (info.dz != null ? `<span>ΔZ <b>${fSign(info.dz)}</b> m</span><span>경사 <b>${fSign(info.grade, 2)}</b> %</span>` : '<span>높이 미입력</span>')
    + `<span>꼭짓점 <b>${info.count}</b></span><span>측점 <b>${ss.length}</b>개 / ${sg.interval} m</span>` + (sg.lat ? `<span>오프셋 <b>${sg.lat > 0 ? '우' : '좌'} ${Math.abs(sg.lat)}</b> m</span>` : '');
  $('#chips').innerHTML = ss.map(st => {
    const sh = S.shots[shotKey(sg, st)], cls = sh ? (sh.kind === 'NA' ? 'ok' : sh.kind.toLowerCase()) : '', sub = sh ? (sh.kind === 'OK' || sh.kind === 'NA' ? '✓' : fSign(sh.depth, 2)) : '';
    const lab = Number.isInteger(st.ch) ? st.ch : st.ch.toFixed(1);
    return `<button data-i="${st.i}" class="${cls} ${st.i === S.curSta ? 'cur' : ''}">${lab}m<span class="m">${sub || '&nbsp;'}</span></button>`;
  }).join('');
  const cur = $('#chips .cur'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
}
function buildPtPanel() {
  const list = ptTargets(), sel = $('#ptTgtSel');
  sel.innerHTML = list.length ? list.map((t, i) => `<option value="${i}">${esc(t.name)} · N ${f3(t.n)} E ${f3(t.e)}${t.z != null ? ' Z ' + f3(t.z) : ''}</option>`).join('') : '<option value="">저장된 점 없음 — 측량 탭 가져오기 / 도면 탭에서 선택</option>';
  const idx = S.ptTarget ? list.findIndex(t => ptKey(t) === ptKey(S.ptTarget)) : -1; sel.value = idx >= 0 ? String(idx) : '';
}
function showShot() {
  const t = curTarget(), el = $('#shotResult'), tol = +S.settings.tol || 0.03;
  const sh = t && (t.mode === 'pt' ? S.pshots[t.key] : S.shots[t.key]); if (!sh) { el.innerHTML = ''; return; }
  if (t.mode === 'pt') {
    el.innerHTML = `<div class="res ${sh.dist <= tol ? 'ok' : 'cut'}"><div>${esc(t.name)} · 실측 편차</div><div class="big1">${fLen(sh.dist)}</div>
      <div class="sub">ΔN(북) ${fSign(sh.dn)} · ΔE(동) ${fSign(sh.de)}${sh.dz != null ? ' · Δ높이 ' + fSign(sh.dz) : ''} · σ ${((sh.sdV || 0) * 100).toFixed(1)}cm · n=${sh.count}${sh.sim ? ' · SIM' : ''}</div>
      <div class="mk">${esc(sh.text)}</div></div>`; return;
  }
  const K = kindOf(t.sg), lab = sh.kind === 'CUT' ? K.cut : sh.kind === 'FILL' ? K.fill : sh.kind === 'NA' ? '표고' : '계획고';
  el.innerHTML = `<div class="res ${sh.kind === 'NA' ? 'ok' : sh.kind.toLowerCase()}"><div>${esc(t.name)} · ${lab}</div><div class="big1">${sh.kind === 'NA' ? f3(sh.gl) + ' m' : sh.kind === 'OK' ? '±0.000' : Math.abs(sh.depth).toFixed(3) + ' m'}</div>
    <div class="sub">${t.z != null ? K.dz + ' ' + f3(t.z) + ' · ' : ''}현황 GL ${f3(sh.gl)} · 측점편차 ${fLen(sh.off)}${sh.dAlong != null ? ` (종 ${fSign(sh.dAlong * 100, 1)} / 횡 ${fSign(sh.dCross * 100, 1)} cm)` : ''} · σ ${(sh.sdV * 100).toFixed(1)}cm · n=${sh.count}${sh.sim ? ' · SIM' : ''}</div>
    <div class="mk">${esc(sh.text)}</div></div>`;
}
$('#modeSw').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.stakeMode = b.dataset.mode; save(); buildStake(); };
$('#segSel').onchange = e => { S.curSeg = e.target.value; S.curSta = 0; save(); buildStake(); };
$('#ptTgtSel').onchange = e => { const t = ptTargets()[+e.target.value]; if (t) { S.ptTarget = t; save(); buildStake(); } };
$('#ptmSet').onclick = () => {
  const n = parseFloat($('#ptmN').value), e = parseFloat($('#ptmE').value), zv = $('#ptmZ').value;
  if (!isFinite(n) || !isFinite(e)) return toast('N, E 를 입력하세요');
  S.ptTarget = { name: $('#ptmName').value.trim() || '입력점', n, e, z: zv === '' ? null : +zv }; save(); buildStake(); toast('목표 설정');
};
$('#chips').onclick = e => { const b = e.target.closest('button'); if (b) { S.curSta = +b.dataset.i; save(); buildStake(); } };
function step(d) {
  if (S.stakeMode === 'pt') { const list = ptTargets(); if (!list.length) return; let i = S.ptTarget ? list.findIndex(t => ptKey(t) === ptKey(S.ptTarget)) : -1; i = Math.max(0, Math.min(list.length - 1, i + d)); S.ptTarget = list[i]; }
  else S.curSta = Math.max(0, Math.min(stas(seg()).length - 1, S.curSta + d));
  save(); buildStake();
}
$('#btnPrev').onclick = () => step(-1); $('#btnNext').onclick = () => step(1);

let inTol = false;
function updateStake() {
  const t = curTarget(), dash = () => ['gFwd', 'gRight', 'gDist', 'glLive', 'cutLive'].forEach(i => $('#' + i).textContent = '–');
  if (!t) { $('#tName').textContent = '목표 없음'; $('#tDes').textContent = S.stakeMode === 'pt' ? '점을 선택하세요' : '선형이 없습니다'; $('#glDes').textContent = '–'; dash(); drawBull(null); return; }
  const isPt = t.mode === 'pt', K = isPt ? null : kindOf(t.sg), g = L ? GL.guide(L.site, t, t.az) : null;
  $('#tName').textContent = t.name + (!isPt && t.sg.kind === 'pipe' && (t.st.vertex === 0 || t.st.vertex === t.sg.pts.length - 1) ? ' (맨홀)' : '');
  $('#tDes').textContent = isPt ? (t.z != null ? '설계고 ' + f3(t.z) : '높이 없음') + (g ? ' · 방위 ' + g.az.toFixed(1) + '°' : '')
    : (t.inv != null ? `${K.z} ${f3(t.inv)} · ${K.dz} ${f3(t.z)}` : `누가 ${t.st.ch.toFixed(2)} m`) + (t.sg.lat ? ` · ${t.sg.lat > 0 ? '우' : '좌'}${Math.abs(t.sg.lat)}m` : '');
  $('#glDesL').textContent = isPt ? '설계고' : K.dz + '(설계)'; $('#glDes').textContent = f3(t.z);
  $('#cutL').textContent = isPt ? '현재 − 설계' : '실시간 ' + K.cut + '/' + K.fill;
  if (!L) { dash(); drawBull(null); return; }
  const tol = +S.settings.tol || 0.03;
  $('#gFwdL').textContent = isPt ? (g.fwd >= 0 ? '▲ 북' : '▼ 남') : (g.fwd >= 0 ? '▲ 전진' : '▼ 후진'); $('#gRightL').textContent = isPt ? (g.right >= 0 ? '▶ 동' : '◀ 서') : (g.right >= 0 ? '▶ 우측' : '◀ 좌측');
  $('#gFwd').textContent = fLen(g.fwd); $('#gRight').textContent = fLen(g.right); $('#gDist').textContent = fLen(g.dist);
  const okp = g.dist <= tol; ['gFwd', 'gRight', 'gDist'].forEach(i => $('#' + i).className = okp ? 'ok' : 'go');
  if (okp && !inTol) buzz(60); inTol = okp;
  const gl = L.site.z, cb = $('#cutBox'); $('#glLive').textContent = f3(gl);
  if (t.z == null || !isFinite(gl)) { $('#cutLive').textContent = '–'; cb.className = 'cutbox'; }
  else { const cf = GL.cutFill(gl, t.z), w = isPt ? PTW : K; $('#cutLive').textContent = cf.kind === 'OK' ? '±0.000' : (cf.kind === 'CUT' ? w.cut : w.fill) + ' ' + Math.abs(cf.depth).toFixed(3); cb.className = 'cutbox ' + (Math.abs(cf.depth) <= 0.005 ? 'okk' : cf.kind.toLowerCase()); }
  drawBull({ g, t, tol, lineAz: t.az }); voiceGuide(g, t, tol);
}
function ctx2d(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); return { c, w, h };
}
const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
const fmtR = v => v < 1 ? (v * 100).toFixed(0) + 'cm' : v + 'm';
// 조준판: 선형 모드 = 위쪽이 선형 진행방향, 점 모드 = 위쪽이 북. 오른쪽은 진행방향 우측(점 모드: 동). 중심 = 목표.
function drawBull(d) {
  const { c, w, h } = ctx2d($('#bull')); c.clearRect(0, 0, w, h); if (!w) return;
  const cx = w / 2, cy = h / 2; c.font = '600 12px system-ui'; c.textBaseline = 'middle';
  if (!d) { c.fillStyle = '#5b6b64'; c.textAlign = 'center'; c.fillText('위치 수신 대기…', cx, cy); return; }
  const { g, t, tol } = d, isLine = t.mode === 'line', ox = -g.right, oy = -g.fwd;         // 현재 − 목표 (우측, 진행방향)
  const need = Math.max(Math.abs(ox), Math.abs(oy)) * 1.15, range = NICE.find(v => v >= need) || 1000, sc = (Math.min(w, h) / 2 - 22) / range;
  c.strokeStyle = '#d3dbd7'; c.fillStyle = '#5b6b64'; c.lineWidth = 1; c.textAlign = 'left';
  for (let k = 1; k <= 4; k++) { c.beginPath(); c.arc(cx, cy, range / 4 * k * sc, 0, 7); c.stroke(); c.fillText(fmtR(range / 4 * k), cx + 4, cy - range / 4 * k * sc + 8); }
  c.beginPath(); c.moveTo(cx, 4); c.lineTo(cx, h - 4); c.moveTo(4, cy); c.lineTo(w - 4, cy); c.stroke();
  if (isLine) {
    c.strokeStyle = '#2563eb'; c.lineWidth = 3; c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, h); c.stroke(); c.lineWidth = 1;   // 선형 중심선
    let lastLbl = -99;
    t.ss.forEach(s => { const y = cy - (s.d - t.st.d) * sc; if (s.i === t.st.i || y < 8 || y > h - 8) return;
      c.strokeStyle = '#2563eb'; c.beginPath(); c.moveTo(cx - 9, y); c.lineTo(cx + 9, y); c.stroke();
      if (Math.abs(y - lastLbl) >= 15) { c.fillStyle = '#2563eb'; c.fillText(s.name.replace('STA', ''), cx + 12, y); lastLbl = y; } });
  }
  c.strokeStyle = '#16a34a'; c.fillStyle = '#16a34a22'; c.lineWidth = 2; const rt = Math.max(tol * sc, 7);
  c.beginPath(); c.arc(cx, cy, rt, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(cx - rt - 6, cy); c.lineTo(cx + rt + 6, cy); c.moveTo(cx, cy - rt - 6); c.lineTo(cx, cy + rt + 6); c.stroke();
  const px = cx + ox * sc, py = cy - oy * sc, col = L.fix === 'FIXED' ? '#15803d' : L.fix === 'FLOAT' ? '#d97706' : '#b91c1c';
  if (L.sdH) { c.fillStyle = col + '22'; c.beginPath(); c.arc(px, py, Math.max(L.sdH * sc, 3), 0, 7); c.fill(); }
  c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(px, py); c.lineTo(cx, cy); c.stroke(); c.setLineDash([]);
  c.fillStyle = col; c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(px, py, 8, 0, 7); c.fill(); c.stroke();
  const endName = isLine ? (t.sg.pts[t.sg.pts.length - 1].name || '종점') : '';
  c.fillStyle = '#0d1b16'; c.textAlign = 'center'; c.fillText(isLine ? '▲ ' + endName + ' 방향' : '▲ 북', cx, 12);
  c.textAlign = 'right'; c.fillText('격자 ' + fmtR(range / 4), w - 6, h - 10);
  const tl = L.tilt;                                                    // 수준기(버블): 바깥 원 = 허용 기울기, 점 = 안테나가 기울어진 방향
  if (tl && !tl.missing) { const bx = 34, by = h - 34, R = 24, rel = (tl.az - d.lineAz) * Math.PI / 180, k = Math.min(tl.theta / tl.lim, 1.3) * R;
    c.fillStyle = '#fffd'; c.beginPath(); c.arc(bx, by, R + 4, 0, 7); c.fill(); c.strokeStyle = tl.ok ? '#16a34a' : '#b91c1c'; c.lineWidth = 2; c.beginPath(); c.arc(bx, by, R, 0, 7); c.stroke();
    c.lineWidth = 1; c.beginPath(); c.moveTo(bx - R, by); c.lineTo(bx + R, by); c.moveTo(bx, by - R); c.lineTo(bx, by + R); c.stroke();
    c.fillStyle = tl.ok ? '#16a34a' : '#b91c1c'; c.beginPath(); c.arc(bx + Math.sin(rel) * k, by - Math.cos(rel) * k, 5, 0, 7); c.fill(); }
}

$('#btnShot').onclick = async () => {
  const t = curTarget(); if (!t) return toast('목표가 없습니다');
  try {
    if (!L) throw new Error('위치 수신 없음');
    const tol = +S.settings.tol || 0.03, g0 = GL.guide(L.site, t, t.az);
    if (g0.dist > Math.max(tol * 3, 0.15) && !confirm(`목표에서 ${fLen(g0.dist)} 떨어져 있습니다. 그래도 확정할까요?`)) return;
    const r = await measure(), g1 = GL.guide({ n: r.n, e: r.e }, t, t.az), off = g1.dist, ts = new Date().toISOString(), sim = S.settings.source === 'sim';
    if (t.mode === 'pt') {
      const dz = t.z != null ? r.z - t.z : null;
      S.pshots[t.key] = { name: t.name, tn: t.n, te: t.e, tz: t.z, n: r.n, e: r.e, z: r.z, dn: r.n - t.n, de: r.e - t.e, dist: off, dz, sdH: r.sdH, sdV: r.sdV, count: r.count, fix: r.fix, ts, sim,
        text: `${t.name} 설계 N ${f3(t.n)} E ${f3(t.e)}${t.z != null ? ' Z ' + f3(t.z) : ''} → 편차 북 ${fSign(r.n - t.n)} 동 ${fSign(r.e - t.e)} (${fLen(off)})${dz != null ? ' 높이 ' + fSign(dz) : ''}` };
    } else {
      const cf = t.z != null ? GL.cutFill(r.z, t.z) : null, K = kindOf(t.sg);
      S.shots[t.key] = { gl: r.z, depth: cf ? cf.depth : null, kind: cf ? cf.kind : 'NA', off, dAlong: -g1.fwd, dCross: -g1.right, n: r.n, e: r.e, sdH: r.sdH, sdV: r.sdV, count: r.count, fix: r.fix, ts,
        text: cf ? GL.markText(t.st, r.z, t.z, K) : `${t.name} 표고 ${f3(r.z)} (설계고 없음)`, sim };
    }
    logShot(t.mode === 'pt' ? 'find' : 'stake', r, Object.assign({ target: t.name, off }, t.mode === 'pt' ? { dn: r.n - t.n, de: r.e - t.e } : { dAlong: -g1.fwd, dCross: -g1.right }));
    save(); buildStake(); buzz([40, 40, 40]);
    if (off > tol) toast(`주의: 목표에서 ${fLen(off)} 벗어난 위치에서 측정됨`);
  } catch (e) { toast(e.message); }
};
$('#simGoto').onclick = () => {
  const t = curTarget(); if (!t) return toast('목표가 없습니다'); const az = t.az * Math.PI / 180;
  SIM.n = t.n - 0.8 * Math.cos(az) - 0.5 * Math.sin(az); SIM.e = t.e - 0.8 * Math.sin(az) + 0.5 * Math.cos(az); simTick();
};
$('#simPad').addEventListener('click', e => {
  const m = e.target.closest('[data-mv]'), f = e.target.closest('[data-fx]');
  if (m) { const [dn, de] = m.dataset.mv.split(',').map(Number); SIM.n += dn; SIM.e += de; simTick(); }
  const tt = e.target.closest('[data-tt]'), ta = e.target.closest('[data-taz]');
  if (tt) { SIM.tilt = +tt.dataset.tt; $$('#simTilt [data-tt]').forEach(b => b.classList.toggle('on', b === tt)); simTick(); }
  if (ta) { SIM.taz = +ta.dataset.taz; $$('#simTilt [data-taz]').forEach(b => b.classList.toggle('on', b === ta)); simTick(); }
  if (e.target.id === 'simMag') { SIM.magOk = !SIM.magOk; e.target.textContent = SIM.magOk ? '자력 양호' : '자력 불량'; simTick(); }
  if (f) { SIM.fix = f.dataset.fx; $$('#simFix button').forEach(b => b.classList.toggle('on', b === f)); simTick(); }
});

// ───────────── 측량 ─────────────
let AB = [];
$('#btnPt').onclick = async () => {
  try {
    const r = await measure(), name = $('#ptName').value.trim() || 'P' + S.seq++;
    S.points.push({ id: uid(), name, code: $('#ptCode').value.trim(), n: r.n, e: r.e, z: r.z, sdH: r.sdH, sdV: r.sdV, fix: r.fix, src: S.settings.source, ts: new Date().toISOString() });
    logShot('point', r, { target: name }); $('#ptName').value = ''; save(); renderSurvey(); buzz([40, 40, 40]); toast(`${name} 저장 (σH ${(r.sdH * 100).toFixed(1)}cm)`);
  } catch (e) { toast(e.message); }
};
function renderSurvey() {
  $('#ptCount').textContent = `(${S.points.length})`;
  $('#ptList').innerHTML = S.points.map(p => `<div class="it ${AB[0] === p.id ? 'A' : AB[1] === p.id ? 'B' : ''}" data-id="${p.id}">
    <div class="nm"><b>${AB[0] === p.id ? '[A] ' : AB[1] === p.id ? '[B] ' : ''}${esc(p.name)}${p.src === 'sim' ? '<span class="tag sim">SIM</span>' : ''}${p.code ? '<span class="tag">' + esc(p.code) + '</span>' : ''}</b>
    <span>N ${f3(p.n)} · E ${f3(p.e)} · Z ${f3(p.z)}${p.sdH != null ? ' · σ' + (p.sdH * 100).toFixed(1) + 'cm' : ''}</span></div>
    <button class="ghost sm" data-find="${p.id}">찾기</button><button class="ghost sm" data-area="${p.id}">면적+</button><button class="ghost sm" data-del="${p.id}" aria-label="삭제">✕</button></div>`).join('') || '<p class="hint">측량한 점이 없습니다. 위 버튼으로 현재 위치를 측량하세요.</p>';
  const A = S.points.find(p => p.id === AB[0]), B = S.points.find(p => p.id === AB[1]), m = $('#measure');
  m.hidden = !A;
  if (A && !B) m.innerHTML = '<b>A: ' + esc(A.name) + '</b> — 비교할 B점을 목록에서 탭하세요';
  if (A && B) { const i = GL.pairInfo(A, B); m.innerHTML = `<b>${esc(A.name)} → ${esc(B.name)}</b><div class="grid">
    <div><small>수평거리</small><b>${f3(i.h)} m</b></div><div><small>높이차 ΔZ</small><b>${fSign(i.dz)} m</b></div>
    <div><small>경사거리</small><b>${f3(i.slope3d)} m</b></div><div><small>경사</small><b>${fSign(i.grade, 2)} %</b></div>
    <div><small>ΔN / ΔE</small><b>${fSign(i.dn, 2)} / ${fSign(i.de, 2)}</b></div><div><small>방위각</small><b>${i.az.toFixed(3)}°</b></div></div>`; }
}
$('#ptList').onclick = e => {
  const fd = e.target.closest('[data-find]'), ar = e.target.closest('[data-area]');
  if (fd) { const p = S.points.find(x => x.id === fd.dataset.find); if (p) { S.ptTarget = { id: p.id, name: p.name, n: p.n, e: p.e, z: p.z }; S.stakeMode = 'pt'; save(); go('stake'); } return; }
  if (ar) { const p = S.points.find(x => x.id === ar.dataset.area); if (p) { addAreaPt(p); toast(p.name + ' → 면적 꼭짓점'); } return; }
  const d = e.target.closest('[data-del]');
  if (d) { if (confirm('이 점을 삭제할까요?')) { S.points = S.points.filter(p => p.id !== d.dataset.del); AB = AB.filter(x => x !== d.dataset.del); save(); renderSurvey(); } return; }
  const it = e.target.closest('.it'); if (!it) return; const id = it.dataset.id;
  if (AB.includes(id)) AB = AB.filter(x => x !== id); else AB = AB.length >= 2 ? [id] : [...AB, id];
  renderSurvey();
};
$('#btnPtClear').onclick = () => { if (S.points.length && confirm('측량점 ' + S.points.length + '개를 모두 삭제할까요?')) { S.points = []; AB = []; save(); renderSurvey(); } };
$('#btnImport').onclick = () => {
  let n = 0;
  $('#importTxt').value.split(/\r?\n/).forEach(l => { const a = l.trim().split(/\s*[,\t;]\s*|\s{2,}/); if (a.length < 3) return; const nn = +a[1], ee = +a[2], zz = (a[3] === undefined || a[3] === '') ? null : +a[3];    // 높이 비움 = 높이 없음(null)
    if (![nn, ee].every(isFinite) || (zz !== null && !isFinite(zz)) || !a[0]) return; S.points.push({ id: uid(), name: a[0], code: 'IMP', n: nn, e: ee, z: zz, src: 'import', ts: new Date().toISOString() }); n++; });
  save(); renderSurvey(); toast(n + '개 가져옴'); if (n) $('#importTxt').value = '';
};

// ───────────── 면적 · 둘레 · 연장 ─────────────
const areaCur = () => S.areas.find(a => a.id === S.areaCur) || null;
function newArea(name) { const a = { id: uid(), name: name || '면적 ' + (S.areas.length + 1), pts: [], closed: true }; S.areas.push(a); S.areaCur = a.id; save(); return a; }
function addAreaPt(p, name) {
  const a = areaCur() || newArea(); a.pts.push({ name: name || p.name || 'V' + (a.pts.length + 1), n: p.n, e: p.e, z: p.z != null && isFinite(p.z) ? p.z : null }); save(); renderAreas();
}
function areaStats(a) { const r = GL.polyStats(a.pts, a.closed); return Object.assign(r, { ha: r.area / 10000, pyeong: r.area / 3.305785 }); }
function renderAreas() {
  const sel = $('#areaSel'); sel.innerHTML = S.areas.map(a => `<option value="${a.id}">${esc(a.name)} (${a.pts.length})</option>`).join('') || '<option value="">면적 없음 — “＋ 새로”</option>';
  if (S.areaCur && areaCur()) sel.value = S.areaCur;
  $('#areaPick').innerHTML = '<option value="">저장점에서 꼭짓점 추가…</option>' + S.points.map(p => `<option value="${p.id}">${esc(p.name)} (${f3(p.n)}, ${f3(p.e)})</option>`).join('');
  const a = areaCur(), box = $('#areaRes'), lst = $('#areaPts');
  if (!a) { box.innerHTML = ''; lst.innerHTML = ''; $('#areaName').value = ''; return; }
  $('#areaName').value = a.name; $('#areaToggle').textContent = a.closed ? '닫힘(면적)' : '열림(연장)';
  const r = areaStats(a);
  box.innerHTML = a.closed ? (a.pts.length >= 3 ? `<div class="grid"><div><small>면적</small><b>${r.area.toFixed(2)} ㎡</b></div><div><small>ha / 평</small><b>${r.ha.toFixed(4)} / ${r.pyeong.toFixed(1)}</b></div>
      <div><small>둘레</small><b>${r.perimeter.toFixed(3)} m</b></div><div><small>중심 N/E</small><b>${r.centroid.n.toFixed(1)} / ${r.centroid.e.toFixed(1)}</b></div></div>` : '<p class="hint">꼭짓점 3개 이상 필요</p>')
    : `<div class="grid"><div><small>연장</small><b>${r.length.toFixed(3)} m</b></div><div><small>꼭짓점</small><b>${r.count}</b></div></div>`;
  lst.innerHTML = a.pts.map((p, i) => `<div class="it"><div class="nm"><b>${i + 1}. ${esc(p.name)}</b><span>N ${f3(p.n)} · E ${f3(p.e)}${p.z != null ? ' · Z ' + f3(p.z) : ''}</span></div><button class="ghost sm" data-adel="${i}" aria-label="삭제">✕</button></div>`).join('');
}
$('#areaSel').onchange = e => { S.areaCur = e.target.value; save(); renderAreas(); };
$('#areaNew').onclick = () => { newArea(); renderAreas(); };
$('#areaDel').onclick = () => { const a = areaCur(); if (a && confirm(`"${a.name}" 삭제?`)) { S.areas = S.areas.filter(x => x !== a); S.areaCur = S.areas.length ? S.areas[0].id : null; save(); renderAreas(); } };
$('#areaName').onchange = e => { const a = areaCur(); if (a) { a.name = e.target.value.trim() || a.name; save(); renderAreas(); } };
$('#areaToggle').onclick = () => { const a = areaCur(); if (a) { a.closed = !a.closed; save(); renderAreas(); } };
$('#areaUndo').onclick = () => { const a = areaCur(); if (a && a.pts.length) { a.pts.pop(); save(); renderAreas(); } };
$('#areaPick').onchange = e => { const p = S.points.find(x => x.id === e.target.value); if (p) addAreaPt(p); e.target.value = ''; };
$('#areaMeasure').onclick = async () => { try { const r = await measure(); logShot('area', r); addAreaPt({ n: r.n, e: r.e, z: r.z }); buzz([40, 40, 40]); } catch (e) { toast(e.message); } };
$('#areaPts').onclick = e => { const b = e.target.closest('[data-adel]'), a = areaCur(); if (b && a) { a.pts.splice(+b.dataset.adel, 1); save(); renderAreas(); } };

// ───────────── 선형 편집 ─────────────
const num = v => v === '' ? 0 : +v;
function renderSegs() {
  const opts = '<option value="">점 목록에서 꼭짓점 추가…</option>' + S.points.map(p => `<option value="${p.id}">${esc(p.name)} (${f3(p.n)}, ${f3(p.e)}${p.z != null ? ', ' + f3(p.z) : ''})</option>`).join('');
  $('#segList').innerHTML = S.segs.map(sg => {
    const info = GL.alignInfo(sg.pts), K = kindOf(sg), ss = stas(sg), id = sg.id;
    const rows = sg.pts.map((p, i) => `<div class="vrow"><div class="vh"><span class="vi">${i + 1}</span><input data-s="${id}" data-v="${i}" data-f="name" value="${esc(p.name)}" placeholder="이름" aria-label="이름">
        <button class="ghost sm" data-s="${id}" data-vhere="${i}" aria-label="현위치 N/E">📍</button><button class="ghost sm danger" data-s="${id}" data-vdel="${i}" aria-label="삭제">✕</button></div>
      <div class="v3"><input type="number" step="0.001" inputmode="decimal" data-s="${id}" data-v="${i}" data-f="n" value="${p.n}" placeholder="N" aria-label="N">
        <input type="number" step="0.001" inputmode="decimal" data-s="${id}" data-v="${i}" data-f="e" value="${p.e}" placeholder="E" aria-label="E">
        <input type="number" step="0.001" inputmode="decimal" data-s="${id}" data-v="${i}" data-f="z" value="${p.z == null ? '' : p.z}" placeholder="${K.z}" aria-label="${K.z}"></div></div>`).join('');
    return `<div class="seg ${id === S.curSeg ? 'cur' : ''}"><div class="form2"><label>이름<input data-s="${id}" data-f="name" value="${esc(sg.name)}"></label>
      <label>종류<select data-s="${id}" data-f="kind"><option value="pipe"${sg.kind === 'pipe' ? ' selected' : ''}>관로 (관저고)</option><option value="line"${sg.kind === 'line' ? ' selected' : ''}>일반 선형 (계획고)</option></select></label></div>
      <div class="hint">연장 <b>${f3(info.len)}</b> m · ${info.dz != null ? 'ΔZ <b>' + fSign(info.dz) + '</b> · 경사 <b>' + fSign(info.grade, 2) + '%</b> · ' : '높이 미입력 · '}꼭짓점 ${info.count} · 측점 ${ss.length}</div>
      <h4>꼭짓점 (시점 → 종점 순서, ${K.z}는 비워도 됨)</h4>${rows}
      <div class="row gap" style="margin-top:6px"><select data-s="${id}" data-addpt="1">${opts}</select><button class="ghost sm" data-s="${id}" data-vadd="1">＋ 추가</button><button class="ghost sm" data-s="${id}" data-vrev="1">↕ 역방향</button></div>
      <div class="form2" style="margin-top:8px"><label>측점 간격 (m)<input type="number" step="0.5" min="0.5" inputmode="decimal" data-s="${id}" data-f="interval" value="${sg.interval}"></label>
        <label>시작 누가거리 (m)<input type="number" step="0.001" inputmode="decimal" data-s="${id}" data-f="startCh" value="${sg.startCh}"></label>
        <label>좌(−)/우(+) 오프셋 (m)<input type="number" step="0.01" inputmode="decimal" data-s="${id}" data-f="lat" value="${sg.lat}"></label>
        <label>${K.dz} = ${K.z} − (m)<input type="number" step="0.01" inputmode="decimal" data-s="${id}" data-f="drop" value="${sg.drop}"></label></div>
      <label class="chk2"><input type="checkbox" data-s="${id}" data-f="verts"${sg.verts !== false ? ' checked' : ''}> 꼭짓점도 측점으로</label>
      <label class="chk2"><input type="checkbox" data-s="${id}" data-f="round"${sg.round ? ' checked' : ''}> 누가거리를 간격의 배수로 정렬</label>
      <div class="row gap" style="margin-top:8px"><button data-use="${id}" class="primary">이 선형으로 찾기</button><button data-delseg="${id}" class="ghost danger">삭제</button></div></div>`;
  }).join('');
}
$('#segAdd').onclick = () => { const g = newSeg('', 'pipe'); S.segs.push(g); S.curSeg = g.id; S.curSta = 0; save(); renderSegs(); };
$('#segAddLine').onclick = () => { const g = newSeg('', 'line'); S.segs.push(g); S.curSeg = g.id; S.curSta = 0; save(); renderSegs(); };
$('#segPasteGo').onclick = () => {
  const pts = []; $('#segPaste').value.split(/\r?\n/).forEach(l => { const a = l.split(/\s*[,\t;]\s*/); if (a.length < 3) return; const n = +a[1], e = +a[2], z = (a[3] === undefined || a[3].trim() === '') ? null : +a[3];
    if (!isFinite(n) || !isFinite(e) || (z !== null && !isFinite(z))) return; pts.push({ name: (a[0] || '').trim(), n, e, z }); });
  if (pts.length < 2) return toast('2개 이상의 좌표가 필요합니다');
  const sg = newSeg('', $('#segPasteKind').value); sg.pts = pts; S.segs.push(sg); S.curSeg = sg.id; S.curSta = 0; save(); renderSegs(); toast(`꼭짓점 ${pts.length}개로 생성`); $('#segPaste').value = '';
};
$('#segList').addEventListener('change', e => {
  const t = e.target, sg = S.segs.find(x => x.id === t.dataset.s); if (!sg) return;
  if (t.dataset.addpt) { const p = S.points.find(x => x.id === t.value); if (p) sg.pts.push({ name: p.name, n: p.n, e: p.e, z: p.z != null && isFinite(p.z) ? p.z : null }); }
  else if (t.dataset.v !== undefined) { const p = sg.pts[+t.dataset.v], f = t.dataset.f; p[f] = f === 'name' ? t.value : (f === 'z' && t.value === '' ? null : num(t.value)); }
  else if (t.dataset.f) { const f = t.dataset.f; if (f === 'name' || f === 'kind') sg[f] = t.value; else if (t.type === 'checkbox') sg[f] = t.checked; else sg[f] = num(t.value); }
  save(); renderSegs(); dirty = true;
});
$('#segList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const sg = S.segs.find(x => x.id === b.dataset.s);
  if (b.dataset.use) { S.curSeg = b.dataset.use; S.curSta = 0; S.stakeMode = 'line'; save(); go('stake'); }
  if (b.dataset.delseg) { if (S.segs.length > 1 && confirm('이 선형을 삭제할까요?')) { S.segs = S.segs.filter(x => x.id !== b.dataset.delseg); Object.keys(S.shots).forEach(k => k.startsWith(b.dataset.delseg + ':') && delete S.shots[k]); if (S.curSeg === b.dataset.delseg) S.curSeg = S.segs[0].id; save(); renderSegs(); } else if (S.segs.length <= 1) toast('마지막 선형은 삭제할 수 없습니다'); }
  if (!sg) return;
  if (b.dataset.vdel !== undefined) { if (sg.pts.length > 2) { sg.pts.splice(+b.dataset.vdel, 1); save(); renderSegs(); dirty = true; } else toast('꼭짓점은 최소 2개'); }
  if (b.dataset.vhere !== undefined) { if (!L) return toast('위치 수신 없음'); const p = sg.pts[+b.dataset.vhere]; p.n = +L.site.n.toFixed(3); p.e = +L.site.e.toFixed(3); save(); renderSegs(); dirty = true; toast('현재 N/E 입력됨 (높이는 직접 입력)'); }
  if (b.dataset.vadd) { const l = sg.pts[sg.pts.length - 1]; sg.pts.push(L ? { name: '', n: +L.site.n.toFixed(3), e: +L.site.e.toFixed(3), z: null } : { name: '', n: l.n + 10, e: l.e, z: null }); save(); renderSegs(); dirty = true; }
  if (b.dataset.vrev) { sg.pts.reverse(); save(); renderSegs(); dirty = true; }
});

// ───────────── 설정 / 보정 ─────────────
function renderSettings() {
  const s = S.settings;
  $('#crs').innerHTML = Object.entries(GL.CRS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join(''); $('#crs').value = s.crs;
  $('#antH').value = s.antH; $('#avgSec').value = s.avgSec; $('#tol').value = s.tol; $('#reqFix').checked = s.reqFix; $('#baud').value = s.baud;
  $$('#srcSel button').forEach(b => b.classList.toggle('on', b.dataset.src === s.source));
  $('#serialBox').hidden = s.source !== 'serial'; $('#bleBox').hidden = s.source !== 'ble'; $('#nativeBox').hidden = s.source !== 'native';
  $$('#srcSel button').forEach(b => { const d = b.dataset.src; b.hidden = d === 'native' ? !NATIVE : (NATIVE && (d === 'serial' || d === 'ble')); });   // 앱에서는 내장 USB 를 쓰고 Web Serial/BLE 는 숨김
  Object.entries(CFG_FIELDS).forEach(([k, id]) => { $('#' + id).value = S.bridge[k]; });
  const T = s.tilt; $('#tiltOn').checked = T.on; $('#tiltDecl').value = T.decl; $('#tiltMax').value = T.max; $('#tiltFrame').value = T.frame; $('#tiltSrc').value = T.imuSrc; updateTiltLive(); $('#srcHelp').textContent = SRC_HELP[s.source];
  if (s.source === 'sim') srcStatus('데모 실행 중');
  const known = knownPoints(); $('#calKnown').innerHTML = known.map((k, i) => `<option value="${i}">${esc(k.label)}</option>`).join('');
  $('#calInfo').innerHTML = CAL ? `보정 ${S.calib.pairs.length}쌍 · 이동 dN ${fSign(CAL.tn - CAL.cn, 3)} dE ${fSign(CAL.te - CAL.ce, 3)} · dZ ${fSign(CAL.dz, 3)} · 회전 ${(CAL.rot * 206264.806).toFixed(1)}″ · RMS ${(CAL.rms * 100).toFixed(1)} cm` : '보정 없음';
  $('#verLbl').textContent = 'GNSS-Lite v' + VER + ' · 데이터는 이 기기 브라우저에만 저장됩니다.'; renderLog(); renderLlm(); renderTts();
}
function updateTiltLive() {
  const T = S.settings.tilt, el = $('#tiltLive'); if (!el) return;
  if (!IMU) { el.textContent = 'IMU 수신 없음 · 폴 축 ' + (T.axis ? '저장됨' : '미설정'); return; }
  const ti = T.axis ? GL.tiltInfo(imuQ(), T.axis, T.decl, T.yawOff) : null;
  el.textContent = 'IMU(' + ({ phone: '폰 센서', ext: '외부', sim: '데모' }[IMU.src] || IMU.src) + ') 수신 중 · 자력 ' + IMU.mag + '/3 · 방위정확도 ' + (IMU.accDeg == null ? 'n/a' : IMU.accDeg + '°') + ' · 폴 축 ' + (T.axis ? '저장됨' : '미설정') + ' · 방위오프셋 ' + T.yawOff.toFixed(1) + '°' + (ti ? ' · 현재 기울기 ' + ti.theta.toFixed(2) + '° 방위 ' + ti.az.toFixed(0) + '°' : '');
}
async function levelCal() {
  if (!IMU) return toast('IMU 수신 없음'); const qs = []; toast('폴을 수직으로 유지… 3초');
  imuTap = () => qs.push(imuQ().slice());
  await new Promise(res => setTimeout(res, 3000)); imuTap = null;
  if (qs.length < 5) return toast('IMU 데이터 부족');
  const axis = GL.poleAxisFromLevel(qs), spread = Math.max(...qs.map(q => GL.tiltInfo(q, axis, 0, 0).theta));
  if (spread > 0.6) return toast('폴이 흔들렸습니다 (' + spread.toFixed(2) + '°) — 다시 시도');
  S.settings.tilt.axis = axis; save(); renderSettings(); toast('폴 축 저장 (샘플 ' + qs.length + ', 흔들림 ' + spread.toFixed(2) + '°)');
}
function yawCal() {
  const T = S.settings.tilt; if (!IMU || !T.axis) return toast('먼저 수평 캘리브레이션'); const ti = GL.tiltInfo(imuQ(), T.axis, T.decl, 0);
  if (ti.theta < 2) return toast('폴을 2° 이상 기울여야 합니다'); const sg = seg(), az = GL.alignInfo(sg.pts).az;
  T.yawOff = GL.yawOffsetFrom(az, ti.az); save(); renderSettings(); toast('방위 오프셋 ' + T.yawOff.toFixed(1) + '° 저장 (기준: ' + sg.name + ' 방위 ' + az.toFixed(1) + '°)');
}
// 폰 내장 센서(가속도+자이로+자력계 융합, 안드로이드 Chrome): 절대 방위 자세. 폰은 폴에 견고히 고정해야 한다.
let lastPhoneMs = 0;
function onDevOri(e) {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const now = Date.now(); if (now - lastPhoneMs < 50) return; lastPhoneMs = now;          // 20Hz 로 솎기
  setImu(GL.qFromDeviceOrientation(e.alpha, e.beta, e.gamma), e.absolute === false ? 1 : 2, null, 'phone', true);   // 자력 신뢰도는 알 수 없어 2(보통) 가정, 상대 방위면 1(불량)
}
window.addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', onDevOri);
$('#tiltSrc').onchange = e => { S.settings.tilt.imuSrc = e.target.value; S.settings.tilt.axis = null; IMU = null; save(); renderSettings(); toast('IMU 소스 변경 — 수평 캘리브레이션을 다시 하세요'); };
$('#tiltLevel').onclick = levelCal; $('#tiltYaw').onclick = yawCal;
$('#tiltOn').onchange = e => { S.settings.tilt.on = e.target.checked; save(); dirty = true; };
$('#tiltDecl').onchange = e => { S.settings.tilt.decl = +e.target.value; save(); dirty = true; };
$('#tiltFrame').onchange = e => { S.settings.tilt.frame = e.target.value; S.settings.tilt.axis = null; save(); renderSettings(); toast('프레임 변경 — 수평 캘리브레이션을 다시 하세요'); };
$('#tiltMax').onchange = e => { S.settings.tilt.max = Math.max(0.5, +e.target.value); save(); dirty = true; };
Object.entries(CFG_FIELDS).forEach(([k, id]) => $('#' + id).addEventListener('change', e => { S.bridge[k] = k === 'port' ? +e.target.value : e.target.value.trim(); save(); }));
$('#btnBle').onclick = () => (bleDev && bleDev.gatt.connected) ? bleDev.gatt.disconnect() : bleConnect();
$('#btnCfgSend').onclick = sendBridgeCfg;
function knownPoints() {
  const k = []; S.segs.forEach(g => g.pts.forEach((p, i) => k.push({ label: `${g.name} · ${p.name || '꼭짓점' + (i + 1)} (수평만)`, n: p.n, e: p.e, z: null })));
  S.points.forEach(p => k.push({ label: `${p.name} (N/E/Z)`, n: p.n, e: p.e, z: p.z })); return k;
}
$('#srcSel').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.source = b.dataset.src; save(); startSource(); };
['crs', 'antH', 'avgSec', 'tol', 'reqFix', 'baud'].forEach(id => $('#' + id).addEventListener('change', e => {
  const t = e.target; S.settings[id] = t.type === 'checkbox' ? t.checked : (id === 'crs' ? t.value : +t.value); save();
  if (id === 'crs') { SIM.o = simOrigin(); SIM.n = SIM.o.n - 3; SIM.e = SIM.o.e - 4; } dirty = true; }));
$('#btnSerial').onclick = () => port ? serialDisconnect() : serialConnect();
$('#btnUm982').onclick = um982Cfg;
$('#ntSave').onclick = () => {
  if (!NATIVE) return;
  const h = $('#ntHost').value.trim(), p = +$('#ntPort').value || 2101, m = $('#ntMount').value.trim(), u = $('#ntUser').value.trim(), pw = $('#ntPw').value;
  if (!h || !m || !u) { toast('서버·마운트포인트·아이디를 입력하세요'); return; }
  if (/[\r\n]/.test(h + m + u + pw)) { toast('줄바꿈이 들어간 값이 있습니다'); return; }
  try {
    NATIVE.ntripSave(h, p, m, u, pw);   // 비밀번호를 비워 두면 이전에 저장한 값을 유지한다
    const c = JSON.parse(NATIVE.ntripLoad() || '{}');
    if (!c.hasPass) { toast('비밀번호를 입력하세요'); return; }
    $('#ntPw').value = ''; $('#ntPw').placeholder = '(저장됨 — 바꿀 때만 입력)';
    NATIVE.ntripStartSaved(); toast('저장하고 보정을 시작합니다');
  } catch (e) { toast('저장 실패: ' + e.message); }
};
$('#ntStop').onclick = () => { if (NATIVE) { try { NATIVE.ntripStop(); } catch (e) {} } };
$('#calAdd').onclick = async () => {
  const k = knownPoints()[+$('#calKnown').value]; if (!k) return toast('기지점이 없습니다');
  try {
    const r = await measure(), zin = $('#calZ').value, kz = zin !== '' ? +zin : k.z;
    logShot('calib', r, { known: k.label });
    S.calib.pairs.push({ m: r.raw, k: { n: k.n, e: k.e, z: kz == null ? null : kz }, name: k.label });
    CAL = GL.solveCalibration(S.calib.pairs); save(); renderSettings(); buzz([40, 40, 40]); toast('보정 적용 (' + S.calib.pairs.length + '쌍)');
  } catch (e) { toast(e.message); }
};
$('#calReset').onclick = () => { S.calib.pairs = []; CAL = null; save(); renderSettings(); toast('보정 초기화'); };
// 백업 파일에는 비밀값(NTRIP·Wi-Fi 비밀번호, AI 키)을 넣지 않는다
$('#dBackup').onclick = () => download('gnsslite-backup-' + stamp() + '.json', JSON.stringify(S, (k, v) => (k === 'pw' || k === 'wpw' || (k === 'key' && typeof v === 'string')) ? undefined : v, 1), 'application/json');
$('#dRestore').onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const j = JSON.parse(t); if (j.v !== 1) throw new Error('형식 오류'); S = Object.assign(defState(), j); save(); location.reload(); }).catch(er => toast('복원 실패: ' + er.message)); };
$('#dReset').onclick = () => { if (confirm('모든 점·구간·측정 결과를 삭제합니다. 계속할까요?')) { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); } };

// ───────────── 도면 (DXF 배경 · 선택 · 선형/점/면적) ─────────────
let DXFD = null, PICK = null, PIPE = { a: null, b: null };
const idb = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('gnsslite', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); },
};
const V = { cn: 0, ce: 0, s: 10, follow: false };
function extents() {
  const pts = []; S.segs.forEach(g => g.pts.forEach(p => pts.push(p))); S.points.forEach(p => pts.push(p)); S.areas.forEach(a => a.pts.forEach(p => pts.push(p)));
  Object.values(S.shots).forEach(s => pts.push(s)); Object.values(S.pshots).forEach(s => pts.push(s)); if (L) pts.push(L.site);
  if (DXFD && S.dxf.on) { const r = DXFD.robust; pts.push({ n: r.miny, e: r.minx }, { n: r.maxy, e: r.maxx }); }
  let v = pts.filter(p => p && isFinite(p.n) && isFinite(p.e)); if (!v.length) return null;
  if (DXFD && S.dxf.on) { const r = DXFD.robust, cn = (r.miny + r.maxy) / 2, ce = (r.minx + r.maxx) / 2; v = v.filter(p => Math.hypot(p.n - cn, p.e - ce) < 30000); }   // 도면과 멀리 떨어진 데이터(데모 등)는 맞춤에서 제외
  const ns = v.map(p => p.n), es = v.map(p => p.e); return { n0: Math.min(...ns), n1: Math.max(...ns), e0: Math.min(...es), e1: Math.max(...es) };
}
function fitTo(w, h, o, reserveR, box) { const x = box || extents(); if (!x) return; const dn = Math.max(x.n1 - x.n0, 1), de = Math.max(x.e1 - x.e0, 1), rr = reserveR || 0;
  o.s = Math.min((w - rr) / (de * 1.3), h / (dn * 1.3)); o.cn = (x.n0 + x.n1) / 2; o.ce = (x.e0 + x.e1) / 2 + rr / 2 / o.s; }   // rr: 우측 버튼 영역만큼 왼쪽으로 치우쳐 배치
function fitView() { const cv = $('#map'); V.follow = false; $('#mFollow').classList.remove('on'); fitTo(cv.clientWidth, cv.clientHeight, V, 64); dirty = true; }
function fitSeg() { const sg = seg(), cv = $('#map'); if (!sg) return; const ns = sg.pts.map(p => p.n), es = sg.pts.map(p => p.e); V.follow = false; $('#mFollow').classList.remove('on');
  fitTo(cv.clientWidth, cv.clientHeight, V, 64, { n0: Math.min(...ns), n1: Math.max(...ns), e0: Math.min(...es), e1: Math.max(...es) }); dirty = true; }
const w2s = (o, w, h, n, e) => [w / 2 + (e - o.ce) * o.s, h / 2 - (n - o.cn) * o.s];
function niceStep(pxMin, s) { const raw = pxMin / s, p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }

// DXF 배경: 뷰포트 밖 엔티티는 bbox 로 건너뜀. DXF X=E, Y=N.
function drawDxf(c, w, h, o) {
  const D = DXFD; if (!D || !S.dxf.on) return; const hid = S.dxf.hidden, s = o.s, D2R = Math.PI / 180;
  const x0 = o.ce - w / 2 / s, x1 = o.ce + w / 2 / s, y0 = o.cn - h / 2 / s, y1 = o.cn + h / 2 / s, X = x => w / 2 + (x - o.ce) * s, Y = y => h / 2 - (y - o.cn) * s;
  let texts = 0; c.lineWidth = 1; c.textBaseline = 'middle'; c.textAlign = 'left';
  for (const e of D.ents) {
    const ly = D.layers[e.l]; if (hid[ly.name]) continue; const b = e.b;
    if (b) { if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue; } else if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
    c.strokeStyle = c.fillStyle = ly.color;
    if (e.t === 'L') { c.beginPath(); c.moveTo(X(e.x1), Y(e.y1)); c.lineTo(X(e.x2), Y(e.y2)); c.stroke(); }
    else if (e.t === 'P') { if ((b[2] - b[0]) * s < 1.5 && (b[3] - b[1]) * s < 1.5) { c.fillRect(X(b[0]), Y(b[1]), 1.5, 1.5); continue; }
      c.beginPath(); e.pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); if (e.c) c.closePath(); c.stroke(); }
    else if (e.t === 'C') { c.beginPath(); c.arc(X(e.x), Y(e.y), Math.max(e.r * s, 1.5), 0, 7); c.stroke(); }
    else if (e.t === 'A') { let a0 = e.a0, a1 = e.a1; if (a1 < a0) a1 += 360; c.beginPath(); c.arc(X(e.x), Y(e.y), Math.max(e.r * s, 1), -a0 * D2R, -a1 * D2R, true); c.stroke(); }
    else if (e.t === '.') { const x = X(e.x), y = Y(e.y); c.beginPath(); c.moveTo(x - 3, y); c.lineTo(x + 3, y); c.moveTo(x, y - 3); c.lineTo(x, y + 3); c.stroke(); }
    else if (e.t === 'I') { const x = X(e.x), y = Y(e.y); c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 4, y); c.lineTo(x, y + 4); c.lineTo(x - 4, y); c.closePath(); c.stroke(); }
    else if (e.t === 'T' && S.dxf.labels && e.h * s >= 5 && texts < 1500) { texts++; const fs = Math.min(e.h * s, 36); c.font = fs + 'px system-ui'; c.save(); c.translate(X(e.x), Y(e.y)); c.rotate(-e.rot * D2R); c.fillText(e.s, 0, 0); c.restore(); }
  }
}
function renderMap(c, w, h, o, live) {
  c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.font = '11px system-ui'; c.textBaseline = 'middle';
  const P = (n, e) => w2s(o, w, h, n, e);
  const st = niceStep(70, o.s), n0 = o.cn - h / 2 / o.s, n1 = o.cn + h / 2 / o.s, e0 = o.ce - w / 2 / o.s, e1 = o.ce + w / 2 / o.s;
  c.strokeStyle = '#e5eae7'; c.fillStyle = '#8a9891'; c.lineWidth = 1; c.textAlign = 'left';
  for (let e = Math.ceil(e0 / st) * st; e < e1; e += st) { const [x] = P(0, e); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); c.fillText(e.toFixed(st < 1 ? 1 : 0), x + 2, h - 8); }
  for (let n = Math.ceil(n0 / st) * st; n < n1; n += st) { const [, y] = P(n, 0); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.save(); c.translate(8, y - 2); c.rotate(-Math.PI / 2); c.fillText(n.toFixed(st < 1 ? 1 : 0), 0, 0); c.restore(); }
  drawDxf(c, w, h, o); c.font = '11px system-ui';
  // 면적 다각형
  S.areas.forEach(a => { if (a.pts.length < 2) return; const cur = a.id === S.areaCur;
    c.beginPath(); a.pts.forEach((p, i) => { const [x, y] = P(p.n, p.e); i ? c.lineTo(x, y) : c.moveTo(x, y); }); if (a.closed && a.pts.length > 2) { c.closePath(); c.fillStyle = cur ? '#7c3aed26' : '#7c3aed12'; c.fill(); }
    c.strokeStyle = '#7c3aed'; c.lineWidth = cur ? 2.5 : 1.5; c.stroke();
    a.pts.forEach((p, i) => { const [x, y] = P(p.n, p.e); c.fillStyle = '#7c3aed'; c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); if (cur) { c.fillStyle = '#4c1d95'; c.textAlign = 'left'; c.fillText(String(i + 1), x + 5, y - 6); } });
    if (a.closed && a.pts.length >= 3) { const r = areaStats(a), [x, y] = P(r.centroid.n, r.centroid.e); c.fillStyle = '#4c1d95'; c.font = '700 12px system-ui'; c.textAlign = 'center'; c.fillText(`${a.name} ${r.area.toFixed(1)}㎡`, x, y); c.font = '11px system-ui'; } });
  // 선형 / 관로
  S.segs.forEach(g => {
    const cur = g.id === S.curSeg, info = GL.alignInfo(g.pts), pp = g.pts.map(p => P(p.n, p.e));
    c.strokeStyle = cur ? '#2563eb' : '#7b8fbf'; c.lineWidth = cur ? 3 : 2; c.beginPath(); pp.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
    if (cur && info.len > 0) { const ss = stas(g);
      ss.forEach(s => { const [x, y] = P(s.n, s.e), a = s.az * Math.PI / 180, px = Math.cos(a), py = Math.sin(a), cs = s.i === S.curSta;    // 화면에서 선형 진행방향에 수직인 단위벡터
        c.strokeStyle = cs ? '#dc2626' : '#2563eb'; c.lineWidth = cs ? 3 : 1.5; c.beginPath(); c.moveTo(x - px * 7, y - py * 7); c.lineTo(x + px * 7, y + py * 7); c.stroke();
        const sh = S.shots[shotKey(g, s)]; if (sh) { c.fillStyle = sh.kind === 'CUT' ? '#c2410c' : sh.kind === 'FILL' ? '#1d4ed8' : '#15803d'; c.beginPath(); c.arc(...P(sh.n, sh.e), 4, 0, 7); c.fill();
          if (o.s * (+g.interval || 5) > 40 && sh.depth != null) { c.textAlign = 'left'; c.fillText(sh.kind === 'OK' ? '±0' : fSign(sh.depth, 2), x + px * 12 + 4, y + py * 12); } }
        if (o.s * (+g.interval || 5) > 26 && s.vertex < 0) { c.fillStyle = '#374151'; c.textAlign = 'center'; c.fillText(s.ch % 1 ? s.ch.toFixed(1) : s.ch, x - px * 18, y - py * 18); } }); }
    g.pts.forEach((m, i) => { const [x, y] = pp[i], end = i === 0 || i === g.pts.length - 1;
      if (g.kind === 'pipe' && end) { c.fillStyle = '#fff'; c.strokeStyle = '#b91c1c'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#7f1d1d'; c.font = '700 12px system-ui'; c.textAlign = 'left'; c.fillText((m.name || 'V' + (i + 1)) + (m.z != null ? '  EL ' + f3(m.z) : ''), x + 10, y - 12); c.font = '11px system-ui'; }
      else if (m.name || end) { c.fillStyle = cur ? '#1d4ed8' : '#7b8fbf'; c.fillRect(x - 3.5, y - 3.5, 7, 7); c.fillStyle = '#1e3a8a'; c.textAlign = 'left'; c.fillText(m.name || 'V' + (i + 1), x + 6, y - 8); } });
    if (info.len > 0) { const a = pp[0], b = pp[pp.length - 1]; c.fillStyle = '#1e3a8a'; c.textAlign = 'center'; c.save(); c.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (Math.abs(ang) > Math.PI / 2) ang += Math.PI; c.rotate(ang);
      c.fillText(`L=${info.len.toFixed(3)}` + (info.grade != null ? `  S=${fSign(info.grade, 2)}%` : ''), 0, 14); c.restore(); }
  });
  S.points.forEach(p => { const [x, y] = P(p.n, p.e); c.fillStyle = '#15803d'; c.fillRect(x - 3.5, y - 3.5, 7, 7); c.fillStyle = '#14532d'; c.textAlign = 'left'; c.fillText(p.name + (p.z != null ? ' ' + f3(p.z) : ''), x + 6, y + 10); });
  Object.values(S.pshots).forEach(sh => { const [x, y] = P(sh.tn, sh.te), [mx, my] = P(sh.n, sh.e); c.strokeStyle = '#16a34a'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 5, 0, 7); c.stroke(); c.fillStyle = '#0d9488'; c.beginPath(); c.arc(mx, my, 3, 0, 7); c.fill(); });
  if (S.stakeMode === 'pt' && S.ptTarget) { const [x, y] = P(S.ptTarget.n, S.ptTarget.e); c.strokeStyle = '#dc2626'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 9, 0, 7); c.moveTo(x - 13, y); c.lineTo(x + 13, y); c.moveTo(x, y - 13); c.lineTo(x, y + 13); c.stroke(); }
  if (live && L && isFinite(L.site.n)) { const [x, y] = P(L.site.n, L.site.e), col = L.fix === 'FIXED' ? '#15803d' : L.fix === 'FLOAT' ? '#d97706' : '#b91c1c';
    if (L.sdH) { c.fillStyle = col + '30'; c.beginPath(); c.arc(x, y, Math.max(L.sdH * o.s, 6), 0, 7); c.fill(); }
    c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 12, y); c.lineTo(x + 12, y); c.moveTo(x, y - 12); c.lineTo(x, y + 12); c.stroke(); c.fillStyle = col; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill(); }
  c.fillStyle = '#0d1b16'; c.textAlign = 'center'; c.font = '700 13px system-ui'; c.fillText('N', 22, 14); c.beginPath(); c.moveTo(22, 20); c.lineTo(16, 38); c.lineTo(22, 33); c.lineTo(28, 38); c.closePath(); c.fill(); c.font = '11px system-ui';
  const sb = niceStep(80, o.s), px = sb * o.s; c.fillRect(12, h - 26, px, 3); c.textAlign = 'left'; c.fillText(sb + ' m', 16 + px, h - 24);
}
function drawMap() {
  const { c, w, h } = ctx2d($('#map')); if (!w) return;
  if (V.follow && L) { V.cn = L.site.n; V.ce = L.site.e; }
  renderMap(c, w, h, V, true);
}
(() => {
  const cv = $('#map'), ptrs = new Map(); let last = null, moved = 0, t0 = 0, d0 = 0, s0 = 1;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; t0 = Date.now(); last = [e.offsetX, e.offsetY]; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); s0 = V.s; } });
  cv.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; V.s = Math.min(2000, Math.max(0.02, s0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / d0)); moved = 99; }
    else { const dx = e.offsetX - last[0], dy = e.offsetY - last[1]; moved += Math.abs(dx) + Math.abs(dy); if (moved > 6) { V.ce -= dx / V.s; V.cn += dy / V.s; V.follow = false; $('#mFollow').classList.remove('on'); } last = [e.offsetX, e.offsetY]; }
    dirty = true; });
  cv.addEventListener('pointerup', e => { const wasTap = moved < 8 && Date.now() - t0 < 400 && ptrs.size === 1; ptrs.delete(e.pointerId); if (wasTap) pickAt(e.offsetX, e.offsetY); });
  cv.addEventListener('pointercancel', e => ptrs.delete(e.pointerId));
  cv.addEventListener('wheel', e => { e.preventDefault(); V.s = Math.min(2000, Math.max(0.02, V.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); dirty = true; }, { passive: false });
})();
$('#mFit').onclick = fitView; if ($('#mSeg')) $('#mSeg').onclick = fitSeg;
$('#mIn').onclick = () => { V.s *= 1.5; dirty = true; }; $('#mOut').onclick = () => { V.s /= 1.5; dirty = true; };
$('#mFollow').onclick = () => { V.follow = !V.follow; $('#mFollow').classList.toggle('on', V.follow); dirty = true; };

// 탭한 위치의 후보 선택: 측점 / 저장점 / DXF 꼭짓점(스냅) / DXF 선·폴리라인
function pickAt(x, y) {
  const cv = $('#map'), w = cv.clientWidth, h = cv.clientHeight, cands = [], sg = seg();
  const wx = V.ce + (x - w / 2) / V.s, wy = V.cn - (y - h / 2) / V.s, tolW = 28 / V.s, snapW = 14 / V.s;
  stas(sg).forEach(s => { const [px, py] = w2s(V, w, h, s.n, s.e), d = Math.hypot(px - x, py - y); if (d < 26) cands.push({ d, kind: 'sta', st: s, x: s.e, y: s.n, t: `${s.name} · ${s.inv != null ? kindOf(sg).z + ' ' + f3(s.inv) + ' / ' + kindOf(sg).dz + ' ' + f3(s.z) : '누가 ' + s.ch.toFixed(2)}` }); });
  S.points.forEach(p => { const [px, py] = w2s(V, w, h, p.n, p.e), d = Math.hypot(px - x, py - y); if (d < 26) cands.push({ d: d - 2, kind: 'pt', pt: p, x: p.e, y: p.n, t: `${p.name} · N ${f3(p.n)} E ${f3(p.e)}${p.z != null ? ' Z ' + f3(p.z) : ''}` }); });
  if (DXFD && S.dxf.on) {
    const D = DXFD; let bestE = null, bestD = tolW;
    for (const e of D.ents) {
      if (S.dxf.hidden[D.layers[e.l].name] || e.t === 'A') continue; const b = e.b;
      if (b) { if (wx < b[0] - tolW || wx > b[2] + tolW || wy < b[1] - tolW || wy > b[3] + tolW) continue; } else if (Math.abs(e.x - wx) > tolW || Math.abs(e.y - wy) > tolW) continue;
      const vs = DXF.vertices(e); let vb = null, vd = snapW;
      for (const q of vs) { const dd = Math.hypot(q[0] - wx, q[1] - wy); if (dd < vd) { vd = dd; vb = q; } }
      if (vb) cands.push({ d: vd * V.s - 1, kind: 'dxfv', ent: e, x: vb[0], y: vb[1], t: dxfLabel(e, D) });
      else if (e.t === 'L' || e.t === 'P') { const dd = DXF.distTo(e, wx, wy); if (dd < bestD) { bestD = dd; bestE = e; } }
    }
    if (bestE) cands.push({ d: bestD * V.s + 6, kind: 'dxfe', ent: bestE, x: wx, y: wy, t: dxfLabel(bestE, D) });
  }
  cands.sort((a, b) => a.d - b.d); const el = $('#pick');
  if (!cands.length) { el.hidden = true; PICK = null; return; }
  showPick(cands[0]);
}
function dxfLabel(e, D) {
  const ly = D.layers[e.l].name;
  return e.t === 'T' ? `문자 “${e.s}” · ${ly}` : e.t === 'I' ? `블록 ${e.name} · ${ly}` : e.t === 'C' ? `원 R=${e.r.toFixed(2)} · ${ly}` : e.t === 'P' ? `폴리라인 ${e.pts.length}점${e.c ? ' (닫힘)' : ''} · ${ly}` : e.t === 'L' ? `선 · ${ly}` : `점 · ${ly}`;
}
function showPick(p) {
  PICK = p; const el = $('#pick'), a = (act, txt, cls) => `<button class="${cls || 'ghost'} sm" data-act="${act}">${txt}</button>`; let b = '';
  const lineish = p.ent && (p.ent.t === 'P' || p.ent.t === 'L');
  if (p.kind === 'sta') b = a('go-sta', '이 측점으로 찾기', 'primary');
  else if (p.kind === 'pt') b = a('go-pt', '찾아가기', 'primary') + a('area-add', '면적에 추가');
  else if (p.kind === 'dxfv') b = a('go-pt', '찾아가기', 'primary') + a('save-pt', '점 저장') + a('area-add', '면적에 추가') + a('pipe-a', '관로 시점') + a('pipe-b', '관로 종점') + (lineish ? a('use-line', '선형으로 사용') + a('area-poly', '면적 계산') : '');
  else b = a('use-line', '선형으로 사용', 'primary') + a('area-poly', '면적 계산');
  const co = p.kind === 'dxfe' ? '' : ` · N ${p.y.toFixed(3)} E ${p.x.toFixed(3)}`;
  el.hidden = false; el.innerHTML = `<div class="pk">${esc(p.t)}${co}</div><div class="pkb">${b}</div>`;
}
function polyVerts(e) {
  let v = e.t === 'L' ? [[e.x1, e.y1], [e.x2, e.y2]] : e.pts.slice(); const out = [];
  v.forEach(q => { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) out.push(q); });
  if (e.c && out.length > 2) out.push(out[0].slice()); return out.map(q => ({ name: '', n: q[1], e: q[0], z: null }));
}
$('#pick').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-act]'); if (!btn || !PICK) return; const p = PICK, act = btn.dataset.act, el = $('#pick');
  const pt = () => ({ name: p.kind === 'pt' ? p.pt.name : (p.ent && p.ent.t === 'T' ? p.ent.s.slice(0, 12) : 'D' + S.seq), n: p.y, e: p.x, z: p.kind === 'pt' ? p.pt.z : null });
  if (act === 'go-sta') { S.curSta = p.st.i; S.stakeMode = 'line'; save(); el.hidden = true; go('stake'); }
  if (act === 'go-pt') { const q = pt(); S.ptTarget = p.kind === 'pt' ? { id: p.pt.id, name: q.name, n: q.n, e: q.e, z: q.z } : { name: q.name, n: q.n, e: q.e, z: null }; S.stakeMode = 'pt'; save(); el.hidden = true; go('stake'); }
  if (act === 'save-pt') { const q = pt(); S.points.push({ id: uid(), name: q.name === 'D' + S.seq ? 'D' + S.seq++ : q.name, code: 'DXF', n: q.n, e: q.e, z: null, src: 'dxf', ts: new Date().toISOString() }); save(); toast('점 저장됨 (높이 없음)'); dirty = true; }
  if (act === 'area-add') { const q = pt(); addAreaPt(q, q.name); toast('면적 꼭짓점으로 추가'); dirty = true; }
  if (act === 'area-poly') { const vs = polyVerts(p.ent); const a = { id: uid(), name: '도면 면적 ' + (S.areas.length + 1), pts: vs.map((q, i) => ({ name: 'V' + (i + 1), n: q.n, e: q.e, z: null })), closed: !!p.ent.c || (vs.length > 2 && vs[0].n === vs[vs.length - 1].n && vs[0].e === vs[vs.length - 1].e) };
    if (a.closed && a.pts.length > 3 && a.pts[0].n === a.pts[a.pts.length - 1].n && a.pts[0].e === a.pts[a.pts.length - 1].e) a.pts.pop(); S.areas.push(a); S.areaCur = a.id; save(); el.hidden = true; const r = areaStats(a); toast(a.closed ? `면적 ${r.area.toFixed(2)} ㎡ · 둘레 ${r.perimeter.toFixed(2)} m` : `연장 ${r.length.toFixed(2)} m`); dirty = true; }
  if (act === 'use-line') { const vs = polyVerts(p.ent), sg = newSeg('도면 선형 ' + (S.segs.length + 1), 'line'); sg.pts = vs; sg.verts = false; sg.interval = GL.alignInfo(vs).len > 300 ? 20 : 10; S.segs.push(sg); S.curSeg = sg.id; S.curSta = 0; S.stakeMode = 'line'; save(); el.hidden = true; toast(`선형 생성: 꼭짓점 ${vs.length}개, 높이는 선형 탭에서 입력`); dirty = true; }
  if (act === 'pipe-a' || act === 'pipe-b') { const q = pt(); PIPE[act === 'pipe-a' ? 'a' : 'b'] = q; toast(act === 'pipe-a' ? '관로 시점 지정' : '관로 종점 지정');
    if (PIPE.a && PIPE.b) { const sg = newSeg('도면 관로 ' + (S.segs.length + 1), 'pipe'); sg.pts = [{ name: 'MH1', n: PIPE.a.n, e: PIPE.a.e, z: null }, { name: 'MH2', n: PIPE.b.n, e: PIPE.b.e, z: null }]; S.segs.push(sg); S.curSeg = sg.id; S.curSta = 0; S.stakeMode = 'line'; PIPE = { a: null, b: null }; save(); el.hidden = true; toast('관로 생성 — 선형 탭에서 관저고를 입력하세요'); dirty = true; } }
});

// DXF 불러오기 / 레이어
function dxfInfoUpdate() {
  const el = $('#dxfInfo'); $('#dxfToggle').textContent = S.dxf.on ? '배경 켜짐' : '배경 꺼짐'; if (!DXFD) { el.hidden = true; return; }
  el.hidden = false; const r = DXFD.robust, cx = (r.minx + r.maxx) / 2, cy = (r.miny + r.maxy) / 2; let warn = '';
  if (L && isFinite(L.site.n) && Math.hypot(L.site.e - cx, L.site.n - cy) > 50000) warn = ' ⚠ 도면 좌표가 현재 위치와 50km 이상 떨어져 있습니다 — 좌표계(설정)를 확인하세요.';
  el.textContent = `${S.dxf.name || 'DXF'} · ${DXFD.ents.length.toLocaleString()}개 엔티티 · 레이어 ${DXFD.layers.length}${DXFD.meta.version ? ' · ' + DXFD.meta.version : ''} · 좌표 범위 E ${r.minx.toFixed(0)}~${r.maxx.toFixed(0)}, N ${r.miny.toFixed(0)}~${r.maxy.toFixed(0)}.${warn}`;
}
function renderLayers() {
  const el = $('#layerPanel'); if (!DXFD) { el.innerHTML = '<p class="hint">불러온 DXF가 없습니다.</p>'; return; }
  el.innerHTML = '<div class="row gap"><button class="ghost sm" data-lay="all">모두 켜기</button><button class="ghost sm" data-lay="none">모두 끄기</button><label class="chk2"><input type="checkbox" data-lay="labels"' + (S.dxf.labels ? ' checked' : '') + '> 문자</label></div>'
    + DXFD.layers.map((l, i) => l.count ? `<label class="lay"><input type="checkbox" data-lay="${i}"${S.dxf.hidden[l.name] ? '' : ' checked'}><i style="background:${l.color}"></i><span>${esc(l.name)}</span><small>${l.count}</small></label>` : '').join('');
}
$('#layerPanel').addEventListener('change', e => { const k = e.target.dataset.lay; if (k === undefined || !DXFD) return; if (k === 'labels') S.dxf.labels = e.target.checked; else S.dxf.hidden[DXFD.layers[+k].name] = !e.target.checked; save(); dirty = true; });
$('#layerPanel').addEventListener('click', e => { const b = e.target.closest('button[data-lay]'); if (!b || !DXFD) return; DXFD.layers.forEach(l => S.dxf.hidden[l.name] = b.dataset.lay === 'none'); save(); renderLayers(); dirty = true; });
$('#dxfLayers').onclick = () => { const p = $('#layerPanel'); p.hidden = !p.hidden; if (!p.hidden) renderLayers(); };
$('#dxfToggle').onclick = () => { S.dxf.on = !S.dxf.on; save(); dxfInfoUpdate(); dirty = true; };
$('#dxfFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    toast('DXF 읽는 중… ' + (f.size / 1e6).toFixed(1) + ' MB'); await new Promise(r => setTimeout(r, 40));
    const r = DXF.parse(new Uint8Array(await f.arrayBuffer()));
    if (!r.ents.length) throw new Error('읽을 수 있는 엔티티가 없습니다 (DWG·바이너리 DXF는 미지원 — ASCII DXF로 저장하세요)');
    r.robust = DXF.robustBounds(r.ents); DXFD = r; S.dxf = { name: f.name, hidden: {}, on: true, labels: true }; save();
    try { await idb.set('dxf', r); } catch (er) { toast('브라우저 저장 실패 — 이번 세션에서만 유지: ' + er.message); }
    renderLayers(); dxfInfoUpdate(); fitView(); toast(`DXF 불러옴: ${r.ents.length.toLocaleString()}개`);
  } catch (er) { toast('DXF 오류: ' + er.message); }
};

// ───────────── 수신 기록 · 데이터 수집 ─────────────
// (a) 측정 특징 로그(상시): 측정 확정마다 1건. 모델 학습용 특징 + (정답점 측정이면) 오차 라벨.
// (b) 연속 세션 로그(선택): 원문 NMEA / 에포크 / 위성 스카이(1 Hz). GSV·GSA 는 USB 시리얼·BLE 소스에서만 들어온다.
S.logs = S.logs || []; S.settings.env = S.settings.env || '개활지'; S.settings.note = S.settings.note || '';
S.logs.forEach(l => { if (!l.t1) l.t1 = '(비정상 종료)'; });
idb.del = async function (k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').delete(k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); };
const SYSN = { GP: 1, GL: 2, GA: 3, GB: 4, BD: 4, GQ: 5 }, SYSC = { 0: '?', 1: 'G', 2: 'R', 3: 'E', 4: 'C', 5: 'J' };
const SKY = { gsv: {}, gsa: {}, dop: null, t: 0 };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function skyUpdate(m) {
  const now = Date.now();
  if (m.type === 'GSV') {
    const e = SKY.gsv[m.talker] || (SKY.gsv[m.talker] = { parts: {}, list: [], t: 0 }); e.parts[m.msg] = m.sats;
    if (m.msg === m.total) { e.list = []; for (let i = 1; i <= m.total; i++) if (e.parts[i]) e.list.push(...e.parts[i]); e.parts = {}; e.t = now; SKY.t = now; }
  } else { const sys = m.sys || SYSN[m.talker] || 0; SKY.gsa[sys] = { prns: m.prns, t: now }; if (isFinite(m.hdop)) SKY.dop = { pdop: m.pdop, hdop: m.hdop, vdop: m.vdop, t: now }; }
}
function skySnapshot() {
  const now = Date.now(); if (now - SKY.t > 6000) return null; const out = [];
  Object.entries(SKY.gsv).forEach(([tk, e]) => {
    if (now - e.t > 6000) return; const sys = SYSN[tk] || 0, g = SKY.gsa[sys] || SKY.gsa[0], used = g && now - g.t < 6000 ? g.prns : [];
    e.list.forEach(s => out.push({ c: SYSC[sys], prn: s.prn, el: s.el, az: s.az, cn0: s.cn0, used: used.includes(s.prn) || (sys === 2 && used.includes(s.prn + 64)) }));
  });
  return out;
}
function skyFeatures(sky) {
  if (!sky || !sky.length) return null; const used = sky.filter(s => s.used), cn = a => a.map(s => s.cn0).filter(v => v != null), bc = {}; used.forEach(s => bc[s.c] = (bc[s.c] || 0) + 1);
  return { nVis: sky.length, nUsed: used.length, cn0Used: avg(cn(used)), cn0All: avg(cn(sky)), minElUsed: used.length ? Math.min(...used.map(s => s.el == null ? 90 : s.el)) : null,
    nLowEl: used.filter(s => s.el != null && s.el < 15).length, nWeak: used.filter(s => s.cn0 != null && s.cn0 < 35).length, byC: bc, pdop: SKY.dop ? SKY.dop.pdop : null };
}

const LOG = { sid: null, buf: { nmea: [], epoch: [], sky: [] }, timer: null, lastSky: 0 };
const logEntry = () => S.logs.find(l => l.id === LOG.sid);
function logStart() {
  if (LOG.sid) return; const id = 'L' + Date.now().toString(36);
  S.logs.push({ id, t0: new Date().toISOString(), t1: null, env: S.settings.env, note: S.settings.note, src: S.settings.source, crs: S.settings.crs, antH: S.settings.antH, n: { nmea: 0, epoch: 0, sky: 0 }, chunks: { nmea: 0, epoch: 0, sky: 0 } });
  LOG.sid = id; LOG.buf = { nmea: [], epoch: [], sky: [] }; LOG.timer = setInterval(logFlush, 5000); save(); renderLog();
}
async function logFlush() {
  const en = logEntry(); if (!en) return;
  for (const k of ['nmea', 'epoch', 'sky']) {
    const b = LOG.buf[k]; if (!b.length) continue; LOG.buf[k] = [];
    try { await idb.set(`log:${en.id}:${k}:${en.chunks[k]}`, b); en.chunks[k]++; en.n[k] += b.length; } catch (e) { toast('기록 저장 실패: ' + e.message); logStop(true); return; }
  }
  save(); renderLogLive();
}
async function logStop(silent) {
  if (!LOG.sid) return; clearInterval(LOG.timer); await logFlush(); const en = logEntry(); if (en) en.t1 = new Date().toISOString(); LOG.sid = null; save(); renderLog(); if (!silent) toast('기록 종료');
}
function logNmea(line) { if (!LOG.sid) return; LOG.buf.nmea.push(line); if (LOG.buf.nmea.length >= 800) logFlush(); }
function logEpoch(e) {
  if (!LOG.sid) return; const t = e.t;
  LOG.buf.epoch.push([t, e.fix, e.lat, e.lon, e.alt, +e.site.n.toFixed(4), +e.site.e.toFixed(4), isFinite(e.site.z) ? +e.site.z.toFixed(4) : null, e.sdH, e.sdV, e.sats, e.hdop, e.age == null ? null : e.age, e.tilt && !e.tilt.missing ? +e.tilt.theta.toFixed(2) : null, e.src]);
  if (t - LOG.lastSky >= 1000) { LOG.lastSky = t; const sk = skySnapshot(); if (sk) LOG.buf.sky.push({ t, s: sk.map(x => [x.c, x.prn, x.el, x.az, x.cn0, x.used ? 1 : 0]) }); }
  if (LOG.buf.epoch.length >= 600) logFlush();
}
async function logRead(en, kind) { const out = []; for (let i = 0; i < en.chunks[kind]; i++) { const c = await idb.get(`log:${en.id}:${kind}:${i}`); if (c) for (const x of c) out.push(x); } return out; }
const iso = t => new Date(t).toISOString();
async function logExport(id, kind) {
  const en = S.logs.find(l => l.id === id); if (!en) return; if (LOG.sid === id) await logFlush();
  if (kind === 'nmea') return download(id + '.nmea', (await logRead(en, 'nmea')).join('\r\n') + '\r\n', 'text/plain');
  if (kind === 'epoch') return download(id + '-epoch.csv', toCsv([['time', 'fix', 'lat', 'lon', 'alt', 'N', 'E', 'Z', 'sdH', 'sdV', 'sats', 'hdop', 'age', 'tilt_deg', 'src']].concat((await logRead(en, 'epoch')).map(r => [iso(r[0])].concat(r.slice(1))))), 'text/csv');
  if (kind === 'sky') { const rows = []; (await logRead(en, 'sky')).forEach(r => r.s.forEach(x => rows.push([iso(r.t)].concat(x)))); return download(id + '-sky.csv', toCsv([['time', 'const', 'prn', 'el', 'az', 'cn0', 'used']].concat(rows)), 'text/csv'); }
  if (kind === 'json') return download(id + '.json', JSON.stringify({ session: en, nmea: await logRead(en, 'nmea'), epoch: await logRead(en, 'epoch'), sky: await logRead(en, 'sky') }), 'application/json');
}
async function logDelete(id) {
  const en = S.logs.find(l => l.id === id); if (!en) return; if (LOG.sid === id) await logStop(true);
  for (const k of ['nmea', 'epoch', 'sky']) for (let i = 0; i < en.chunks[k]; i++) { try { await idb.del(`log:${id}:${k}:${i}`); } catch (e) {} }
  S.logs = S.logs.filter(l => l.id !== id); save(); renderLog();
}

// 측정 특징 로그 (상시)
let SHOTLOG = [], shotSaveT = null;
function loadShotLog() { idb.get('shotlog').then(a => { if (Array.isArray(a)) SHOTLOG = a.concat(SHOTLOG); renderLogLive(); }).catch(() => {}); }
function logShot(kind, r, extra) {
  const rec = Object.assign({ t: new Date().toISOString(), kind, env: S.settings.env, note: S.settings.note, src: S.settings.source, sim: S.settings.source === 'sim', crs: S.settings.crs, antH: S.settings.antH, tol: S.settings.tol, avgSec: S.settings.avgSec, tiltOn: S.settings.tilt.on, calibrated: !!CAL,
    n: r.n, e: r.e, z: r.z, sdH: r.sdH, sdV: r.sdV, count: r.count, fix: r.fix }, r.feat || {}, r.skyF ? { sky: r.skyF } : {}, extra || {});
  SHOTLOG.push(rec); if (SHOTLOG.length > 5000) SHOTLOG.shift(); clearTimeout(shotSaveT); shotSaveT = setTimeout(() => idb.set('shotlog', SHOTLOG).catch(() => {}), 800); renderLogLive();
}
const SHOT_COLS = ['t', 'kind', 'env', 'note', 'src', 'sim', 'crs', 'antH', 'tol', 'avgSec', 'tiltOn', 'calibrated', 'n', 'e', 'z', 'sdH', 'sdV', 'count', 'fix', 'waitS', 'resets', 'fixedFrac', 'sats', 'hdop', 'sdRepH', 'sdRepV', 'ageDiff', 'thMean', 'thMax',
  'sky.nVis', 'sky.nUsed', 'sky.cn0Used', 'sky.cn0All', 'sky.minElUsed', 'sky.nLowEl', 'sky.nWeak', 'sky.pdop', 'target', 'off', 'known', 'errN', 'errE', 'errH', 'errZ', 'rawErrN', 'rawErrE', 'rawErrH', 'dAlong', 'dCross', 'dn', 'de'];
function shotCsv() { return toCsv([SHOT_COLS].concat(SHOTLOG.map(s => SHOT_COLS.map(c => { const v = c.startsWith('sky.') ? (s.sky ? s.sky[c.slice(4)] : '') : s[c]; return v == null ? '' : typeof v === 'number' ? +v.toFixed(5) : v; })))); }

// 정답점 측정: 기지점에서 재서 오차를 라벨로 기록 (다중경로 신뢰도 모델의 학습 정답)
$('#gtMeasure').onclick = async () => {
  const k = knownPoints()[+$('#gtKnown').value]; if (!k) return toast('정답점이 없습니다 (측량 탭에서 좌표를 가져오거나 선형에 맨홀 좌표 입력)');
  try {
    const r = await measure(), dn = r.n - k.n, de = r.e - k.e, dz = k.z != null ? r.z - k.z : null, rn = r.raw.n - k.n, re = r.raw.e - k.e;
    logShot('gt', r, { known: k.label, errN: dn, errE: de, errH: Math.hypot(dn, de), errZ: dz, rawErrN: rn, rawErrE: re, rawErrH: Math.hypot(rn, re) });
    toast(`정답 오차 수평 ${fLen(Math.hypot(dn, de))}${dz != null ? ' · 높이 ' + fSign(dz) : ''} 기록됨`);
  } catch (e) { toast(e.message); }
};

function drawSky() {
  const cv = $('#skyPlot'); if (!cv || !cv.clientWidth) return; const { c, w, h } = ctx2d(cv); c.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 20; c.strokeStyle = '#cfd8d3'; c.lineWidth = 1; c.fillStyle = '#5b6b64'; c.font = '11px system-ui'; c.textAlign = 'center';
  [0, 30, 60].forEach(el => { c.beginPath(); c.arc(cx, cy, R * (90 - el) / 90, 0, 7); c.stroke(); });
  c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke(); c.fillText('N', cx, cy - R - 6); c.fillText('S', cx, cy + R + 13); c.fillText('E', cx + R + 10, cy + 4); c.fillText('W', cx - R - 10, cy + 4);
  const sk = skySnapshot(), info = $('#skyInfo');
  if (!sk) { c.fillText('위성 정보(GSV) 없음 — USB 시리얼·BLE·데모 소스에서 표시', cx, cy); info.textContent = ''; return; }
  sk.forEach(s => {
    if (s.el == null || s.az == null) return; const r = R * (90 - s.el) / 90, a = s.az * Math.PI / 180, x = cx + r * Math.sin(a), y = cy - r * Math.cos(a), cn = s.cn0 == null ? 0 : s.cn0;
    c.fillStyle = cn >= 40 ? '#15803d' : cn >= 32 ? '#ca8a04' : cn > 0 ? '#b91c1c' : '#9ca3af'; c.beginPath(); c.arc(x, y, s.used ? 9 : 6, 0, 7); c.fill();
    if (!s.used) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); } c.fillStyle = '#fff'; c.font = '8px system-ui'; c.fillText(String(s.prn), x, y + 3); c.font = '11px system-ui';
  });
  const f = skyFeatures(sk); info.textContent = `가시 ${f.nVis} · 사용 ${f.nUsed} · 평균 C/N0 ${f.cn0Used != null ? f.cn0Used.toFixed(1) : '–'} dB-Hz · 저고도(<15°) 사용 ${f.nLowEl} · 약신호(<35) ${f.nWeak}${f.pdop != null ? ' · PDOP ' + f.pdop : ''}  (녹색 ≥40 / 황색 ≥32 / 적색 <32, 큰 점=사용 위성)`;
}
function renderLogLive() {
  const fe = $('#fixStat'); if (fe) fe.textContent = fsText();
  const dt = $('#diagText'); if (dt) dt.textContent = diagReport();
  const el = $('#logStat'); if (!el) return; const en = logEntry();
  el.textContent = en ? `● 기록 중 — NMEA ${en.n.nmea + LOG.buf.nmea.length} · 에포크 ${en.n.epoch + LOG.buf.epoch.length} · 위성 ${en.n.sky + LOG.buf.sky.length}` : `기록 중지 · 측정 특징 ${SHOTLOG.length}건 누적`;
  if (tab === 'settings') drawSky();
}
function renderLog() {
  if (!$('#logCard')) return; $('#logEnv').value = S.settings.env; $('#logNote').value = S.settings.note; $('#logToggle').textContent = LOG.sid ? '■ 기록 중지' : '● 연속 기록 시작';
  $('#gtKnown').innerHTML = knownPoints().map((k, i) => `<option value="${i}">${esc(k.label)}</option>`).join('') || '<option value="">기지점 없음</option>';
  $('#logList').innerHTML = S.logs.slice().reverse().map(l => `<div class="it"><div class="nm"><b>${esc(l.id)} · ${esc(l.env)}</b><span>${l.t0.slice(0, 16).replace('T', ' ')} · ${l.src} · NMEA ${l.n.nmea} / 에포크 ${l.n.epoch} / 위성 ${l.n.sky}${l.t1 ? '' : ' · 진행 중'}</span></div>
    <div class="lbtn"><button class="ghost sm" data-lx="${l.id}:nmea">NMEA</button><button class="ghost sm" data-lx="${l.id}:epoch">에포크</button><button class="ghost sm" data-lx="${l.id}:sky">위성</button><button class="ghost sm" data-lx="${l.id}:json">JSON</button><button class="ghost sm danger" data-lx="${l.id}:del">삭제</button></div></div>`).join('') || '<p class="hint">연속 기록 세션 없음</p>';
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { const el = $('#logStorage'); if (el) el.textContent = `브라우저 저장소 사용 ${(e.usage / 1e6).toFixed(1)} MB / 한도 ${(e.quota / 1e6).toFixed(0)} MB`; }).catch(() => {});
  renderLogLive();
}
$('#logEnv').onchange = e => { S.settings.env = e.target.value; save(); };
$('#logNote').onchange = e => { S.settings.note = e.target.value.trim(); save(); };
$('#logToggle').onclick = () => LOG.sid ? logStop() : logStart();
$('#xShotCsv').onclick = () => download('shot-features-' + stamp() + '.csv', shotCsv(), 'text/csv');
$('#xShotClear').onclick = () => { if (SHOTLOG.length && confirm('측정 특징 ' + SHOTLOG.length + '건을 모두 삭제할까요? (내보내기 먼저 권장)')) { SHOTLOG = []; idb.set('shotlog', []).catch(() => {}); renderLogLive(); } };
$('#logList').onclick = e => { const b = e.target.closest('[data-lx]'); if (!b) return; const [id, k] = b.dataset.lx.split(':'); if (k === 'del') { if (confirm('이 기록 세션을 삭제할까요?')) logDelete(id); } else logExport(id, k); };

// ── 내보내기 ──
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' }), file = typeof File !== 'undefined' ? new File([blob], name, { type: mime }) : null;
  const dl = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
  if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) navigator.share({ files: [file], title: name }).catch(dl); else dl();
}
const f3c = v => (v == null || !isFinite(v)) ? '' : v.toFixed(3);   // CSV 는 값 없음 = 빈칸
const csvCell = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
function pointsCsv() { return toCsv([['이름', '코드', 'N(X)', 'E(Y)', 'Z', 'σH(m)', 'σV(m)', 'FIX', '소스', '시각']].concat(S.points.map(p => [p.name, p.code, f3c(p.n), f3c(p.e), f3c(p.z), p.sdH != null ? p.sdH.toFixed(3) : '', p.sdV != null ? p.sdV.toFixed(3) : '', p.fix || '', p.src, p.ts]))); }
function sheetCsv() {
  const KD = { CUT: 'cut', FILL: 'fill', OK: '계획고', NA: '높이없음' }, rows = [];
  S.segs.forEach(g => { const K = kindOf(g); stas(g).forEach(s => { const sh = S.shots[shotKey(g, s)], kd = sh ? (sh.kind === 'CUT' ? K.cut : sh.kind === 'FILL' ? K.fill : KD[sh.kind]) : '';
    rows.push([g.name, g.kind === 'pipe' ? '관로' : '선형', s.name, s.ch.toFixed(3), f3c(s.n), f3c(s.e), f3c(s.inv), f3c(s.z), sh ? f3c(sh.gl) : '', sh && sh.depth != null ? f3c(sh.depth) : '', sh && sh.dAlong != null ? f3c(sh.dAlong) : '', sh && sh.dCross != null ? f3c(sh.dCross) : '', sh ? f3c(sh.off) : '', sh ? sh.sdV.toFixed(3) : '', kd, sh ? sh.ts : '', sh ? sh.text : '']); }); });
  return toCsv([['선형', '종류', '측점', '누가거리(m)', 'N', 'E', '설계 관저/계획고', '굴착저면/설계고', '현황GL', '절·터파기(+)/성토(−)', '종편차(m)', '횡편차(m)', '측점편차(m)', 'σV(m)', '판정', '시각', '마킹문구']].concat(rows));
}
function findCsv() {
  return toCsv([['이름', '설계N', '설계E', '설계Z', '실측N', '실측E', '실측Z', 'ΔN(북)', 'ΔE(동)', '수평편차(m)', 'Δ높이', 'σH(m)', 'σV(m)', 'FIX', '시각']].concat(
    Object.values(S.pshots).map(s => [s.name, f3c(s.tn), f3c(s.te), f3c(s.tz), f3c(s.n), f3c(s.e), f3c(s.z), f3c(s.dn), f3c(s.de), f3c(s.dist), f3c(s.dz), s.sdH != null ? s.sdH.toFixed(3) : '', s.sdV != null ? s.sdV.toFixed(3) : '', s.fix || '', s.ts])));
}
function areaCsv() {
  const rows = [['이름', '구분', '꼭짓점수', '면적(㎡)', '면적(ha)', '면적(평)', '둘레(m)', '연장(m)', '중심N', '중심E']];
  S.areas.forEach(a => { const r = areaStats(a); rows.push([a.name, a.closed ? '닫힘' : '열림', r.count, r.area.toFixed(3), r.ha.toFixed(5), r.pyeong.toFixed(2), r.perimeter.toFixed(3), r.length.toFixed(3), r.centroid ? r.centroid.n.toFixed(3) : '', r.centroid ? r.centroid.e.toFixed(3) : '']); });
  rows.push([], ['꼭짓점 목록'], ['면적', '번호', '이름', 'N', 'E', 'Z']);
  S.areas.forEach(a => a.pts.forEach((p, i) => rows.push([a.name, i + 1, p.name, f3c(p.n), f3c(p.e), f3c(p.z)]))); return toCsv(rows);
}
function buildDxf() {
  const d = GL.dxfBuilder(), x = extents(), ext = x ? Math.max(x.n1 - x.n0, x.e1 - x.e0, 10) : 50, th = Math.max(0.15, Math.min(ext, 2000) / 150);
  [['MH', 1], ['PIPE', 5], ['ALIGN', 5], ['STATION', 2], ['SHOT', 6], ['POINT', 3], ['FIND', 6], ['AREA', 4], ['TEXT', 7]].forEach(([n, c]) => d.layer(n, c));
  S.segs.forEach(g => { const info = GL.alignInfo(g.pts); if (!(info.len > 0)) return; const ly = g.kind === 'pipe' ? 'PIPE' : 'ALIGN', ss = stas(g);
    for (let k = 1; k < g.pts.length; k++) d.line(ly, g.pts[k - 1].e, g.pts[k - 1].n, g.pts[k].e, g.pts[k].n);
    g.pts.forEach((m, i) => { if (g.kind === 'pipe' && (i === 0 || i === g.pts.length - 1)) d.circle('MH', m.e, m.n, 0.6); if (m.name || m.z != null) d.text('TEXT', m.e + 0.8, m.n + 0.8, th, `${m.name || 'V' + (i + 1)}${m.z != null ? ' EL' + f3(m.z) : ''}`); });
    const a0 = g.pts[0], a1 = g.pts[g.pts.length - 1]; d.text('TEXT', (a0.e + a1.e) / 2, (a0.n + a1.n) / 2, th, `${g.name} L=${info.len.toFixed(3)}${info.grade != null ? ' S=' + fSign(info.grade, 2) + '%' : ''}`, Math.atan2(a1.n - a0.n, a1.e - a0.e) * 180 / Math.PI);
    ss.forEach(s => { const ux = Math.sin(s.az * Math.PI / 180), uy = Math.cos(s.az * Math.PI / 180);    // 진행방향 단위벡터 (x=E, y=N)
      d.line('STATION', s.e - uy * 0.5, s.n + ux * 0.5, s.e + uy * 0.5, s.n - ux * 0.5); if (s.vertex < 0) d.text('STATION', s.e + uy * 0.7, s.n - ux * 0.7, th * 0.8, `${s.name}${s.inv != null ? ' EL' + f3(s.inv) : ''}`);
      const sh = S.shots[shotKey(g, s)]; if (sh) { d.point('SHOT', sh.e, sh.n, sh.gl); d.text('SHOT', sh.e - uy * 0.7, sh.n + ux * 0.7, th * 0.8, `GL${f3(sh.gl)}${sh.depth != null ? ' ' + (sh.kind === 'OK' ? 'OK' : (sh.kind === 'CUT' ? 'CUT ' : 'FILL ') + Math.abs(sh.depth).toFixed(3)) : ''}`); } }); });
  S.points.forEach(p => { d.point('POINT', p.e, p.n, p.z || 0); d.text('POINT', p.e + 0.3, p.n + 0.3, th, `${p.name}${p.z != null ? ' ' + f3(p.z) : ''}`); });
  Object.values(S.pshots).forEach(s => { d.circle('FIND', s.te, s.tn, 0.3); d.point('FIND', s.e, s.n, s.z); d.line('FIND', s.te, s.tn, s.e, s.n); d.text('FIND', s.te + 0.4, s.tn + 0.4, th * 0.8, `${s.name} d=${(s.dist * 100).toFixed(1)}cm`); });
  S.areas.forEach(a => { const m = a.pts.length; for (let k = 0; k < m - 1 + (a.closed && m > 2 ? 1 : 0); k++) { const p = a.pts[k], q = a.pts[(k + 1) % m]; d.line('AREA', p.e, p.n, q.e, q.n); }
    a.pts.forEach((p, i) => d.text('AREA', p.e + 0.3, p.n + 0.3, th * 0.8, `${i + 1}`)); const r = areaStats(a);
    if (a.closed && r.centroid) d.text('AREA', r.centroid.e, r.centroid.n, th, `${a.name} A=${r.area.toFixed(2)}m2 P=${r.perimeter.toFixed(2)}m`); else if (m > 1) d.text('AREA', a.pts[0].e, a.pts[0].n + th, th, `${a.name} L=${r.length.toFixed(2)}m`); });
  return d.toString();
}
$('#xDxf').onclick = () => download('survey-' + stamp() + '.dxf', buildDxf(), 'application/dxf');
$('#xCsv').onclick = () => download('points-' + stamp() + '.csv', pointsCsv(), 'text/csv');
$('#xSheet').onclick = () => download('alignment-sheet-' + stamp() + '.csv', sheetCsv(), 'text/csv');
$('#xFind').onclick = () => download('find-results-' + stamp() + '.csv', findCsv(), 'text/csv');
$('#xArea').onclick = () => download('areas-' + stamp() + '.csv', areaCsv(), 'text/csv');
function buildPrint() {
  const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 900; const c = cv.getContext('2d'), o = { cn: 0, ce: 0, s: 1 }; fitTo(1400, 900, o); renderMap(c, 1400, 900, o, false);
  const tables = S.segs.map(g => { const info = GL.alignInfo(g.pts), K = kindOf(g);
    return `<div class="pb"><h2>${esc(g.name)} — ${g.kind === 'pipe' ? '관로' : '선형'} (${esc(g.pts[0].name || '시점')} → ${esc(g.pts[g.pts.length - 1].name || '종점')})</h2>
    <div>연장 ${f3(info.len)} m${info.dz != null ? ' · ΔZ ' + fSign(info.dz) + ' m · 경사 ' + fSign(info.grade, 2) + ' %' : ''} · 꼭짓점 ${info.count}${g.lat ? ' · 오프셋 ' + (g.lat > 0 ? '우' : '좌') + ' ' + Math.abs(g.lat) + ' m' : ''}${g.drop ? ' · ' + K.dz + ' = ' + K.z + ' − ' + g.drop : ''}</div>
    <table><tr><th class="l">측점</th><th>누가(m)</th><th>${K.z}</th><th>${K.dz}</th><th>현황 GL</th><th>${K.cut}(+)/${K.fill}(−)</th><th>종/횡 편차(cm)</th><th class="l">판정</th></tr>${stas(g).map(s => { const sh = S.shots[shotKey(g, s)];
      return `<tr><td class="l">${esc(s.name)}</td><td>${s.ch.toFixed(2)}</td><td>${f3(s.inv)}</td><td>${f3(s.z)}</td><td>${sh ? f3(sh.gl) : ''}</td><td>${sh && sh.depth != null ? fSign(sh.depth) : ''}</td><td>${sh && sh.dAlong != null ? (sh.dAlong * 100).toFixed(1) + ' / ' + (sh.dCross * 100).toFixed(1) : ''}</td><td class="l">${sh ? (sh.kind === 'CUT' ? K.cut : sh.kind === 'FILL' ? K.fill : sh.kind === 'OK' ? '계획고' : '높이없음') : ''}</td></tr>`; }).join('')}</table></div>`; }).join('');
  const finds = Object.values(S.pshots), findT = finds.length ? `<div class="pb"><h2>점 찾기 결과</h2><table><tr><th class="l">이름</th><th>설계 N</th><th>설계 E</th><th>ΔN(북)</th><th>ΔE(동)</th><th>수평편차</th><th>Δ높이</th></tr>${finds.map(s => `<tr><td class="l">${esc(s.name)}</td><td>${f3(s.tn)}</td><td>${f3(s.te)}</td><td>${fSign(s.dn)}</td><td>${fSign(s.de)}</td><td>${fLen(s.dist)}</td><td>${fSign(s.dz)}</td></tr>`).join('')}</table></div>` : '';
  const areaT = S.areas.length ? `<div class="pb"><h2>면적 · 둘레 · 연장</h2><table><tr><th class="l">이름</th><th>구분</th><th>꼭짓점</th><th>면적(㎡)</th><th>평</th><th>둘레/연장(m)</th></tr>${S.areas.map(a => { const r = areaStats(a); return `<tr><td class="l">${esc(a.name)}</td><td>${a.closed ? '닫힘' : '열림'}</td><td>${r.count}</td><td>${a.closed ? r.area.toFixed(2) : ''}</td><td>${a.closed ? r.pyeong.toFixed(1) : ''}</td><td>${(a.closed ? r.perimeter : r.length).toFixed(3)}</td></tr>`; }).join('')}</table></div>` : '';
  $('#printArea').innerHTML = `<h1>측량 성과표</h1><div>출력 ${new Date().toLocaleString('ko-KR')} · 좌표계 ${esc(GL.CRS[S.settings.crs].name)} · 안테나 ${S.settings.antH} m${S.settings.source === 'sim' ? ' · <b>※ 데모(가상) 데이터</b>' : ''}</div>${tables}${findT}${areaT}<img alt="평면도" src="${cv.toDataURL('image/png')}">`;
}
$('#xPrint').onclick = () => { buildPrint(); setTimeout(() => window.print(), 100); };

// ───────────── 음성 · 자연어 명령 (AI 보조) ─────────────
// 1) 로컬 규칙 해석(nlu.js, 오프라인) → 2) 해석 실패 시 LLM 보조(설정 시) → 모든 명령은 같은 검증·확인·실행취소 경로를 지난다.
// 데이터를 바꾸는 명령은 사용자 확인("예/아니오")을 받고, 모든 명령·결과는 기록(cmdlog)되어 해석 정확도 평가에 쓰인다.
S.settings.voiceGuide = !!S.settings.voiceGuide; S.settings.llm = Object.assign({ on: false, endpoint: 'https://api.anthropic.com', model: 'claude-opus-5-5', key: '' }, S.settings.llm);
S.settings.tts = Object.assign({ engine: 'browser', key: '', voice: '', voiceName: '', model: 'eleven_flash_v2_5', used: 0 }, S.settings.tts);
if (/^claude-haiku-4-5-\d+$/.test(S.settings.llm.model)) S.settings.llm.model = 'claude-haiku-4-5';          // 모델 ID 에는 날짜 접미사를 붙이지 않는다
S.settings.hf = Object.assign({ on: false, wake: '측량기, 측량기야, 측량이, 축량기' }, S.settings.hf);                           // 핸즈프리(호출어) 설정
let PENDING = null, LASTVIA = 'text', CMDLOG = [], cmdSaveT = null, REC = null;
const HF = { run: false, rec: null, armed: 0, speakUntil: 0, fails: 0, heard: 0, wake: 0, ignored: 0, timer: null, ctx: null };   // 핸즈프리 상태
const VG = { t: 0, last: '', arrived: false };
const gv = id => document.getElementById(id);
const nluCtx = () => ({ segs: S.segs.map(s => ({ id: s.id, name: s.name })), points: S.points.map(p => ({ id: p.id, name: p.name })) });
function say(msg, o) {
  gv('vInterp').textContent = msg;
  if (HF.run) HF.speakUntil = Date.now() + 600 + 130 * msg.length + (S.settings.tts.engine === 'eleven' ? 1200 : 0);   // 자기 안내 음성을 마이크가 다시 듣지 않게 그동안 무시
  if (!(o && o.force) && LASTVIA !== 'voice' && !S.settings.voiceGuide) return;
  const T = S.settings.tts;
  if (T.engine === 'eleven' && T.key && T.voice) { ttsSpeak(msg, o).catch(() => browserSpeak(msg, o)); return; }   // 캐시에 있으면 오프라인에서도 재생, 생성 실패·미캐시 오프라인이면 기본 음성
  browserSpeak(msg, o);
}
function browserSpeak(msg, o) {
  try { if (!window.speechSynthesis) return; if (o && o.interrupt) speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(msg); u.lang = 'ko-KR'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
}
// ── 고품질 음성(ElevenLabs). 문구 단위로 생성해 IndexedDB에 캐시 → 같은 문구는 오프라인·무료·즉시. 실패하면 기본 음성으로 대체.
// 무료 플랜은 월 크레딧이 작다(빠른 모델 0.5 크레딧/글자). 그래서 거리 안내는 5cm/0.1m 단위로 묶어 캐시 적중률을 높이고 쉼표 단위로 나눠 재생한다.
const TTSMEM = new Set(); let TTSCTX = null, TTSSRC = null, TTSSEQ = 0;
const ttsKey = p => 'tts:' + S.settings.tts.voice + ':' + S.settings.tts.model + ':' + p;
function ttsCtx() { if (!TTSCTX) TTSCTX = new (window.AudioContext || window.webkitAudioContext)(); if (TTSCTX.state === 'suspended') TTSCTX.resume().catch(() => {}); return TTSCTX; }
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { try { if (S.settings.tts.engine === 'eleven') ttsCtx(); } catch (e) {} }, { passive: true }));   // 자동재생 차단 해제
async function ttsFetch(text) {
  const T = S.settings.tts, f = window.__ttsFetch || fetch.bind(window);
  const r = await f('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(T.voice) + '?output_format=mp3_44100_64', { method: 'POST', headers: { 'xi-api-key': T.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: T.model || 'eleven_flash_v2_5' }) });
  if (!r.ok) { let d = ''; try { const j = await r.json(); d = (j.detail && (j.detail.message || j.detail.status || j.detail)) || ''; } catch (e) {} throw new Error('ElevenLabs ' + r.status + (d ? ' ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); }
  return r.arrayBuffer();
}
async function ttsClip(p) {                                    // 한 문구의 mp3 바이트(캐시 우선)
  const k = ttsKey(p); let b = await idb.get(k).catch(() => null);
  if (!b) { if (navigator.onLine === false) throw new Error('offline'); b = await ttsFetch(p); S.settings.tts.used += p.length; save(); idb.set(k, b).catch(() => {}); }
  TTSMEM.add(k); return b;
}
async function ttsSpeak(msg, o) {
  const parts = msg.split(', ').map(s => s.trim()).filter(Boolean).slice(0, 4);
  if (o && o.interrupt) ttsStop(); else if (TTSSRC) return;      // 안내가 겹치면 이전 안내가 끝날 때까지 새 안내를 건너뜀(interrupt 가 아닌 경우)
  const seq = ++TTSSEQ;
  const ctx = ttsCtx(), bufs = [];
  for (const p of parts) { const b = await ttsClip(p); if (seq !== TTSSEQ) return; bufs.push(await ctx.decodeAudioData(b.slice(0))); }
  if (seq !== TTSSEQ) return;
  let t = ctx.currentTime + 0.02; const srcs = [];
  for (const ab of bufs) { const s = ctx.createBufferSource(); s.buffer = ab; s.connect(ctx.destination); s.start(t); t += ab.duration + 0.12; srcs.push(s); }
  TTSSRC = srcs; srcs[srcs.length - 1].onended = () => { if (TTSSRC === srcs) TTSSRC = null; };
}
function ttsStop() { if (TTSSRC) { TTSSRC.forEach(s => { try { s.onended = null; s.stop(); } catch (e) {} }); TTSSRC = null; } try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {} }
const spLen = v => { v = Math.abs(v); return v < 1 ? (Math.round(v * 20) * 5 || 5) + ' 센티' : v.toFixed(1) + ' 미터'; };
const bad = (msg) => ({ ok: false, msg });
const ACTIONS = {
  undo: { risk: 'safe', run() { if (!UNDO.length) return bad('되돌릴 작업이 없습니다'); const l = UNDO[UNDO.length - 1].label; undo(); return { ok: true, msg: l + ' 되돌렸습니다' }; } },
  go_tab: { risk: 'safe', run(a) { if (!a.tab) return bad('화면을 알 수 없습니다'); go(a.tab); return { ok: true, msg: '이동했습니다' }; } },
  set_mode: { risk: 'safe', run(a) { S.stakeMode = a.mode === 'pt' ? 'pt' : 'line'; save(); go('stake'); return { ok: true, msg: (S.stakeMode === 'pt' ? '점' : '선형') + ' 찾기 모드입니다' }; } },
  step: { risk: 'safe', run(a) { step(a.d > 0 ? 1 : -1); const t = curTarget(); return t ? { ok: true, msg: t.name } : bad('목표가 없습니다'); } },
  goto_point: { risk: 'safe', run(a) {
    if (!a.id) return bad(a.ambiguous ? '여러 개입니다: ' + a.ambiguous.slice(0, 4).join(', ') : `'${a.name}' 점을 찾지 못했습니다`);
    const p = S.points.find(x => x.id === a.id); if (!p) return bad('점이 없습니다');
    S.ptTarget = { id: p.id, name: p.name, n: p.n, e: p.e, z: p.z }; S.stakeMode = 'pt'; save(); go('stake'); return { ok: true, msg: p.name + ' 찾기를 시작합니다' }; } },
  goto_coord: { risk: 'safe', run(a) {
    if (![a.n, a.e].every(isFinite) || a.n < 100 || a.e < 100) return bad('좌표가 올바르지 않습니다');
    S.ptTarget = { name: '입력점', n: a.n, e: a.e, z: null }; S.stakeMode = 'pt'; save(); go('stake'); return { ok: true, msg: '입력한 좌표를 찾습니다' }; } },
  goto_station: { risk: 'safe', run(a) {
    const sg = seg(); if (!sg) return bad('선형이 없습니다'); const ss = stas(sg); if (!ss.length) return bad('측점이 없습니다'); let i;
    if (a.which === 'first') i = 0; else if (a.which === 'last') i = ss.length - 1;
    else { let best = 0, bd = 1e18; ss.forEach((s, k) => { const d = Math.abs(s.ch - a.ch); if (d < bd) { bd = d; best = k; } });
      if (bd > Math.max(0.5, (+sg.interval || 5) / 2)) return bad(`누가거리 ${a.ch} 에 해당하는 측점이 없습니다 (가장 가까운 ${ss[best].name}, 누가 ${ss[best].ch.toFixed(1)})`); i = best; }
    S.curSta = i; S.stakeMode = 'line'; save(); go('stake'); return { ok: true, msg: ss[i].name + ' 측점입니다' }; } },
  select_seg: { risk: 'safe', run(a) {
    if (!a.id) return bad(a.ambiguous ? '여러 개입니다: ' + a.ambiguous.slice(0, 4).join(', ') : `'${a.name}' 선형을 찾지 못했습니다`);
    S.curSeg = a.id; S.curSta = 0; S.stakeMode = 'line'; save(); go('stake'); return { ok: true, msg: seg().name + ' 선택' }; } },
  shot: { risk: 'confirm', run() { if (!curTarget()) return bad('목표가 없습니다'); go('stake'); gv('btnShot').click(); return { ok: true, msg: '측정을 시작합니다' }; } },
  point_save: { risk: 'confirm', run(a) { if (!L) return bad('위치 수신 없음'); if (a.name) gv('ptName').value = a.name; gv('btnPt').click(); return { ok: true, msg: '점 측량을 시작합니다' }; } },
  area_new: { risk: 'safe', run() { newArea(); renderAreas(); return { ok: true, msg: '새 면적을 만들었습니다' }; } },
  area_add: { risk: 'confirm', run() { if (!L) return bad('위치 수신 없음'); gv('areaMeasure').click(); return { ok: true, msg: '면적 꼭짓점을 측정합니다' }; } },
  log: { risk: 'safe', run(a) { if (a.on) { logStart(); return { ok: true, msg: '연속 기록을 시작합니다' }; } if (!LOG.sid) return bad('기록 중이 아닙니다'); logStop(true); return { ok: true, msg: '기록을 종료합니다' }; } },
  set_env: { risk: 'safe', run(a) { if (!a.env) return bad('현장 유형을 알 수 없습니다'); S.settings.env = a.env; save(); renderLog(); return { ok: true, msg: '현장 유형: ' + a.env }; } },
  gt_measure: { risk: 'confirm', extra() { renderLog(); const k = knownPoints()[+gv('gtKnown').value]; return k ? ' — 기준: ' + k.label : ''; },
    run() { renderLog(); if (!knownPoints()[+gv('gtKnown').value]) return bad('정답점이 없습니다'); gv('gtMeasure').click(); return { ok: true, msg: '정답점을 측정합니다' }; } },
  set_offset: { risk: 'confirm', run(a) { const sg = seg(); if (!sg || !isFinite(a.lat) || Math.abs(a.lat) > 100) return bad('오프셋을 설정할 수 없습니다'); sg.lat = a.lat; save(); buildStake(); return { ok: true, msg: a.lat ? `오프셋 ${a.lat > 0 ? '우측' : '좌측'} ${Math.abs(a.lat)} 미터` : '오프셋을 해제했습니다' }; } },
  set_interval: { risk: 'confirm', run(a) { const sg = seg(); if (!sg || !(a.interval > 0 && a.interval <= 1000)) return bad('측점 간격이 올바르지 않습니다'); sg.interval = a.interval; save(); buildStake(); return { ok: true, msg: `측점 간격 ${a.interval} 미터` }; } },
  set_antenna: { risk: 'confirm', run(a) { if (!(a.antH > 0 && a.antH < 5)) return bad('안테나 높이가 올바르지 않습니다'); S.settings.antH = a.antH; save(); renderSettings(); return { ok: true, msg: `안테나 높이 ${a.antH} 미터` }; } },
  set_tol: { risk: 'confirm', run(a) { if (!(a.tol > 0 && a.tol < 1)) return bad('허용 오차가 올바르지 않습니다'); S.settings.tol = a.tol; save(); renderSettings(); return { ok: true, msg: `허용 오차 ${(a.tol * 100).toFixed(1)} 센티` }; } },
  set_avg: { risk: 'confirm', run(a) { if (!(a.sec >= 1 && a.sec <= 60)) return bad('평균 시간은 1~60초'); S.settings.avgSec = a.sec; save(); renderSettings(); return { ok: true, msg: `평균 시간 ${a.sec} 초` }; } },
  voice_guide: { risk: 'safe', run(a) { S.settings.voiceGuide = !!a.on; save(); gv('vGuide').checked = !!a.on; VG.last = ''; return { ok: true, msg: a.on ? '음성 안내를 켰습니다' : '음성 안내를 껐습니다' }; } },
  speak_status: { risk: 'safe', run(a) {
    if (a.kind === 'area') { const ar = areaCur(); if (!ar) return bad('면적이 없습니다'); const r = areaStats(ar); return { ok: true, msg: ar.closed ? `면적 ${r.area.toFixed(1)} 제곱미터, 둘레 ${r.perimeter.toFixed(1)} 미터` : `연장 ${r.length.toFixed(1)} 미터` }; }
    if (!L) return bad('위치 수신이 없습니다');
    if (a.kind === 'distance') { const t = curTarget(); if (!t) return bad('목표가 없습니다'); const g = GL.guide(L.site, t, t.az), pt = t.mode === 'pt';
      return { ok: true, msg: `${t.name}까지 ${spLen(g.dist)}. ${pt ? (g.fwd >= 0 ? '북 ' : '남 ') + spLen(g.fwd) + ', ' + (g.right >= 0 ? '동 ' : '서 ') + spLen(g.right) : (g.fwd >= 0 ? '전진 ' : '후진 ') + spLen(g.fwd) + ', ' + (g.right >= 0 ? '우측 ' : '좌측 ') + spLen(g.right)}` }; }
    return { ok: true, msg: `${L.fix}, 위성 ${L.sats == null ? '정보 없음' : L.sats + '개'}${L.sdH != null ? ', 수평 정밀도 ' + (L.sdH * 100).toFixed(1) + ' 센티' : ''}${L.tilt && !L.tilt.missing ? ', 기울기 ' + L.tilt.theta.toFixed(1) + '도' : ''}` }; } },
};
function cmdFinish(rec) {
  CMDLOG.push(rec); if (CMDLOG.length > 2000) CMDLOG.shift(); clearTimeout(cmdSaveT); cmdSaveT = setTimeout(() => idb.set('cmdlog', CMDLOG).catch(() => {}), 800);
  const h = gv('vHist'); h.innerHTML = CMDLOG.slice(-5).reverse().map(r => `<div class="${r.ok === false ? 'bad' : ''}">${r.ok === false ? '✖' : r.ok === null ? '…' : '✔'} “${esc(r.text)}” → ${esc(r.summary || r.intent || '해석 실패')}${r.msg ? ' · ' + esc(r.msg) : ''} <small>[${r.src}]</small></div>`).join('');
}
function showConfirm(sum) { gv('vConfirm').hidden = false; gv('vInterp').textContent = sum + ' — 실행할까요?'; }
function hideConfirm() { gv('vConfirm').hidden = true; PENDING = null; }
async function execute(cmd, confirmed) {
  const A = ACTIONS[cmd.intent], rec = { t: new Date().toISOString(), text: cmd.text, intent: cmd.intent, args: cmd.args, conf: cmd.conf, src: cmd.src || 'local', via: LASTVIA, summary: NLU.summarize(cmd), llm: cmd.llm || null };
  if (!A) { say('지원하지 않는 명령입니다'); rec.ok = false; return cmdFinish(rec); }
  if (A.risk === 'confirm' && !confirmed) {
    PENDING = cmd; const sum = NLU.summarize(cmd) + (A.extra ? A.extra(cmd.args) : ''); showConfirm(sum); say(sum + '. 실행할까요? 예 또는 아니오로 말씀하세요', { force: LASTVIA === 'voice', interrupt: true }); rec.ok = null; rec.pending = true; return cmdFinish(rec);
  }
  let r; try { r = await A.run(cmd.args || {}); } catch (e) { r = bad('오류: ' + e.message); }
  rec.ok = r.ok; rec.msg = r.msg; if (confirmed) rec.confirmed = true; say(r.msg, { interrupt: true }); cmdFinish(rec);
}
async function handleUtterance(text, via) {
  if (via) LASTVIA = via; text = String(text || '').trim(); if (!text) return; gv('vTranscript').textContent = '“' + text + '”';
  if (PENDING) {
    const yn = NLU.parseYesNo(text), c = PENDING;
    if (yn === 'yes') { hideConfirm(); return execute(c, true); }
    if (yn === 'no') { hideConfirm(); say('취소했습니다'); return cmdFinish({ t: new Date().toISOString(), text, intent: c.intent, ok: false, msg: '사용자 취소', src: c.src || 'local', via: LASTVIA, summary: NLU.summarize(c) }); }
    hideConfirm();                                                  // 다른 말을 하면 대기 중이던 명령은 폐기하고 새 명령으로 처리
  }
  let cmd = NLU.parseCommand(text, nluCtx()), src = 'local', spoke = false;
  if (!cmd && llmReady()) {
    gv('vInterp').textContent = 'AI가 해석하는 중…';
    try { cmd = await llmInterpret(text); src = 'llm'; spoke = !cmd && gv('vInterp').textContent !== 'AI가 해석하는 중…'; }   // ask_user/설명문은 llmInterpret가 이미 말함
    catch (e) { say('AI 해석 실패: ' + (e && e.message || e)); spoke = true; }
  }
  if (!cmd) { if (!spoke) say('이해하지 못했습니다. 예: “P1 찾아줘”, “다음 측점”, “확정”'); return cmdFinish({ t: new Date().toISOString(), text, ok: false, msg: spoke ? 'AI 응답 없음/질문' : '해석 실패', src: src === 'llm' || spoke ? 'llm' : 'local', via: LASTVIA }); }
  cmd.src = src; return execute(cmd, false);
}
// LLM 보조 해석: 로컬 규칙이 못 알아들은 발화만 Anthropic Messages API(공식 SDK, 로컬 번들)로 보낸다.
// 보내는 것: 발화 + 점/선형 "이름" 목록 + 현재 모드. 좌표·측정값·키 외 개인 데이터는 보내지 않는다. 결과는 도구 호출 하나이며 앱이 다시 검증한다.
if (/\/v1\/messages\/?$/.test(S.settings.llm.endpoint || '')) S.settings.llm.endpoint = S.settings.llm.endpoint.replace(/\/v1\/messages\/?$/, '');
let LLMC = null;
function llmReady() { const c = S.settings.llm; return !!(c.on && c.key && navigator.onLine !== false); }
function llmLoadSdk() {
  if (window.AnthropicSDK) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/anthropic.bundle.js?v=7'; s.onload = res; s.onerror = () => rej(new Error('AI 모듈 로드 실패(오프라인?)')); document.head.appendChild(s); });
}
async function llmClient() {
  await llmLoadSdk(); const c = S.settings.llm;
  if (!LLMC || LLMC._k !== c.key || LLMC._u !== c.endpoint) {
    const opts = { apiKey: c.key, baseURL: c.endpoint || 'https://api.anthropic.com', dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 20000 };   // 키는 이 기기 브라우저에만 저장(개인용). 판매 제품은 중계 서버 사용
    if (window.__llmFetch) opts.fetch = window.__llmFetch;                                                                                                      // 테스트용 주입 지점
    LLMC = new window.AnthropicSDK(opts); LLMC._k = c.key; LLMC._u = c.endpoint;
  }
  return LLMC;
}
async function llmInterpret(text) {
  const c = await llmClient(), ctx = nluCtx(), params = { model: S.settings.llm.model || 'claude-opus-5-5', max_tokens: 1024, output_config: { effort: 'low' }, system: NLU.SYSTEM_PROMPT,
    tools: NLU.LLM_TOOLS.map(t => Object.assign({}, t, { strict: true })), tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: NLU.buildUserContent(text, ctx, { mode: S.stakeMode, hasTarget: !!curTarget() }) }] };
  let resp;
  try { resp = await c.beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, params)); }       // 안전 분류기 거절 시 서버가 다른 모델로 재시도
  catch (e) { if (e && e.status === 400) resp = await c.messages.create(params); else throw e; }                                                         // 폴백 파라미터를 못 받는 환경이면 일반 호출로 1회 재시도
  if (resp.stop_reason === 'refusal') throw new Error('AI가 요청을 거부했습니다');
  const block = (resp.content || []).find(b => b.type === 'tool_use');
  if (!block) { const tx = (resp.content || []).find(b => b.type === 'text'); if (tx && tx.text) say(tx.text.slice(0, 120)); return null; }
  const r = NLU.toolToCommand(block, ctx); if (!r) return null; if (r.ask) { say(r.ask); return null; }
  r.text = text; r.llm = { model: resp.model || params.model, tool: block.name, tin: resp.usage && resp.usage.input_tokens, tout: resp.usage && resp.usage.output_tokens }; return r;
}
async function llmTest() {
  const el = gv('llmStat'); el.textContent = '시험 중…';
  try { const t0 = Date.now(); const r = await llmInterpret('다음 측점으로 가줘'); el.textContent = r ? `연결 성공 (${((Date.now() - t0) / 1000).toFixed(1)}초) — 해석: ${NLU.summarize(r)} · 모델 ${r.llm.model} · 토큰 ${r.llm.tin}/${r.llm.tout}` : '연결됨, 그러나 명령으로 해석하지 못했습니다'; }
  catch (e) { el.textContent = '실패: ' + (e && e.message || e); }
}

// 음성 안내: 찾기 화면에서 화면을 보지 않고 목표까지 이동 (2.5초 이상 간격, 같은 말 반복 억제, 도착 시 1회 알림)
function voiceGuide(g, t, tol) {
  if (!S.settings.voiceGuide || tab !== 'stake') return; const now = Date.now(); if (now - VG.t < 2500) return;
  if (g.dist <= tol) { if (!VG.arrived) { VG.arrived = true; VG.t = now; VG.last = ''; say('도착. 허용 오차 이내입니다', { force: true, interrupt: true }); } return; }
  VG.arrived = false; const pt = t.mode === 'pt';
  const parts = []; if (Math.abs(g.fwd) >= tol) parts.push((pt ? (g.fwd >= 0 ? '북 ' : '남 ') : (g.fwd >= 0 ? '전진 ' : '후진 ')) + spLen(g.fwd));
  if (Math.abs(g.right) >= tol) parts.push((pt ? (g.right >= 0 ? '동 ' : '서 ') : (g.right >= 0 ? '우측 ' : '좌측 ')) + spLen(g.right));
  const text = parts.join(', '); if (!text) return;
  if (text !== VG.last || now - VG.t > 7000) { VG.last = text; VG.t = now; say(text, { force: true, interrupt: true }); }
}

// 음성 인식 (Web Speech API — Android Chrome. 오디오는 브라우저 제공 서비스로 전송됨)
function setMic(on) { gv('micBtn').classList.toggle('on', on); gv('vMic').textContent = on ? '■' : '🎤'; }
// ── 핸즈프리(호출어) 모드 [실험]: 상시 듣기 + 호출어("측량기") 뒤의 말만 명령으로 처리. 호출어 없이 들린 말은 버린다(확인 대기 중의 예/아니오만 예외).
// Web Speech API 상시 인식이라 안드로이드 Chrome 에서는 인식이 수시로 끊겨 다시 시작하고 시작음이 날 수 있다. 화면이 켜진 앱 전면에서만 동작하며 오디오는 클라우드로 전송된다.
const HF_PUNCT = /[\s.,!?·~"'“”‘’]/;
const hfNorm = s => s.split('').filter(c => !HF_PUNCT.test(c)).join('');
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function hfFindWake(s) {                                     // 호출어가 들어 있으면 {rest: 호출어 뒤 문장}, 없으면 null
  const n = hfNorm(s); let best = null;
  for (const w0 of S.settings.hf.wake.split(',')) {
    const w = hfNorm(w0); if (!w) continue; let idx = n.indexOf(w), end = idx + w.length;
    if (idx < 0 && w.length >= 4) { for (let i = 0; i + w.length - 1 <= n.length && idx < 0; i++) for (const L of [w.length - 1, w.length, w.length + 1]) { if (i + L <= n.length && lev(n.slice(i, i + L), w) <= 1) { idx = i; end = i + L; break; } } }   // 4글자 이상이면 한 글자 오인식 허용
    if (idx >= 0 && (!best || idx < best.idx || (idx === best.idx && end > best.end))) best = { idx, end };     // 같은 위치면 더 긴 호출어("측량기야")를 우선
  }
  if (!best) return null;
  let cnt = 0, pos = 0; for (; pos < s.length && cnt < best.end; pos++) if (!HF_PUNCT.test(s[pos])) cnt++;     // 정규화 위치 → 원문 위치
  return { rest: s.slice(pos).replace(/^[\s,.!?]+/, '').trim() };
}
function hfBeep(f, ms) { try { HF.ctx = HF.ctx || new (window.AudioContext || window.webkitAudioContext)(); if (HF.ctx.state === 'suspended') HF.ctx.resume(); const o = HF.ctx.createOscillator(), g = HF.ctx.createGain(); o.frequency.value = f; g.gain.value = 0.08; o.connect(g); g.connect(HF.ctx.destination); o.start(); o.stop(HF.ctx.currentTime + ms / 1000); } catch (e) {} }
function hfUi() {
  gv('micBtn').classList.toggle('hf', HF.run); gv('micBtn').classList.toggle('hfoff', S.settings.hf.on && !HF.run);
  gv('vHF').checked = S.settings.hf.on; const w = S.settings.hf.wake.split(',')[0].trim();
  gv('vHFStat').textContent = HF.run ? `● 핸즈프리 대기 — “${w}”라고 부른 뒤 명령 · 들은 말 ${HF.heard} · 호출 ${HF.wake} · 무시 ${HF.ignored}` : (S.settings.hf.on ? '핸즈프리가 꺼져 있습니다 — 🎤를 누르면 켜집니다' : '핸즈프리 꺼짐');
}
function hfOnFinal(alts) {
  const now = Date.now(); HF.heard++;
  if (now < HF.speakUntil) { HF.ignored++; return; }          // 자기 안내 음성
  let w = null; for (const a of alts) { w = hfFindWake(a); if (w) break; }
  if (w) {
    HF.wake++; hfBeep(880, 110);
    if (w.rest.length >= 2) { HF.armed = 0; gv('vTranscript').textContent = '“' + w.rest + '”'; handleUtterance(w.rest, 'voice'); }
    else { HF.armed = now + 6000; gv('vTranscript').textContent = '듣는 중… 명령을 말하세요'; }     // 호출어만 말했으면 다음 한 마디를 명령으로
    return;
  }
  if (HF.armed && now < HF.armed) { HF.armed = 0; const ok = alts.find(a => NLU.parseCommand(a, nluCtx()) || (PENDING && NLU.parseYesNo(a))); gv('vTranscript').textContent = '“' + (ok || alts[0]) + '”'; handleUtterance(ok || alts[0], 'voice'); return; }
  if (PENDING) { const yn = alts.find(a => NLU.parseYesNo(a)); if (yn) { gv('vTranscript').textContent = '“' + yn + '”'; handleUtterance(yn, 'voice'); return; } }   // 확인 대기 중의 예/아니오는 호출어 없이 허용
  HF.ignored++;
}
function hfSpawn(SR) {
  if (!HF.run) return;
  try {
    const r = new SR(); r.lang = 'ko-KR'; r.continuous = true; r.interimResults = false; r.maxAlternatives = 3;
    r.onresult = e => { HF.fails = 0; for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (!res.isFinal) continue; const alts = []; for (let k = 0; k < res.length; k++) alts.push(res[k].transcript.trim()); hfOnFinal(alts); } hfUi(); };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { hfStop(true); toast('마이크 권한이 필요합니다 — 브라우저 사이트 설정에서 허용하세요'); } else if (e.error === 'audio-capture') { hfStop(true); toast('마이크를 사용할 수 없습니다'); } else if (e.error !== 'no-speech' && e.error !== 'aborted') HF.fails++; };
    r.onend = () => { HF.rec = null; if (!HF.run || document.hidden) return; HF.timer = setTimeout(() => hfSpawn(SR), Math.min(10000, 250 * Math.pow(2, Math.min(HF.fails, 5)))); };     // 끊기면 다시 시작(연속 실패는 간격을 늘림)
    HF.rec = r; r.start();
  } catch (e) { HF.fails++; HF.timer = setTimeout(() => hfSpawn(SR), 1500); }
}
function hfStart() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('이 브라우저는 음성 인식을 지원하지 않습니다'); return false; }
  if (HF.run) return true;
  HF.run = true; HF.fails = 0; hfSpawn(SR); hfUi(); return true;
}
function hfStop(off) { HF.run = false; clearTimeout(HF.timer); try { HF.rec && HF.rec.abort(); } catch (e) {} HF.rec = null; if (off) { S.settings.hf.on = false; save(); } hfUi(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && HF.run && !HF.rec) { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (SR) hfSpawn(SR); } });   // 앱이 다시 앞으로 오면 재개
function startListen() {
  if (HF.run) { HF.armed = Date.now() + 6000; hfBeep(880, 110); gv('vTranscript').textContent = '듣는 중… 명령을 말하세요'; return; }      // 핸즈프리 중에는 새 인식기를 만들지 않고 "지금 말하기"로 동작
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('이 브라우저는 음성 인식을 지원하지 않습니다 — 아래에 입력하세요'); return; }
  if (REC) { try { REC.stop(); } catch (e) {} return; }
  try {
    REC = new SR(); REC.lang = 'ko-KR'; REC.interimResults = true; REC.maxAlternatives = 3; REC.continuous = false;
    REC.onresult = e => { let txt = '', fin = null; for (const r of e.results) { txt += r[0].transcript; if (r.isFinal) fin = r; }
      gv('vTranscript').textContent = '“' + txt + '”';
      if (fin) { const alts = []; for (let k = 0; k < fin.length; k++) alts.push(fin[k].transcript.trim()); const ok = alts.find(a => NLU.parseCommand(a, nluCtx()) || (PENDING && NLU.parseYesNo(a))); handleUtterance(ok || alts[0], 'voice'); } };
    REC.onerror = e => { setMic(false); REC = null; toast('음성 인식 오류: ' + e.error); };
    REC.onend = () => { setMic(false); REC = null; };
    REC.start(); setMic(true); LASTVIA = 'voice';
  } catch (e) { REC = null; toast('음성 인식을 시작할 수 없습니다: ' + e.message); }
}
function openSheet(listen) { gv('vsheet').hidden = false; gv('vGuide').checked = S.settings.voiceGuide; if (listen) startListen(); }
gv('micBtn').onclick = () => {
  if (S.settings.hf.on && !HF.run) { hfBeep(660, 80); hfStart(); gv('vsheet').hidden = false; return; }      // 핸즈프리를 켜 둔 상태에서 앱을 다시 열면 🎤 한 번으로 재개(브라우저 정책상 사용자 터치 필요)
  if (gv('vsheet').hidden) openSheet(!HF.run); else if (REC) startListen(); else openSheet(!HF.run);
};
gv('vHF').onchange = e => { S.settings.hf.on = e.target.checked; save(); if (e.target.checked) { hfBeep(660, 80); hfStart(); } else hfStop(false); hfUi(); };
gv('vWake').value = S.settings.hf.wake; gv('vWake').onchange = e => { S.settings.hf.wake = e.target.value.trim() || '측량기, 측량기야, 측량이, 축량기'; e.target.value = S.settings.hf.wake; save(); hfUi(); };
hfUi();
gv('vClose').onclick = () => { gv('vsheet').hidden = true; if (REC) { try { REC.stop(); } catch (e) {} } hideConfirm(); };
gv('vMic').onclick = startListen;
gv('vSend').onclick = () => { const v = gv('vText').value; gv('vText').value = ''; handleUtterance(v, 'text'); };
gv('vText').addEventListener('keydown', e => { if (e.key === 'Enter') gv('vSend').click(); });
gv('vYes').onclick = () => handleUtterance('예', LASTVIA); gv('vNo').onclick = () => handleUtterance('아니요', LASTVIA);
gv('vGuide').onchange = e => { S.settings.voiceGuide = e.target.checked; save(); VG.last = ''; };
// 설정 ▸ AI 보조 해석
function renderLlm() {
  const c = S.settings.llm; gv('llmOn').checked = !!c.on; gv('llmKey').value = c.key || ''; gv('llmModel').value = c.model || ''; gv('llmUrl').value = c.endpoint || '';
}
gv('llmOn').onchange = e => { S.settings.llm.on = e.target.checked; save(); };
gv('llmKey').onchange = e => { S.settings.llm.key = e.target.value.trim(); LLMC = null; save(); };
gv('llmModel').onchange = e => { S.settings.llm.model = e.target.value.trim() || 'claude-opus-5-5'; save(); };
gv('llmUrl').onchange = e => { S.settings.llm.endpoint = e.target.value.trim() || 'https://api.anthropic.com'; LLMC = null; save(); };
gv('llmTest').onclick = llmTest;
// 설정 ▸ 안내 음성
const TTS_PRE = ['도착. 허용 오차 이내입니다', '취소했습니다', '확정했습니다', '실행할까요? 예 또는 아니오로 말씀하세요', '이해하지 못했습니다. 다시 말씀해 주세요', '다음 측점입니다', '이전 측점입니다', '전진', '후진', '우측', '좌측', '북', '남', '동', '서'];
function ttsStat(t) { gv('ttsStat').textContent = t; }
function renderTts() {
  const T = S.settings.tts; gv('ttsEngine').value = T.engine; gv('ttsModel').value = T.model; gv('ttsKey').value = T.key || ''; gv('ttsVoiceId').value = T.voice || '';
  const sel = gv('ttsVoice'); if (T.voice && !Array.from(sel.options).some(o => o.value === T.voice)) { sel.add(new Option(T.voiceName || T.voice, T.voice)); } sel.value = T.voice || '';
  ttsStat('이번 달 생성한 글자 수(이 폰 기준): ' + (T.used || 0) + ' · 무료 플랜 크레딧은 ElevenLabs 사이트에서 확인');
}
gv('ttsEngine').onchange = e => { S.settings.tts.engine = e.target.value; save(); if (e.target.value === 'eleven') try { ttsCtx(); } catch (x) {} };
gv('ttsModel').onchange = e => { S.settings.tts.model = e.target.value; save(); };
gv('ttsKey').onchange = e => { S.settings.tts.key = e.target.value.trim(); save(); };
gv('ttsVoice').onchange = e => { const o = e.target.selectedOptions[0]; S.settings.tts.voice = e.target.value; S.settings.tts.voiceName = o ? o.textContent : ''; gv('ttsVoiceId').value = e.target.value; save(); };
gv('ttsVoiceId').onchange = e => { S.settings.tts.voice = e.target.value.trim(); S.settings.tts.voiceName = ''; save(); };
gv('ttsLoad').onclick = async () => {
  const T = S.settings.tts; if (!T.key) { ttsStat('먼저 API 키를 입력하세요'); return; }
  ttsStat('목소리 목록을 가져오는 중…');
  try {
    const f = window.__ttsFetch || fetch.bind(window), r = await f('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': T.key } });
    if (!r.ok) throw new Error('ElevenLabs ' + r.status);
    const j = await r.json(), sel = gv('ttsVoice'); sel.innerHTML = '<option value="">(선택)</option>';
    (j.voices || []).forEach(v => { const lb = v.labels || {}, tag = [v.category, lb.gender, lb.accent].filter(Boolean).join('·'); sel.add(new Option(v.name + (tag ? ' (' + tag + ')' : ''), v.voice_id)); });
    if (T.voice) sel.value = T.voice; ttsStat((j.voices || []).length + '개 목소리. 고른 뒤 "시험 재생"을 누르세요');
  } catch (e) { ttsStat('실패: ' + (e && e.message || e)); }
};
gv('ttsTest').onclick = async () => {
  const T = S.settings.tts; if (!T.key || !T.voice) { ttsStat('API 키와 목소리를 먼저 지정하세요'); return; }
  ttsStat('생성·재생 중…');
  try { await ttsSpeak('전진 3.2 미터, 우측 20 센티', { interrupt: true }); ttsStat('재생했습니다' + (T.engine === 'eleven' ? '' : ' (실제 안내에 쓰려면 위 "음성 엔진"을 ElevenLabs로 선택하세요)') + ' · 생성한 글자 ' + T.used); }
  catch (e) { ttsStat('실패: ' + (e && e.message || e) + (/402|paid/i.test(String(e && e.message)) ? ' — 무료 플랜에서는 이 목소리를 API로 못 쓸 수 있습니다. 다른 목소리를 고르세요' : '')); }
};
gv('ttsPre').onclick = async () => {
  const T = S.settings.tts; if (!T.key || !T.voice) { ttsStat('API 키와 목소리를 먼저 지정하세요'); return; }
  let n = 0, chars = 0; for (const p of TTS_PRE) { try { const had = await idb.get(ttsKey(p)).catch(() => null); await ttsClip(p); if (!had) { n++; chars += p.length; } ttsStat('미리 만드는 중… ' + (n) + '/' + TTS_PRE.length); } catch (e) { ttsStat('중단: ' + (e && e.message || e)); return; } }
  save(); ttsStat('새로 ' + n + '개(' + chars + '자) 저장. 나머지는 이미 저장돼 있었습니다');
};
gv('ttsClear').onclick = async () => {
  try { const db = await idb.open(); await new Promise((res, rej) => { const os = db.transaction('kv', 'readwrite').objectStore('kv'), q = os.openCursor(); q.onsuccess = () => { const c = q.result; if (!c) return res(); if (String(c.key).startsWith('tts:')) c.delete(); c.continue(); }; q.onerror = () => rej(q.error); }); TTSMEM.clear(); ttsStat('저장된 음성을 지웠습니다'); } catch (e) { ttsStat('실패: ' + e.message); }
};
idb.get('cmdlog').then(a => { if (Array.isArray(a)) CMDLOG = a.concat(CMDLOG); }).catch(() => {});

// ───────────── 루프 / 초기화 ─────────────
function render() { dirty = false; updateTop(); if (tab === 'stake') updateStake(); else if (tab === 'map') drawMap(); else if (tab === 'settings') renderLogLive(); }
function frame() { if (dirty) render(); requestAnimationFrame(frame); }
setInterval(() => { if (L) dirty = true; }, 1000);
window.addEventListener('resize', () => { dirty = true; });
document.addEventListener('visibilitychange', async () => { try { if (document.visibilityState === 'visible' && navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) {} });
try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

$('#fsReset').onclick = () => { fsReset(); dirty = true; };
$('#diagCopy').onclick = async () => {
  const t = diagReport();
  try { await navigator.clipboard.writeText(t); toast('진단 내용을 복사했습니다'); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('진단 내용을 복사했습니다'); } catch (x) { toast('복사 실패 — 화면을 캡처하세요'); } ta.remove(); }
};
$('#diagShare').onclick = () => { if (navigator.share) navigator.share({ title: '간이측량기 진단', text: diagReport() }).catch(() => {}); else toast('이 브라우저는 공유를 지원하지 않습니다 — 복사를 쓰세요'); };
window.__gl = { DG, dgStats, diagReport, HF, hfOnFinal, hfFindWake, hfStart, hfStop, FS, fsFeed, fsText, fsReset, say, ttsSpeak, ttsClip, ttsKey, handleUtterance, execute, ACTIONS, CMDLOG: () => CMDLOG, nluCtx, PENDING: () => PENDING, logStart, logStop, logFlush, logExport, logRead, SKY, skySnapshot, skyFeatures, logShot, shotCsv, SHOTLOG: () => SHOTLOG, LOGSID: () => LOG.sid, undo, UNDO, V, PICK: () => PICK, simTick, DXFD: () => DXFD, areaStats, findCsv, areaCsv, curTarget, stas, kindOf, shotKey, pickAt, showPick, render, IMU: () => IMU, levelCal, yawCal, computeRaw, S: () => S, L: () => L, SIM, sample, onEpoch, go, buildPrint, buildDxf, sheetCsv, pointsCsv, CAL: () => CAL, handleNmea };
idb.get('dxf').then(d => { if (d && S.dxf && S.dxf.name) { DXFD = d; dirty = true; renderLayers(); dxfInfoUpdate(); } }).catch(() => {});
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}   // 저장공간 부족 시 브라우저가 앱 데이터를 지우지 않도록 요청(설치된 앱은 보통 허용)
if (NATIVE && !S.settings.nativeInit) { S.settings.nativeInit = true; S.settings.source = 'native'; save(); }   // Android 앱 첫 실행 시 내장 USB 를 기본 소스로
startSource(); buildStake(); renderAreas(); requestAnimationFrame(frame);
loadShotLog(); lastSig = dataSig(); refreshUndoBtn(); $('#undoGo').onclick = undo; $('#undoBtn').onclick = undo;
})();
