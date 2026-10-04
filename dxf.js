/* DXF(ASCII) 읽기: 도면을 배경으로 깔고, 점·선형을 뽑아 스테이크아웃에 쓰기 위한 경량 파서.
   지원: LINE, LWPOLYLINE(bulge 호 포함, 2정점 폐합 bulge=원으로 인식), POLYLINE/VERTEX, CIRCLE, ARC, POINT, TEXT, MTEXT, INSERT(삽입점).
   미지원: DWG/바이너리 DXF, HATCH, DIMENSION, 블록 내부 전개, 3D 면. 좌표: DXF X=동(E), Y=북(N).
   출력 ents: {t:'L',l,x1,y1,x2,y2,b} {t:'P',l,pts:[[x,y]..],c(닫힘),b} {t:'C',l,x,y,r,b,poly?} {t:'A',l,x,y,r,a0,a1,b}
              {t:'.',l,x,y,z} {t:'T',l,x,y,h,rot,s} {t:'I',l,x,y,name,rot}   b=[minx,miny,maxx,maxy] */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;

  function decode(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('euc-kr').decode(u8); }   // 구형(≤R2004) 한글 DXF 는 CP949
  }
  const ACI = { 1: '#e11d48', 2: '#ca8a04', 3: '#16a34a', 4: '#0891b2', 5: '#2563eb', 6: '#c026d3', 7: '#374151', 8: '#6b7280', 9: '#9ca3af' };
  const aciColor = c => ACI[Math.abs(c)] || '#4b5563';
  function cleanText(s) {
    return String(s || '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/[{}]/g, '').trim();
  }
  // bulge 호를 점열로 (step 도 간격)
  function bulgePts(x1, y1, x2, y2, b, stepDeg) {
    const dx = x2 - x1, dy = y2 - y1, ch = Math.hypot(dx, dy); if (!ch || !b) return [];
    const sweep = 4 * Math.atan(b), off = (ch / 2) * (1 - b * b) / (2 * b), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const cx = mx + (-dy / ch) * off, cy = my + (dx / ch) * off, R = Math.hypot(x1 - cx, y1 - cy), a0 = Math.atan2(y1 - cy, x1 - cx);
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / ((stepDeg || 6) * D2R))), out = [];
    for (let k = 1; k < n; k++) out.push([cx + R * Math.cos(a0 + sweep * k / n), cy + R * Math.sin(a0 + sweep * k / n)]);
    return out;
  }
  function bbox(pts) { let a = 1e300, b = 1e300, c = -1e300, d = -1e300; for (const p of pts) { if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; } return [a, b, c, d]; }

  function parse(input) {
    const text = typeof input === 'string' ? input : decode(input), len = text.length;
    let pos = 0;
    const nextLine = () => { let e = text.indexOf('\n', pos); if (e < 0) e = len; let s = text.slice(pos, e); pos = e + 1; if (s.charCodeAt(s.length - 1) === 13) s = s.slice(0, -1); return s; };
    const layers = [], lidx = Object.create(null), layerColor = Object.create(null), ents = [], meta = { version: '', codepage: '' };
    const L = name => { let i = lidx[name]; if (i === undefined) { i = layers.length; lidx[name] = i; layers.push({ name, color: '#4b5563', count: 0 }); } return i; };
    let section = '', cur = null, poly = null, tblLayer = null, hdrVar = '', tblBR = null, modelHandle = '';
    const bounds = { minx: 1e300, miny: 1e300, maxx: -1e300, maxy: -1e300 };
    const grow = (x, y) => { if (x < bounds.minx) bounds.minx = x; if (x > bounds.maxx) bounds.maxx = x; if (y < bounds.miny) bounds.miny = y; if (y > bounds.maxy) bounds.maxy = y; };
    const push = e => { layers[e.l].count++; ents.push(e); if (e.b) { grow(e.b[0], e.b[1]); grow(e.b[2], e.b[3]); } else grow(e.x, e.y); };

    function finish(c) {
      if (!c || (c.g && c.g[67] === '1')) return;                                        // 그룹코드 67=1: 배치(종이 공간) 엔티티는 제외
      if (modelHandle && c.g && c.g[330] && c.g[330] !== modelHandle) return;            // 최신 DXF: 소유 블록(330)이 모형 공간이 아니면(배치 등) 제외
      const g = c.g, n = k => parseFloat(g[k]), has = k => g[k] !== undefined, l = L(c.layer || '0');
      switch (c.t) {
        case 'LINE': if (has(10) && has(11)) { const x1 = n(10), y1 = n(20), x2 = n(11), y2 = n(21); push({ t: 'L', l, x1, y1, x2, y2, b: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] }); } break;
        case 'CIRCLE': if (has(10)) { const x = n(10), y = n(20), r = n(40); push({ t: 'C', l, x, y, r, b: [x - r, y - r, x + r, y + r] }); } break;
        case 'ARC': if (has(10)) { const x = n(10), y = n(20), r = n(40); push({ t: 'A', l, x, y, r, a0: n(50) || 0, a1: n(51) || 0, b: [x - r, y - r, x + r, y + r] }); } break;
        case 'POINT': if (has(10)) push({ t: '.', l, x: n(10), y: n(20), z: has(30) ? n(30) : 0 }); break;
        case 'TEXT': case 'MTEXT': if (has(10)) {
          const al = c.t === 'TEXT' && (n(72) || n(73)) && has(11), s = cleanText(c.t === 'MTEXT' ? (c.extra || '') + (g[1] || '') : g[1]);
          if (s) push({ t: 'T', l, x: al ? n(11) : n(10), y: al ? n(21) : n(20), h: n(40) || 1, rot: n(50) || 0, s });
        } break;
        case 'INSERT': if (has(10)) push({ t: 'I', l, x: n(10), y: n(20), name: g[2] || '', rot: n(50) || 0 }); break;
        case 'LWPOLYLINE': case 'POLYLINE': polyDone(c, l); break;
      }
    }
    function polyDone(c, l) {
      const V = c.v; if (V.length < 2) return; const closed = (parseInt(c.g[70], 10) & 1) === 1;
      if (closed && V.length === 2 && Math.abs(V[0][2] || 0) > 0.99 && Math.abs(V[1][2] || 0) > 0.99) {      // 맨홀 등 원(두 반원 폴리라인)
        const x = (V[0][0] + V[1][0]) / 2, y = (V[0][1] + V[1][1]) / 2, r = Math.hypot(V[0][0] - V[1][0], V[0][1] - V[1][1]) / 2; push({ t: 'C', l, x, y, r, b: [x - r, y - r, x + r, y + r], poly: true }); return;
      }
      const pts = [], m = V.length;
      for (let k = 0; k < m; k++) {
        const a = V[k], nxt = V[(k + 1) % m]; pts.push([a[0], a[1]]);
        if ((k < m - 1 || closed) && a[2]) pts.push(...bulgePts(a[0], a[1], nxt[0], nxt[1], a[2]));
      }
      push({ t: 'P', l, pts, c: closed, b: bbox(pts) });
    }

    while (pos < len) {
      const cs = nextLine(); if (pos >= len && !cs.trim()) break; const v = nextLine(), code = parseInt(cs, 10);
      if (code === 0) {
        const name = v.trim();
        if (name === 'SECTION') { section = '?'; cur = null; continue; }
        if (name === 'ENDSEC') { if (poly) { finish(poly); poly = null; } else finish(cur); cur = null; section = ''; tblLayer = null; continue; }
        if (section === 'TABLES') { tblLayer = name === 'LAYER' ? { name: '' } : null; tblBR = name === 'BLOCK_RECORD' ? { h: '' } : null; continue; }
        if (section !== 'ENTITIES') continue;
        if (poly) {                                              // 2D/3D POLYLINE 진행 중: VERTEX 는 누적, SEQEND 에서 완료
          if (cur && cur.t === 'VERTEX') { poly.v.push([parseFloat(cur.g[10]), parseFloat(cur.g[20]), parseFloat(cur.g[42]) || 0]); cur = null; }
          if (name === 'VERTEX') { cur = { t: 'VERTEX', g: {} }; continue; }
          if (name === 'SEQEND') { finish(poly); poly = null; cur = null; continue; }
          finish(poly); poly = null;
        }
        if (cur && cur.t !== 'VERTEX') finish(cur);
        cur = { t: name, g: {}, layer: '0', v: [], extra: '' };
        if (name === 'POLYLINE') { poly = cur; cur = null; }
        continue;
      }
      if (section === '?') { if (code === 2) section = v.trim(); continue; }
      if (section === 'HEADER') { if (code === 9) hdrVar = v.trim(); else if (hdrVar === '$ACADVER' && code === 1) meta.version = v.trim(); else if (hdrVar === '$DWGCODEPAGE' && code === 3) meta.codepage = v.trim(); continue; }
      if (section === 'TABLES') {
        if (tblLayer) { if (code === 2) tblLayer.name = v.trim(); else if (code === 62) layerColor[tblLayer.name] = aciColor(parseInt(v, 10)); }
        else if (tblBR) { if (code === 5) tblBR.h = v.trim(); else if (code === 2 && v.trim().toLowerCase() === '*model_space') modelHandle = tblBR.h; }
        continue;
      }
      if (section !== 'ENTITIES') continue;
      if (poly && !cur) { if (code === 8) poly.layer = v.trim(); else poly.g[code] = v.trim(); continue; }      // POLYLINE 머리부(플래그 70 등)
      if (!cur) continue;
      if (cur.t === 'VERTEX') { cur.g[code] = v.trim(); continue; }
      if (code === 8) { cur.layer = v.trim(); continue; }
      if (cur.t === 'LWPOLYLINE') {
        if (code === 10) cur.v.push([parseFloat(v), 0, 0]); else if (code === 20 && cur.v.length) cur.v[cur.v.length - 1][1] = parseFloat(v);
        else if (code === 42 && cur.v.length) cur.v[cur.v.length - 1][2] = parseFloat(v); else if (code === 70 || code === 67 || code === 330) cur.g[code] = v.trim();
        continue;
      }
      if (code === 1 || code === 2) cur.g[code] = v; else if (code === 3) cur.extra += v; else cur.g[code] = v.trim();
    }
    if (poly) finish(poly); else if (cur && cur.t !== 'VERTEX') finish(cur);
    layers.forEach(ly => { if (layerColor[ly.name]) ly.color = layerColor[ly.name]; });
    if (!ents.length) { bounds.minx = bounds.miny = 0; bounds.maxx = bounds.maxy = 1; }
    return { ents, layers, bounds, meta };
  }

  // 선택 가능한 꼭짓점 목록 [[x,y]]
  function vertices(e) {
    if (e.t === 'L') return [[e.x1, e.y1], [e.x2, e.y2]];
    if (e.t === 'P') return e.pts; if (e.t === 'C' || e.t === '.' || e.t === 'I' || e.t === 'T') return [[e.x, e.y]]; return [];
  }
  // 점 (x,y) 에서 엔티티까지 최소 거리
  function distTo(e, x, y) {
    const seg = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0; return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)); };
    if (e.t === 'L') return seg(e.x1, e.y1, e.x2, e.y2);
    if (e.t === 'P') { let d = 1e300; const p = e.pts; for (let k = 0; k < p.length - 1; k++) d = Math.min(d, seg(p[k][0], p[k][1], p[k + 1][0], p[k + 1][1])); if (e.c && p.length > 2) d = Math.min(d, seg(p[p.length - 1][0], p[p.length - 1][1], p[0][0], p[0][1])); return d; }
    if (e.t === 'C' || e.t === 'A') return Math.abs(Math.hypot(x - e.x, y - e.y) - e.r);
    return Math.hypot(x - e.x, y - e.y);
  }

  // 외톨이(도면틀·기준점 등) 제외한 맞춤용 범위: 엔티티 중심의 p~(1-p) 분위수
  function robustBounds(ents, p) {
    p = p == null ? 0.02 : p; const xs = [], ys = [];
    for (const e of ents) { if (e.b) { xs.push((e.b[0] + e.b[2]) / 2); ys.push((e.b[1] + e.b[3]) / 2); } else if (e.x !== undefined) { xs.push(e.x); ys.push(e.y); } }
    if (!xs.length) return { minx: 0, miny: 0, maxx: 1, maxy: 1 };
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b); const i0 = Math.floor(p * (xs.length - 1)), i1 = Math.ceil((1 - p) * (xs.length - 1));
    return { minx: xs[i0], maxx: xs[i1], miny: ys[i0], maxy: ys[i1] };
  }

  const api = { parse, decode, bulgePts, vertices, distTo, cleanText, robustBounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DXF = api;
})(typeof window !== 'undefined' ? window : globalThis);
