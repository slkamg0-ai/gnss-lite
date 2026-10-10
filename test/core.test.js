// node test/core.test.js  — core.js 검증 (proj4 를 기준값으로 사용)
const assert = require('assert');
const proj4 = require('proj4');
const GL = require('../core.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (tol ${tol})`);

// ── 1. 좌표변환: proj4 대조 ──
const DEFS = {
  'EPSG:5186': '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5185': '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5187': '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5179': '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs',
  'EPSG:5174': '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs',
};
const SITES = [[37.19, 126.75], [37.5665, 126.978], [35.1796, 129.0756], [33.4996, 126.5312], [36.35, 127.385]];
for (const id of Object.keys(DEFS)) {
  t(`${id} forward == proj4 (<1mm, 5개 지점)`, () => {
    for (const [lat, lon] of SITES) {
      const ref = proj4('EPSG:4326', DEFS[id], [lon, lat]);
      const my = GL.toProjected(id, lat, lon);
      near(my.e, ref[0], 0.001, `${id} E@${lat},${lon}`); near(my.n, ref[1], 0.001, `${id} N@${lat},${lon}`);
    }
  });
  t(`${id} inverse round-trip (TM <0.5mm, Bessel 데이텀 이동은 높이 무시로 <5mm)`, () => {
    for (const [lat, lon] of SITES) {
      const p = GL.toProjected(id, lat, lon), q = GL.fromProjected(id, p.e, p.n);
      const r2 = GL.toProjected(id, q.lat, q.lon);
      const tol = id === 'EPSG:5174' ? 5e-3 : 5e-4; near(r2.e, p.e, tol); near(r2.n, p.n, tol);
    }
  });
}
t('5186 원점 (38N,127E) → (200000, 600000)', () => {
  const p = GL.toProjected('EPSG:5186', 38, 127); near(p.e, 200000, 1e-6); near(p.n, 600000, 1e-6);
});

// ── 2. NMEA ──
const gga = GL.nmeaChecksumAppend('GNGGA,012345.00,3711.4000000,N,12645.0000000,E,4,24,0.6,45.123,M,26.400,M,1.0,0000');
t('GGA 체크섬 정상', () => assert(GL.nmeaChecksumOk(gga)));
t('GGA 체크섬 변조 거부', () => assert.strictEqual(GL.parseNmea(gga.replace('45.123', '45.124')), null));
t('GGA 파싱 (RTK fixed)', () => {
  const r = GL.parseNmea(gga);
  assert.strictEqual(r.fix, 4); assert.strictEqual(GL.fixClass(r.fix), 'FIXED');
  near(r.lat, 37 + 11.4 / 60, 1e-9); near(r.lon, 126 + 45 / 60, 1e-9); near(r.alt, 45.123, 1e-9); near(r.geoid, 26.4, 1e-9); assert.strictEqual(r.sats, 24);
});
t('GGA fix=0 → 무효', () => assert.strictEqual(GL.parseNmea(GL.nmeaChecksumAppend('GNGGA,,,,,,0,00,99.99,,,,,,')).fix, 0));
t('GST 파싱', () => {
  const r = GL.parseNmea(GL.nmeaChecksumAppend('GNGST,012345.00,0.5,0.01,0.01,45,0.008,0.009,0.015'));
  near(r.sdLat, 0.008, 1e-9); near(r.sdLon, 0.009, 1e-9); near(r.sdAlt, 0.015, 1e-9);
});
t('서남반구 부호', () => { const r = GL.parseNmea(GL.nmeaChecksumAppend('GNGGA,1,3300.0000,S,07000.0000,W,1,08,1.0,10.0,M,0,M,,')); near(r.lat, -33, 1e-9); near(r.lon, -70, 1e-9); });
t('줄 버퍼: 조각난 청크 재조립', () => {
  const got = []; const f = GL.makeLineBuffer(l => got.push(l));
  f(gga.slice(0, 20)); f(gga.slice(20) + '\r\n$GNGG'); f('A,bad*00\r\n');
  assert.strictEqual(got.length, 2); assert.strictEqual(got[0], gga);
});
t('정확도→fix 추정', () => { assert.strictEqual(GL.fixFromAccuracy(0.02), 'FIXED'); assert.strictEqual(GL.fixFromAccuracy(0.2), 'FLOAT'); assert.strictEqual(GL.fixFromAccuracy(5), 'SINGLE'); });

// ── 3. 관로 시나리오: 50m, 높이차 0.3m, 5m 간격 ──
const MH1 = { name: 'MH1', n: 1000, e: 2000, z: 10.000 }, MH2 = { name: 'MH2', n: 1030, e: 2040, z: 9.700 };   // 3-4-5: 거리 50
t('거리 50m / 높이차 -0.3m / 경사 -0.6% / 방위', () => {
  const p = GL.pairInfo(MH1, MH2);
  near(p.h, 50, 1e-9); near(p.dz, -0.3, 1e-9); near(p.grade, -0.6, 1e-9); near(p.az, Math.atan2(40, 30) * 180 / Math.PI, 1e-9);
});
t('5m 간격 11개 측점, 선형보간 EL', () => {
  const S = GL.makeStations(MH1, MH2, 5, 0);
  assert.strictEqual(S.length, 11);
  assert.deepStrictEqual(S.map(s => s.d), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  near(S[2].z, 9.94, 1e-9); near(S[10].z, 9.7, 1e-9);
  near(S[3].n, 1009, 1e-9); near(S[3].e, 2012, 1e-9);          // 15m 지점
  assert.strictEqual(S[0].name, 'MH1'); assert.strictEqual(S[10].name, 'MH2'); assert.strictEqual(S[2].name, 'STA0+10');
});
t('나누어떨어지지 않는 거리: 종점 자동 추가 (52m)', () => {
  const S = GL.makeStations({ n: 0, e: 0, z: 0 }, { n: 52, e: 0, z: -0.52 }, 5, 0);
  assert.strictEqual(S.length, 12); near(S[11].d, 52, 1e-9); near(S[10].d, 50, 1e-9);
});
t('굴착저면 offset', () => near(GL.makeStations(MH1, MH2, 5, 0.35)[2].z, 9.59, 1e-9));
t('측점명', () => { assert.strictEqual(GL.staName(105), 'STA1+05'); assert.strictEqual(GL.staName(12.5), 'STA0+12.5'); assert.strictEqual(GL.staName(0), 'STA0+00'); });

t('터파기/성토 판정 & 문구 (사용자 예: 설계 9.94 현황 10.45 → 0.51m)', () => {
  const c = GL.cutFill(10.45, 9.94); near(c.depth, 0.51, 1e-9); assert.strictEqual(c.kind, 'CUT');
  assert.strictEqual(GL.markText({ name: 'STA0+10' }, 10.45, 9.94), 'STA0+10 설계 9.940 현황 10.450 → 터파기 0.510m');
  assert.strictEqual(GL.cutFill(9.9, 9.94).kind, 'FILL');
});

// ── 4. 스테이크아웃 안내 ──
t('안내: 선형 진행방향 기준 전후/좌우', () => {
  // 선형이 정북(az=0). 타깃 (10,0). 현재 (8,1) → 전진 2, 좌로 1 (right=-1)
  const g = GL.guide({ n: 8, e: 1 }, { n: 10, e: 0 }, 0);
  near(g.fwd, 2, 1e-9); near(g.right, -1, 1e-9); near(g.dist, Math.sqrt(5), 1e-9);
  // 선형이 정동(az=90). 타깃 (0,10). 현재 (1,8): 전진 2, 오른쪽=남(-N) → 현재가 북쪽(+1)이므로 우측 +1
  const g2 = GL.guide({ n: 1, e: 8 }, { n: 0, e: 10 }, 90);
  near(g2.fwd, 2, 1e-9); near(g2.right, 1, 1e-9);
});
t('안내 방위각', () => near(GL.guide({ n: 0, e: 0 }, { n: 0, e: 5 }, 0).az, 90, 1e-9));

// ── 5. 현장보정 ──
t('1점 보정 = 평행이동 + Z', () => {
  const T = GL.solveCalibration([{ m: { n: 100.10, e: 200.05, z: 20.30 }, k: { n: 100, e: 200, z: 20.00 } }]);
  const q = GL.applyCalibration(T, { n: 110.10, e: 210.05, z: 21.30 });
  near(q.n, 110, 1e-9); near(q.e, 210, 1e-9); near(q.z, 21, 1e-9);
});
t('2점 보정 = 회전+이동 복원 (잔차 0)', () => {
  const θ = 0.02, mk = (n, e) => ({ n: 500 + n * Math.cos(θ) - e * Math.sin(θ) + 1.5, e: 800 + n * Math.sin(θ) + e * Math.cos(θ) - 0.7 });
  const K = [{ n: 0, e: 0, z: 5 }, { n: 60, e: 20, z: 4.8 }, { n: 20, e: -40, z: 5.1 }];
  const pairs = K.map(k => ({ m: { ...mk(k.n, k.e), z: k.z + 0.42 }, k: { n: 500 + k.n, e: 800 + k.e, z: k.z } }));
  const T = GL.solveCalibration(pairs.slice(0, 2)); near(T.rot, -θ, 1e-9); near(T.rms, 0, 1e-9); near(T.dz, -0.42, 1e-9);
  const q = GL.applyCalibration(T, pairs[2].m); near(q.n, pairs[2].k.n, 1e-9); near(q.e, pairs[2].k.e, 1e-9);
});
t('Z 없는 기지점은 수평만 보정 (dz 평균에서 제외)', () => {
  const T = GL.solveCalibration([{ m: { n: 10.1, e: 20, z: 5.5 }, k: { n: 10, e: 20, z: null } }, { m: { n: 10.1, e: 20, z: 5.5 }, k: { n: 10, e: 20, z: 5.0 } }]);
  near(T.dz, -0.5, 1e-9); assert.strictEqual(T.res[0].dz, null);
});
t('보정 없음 = 항등', () => { const p = { n: 1, e: 2, z: 3 }; assert.deepStrictEqual(GL.applyCalibration(null, p), p); });

// 4-파라미터(축척 포함) + 표고 경사면 + 점 끄기
const mkS = (n, e, k, θ) => ({ n: 1000 + k * (n * Math.cos(θ) - e * Math.sin(θ)) + 3.2, e: 2000 + k * (n * Math.sin(θ) + e * Math.cos(θ)) - 1.1 });   // 기지좌표(n,e) → 측정좌표(축척 k, 회전 θ)
t('4-파라미터: 축척·회전·이동 복원 (잔차 0)', () => {
  const k = 1.00012, θ = 0.01, K = [[0, 0], [80, 10], [30, -60], [-40, 50]];
  const pairs = K.map(([n, e]) => { const m = mkS(n, e, k, θ); return { m: { ...m, z: 10 }, k: { n, e, z: 10 } }; });
  const T = GL.solveCalibration(pairs, { scale: true });
  near(T.scale, 1 / k, 1e-9); near(T.rms, 0, 1e-7);
  const q = GL.applyCalibration(T, pairs[2].m); near(q.n, 30, 1e-6); near(q.e, -60, 1e-6);
});
t('축척 옵션 끄면 축척 1 고정 (기존 동작)', () => {
  const pairs = [[0, 0], [100, 0]].map(([n, e]) => ({ m: { ...mkS(n, e, 1.0005, 0), z: 0 }, k: { n, e, z: 0 } }));
  const T = GL.solveCalibration(pairs, { scale: false }); assert.strictEqual(T.scale, 1); assert(T.rms > 0.01, '축척 오차가 잔차로 남아야 함');
});
t('표고 경사면: 3점 이상에서 기울기 복원 (잔차 0)', () => {
  const plane = (n, e) => 0.30 + 0.002 * n - 0.001 * e;                        // 지반 경사: 북으로 2 mm/m, 동으로 -1 mm/m
  const K = [[0, 0], [60, 0], [0, 50], [40, 40]];
  const pairs = K.map(([n, e]) => ({ m: { n: 1000 + n, e: 2000 + e, z: 20 }, k: { n: 1000 + n, e: 2000 + e, z: 20 + plane(n, e) } }));
  const T = GL.solveCalibration(pairs, { z: 'plane' });
  assert.strictEqual(T.zMode, 'plane'); near(T.zRms, 0, 1e-9);
  const q = GL.applyCalibration(T, { n: 1030, e: 2020, z: 20 }); near(q.z, 20 + plane(30, 20), 1e-9);
});
t('표고 auto: 2점 이하면 상수, 3점 이상이면 경사면', () => {
  const mk = (n, e, dz) => ({ m: { n, e, z: 5 }, k: { n, e, z: 5 + dz } });
  assert.strictEqual(GL.solveCalibration([mk(0, 0, .1), mk(50, 0, .2)], { z: 'auto' }).zMode, 'const');
  assert.strictEqual(GL.solveCalibration([mk(0, 0, .1), mk(50, 0, .2), mk(0, 50, .15)], { z: 'auto' }).zMode, 'plane');
});
t('표고 경사면: 일직선 기지점은 상수로 대체하고 경고', () => {
  const mk = (n, dz) => ({ m: { n, e: 0, z: 5 }, k: { n, e: 0, z: 5 + dz } });
  const T = GL.solveCalibration([mk(0, .1), mk(30, .2), mk(60, .3)], { z: 'plane' });
  assert.strictEqual(T.zMode, 'const'); assert(/일직선|경사면/.test(T.warn || ''), '경고 필요');
});
t('점 끄기(off): 이상점을 제외하고 풀면 잔차가 줄고 제외점 잔차도 계산', () => {
  const K = [[0, 0], [100, 0], [0, 100], [100, 100]];
  const pairs = K.map(([n, e], i) => ({ m: { n: 500 + n + (i === 3 ? 0.30 : 0), e: 800 + e, z: 1 }, k: { n: 500 + n, e: 800 + e, z: 1 } }));   // 마지막 점에 30 cm 이상치
  const all = GL.solveCalibration(pairs, { scale: true }), ok = GL.solveCalibration(pairs, { scale: true, off: [3] });
  assert(ok.rms < all.rms / 5, '이상치를 빼면 RMS 가 크게 줄어야 함'); assert.strictEqual(ok.res.length, 4); assert(ok.res[3].off === true && Math.abs(ok.res[3].dn) > 0.2, '제외한 점의 잔차(이상치)가 보여야 함');
});
t('이상점 자동 탐지: 한 점씩 빼고 풀어 RMS 가 가장 크게 줄어드는 점', () => {
  const K = [[0, 0], [100, 0], [0, 100], [100, 100], [50, 120]];
  const pairs = K.map(([n, e], i) => ({ m: { n: 500 + n + (i === 3 ? 0.20 : 0), e: 800 + e, z: 1 }, k: { n: 500 + n, e: 800 + e, z: 1 } }));
  const o = GL.findOutlier(pairs, { scale: true });
  assert.strictEqual(o.index, 3); assert(o.gain > 0.5, '이상점을 빼면 RMS 가 절반 이상 줄어야 함'); assert(o.rmsAfter < o.rmsBefore);
});
t('이상점 자동 탐지: 이상치가 없거나 점이 4개 미만이면 없음', () => {
  const clean = [[0, 0], [100, 0], [0, 100], [100, 100], [50, 120]].map(([n, e]) => ({ m: { n: 500 + n, e: 800 + e, z: 1 }, k: { n: 500 + n, e: 800 + e, z: 1 } }));
  assert.strictEqual(GL.findOutlier(clean, { scale: true }), null);
  assert.strictEqual(GL.findOutlier(clean.slice(0, 3), { scale: true }), null);
});
t('이상점 자동 탐지: 잔차가 이미 5 mm 이하면 부동소수점 잡음으로 지목하지 않는다', () => {
  const K = [[0, 0], [80, 10], [30, -60], [-40, 50], [60, 90]];
  const pairs = K.map(([n, e]) => ({ m: { n: 1000 + 1.0002 * n + 0.8, e: 2000 + 1.0002 * e - 0.5, z: 1 }, k: { n: 1000 + n, e: 2000 + e, z: 1 } }));   // 축척만 다르고 점들은 서로 완전히 일관됨
  assert.strictEqual(GL.findOutlier(pairs, { scale: true }), null);
  const small = pairs.map((p, i) => i === 2 ? { ...p, m: { ...p.m, n: p.m.n + 0.003 } } : p);   // 3 mm 편차는 무시
  assert.strictEqual(GL.findOutlier(small, { scale: true }), null);
});
t('기지점 1개·Z 없음 등 최소 입력', () => {
  const T = GL.solveCalibration([{ m: { n: 10.1, e: 20, z: 5.5 }, k: { n: 10, e: 20, z: null } }], { scale: true, z: 'plane' });
  assert.strictEqual(T.scale, 1); assert.strictEqual(T.zMode, 'const'); near(T.rms, 0, 1e-9);
});

// ── 6. 통계 / DXF ──
t('meanSd', () => { const r = GL.meanSd([1, 2, 3, 4, 5]); near(r.mean, 3, 1e-12); near(r.sd, Math.sqrt(2.5), 1e-12); });
t('DXF 구조', () => {
  const d = GL.dxfBuilder(); d.layer('PIPE', 5); d.line('PIPE', 0, 0, 10, 10); d.text('PIPE', 1, 1, 0.5, 'A'); d.point('PT', 1, 2, 3); d.circle('MH', 0, 0, 0.6);
  const s = d.toString(); assert(s.startsWith('0\nSECTION')); assert(s.endsWith('0\nEOF\n')); assert(/LINE/.test(s) && /TEXT/.test(s) && /POINT/.test(s) && /CIRCLE/.test(s));
});

t('DXF: 한글은 \U+ 이스케이프, 파일은 순수 ASCII', () => {
  const d = GL.dxfBuilder(); d.layer('T', 7); d.text('T', 0, 0, 1, '맨홀1 EL10.000'); const s = d.toString();
  assert(!/[^\x00-\x7f]/.test(s)); assert(s.includes(String.fromCharCode(92) + 'U+B9E8' + String.fromCharCode(92) + 'U+D640') && s.includes('EL10.000'));
});


// ── 7. 폴 기울기 보정 ──
const D = Math.PI / 180;
const qAxisAngle = (ax, ang) => { const n = Math.hypot(...ax), sn = Math.sin(ang / 2) / n; return [Math.cos(ang / 2), ax[0] * sn, ax[1] * sn, ax[2] * sn]; };
// 폴이 방위 az(북 기준 시계방향, 세계좌표)로 th 만큼 기울어진 세계회전
const tiltWorld = (thDeg, azDeg) => { const th = thDeg * D, az = azDeg * D, u = [Math.sin(th) * Math.sin(az), Math.sin(th) * Math.cos(az), Math.cos(th)];
  const ax = [-u[1], u[0], 0]; return th === 0 ? [1, 0, 0, 0] : qAxisAngle(ax, th); };
t('tiltWorld 자체 검증: 세계 +Z 를 목표 방향으로', () => {
  const u = GL.qRot(tiltWorld(5, 60), [0, 0, 1]);
  near(u[0], Math.sin(5 * D) * Math.sin(60 * D), 1e-12); near(u[1], Math.sin(5 * D) * Math.cos(60 * D), 1e-12); near(u[2], Math.cos(5 * D), 1e-12);
});
// IMU 를 임의 방향(폴 축이 본체 X+Y 대각)으로 장착한 경우도 폴 축이 복원되어야 한다
const mountQ = qAxisAngle([0.3, -0.5, 0.8], 1.1);                       // 수직 상태에서의 IMU 자세(장착 임의)
const axisBody = GL.qRot(GL.qConj(mountQ), [0, 0, 1]);
t('수평 캘리브레이션: 폴 축(본체좌표) 복원', () => {
  const noisy = [0, 1, 2].map(i => GL.qNorm(GL.qMul(qAxisAngle([1, 0, 0], (i - 1) * 0.0005), mountQ)));
  const a = GL.poleAxisFromLevel(noisy); near(a[0], axisBody[0], 1e-3); near(a[1], axisBody[1], 1e-3); near(a[2], axisBody[2], 1e-3);
});
for (const [th, az] of [[0, 0], [1, 10], [3, 90], [5, 200], [8, 315]]) {
  t(`기울기 ${th}° 방위 ${az}° → 각도/방위 복원`, () => {
    const q = GL.qMul(tiltWorld(th, az), mountQ), ti = GL.tiltInfo(q, axisBody, 0, 0);
    near(ti.theta, th, 1e-9); if (th > 0) near(((ti.az - az + 540) % 360) - 180, 0, 1e-7);
  });
  t(`지면점 복원: h=1.8, 기울기 ${th}° 방위 ${az}° (오차 <0.1mm)`, () => {
    const h = 1.8, g = { n: 1000, e: 2000, z: 10 }, W = tiltWorld(th, az), u = GL.qRot(W, [0, 0, 1]);
    const ant = { n: g.n + h * u[1], e: g.e + h * u[0], z: g.z + h * u[2] };
    const ti = GL.tiltInfo(GL.qMul(W, mountQ), axisBody, 0, 0), r = GL.tiltCompensate(ant, h, ti);
    near(r.n, g.n, 1e-4); near(r.e, g.e, 1e-4); near(r.z, g.z, 1e-4);
  });
}
t('사용자 예: 1.8m 폴 3° 기울임 → 수평 94mm, 높이 2.5mm 영향', () => {
  const ti = GL.tiltInfo(GL.qMul(tiltWorld(3, 0), mountQ), axisBody, 0, 0), r = GL.tiltCompensate({ n: 0, e: 0, z: 1.8 }, 1.8, ti);
  near(r.dh, 1.8 * Math.sin(3 * D), 1e-9); near(1.8 - 1.8 * Math.cos(3 * D), 0.0025, 1e-4);
});
t('자북 편차/방위 오프셋 적용 (자북 −8.5°)', () => {
  const q = GL.qMul(tiltWorld(4, 0), mountQ);            // 세계 프레임 기준 "북"으로 기울임 = 자북
  near(GL.tiltInfo(q, axisBody, -8.5, 0).az, 351.5, 1e-7);
  near(GL.tiltInfo(q, axisBody, -8.5, 2).az, 353.5, 1e-7);
});
t('방위 캘리브레이션 오프셋(±180 정규화)', () => { near(GL.yawOffsetFrom(10, 350), 20, 1e-9); near(GL.yawOffsetFrom(350, 10), -20, 1e-9); near(GL.yawOffsetFrom(0, 180), -180, 1e-9) || 0; });
t('허용 기울기: 자력 불량이면 tol 안으로 제한', () => {
  near(GL.allowedTilt(1.8, 0.03, 5, true), 5, 1e-12);
  const a = GL.allowedTilt(1.8, 0.03, 5, false); near(a, Math.asin(0.03 / 1.8) / D, 1e-9); assert(a < 1);
});
t('GSV 파싱: 한 문장 4개 위성, 빈 필드(null), 신호ID 꼬리', () => {
  const a = GL.parseNmea(GL.nmeaChecksumAppend('GPGSV,3,1,11,03,03,111,14,04,15,270,,06,01,010,,13,06,292,22'));
  assert.strictEqual(a.type, 'GSV'); assert.strictEqual(a.talker, 'GP'); assert.strictEqual(a.total, 3); assert.strictEqual(a.msg, 1); assert.strictEqual(a.nsv, 11); assert.strictEqual(a.sats.length, 4);
  assert.deepStrictEqual(a.sats[0], { prn: 3, el: 3, az: 111, cn0: 14 }); assert.strictEqual(a.sats[1].cn0, null); assert.strictEqual(a.sig, null);
  const b = GL.parseNmea(GL.nmeaChecksumAppend('GBGSV,1,1,02,06,45,100,38,07,60,200,41,1')); assert.strictEqual(b.sats.length, 2); assert.strictEqual(b.sig, '1'); assert.strictEqual(b.sats[1].cn0, 41);
  assert.strictEqual(GL.parseNmea(GL.nmeaChecksumAppend('GAGSV,1,1,00')).sats.length, 0);
});
t('GSA 파싱: 사용 위성/DOP/시스템ID', () => {
  const a = GL.parseNmea(GL.nmeaChecksumAppend('GNGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1,1'));
  assert.strictEqual(a.type, 'GSA'); assert.strictEqual(a.fix, 3); assert.deepStrictEqual(a.prns, [4, 5, 9, 12, 24]); near(a.pdop, 2.5, 1e-9); near(a.hdop, 1.3, 1e-9); near(a.vdop, 2.1, 1e-9); assert.strictEqual(a.sys, 1);
  assert.strictEqual(GL.parseNmea(GL.nmeaChecksumAppend('GPGSA,A,3,04,05,,,,,,,,,,,2.5,1.3,2.1')).sys, null);
});
t('$PIMU 문장 파싱', () => {
  const m = GL.parseNmea(GL.nmeaChecksumAppend('PIMU,0.7071,0.0,0.7071,0.0,2.5,3'));
  assert.strictEqual(m.type, 'IMU'); near(m.q[0], 0.7071, 1e-9); near(m.accDeg, 2.5, 1e-9); assert.strictEqual(m.mag, 3);
  assert.strictEqual(GL.parseNmea('$PIMU,1,0,0,0,1,3*00'), null);
});

// ── 8. 꺾인 선형 / 면적 ──
const LPTS = [{ name: 'A', n: 0, e: 0, z: 10 }, { name: 'B', n: 0, e: 30, z: 9 }, { name: 'C', n: 40, e: 30, z: 8 }];   // 동으로 30, 북으로 40 (총 70)
t('꺾인 선형: 측점 배치/이름/누가거리/꼭짓점', () => {
  const S = GL.makeAlignment(LPTS, 10, {});
  assert.deepStrictEqual(S.map(s => s.d), [0, 10, 20, 30, 40, 50, 60, 70]);
  assert.strictEqual(S[0].name, 'A'); assert.strictEqual(S[3].name, 'B'); assert.strictEqual(S[7].name, 'C'); assert.strictEqual(S[1].name, 'STA0+10');
  assert.strictEqual(S[3].vertex, 1); assert.strictEqual(S[1].vertex, -1);
  near(S[1].n, 0, 1e-9); near(S[1].e, 10, 1e-9); near(S[5].n, 20, 1e-9); near(S[5].e, 30, 1e-9);   // 북쪽 구간 20m 지점
  near(S[1].az, 90, 1e-9); near(S[5].az, 0, 1e-9);
});
t('꺾인 선형: 높이 정점 간 보간 (A10→B9→C8)', () => {
  const S = GL.makeAlignment(LPTS, 10, {});
  near(S[1].inv, 9.666666667, 1e-6); near(S[3].inv, 9, 1e-9); near(S[5].inv, 8 + 20 / 40, 1e-9);   // 북쪽 구간 (B9→C8) 20m/40m → 8.5
  near(GL.makeAlignment(LPTS, 10, { drop: 0.35 })[3].z, 8.65, 1e-9);
});
t('꺾인 선형: 우측 오프셋 2m (직선구간 + 꼭짓점 마이터)', () => {
  const S = GL.makeAlignment(LPTS, 10, { lat: 2 });
  near(S[1].n, -2, 1e-9); near(S[1].e, 10, 1e-9);            // 동쪽 진행의 우측 = 남
  near(S[5].n, 20, 1e-9); near(S[5].e, 32, 1e-9);            // 북쪽 진행의 우측 = 동
  near(S[3].n, -2, 1e-9); near(S[3].e, 32, 1e-9);            // 꺾임 꼭짓점: 두 오프셋선의 교점(마이터)
  const Lf = GL.makeAlignment(LPTS, 10, { lat: -2 }); near(Lf[1].n, 2, 1e-9);   // 좌측
});
t('꺾인 선형: 시작 누가거리 + 라운드 정렬', () => {
  const S = GL.makeAlignment(LPTS, 10, { startCh: 12, round: true, vertices: false });
  near(S[0].ch, 12, 1e-9); near(S[1].ch, 20, 1e-9); near(S[1].d, 8, 1e-9); assert.strictEqual(S[1].name, 'STA0+20');
  near(S[S.length - 1].ch, 82, 1e-9);
});
t('꺾인 선형: 높이 없는 정점 → z null, 정점 하나면 빈 배열', () => {
  const S = GL.makeAlignment([{ n: 0, e: 0 }, { n: 0, e: 20, z: null }], 10, {});
  assert.strictEqual(S.length, 3); assert.strictEqual(S[1].z, null); assert.strictEqual(GL.makeAlignment([{ n: 0, e: 0 }], 5, {}).length, 0);
});
t('기존 2점 API 유지 (makeStations)', () => { const S = GL.makeStations({ name: 'M1', n: 0, e: 0, z: 10 }, { name: 'M2', n: 50, e: 0, z: 9.7 }, 5, 0); assert.strictEqual(S.length, 11); near(S[2].z, 9.94, 1e-9); });
t('alignInfo', () => { const i = GL.alignInfo(LPTS); near(i.len, 70, 1e-9); near(i.dz, -2, 1e-9); near(i.grade, -2 / 70 * 100, 1e-9); near(i.az, 90, 1e-9); });
t('면적/둘레: 정사각형·삼각형·오목(L자)·역방향·열린선', () => {
  const sq = [{ n: 0, e: 0 }, { n: 0, e: 10 }, { n: 10, e: 10 }, { n: 10, e: 0 }], r = GL.polyStats(sq, true);
  near(r.area, 100, 1e-9); near(r.perimeter, 40, 1e-9); near(r.centroid.n, 5, 1e-9); near(r.centroid.e, 5, 1e-9);
  near(GL.polyStats(sq.slice().reverse(), true).area, 100, 1e-9);
  near(GL.polyStats([{ n: 0, e: 0 }, { n: 0, e: 6 }, { n: 8, e: 0 }], true).area, 24, 1e-9);                    // 6-8-10 삼각형
  const Ls = GL.polyStats([{ n: 0, e: 0 }, { n: 0, e: 4 }, { n: 2, e: 4 }, { n: 2, e: 2 }, { n: 4, e: 2 }, { n: 4, e: 0 }], true); near(Ls.area, 12, 1e-9); near(Ls.perimeter, 16, 1e-9);
  const op = GL.polyStats(sq, false); near(op.length, 30, 1e-9); assert.strictEqual(op.area, 0);
});
t('큰 좌표에서도 면적 정밀 (5186 좌표 규모 오프셋)', () => {
  const B = { n: 500000, e: 200000 }, r = GL.polyStats([{ n: B.n, e: B.e }, { n: B.n, e: B.e + 30 }, { n: B.n + 20, e: B.e + 30 }, { n: B.n + 20, e: B.e }], true);
  near(r.area, 600, 1e-6);
});
t('DeviceOrientation(absolute) → ENU 쿼터니언 (W3C 정의)', () => {
  const v = (a, b, g, vec) => GL.qRot(GL.qFromDeviceOrientation(a, b, g), vec);
  const eq = (x, y) => { for (let i = 0; i < 3; i++) near(x[i], y[i], 1e-12); };
  eq(v(0, 0, 0, [0, 0, 1]), [0, 0, 1]);            // 평평히 놓은 폰: 화면 법선 = 위
  eq(v(0, 90, 0, [0, 1, 0]), [0, 0, 1]);           // 세워 든 폰(beta=90): 폰 위쪽 끝 = 하늘
  eq(v(90, 0, 0, [0, 1, 0]), [-1, 0, 0]);          // alpha=90: 폰 위쪽이 서쪽 (북에서 반시계)
  eq(v(0, 0, 90, [1, 0, 0]), [0, 0, -1]);          // gamma=90: 폰 오른쪽이 아래
});
t('폰 센서를 폴에 임의 각도로 고정: 수평 캘리브 후 기울임 복원', () => {
  const qLevel = GL.qFromDeviceOrientation(200, 83, 7), ax = GL.qRot(GL.qConj(qLevel), [0, 0, 1]);      // 폰이 폴에 대략 세워 고정된 상태(임의 오차 포함)
  const axis = GL.poleAxisFromLevel([qLevel, GL.qMul(qAxisAngle([0, 0, 1], 0.0004), qLevel)]);
  for (const [th, az] of [[3, 30], [6, 250]]) {
    const ti = GL.tiltInfo(GL.qMul(tiltWorld(th, az), qLevel), axis, 0, 0);
    near(ti.theta, th, 1e-3); near(((ti.az - az + 540) % 360) - 180, 0, 0.05);
  }
  near(ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2], 1, 1e-12);
});
t('IMU 프레임 NED → ENU 변환: 같은 기울기가 동일하게 복원', () => {
  const NED = [0, Math.SQRT1_2, Math.SQRT1_2, 0];   // ENU→NED 도 같은 180° 회전(대합)
  for (const [th, az] of [[5, 120], [3, 300]]) {
    const qEnu = GL.qMul(tiltWorld(th, az), mountQ), qNed = GL.qMul(NED, qEnu);       // NED 세계에서 본 같은 자세
    const ti = GL.tiltInfo(GL.qToEnu(qNed, 'NED'), axisBody, 0, 0);
    near(ti.theta, th, 1e-9); near(((ti.az - az + 540) % 360) - 180, 0, 1e-7);
  }
  assert.strictEqual(GL.qToEnu([1, 0, 0, 0], 'ENU')[0], 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
