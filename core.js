/* GNSS-Lite core: 좌표변환 / NMEA / 관로 측점 / 스테이크아웃 / 보정 / DXF.
   브라우저(window.GL)와 Node(module.exports) 양쪽에서 동일하게 사용한다. */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ───────────── 타원체 / 좌표계 ─────────────
  const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
  const GRS80 = { a: 6378137, f: 1 / 298.257222101 };
  const BESSEL = { a: 6377397.155, f: 1 / 299.1528128 };

  // EPSG:5174 (구 TM 중부원점, Bessel) : WGS84로의 7-param (position vector, EPSG 정의)
  const TOWGS84_5174 = [-115.80, 474.99, 674.11, 1.16, -2.31, -1.63, 6.43];

  const CRS = {
    'EPSG:5186': { name: '5186 중부원점 (GRS80)', ell: GRS80, lat0: 38, lon0: 127, k: 1, fe: 200000, fn: 600000 },
    'EPSG:5185': { name: '5185 서부원점 (GRS80)', ell: GRS80, lat0: 38, lon0: 125, k: 1, fe: 200000, fn: 600000 },
    'EPSG:5187': { name: '5187 동부원점 (GRS80)', ell: GRS80, lat0: 38, lon0: 129, k: 1, fe: 200000, fn: 600000 },
    'EPSG:5188': { name: '5188 동해원점 (GRS80)', ell: GRS80, lat0: 38, lon0: 131, k: 1, fe: 200000, fn: 600000 },
    'EPSG:5179': { name: '5179 UTM-K (GRS80)', ell: GRS80, lat0: 38, lon0: 127.5, k: 0.9996, fe: 1000000, fn: 2000000 },
    'EPSG:5174': { name: '5174 구 중부원점 (Bessel)', ell: BESSEL, lat0: 38, lon0: 127.0028902777778, k: 1, fe: 200000, fn: 500000, towgs84: TOWGS84_5174 },
    'EPSG:5178': { name: '5178 구 UTM-K (Bessel)', ell: BESSEL, lat0: 38, lon0: 128, k: 0.9996, fe: 400000, fn: 600000, towgs84: TOWGS84_5174 },
  };

  function geodeticToEcef(lat, lon, h, e) {
    const f = e.f, a = e.a, e2 = f * (2 - f);
    const φ = lat * D2R, λ = lon * D2R, s = Math.sin(φ), c = Math.cos(φ);
    const N = a / Math.sqrt(1 - e2 * s * s);
    return [(N + h) * c * Math.cos(λ), (N + h) * c * Math.sin(λ), (N * (1 - e2) + h) * s];
  }
  function ecefToGeodetic(X, Y, Z, e) {
    const a = e.a, f = e.f, e2 = f * (2 - f), p = Math.hypot(X, Y);
    const λ = Math.atan2(Y, X);
    let φ = Math.atan2(Z, p * (1 - e2)), h = 0;
    for (let i = 0; i < 8; i++) {
      const s = Math.sin(φ), N = a / Math.sqrt(1 - e2 * s * s);
      h = p / Math.cos(φ) - N;
      φ = Math.atan2(Z, p * (1 - e2 * N / (N + h)));
    }
    return { lat: φ * R2D, lon: λ * R2D, h };
  }
  // p = [tx,ty,tz, rx,ry,rz (arcsec), s(ppm)] : 로컬 → WGS84 (position vector)
  function helmert(v, p, inverse) {
    const rx = p[3] / 3600 * D2R, ry = p[4] / 3600 * D2R, rz = p[5] / 3600 * D2R, s = 1 + p[6] * 1e-6;
    const R = [[1, -rz, ry], [rz, 1, -rx], [-ry, rx, 1]];
    if (!inverse) {
      const r = [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
      return [p[0] + s * r[0], p[1] + s * r[1], p[2] + s * r[2]];
    }
    const w = [(v[0] - p[0]) / s, (v[1] - p[1]) / s, (v[2] - p[2]) / s];
    const [[a, b, c], [d, e, f], [g, h, i]] = R;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    const inv = [[(e * i - f * h), (c * h - b * i), (b * f - c * e)], [(f * g - d * i), (a * i - c * g), (c * d - a * f)], [(d * h - e * g), (b * g - a * h), (a * e - b * d)]];
    return [0, 1, 2].map(r => (inv[r][0] * w[0] + inv[r][1] * w[1] + inv[r][2] * w[2]) / det);
  }

  // Krüger 급수 횡메르카토르 (Karney 2011, 3차)
  function tmParams(c) {
    const f = c.ell.f, n = f / (2 - f), a = c.ell.a;
    const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
    const α = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
    const β = [n / 2 - 2 * n * n / 3 + 37 * n ** 3 / 96, n * n / 48 + n ** 3 / 15, 17 * n ** 3 / 480];
    const δ = [2 * n - 2 * n * n / 3 - 2 * n ** 3, 7 * n * n / 3 - 8 * n ** 3 / 5, 56 * n ** 3 / 15];
    return { n, A, α, β, δ };
  }
  function tmXi(c, P, latDeg, dλ) {
    const φ = latDeg * D2R, n = P.n, sφ = Math.sin(φ);
    const q = 2 * Math.sqrt(n) / (1 + n);
    const t = Math.sinh(Math.atanh(sφ) - q * Math.atanh(q * sφ));
    const ξp = Math.atan2(t, Math.cos(dλ));
    const ηp = Math.asinh(Math.sin(dλ) / Math.hypot(t, Math.cos(dλ)));
    let ξ = ξp, η = ηp;
    for (let j = 1; j <= 3; j++) {
      ξ += P.α[j - 1] * Math.sin(2 * j * ξp) * Math.cosh(2 * j * ηp);
      η += P.α[j - 1] * Math.cos(2 * j * ξp) * Math.sinh(2 * j * ηp);
    }
    return { ξ, η };
  }
  function tmForward(c, lat, lon) {
    const P = c._P || (c._P = tmParams(c));
    const { ξ, η } = tmXi(c, P, lat, (lon - c.lon0) * D2R);
    const ξ0 = tmXi(c, P, c.lat0, 0).ξ;
    return { e: c.fe + c.k * P.A * η, n: c.fn + c.k * P.A * (ξ - ξ0) };
  }
  function tmInverse(c, e, n) {
    const P = c._P || (c._P = tmParams(c));
    const ξ0 = tmXi(c, P, c.lat0, 0).ξ;
    const ξ = (n - c.fn) / (c.k * P.A) + ξ0, η = (e - c.fe) / (c.k * P.A);
    let ξp = ξ, ηp = η;
    for (let j = 1; j <= 3; j++) {
      ξp -= P.β[j - 1] * Math.sin(2 * j * ξ) * Math.cosh(2 * j * η);
      ηp -= P.β[j - 1] * Math.cos(2 * j * ξ) * Math.sinh(2 * j * η);
    }
    const χ = Math.asin(Math.sin(ξp) / Math.cosh(ηp));
    let φ = χ;
    for (let j = 1; j <= 3; j++) φ += P.δ[j - 1] * Math.sin(2 * j * χ);
    const λ = Math.atan2(Math.sinh(ηp), Math.cos(ξp));
    return { lat: φ * R2D, lon: c.lon0 + λ * R2D };
  }

  // WGS84 경위도 → 좌표계 (n=X 북, e=Y 동). 높이는 그대로 통과(지오이드 처리는 앱에서).
  function toProjected(crsId, lat, lon) {
    const c = CRS[crsId]; if (!c) throw new Error('unknown CRS ' + crsId);
    if (c.towgs84) {
      const X = geodeticToEcef(lat, lon, 0, WGS84);
      const g = ecefToGeodetic(...helmert(X, c.towgs84, true), c.ell);
      lat = g.lat; lon = g.lon;
    }
    return tmForward(c, lat, lon);
  }
  function fromProjected(crsId, e, n) {
    const c = CRS[crsId]; if (!c) throw new Error('unknown CRS ' + crsId);
    let g = tmInverse(c, e, n);
    if (c.towgs84) {
      const X = geodeticToEcef(g.lat, g.lon, 0, c.ell);
      g = ecefToGeodetic(...helmert(X, c.towgs84, false), WGS84);
    }
    return { lat: g.lat, lon: g.lon };
  }

  // ───────────── NMEA ─────────────
  function nmeaChecksumOk(line) {
    const i = line.indexOf('*'); if (line[0] !== '$' || i < 0) return false;
    let x = 0; for (let k = 1; k < i; k++) x ^= line.charCodeAt(k);
    return x === parseInt(line.slice(i + 1, i + 3), 16);
  }
  function nmeaLatLon(v, hemi) {
    if (!v) return null;
    const dot = v.indexOf('.'), dd = dot - 2;
    const deg = parseInt(v.slice(0, dd), 10), min = parseFloat(v.slice(dd));
    const r = deg + min / 60; return (hemi === 'S' || hemi === 'W') ? -r : r;
  }
  function nmeaChecksumAppend(body) { let x = 0; for (let i = 0; i < body.length; i++) x ^= body.charCodeAt(i); return '$' + body + '*' + x.toString(16).toUpperCase().padStart(2, '0'); }

  // GGA / GST 만 해석. 반환: {type,...} 또는 null
  function parseNmea(line) {
    line = line.trim();
    if (!nmeaChecksumOk(line)) return null;
    const f = line.slice(1, line.indexOf('*')).split(',');
    if (f[0] === 'PIMU') {   // $PIMU,qw,qx,qy,qz,headingAccDeg,magStatus(0-3)  — ESP32 브리지가 BNO085 회전벡터를 전송
      const v = f.slice(1, 7).map(Number); if (v.some(x => !isFinite(x))) return null;
      return { type: 'IMU', q: [v[0], v[1], v[2], v[3]], accDeg: v[4], mag: v[5] };
    }
    if (f[0] === 'PSTAT') return { type: 'STAT', wifi: +f[1], ntrip: +f[2], rtcm: +f[3], age: +f[4], text: f.slice(5).join(',') };   // ESP32 브리지 상태
    const t = f[0].slice(2);
    if (t === 'GGA') {
      const lat = nmeaLatLon(f[2], f[3]), lon = nmeaLatLon(f[4], f[5]);
      const fix = parseInt(f[6] || '0', 10);
      if (lat == null || lon == null || fix === 0) return { type: 'GGA', fix: 0 };
      return { type: 'GGA', fix, lat, lon, sats: parseInt(f[7] || '0', 10), hdop: parseFloat(f[8]),
        alt: parseFloat(f[9]), geoid: parseFloat(f[11]), age: f[13] ? parseFloat(f[13]) : null };
    }
    if (t === 'GST') {
      return { type: 'GST', sdLat: parseFloat(f[6]), sdLon: parseFloat(f[7]), sdAlt: parseFloat(f[8]) };
    }
    if (t === 'GSV') {                              // 가시 위성: total,msg,numSV,{prn,el,az,snr}×4 [,signalId(NMEA 4.10+)]
      const rest = f.slice(4), hasSig = rest.length % 4 === 1, n = hasSig ? rest.length - 1 : rest.length, sats = [], num = x => (x === undefined || x === '') ? null : +x;
      for (let i = 0; i + 3 < n; i += 4) { const prn = parseInt(rest[i], 10); if (isFinite(prn)) sats.push({ prn, el: num(rest[i + 1]), az: num(rest[i + 2]), cn0: num(rest[i + 3]) }); }
      return { type: 'GSV', talker: f[0].slice(0, 2), total: +f[1], msg: +f[2], nsv: +f[3], sats, sig: hasSig ? rest[rest.length - 1] : null };
    }
    if (t === 'GSA') {                              // 사용 위성: mode,fix,prn×12,pdop,hdop,vdop[,systemId(4.11)]
      return { type: 'GSA', talker: f[0].slice(0, 2), fix: +f[2], prns: f.slice(3, 15).map(x => parseInt(x, 10)).filter(isFinite), pdop: parseFloat(f[15]), hdop: parseFloat(f[16]), vdop: parseFloat(f[17]), sys: f[18] ? +f[18] : null };
    }
    return null;
  }
  // 수신 텍스트 청크를 줄 단위로 나누는 버퍼
  function makeLineBuffer(onLine) {
    let buf = '';
    return function (chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (l) onLine(l); }
      if (buf.length > 2000) buf = '';
    };
  }
  function fixClass(q) { // GGA quality → 표시 등급
    return q === 4 ? 'FIXED' : q === 5 ? 'FLOAT' : q === 2 ? 'DGPS' : q === 1 ? 'SINGLE' : q === 0 ? 'NONE' : 'OTHER';
  }
  // Android mock location 은 fix 종류를 주지 않으므로 정확도(m)로 추정한다.
  function fixFromAccuracy(acc) {
    if (acc == null || !isFinite(acc)) return 'SINGLE';
    return acc <= 0.05 ? 'FIXED' : acc <= 0.5 ? 'FLOAT' : acc <= 3 ? 'DGPS' : 'SINGLE';
  }

  // ───────────── 기하 ─────────────
  const hyp = (a, b) => Math.hypot(a, b);
  function azimuth(n1, e1, n2, e2) { const a = Math.atan2(e2 - e1, n2 - n1) * R2D; return (a + 360) % 360; }
  function pairInfo(A, B) {
    const dn = B.n - A.n, de = B.e - A.e, dz = B.z - A.z, h = hyp(dn, de);
    return { dn, de, dz, h, slope3d: Math.hypot(h, dz), grade: h ? dz / h * 100 : 0, az: azimuth(A.n, A.e, B.n, B.e) };
  }
  function staName(d) {
    const r = Math.round(d * 1000) / 1000, km = Math.floor(r / 100), m = r - km * 100;
    const ms = Number.isInteger(m) ? String(m).padStart(2, '0') : m.toFixed(2).replace(/0+$/, '').padStart(4, '0');
    return 'STA' + km + '+' + ms;
  }
  // 두 맨홀 사이 등간격 측점. z 는 관저고(EL)를 선형보간, 굴착저면 = 관저고 - offset.
  function makeStations(A, B, interval, offset) {
    return makeAlignment([A, B], interval, { drop: offset || 0 }).map(s => ({ i: s.i, d: s.d, name: s.name, n: s.n, e: s.e, inv: s.inv, z: s.z }));
  }
  // 꺾인 선형(정점 pts[{name,n,e,z|null}]) 위 등간격 측점.
  //  o.startCh 시작 누가거리, o.lat 좌우 오프셋(+우측, 진행방향 기준), o.drop 굴착저면 = z − drop,
  //  o.vertices(기본 true) 꼭짓점도 측점, o.round 누가거리가 interval 의 배수가 되도록 정렬.
  //  z 는 정점 사이 선형보간(정점 z 가 없으면 null → 높이 판정 생략).
  function makeAlignment(pts, interval, o) {
    o = o || {}; const lat = o.lat || 0, drop = o.drop || 0, ch0 = o.startCh || 0;
    const P = (pts || []).filter(p => p && isFinite(p.n) && isFinite(p.e));
    if (P.length < 2 || !(interval > 0)) return [];
    const cum = [0], U = [];
    for (let k = 1; k < P.length; k++) {
      const dn = P[k].n - P[k - 1].n, de = P[k].e - P[k - 1].e, len = Math.hypot(dn, de);
      cum.push(cum[k - 1] + len); U.push(len > 1e-9 ? [dn / len, de / len] : (U[U.length - 1] || [1, 0]));
    }
    const L = cum[cum.length - 1]; if (!(L > 0)) return [];
    const raw = [], first = o.round ? Math.ceil(ch0 / interval - 1e-9) * interval - ch0 : 0;
    for (let d = Math.max(0, first); d < L - 1e-9; d += interval) raw.push({ d: Math.round(d * 1e6) / 1e6, v: -1 });
    if (o.vertices !== false) cum.forEach((d, k) => raw.push({ d, v: k })); else raw.push({ d: 0, v: 0 }, { d: L, v: P.length - 1 });
    raw.sort((a, b) => a.d - b.d || b.v - a.v);
    const ds = []; raw.forEach(r => { const l = ds[ds.length - 1]; if (l && Math.abs(l.d - r.d) < 1e-6) { if (r.v >= 0) l.v = r.v; } else ds.push({ d: r.d, v: r.v }); });
    const zOf = p => (p.z != null && isFinite(p.z)) ? +p.z : NaN, fin = v => isFinite(v) ? v : null;
    return ds.map((s, i) => {
      let j = 0; while (j < P.length - 2 && cum[j + 1] < s.d - 1e-9) j++;
      const a = P[j], b = P[j + 1], t = (s.d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      const n0 = a.n + (b.n - a.n) * t, e0 = a.e + (b.e - a.e) * t, z0 = zOf(a), z1 = zOf(b), inv = z0 + (z1 - z0) * t;
      let u = U[j], off = lat;
      if (s.v > 0 && s.v < P.length - 1) {                       // 내부 꼭짓점: 이등분 방향 + 마이터 오프셋
        const p = U[s.v - 1], q = U[s.v], bx = p[0] + q[0], by = p[1] + q[1], bl = Math.hypot(bx, by);
        if (bl > 1e-6) { u = [bx / bl, by / bl]; off = lat / Math.max(0.25, u[0] * q[0] + u[1] * q[1]); }
        else u = q;
      } else if (s.v === P.length - 1) u = U[P.length - 2]; else if (s.v === 0) u = U[0];
      const az = (Math.atan2(u[1], u[0]) * R2D + 360) % 360;
      return { i, d: s.d, ch: ch0 + s.d, name: (s.v >= 0 && P[s.v].name) ? P[s.v].name : staName(ch0 + s.d),
        n: n0 - u[1] * off, e: e0 + u[0] * off, inv: fin(inv), z: fin(inv - drop), az, vertex: s.v };
    });
  }
  // 선형 요약: 총연장, 시·종점 높이차, 평균경사, 첫 구간 방위
  function alignInfo(pts) {
    const P = (pts || []).filter(p => p && isFinite(p.n) && isFinite(p.e)); let len = 0;
    for (let k = 1; k < P.length; k++) len += Math.hypot(P[k].n - P[k - 1].n, P[k].e - P[k - 1].e);
    const za = P.length ? P[0].z : null, zb = P.length ? P[P.length - 1].z : null, hasZ = za != null && zb != null && isFinite(za) && isFinite(zb);
    return { len, dz: hasZ ? zb - za : null, grade: hasZ && len ? (zb - za) / len * 100 : null, az: P.length > 1 ? azimuth(P[0].n, P[0].e, P[1].n, P[1].e) : 0, count: P.length };
  }
  // 현재 위치 → 목표. 선형 진행방향 기준 전후/좌우.
  function guide(cur, tgt, lineAz) {
    const gn = tgt.n - cur.n, ge = tgt.e - cur.e;
    const θ = lineAz * D2R, uN = Math.cos(θ), uE = Math.sin(θ), rN = -Math.sin(θ), rE = Math.cos(θ);
    return { dist: hyp(gn, ge), az: azimuth(cur.n, cur.e, tgt.n, tgt.e), fwd: gn * uN + ge * uE, right: gn * rN + ge * rE, dn: gn, de: ge };
  }
  // 굴착 판정: 현황 지반고 GL − 굴착저면 설계고. +: 터파기(굴착), −: 성토
  function cutFill(gl, designZ) { const c = gl - designZ; return { depth: c, kind: Math.abs(c) < 0.0005 ? 'OK' : c > 0 ? 'CUT' : 'FILL' }; }
  function markText(st, gl, designZ, words) {      // words: {cut,fill} 용도별 용어 (관로: 터파기/성토, 도로 등: 절토/성토)
    const r = cutFill(gl, designZ), w = words || { cut: '터파기', fill: '성토' };
    return st.name + ' 설계 ' + designZ.toFixed(3) + ' 현황 ' + gl.toFixed(3) + ' → ' +
      (r.kind === 'OK' ? '계획고' : (r.kind === 'CUT' ? w.cut + ' ' : w.fill + ' ') + Math.abs(r.depth).toFixed(3) + 'm');
  }
  // 다각형/폴리라인 통계 (평면). area = |신발끈 공식|, perimeter = 폐합 시 둘레, length = 열린 선 연장, centroid = 면적중심
  function polyStats(pts, closed) {
    const src = (pts || []).filter(p => p && isFinite(p.n) && isFinite(p.e)), m = src.length; let A2 = 0, cn = 0, ce = 0, len = 0;
    const o = m ? src[0] : { n: 0, e: 0 }, P = src.map(p => ({ n: p.n - o.n, e: p.e - o.e }));   // 첫 점 기준으로 평행이동해 큰 좌표의 자릿수 손실 방지
    for (let k = 0; k < m; k++) {
      const a = P[k], b = P[(k + 1) % m], cr = a.e * b.n - b.e * a.n;
      A2 += cr; ce += (a.e + b.e) * cr; cn += (a.n + b.n) * cr;
      if (k < m - 1 || closed) len += Math.hypot(b.n - a.n, b.e - a.e);
    }
    const A = A2 / 2, ok = closed && m >= 3 && Math.abs(A) > 1e-12;
    return { area: ok ? Math.abs(A) : 0, perimeter: closed ? len : 0, length: closed ? 0 : len, centroid: ok ? { n: o.n + cn / (6 * A), e: o.e + ce / (6 * A) } : null, count: m };
  }
  function meanSd(arr) {
    const n = arr.length; if (!n) return { mean: NaN, sd: NaN, n: 0 };
    const m = arr.reduce((s, v) => s + v, 0) / n;
    return { mean: m, sd: n > 1 ? Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1)) : 0, n };
  }

  // ───────────── 현장 보정 (2D 유사변환 + 표고 보정) ─────────────
  // pairs: [{m:{n,e,z}, k:{n,e,z}}]  m=측정(원시), k=기지값. 1쌍=평행이동, 2쌍이상=회전+이동(+축척).
  // opts.scale: true 면 축척까지 푼다(4-파라미터). 기본 false(축척 1 고정).
  // opts.z: 'const'(평균 오프셋) | 'plane'(경사면, 표고가 있는 기지점 3개 이상) | 'auto'(3개 이상이면 경사면). 기본 'const'.
  // opts.off: 계산에서 뺄 점 인덱스 목록(이상점). 뺀 점도 잔차는 계산해 보여 준다.
  function solveCalibration(pairs, opts) {
    if (!pairs.length) return null;
    opts = opts || {};
    const off = new Set(opts.off || []), use = pairs.map((p, i) => ({ p, i })).filter(o => !off.has(o.i)).map(o => o.p);
    if (!use.length) return null;
    const N = use.length, cm = { n: 0, e: 0 }, ck = { n: 0, e: 0 };
    use.forEach(p => { cm.n += p.m.n; cm.e += p.m.e; ck.n += p.k.n; ck.e += p.k.e; });
    cm.n /= N; cm.e /= N; ck.n /= N; ck.e /= N;
    let rot = 0, scale = 1;
    if (N >= 2) {
      let s = 0, c = 0, d = 0;
      use.forEach(p => {
        const a = p.m.n - cm.n, b = p.m.e - cm.e, x = p.k.n - ck.n, y = p.k.e - ck.e;
        c += a * x + b * y; s += a * y - b * x; d += a * a + b * b;
      });
      rot = Math.atan2(s, c);
      if (opts.scale && d > 0) scale = Math.hypot(c, s) / d;   // 복소수 최소제곱: λ = Σ conj(u)·v / Σ|u|²,  축척 = |λ|
    }
    const hasZ = p => p.k.z != null && isFinite(p.k.z) && isFinite(p.m.z), zp = use.filter(hasZ);   // k.z 없는 기지점은 수평 보정에만 사용
    const T = { rot, scale, cn: cm.n, ce: cm.e, tn: ck.n, te: ck.e, dz: zp.length ? zp.reduce((s, p) => s + (p.k.z - p.m.z), 0) / zp.length : 0, zMode: 'const', zA: 0, zB: 0, warn: '' };
    // 표고: 경사면  dz = dz0 + zA·(n−cn) + zB·(e−ce)  (측정 좌표 기준)
    const wantPlane = opts.z === 'plane' || (opts.z === 'auto' && zp.length >= 3);
    if (wantPlane) {
      if (zp.length < 3) T.warn = '경사면 보정에는 표고가 있는 기지점 3개 이상이 필요합니다 → 높이는 평균 오프셋으로 보정합니다';
      else {
        let snn = 0, see = 0, sne = 0, snz = 0, sez = 0;
        zp.forEach(p => { const a = p.m.n - cm.n, b = p.m.e - cm.e, v = p.k.z - p.m.z - T.dz; snn += a * a; see += b * b; sne += a * b; snz += a * v; sez += b * v; });
        const det = snn * see - sne * sne;
        if (!(det > 1e-6 * Math.max(snn * see, 1e-12))) T.warn = '표고 기지점이 일직선에 가까워 경사면을 풀 수 없습니다 → 높이는 평균 오프셋으로 보정합니다';
        else { T.zA = (snz * see - sez * sne) / det; T.zB = (sez * snn - snz * sne) / det; T.zMode = 'plane'; }
      }
    }
    const rz = [];
    T.res = pairs.map((p, i) => {
      const q = applyCalibration(T, p.m), z = hasZ(p) ? q.z - p.k.z : null;
      if (z != null && !off.has(i)) rz.push(z);
      return { dn: q.n - p.k.n, de: q.e - p.k.e, dz: z, off: off.has(i) };
    });
    const on = T.res.filter(r => !r.off);
    T.rms = Math.sqrt(on.reduce((s, r) => s + r.dn ** 2 + r.de ** 2, 0) / on.length);
    T.zRms = rz.length ? Math.sqrt(rz.reduce((s, v) => s + v * v, 0) / rz.length) : 0;
    T.n = N;
    return T;
  }
  // 이상점 탐지: 사용 중인 기지점이 4개 이상일 때, 한 점씩 빼고 다시 풀어 RMS 가 가장 크게 줄어드는 점을 찾는다.
  // 반환 {index, rmsBefore, rmsAfter, gain}  (gain = 줄어든 비율). 현재 RMS 의 50% 이상 줄지 않으면 이상점 없음(null).
  function findOutlier(pairs, opts) {
    opts = opts || {};
    const off = new Set(opts.off || []), idx = pairs.map((p, i) => i).filter(i => !off.has(i));
    if (idx.length < 4) return null;
    const base = solveCalibration(pairs, opts); if (!base || !(base.rms > 0.005)) return null;   // 잔차가 이미 5 mm 이하면 현장에서 문제 삼을 이유가 없고, 비율 계산이 부동소수점 잡음에 흔들린다
    let best = null;
    idx.forEach(i => {
      const T = solveCalibration(pairs, Object.assign({}, opts, { off: [...off, i] }));
      if (T && (!best || T.rms < best.rmsAfter)) best = { index: i, rmsBefore: base.rms, rmsAfter: T.rms };
    });
    if (!best) return null;
    best.gain = 1 - best.rmsAfter / best.rmsBefore;
    return best.gain >= 0.5 ? best : null;
  }
  function applyCalibration(T, p) {
    if (!T) return { n: p.n, e: p.e, z: p.z };
    const a = p.n - T.cn, b = p.e - T.ce, c = Math.cos(T.rot), s = Math.sin(T.rot), k = T.scale == null ? 1 : T.scale;
    return { n: T.tn + k * (a * c - b * s), e: T.te + k * (a * s + b * c), z: p.z + T.dz + (T.zA || 0) * a + (T.zB || 0) * b };
  }

  // ───────────── DXF (R12 ASCII: AutoCAD/BricsCAD/ZWCAD 모두 열림) ─────────────
  function dxfBuilder() {
    const ent = [], layers = {};
    const g = (code, v) => code + '\n' + v + '\n';
    const num = v => (Math.round(v * 1e4) / 1e4).toFixed(4);
    // R12 DXF 는 UTF-8 미지원 → 비ASCII 는 CAD 공통 \U+XXXX 이스케이프로 기록 (파일은 순수 ASCII)
    const safe = s => String(s).replace(/[\r\n]/g, ' ').replace(/[^\x20-\x7e]/gu, ch => String.fromCharCode(92) + 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
    return {
      layer(name, color) { layers[name] = color; },
      point(l, x, y, z) { ent.push(g(0, 'POINT') + g(8, l) + g(10, num(x)) + g(20, num(y)) + g(30, num(z || 0))); },
      line(l, x1, y1, x2, y2) { ent.push(g(0, 'LINE') + g(8, l) + g(10, num(x1)) + g(20, num(y1)) + g(30, 0) + g(11, num(x2)) + g(21, num(y2)) + g(31, 0)); },
      circle(l, x, y, r) { ent.push(g(0, 'CIRCLE') + g(8, l) + g(10, num(x)) + g(20, num(y)) + g(30, 0) + g(40, num(r))); },
      text(l, x, y, h, s, rotDeg) { ent.push(g(0, 'TEXT') + g(8, l) + g(10, num(x)) + g(20, num(y)) + g(30, 0) + g(40, num(h)) + g(1, safe(s)) + (rotDeg ? g(50, num(rotDeg)) : '')); },
      toString() {
        let s = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009') + g(9, '$DWGCODEPAGE') + g(3, 'ANSI_1252') + g(0, 'ENDSEC');
        const names = Object.keys(layers);
        s += g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(70, names.length);
        names.forEach(n => { s += g(0, 'LAYER') + g(2, n) + g(70, 0) + g(62, layers[n]) + g(6, 'CONTINUOUS'); });
        s += g(0, 'ENDTAB') + g(0, 'ENDSEC') + g(0, 'SECTION') + g(2, 'ENTITIES') + ent.join('') + g(0, 'ENDSEC') + g(0, 'EOF');
        return s;
      },
    };
  }


  // ───────────── 폴 기울기 보정 (IMU 쿼터니언, ENU 세계좌표: x=동, y=북, z=상) ─────────────
  const qMul = (a, b) => [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];
  const qConj = q => [q[0], -q[1], -q[2], -q[3]];
  const qNorm = q => { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(x => x / n); };
  function qRot(q, v) {
    const [w, x, y, z] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
  // IMU 세계 프레임 → ENU. frame 'NED' 면 NED→ENU(축 교환, z 반전) 회전을 앞에서 곱한다.
  const Q_NED2ENU = [0, Math.SQRT1_2, Math.SQRT1_2, 0];
  const qToEnu = (q, frame) => frame === 'NED' ? qMul(Q_NED2ENU, q) : q;
  // 폴을 수직(버블)으로 세운 상태의 쿼터니언들 → 폴 축의 본체(IMU) 좌표 벡터. 장착 방향과 무관.
  function poleAxisFromLevel(qs) {
    if (!qs.length) return null;
    const ref = qs[0], acc = [0, 0, 0, 0];
    qs.forEach(q => { const d = q[0]*ref[0] + q[1]*ref[1] + q[2]*ref[2] + q[3]*ref[3], sg = d < 0 ? -1 : 1; for (let i = 0; i < 4; i++) acc[i] += sg * q[i]; });
    return qRot(qConj(qNorm(acc)), [0, 0, 1]);
  }
  // 현재 자세 → 기울기. decl: 자북 편차(동쪽 +, 한국 약 −8.5), yawOff: 방위 캘리브레이션 오프셋
  function tiltInfo(q, axis, declDeg, yawOffDeg) {
    const u = qRot(qNorm(q), axis), th = Math.acos(Math.max(-1, Math.min(1, u[2])));
    const magAz = Math.atan2(u[0], u[1]) * R2D, az = ((magAz + (declDeg || 0) + (yawOffDeg || 0)) % 360 + 360) % 360;
    return { theta: th * R2D, az, thetaRad: th, magAz };
  }
  // 안테나 위치 → 폴 끝(지면) 위치. h: 폴 끝에서 안테나 위상중심까지 폴 축 방향 길이
  function tiltCompensate(ant, h, t) {
    const s = Math.sin(t.thetaRad), c = Math.cos(t.thetaRad), a = t.az * D2R;
    return { n: ant.n - h * s * Math.cos(a), e: ant.e - h * s * Math.sin(a), z: ant.z - h * c, dh: h * s };
  }
  // 허용 기울기: 자력계 신뢰(mag>=2)면 사용자 한계, 아니면 방위를 못 믿으므로 보정 없이 허용오차(tol) 안에 드는 각도만
  function allowedTilt(h, tol, maxDeg, magOk) { return magOk ? maxDeg : Math.min(maxDeg, Math.asin(Math.min(1, tol / h)) * R2D); }
  // 폴을 알려진 방위(knownAz)로 기울인 상태에서 방위 오프셋 산출
  function yawOffsetFrom(knownAz, measuredAz) { let d = (knownAz - measuredAz) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }
  // W3C DeviceOrientation(absolute) 각도(도) → 기기→지구(ENU: x=동, y=북, z=상) 쿼터니언. R = Rz(alpha)·Rx(beta)·Ry(gamma)
  function qFromDeviceOrientation(alpha, beta, gamma) {
    const h = D2R / 2, qz = [Math.cos(alpha * h), 0, 0, Math.sin(alpha * h)], qx = [Math.cos(beta * h), Math.sin(beta * h), 0, 0], qy = [Math.cos(gamma * h), 0, Math.sin(gamma * h), 0];
    return qNorm(qMul(qMul(qz, qx), qy));
  }

  const api = { CRS, toProjected, fromProjected, parseNmea, nmeaChecksumOk, nmeaChecksumAppend, makeLineBuffer, fixClass, fixFromAccuracy,
    qMul, qConj, qNorm, qRot, qToEnu, qFromDeviceOrientation, poleAxisFromLevel, tiltInfo, tiltCompensate, allowedTilt, yawOffsetFrom, azimuth, pairInfo, staName, makeStations, makeAlignment, alignInfo, polyStats, guide, cutFill, markText, meanSd, solveCalibration, applyCalibration, findOutlier, dxfBuilder, hyp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GL = api;
})(typeof window !== 'undefined' ? window : globalThis);
