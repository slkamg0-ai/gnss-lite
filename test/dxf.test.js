// node test/dxf.test.js — dxf.js 검증 (합성 DXF + core.js 내보내기 왕복)
const assert = require('assert');
const DXF = require('../dxf.js');
const GL = require('../core.js');
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } }
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, (m || '') + ` ${a} vs ${b}`);
const g = (c, v) => c + '\n' + v + '\n';
const ent = (type, layer, ...pairs) => g(0, type) + g(8, layer) + pairs.map(([c, v]) => g(c, v)).join('');
const wrap = (entities, tables) => g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1032') + g(0, 'ENDSEC') + (tables || '') + g(0, 'SECTION') + g(2, 'ENTITIES') + entities + g(0, 'ENDSEC') + g(0, 'EOF');
const BS = String.fromCharCode(92);

const SAMPLE = wrap(
  ent('LINE', 'A', [10, 0], [20, 0], [30, 0], [11, 10], [21, 5], [31, 0]) +
  ent('LWPOLYLINE', 'B', [90, 3], [70, 0], [10, 0], [20, 0], [42, 0.5], [10, 10], [20, 0], [10, 10], [20, 10]) +
  ent('LWPOLYLINE', 'MH', [90, 2], [70, 1], [10, 100], [20, 100], [42, 1], [10, 102], [20, 100], [42, 1]) +
  g(0, 'POLYLINE') + g(8, 'OLD') + g(70, 1) + g(0, 'VERTEX') + g(8, 'OLD') + g(10, 0) + g(20, 0) + g(0, 'VERTEX') + g(8, 'OLD') + g(10, 4) + g(20, 0) + g(0, 'VERTEX') + g(8, 'OLD') + g(10, 4) + g(20, 3) + g(0, 'SEQEND') +
  ent('CIRCLE', 'C', [10, 5], [20, 5], [40, 2]) + ent('ARC', 'C', [10, 0], [20, 0], [40, 3], [50, 0], [51, 90]) + ent('POINT', 'P', [10, 7], [20, 8], [30, 12.5]) +
  ent('TEXT', 'T', [10, 1], [20, 2], [40, 0.5], [1, '맨홀%%c900 %%d']) + ent('MTEXT', 'T', [10, 3], [20, 4], [40, 0.5], [1, '{' + BS + 'fArial;Hello}' + BS + 'Pworld']) +
  ent('INSERT', 'I', [2, 'MH_BLOCK'], [10, 50], [20, 60], [50, 30]) +
  ent('LINE', 'PS', [67, 1], [10, 0], [20, 0], [11, 1], [21, 1]));                                            // 종이 공간 → 제외

t('엔티티 종류별 파싱', () => {
  const r = DXF.parse(SAMPLE), c = {}; r.ents.forEach(e => c[e.t] = (c[e.t] || 0) + 1);
  assert.deepStrictEqual(c, { L: 1, P: 2, C: 2, A: 1, '.': 1, T: 2, I: 1 });          // 2정점 폐합 bulge=원(C 포함), 종이공간 LINE 제외
  assert(r.ents.some(e => e.t === 'C' && e.poly && Math.abs(e.x - 101) < 1e-9 && Math.abs(e.r - 1) < 1e-9));
});
t('POLYLINE/VERTEX 폐합', () => { const p = DXF.parse(SAMPLE).ents.filter(e => e.t === 'P'); const old = p.find(e => e.pts.length === 3); assert(old && old.c === true); });
t('LWPOLYLINE bulge → 호 점열 (반지름 일정, 진행방향 오른쪽으로 볼록)', () => {
  const pl = DXF.parse(SAMPLE).ents.find(e => e.t === 'P' && e.pts.length > 3), iEnd = pl.pts.findIndex(q => q[0] === 10 && q[1] === 0);
  assert(iEnd > 3);                                                                     // 첫 변(0,0)→(10,0), bulge 0.5 → 중간 점 다수
  const b = 0.5, R = 10 / 2 * (1 + b * b) / (2 * b), cy = 10 / 2 * (1 - b * b) / (2 * b);  // 중심 (5, +cy)
  pl.pts.slice(0, iEnd + 1).forEach(q => near(Math.hypot(q[0] - 5, q[1] - cy), R, 1e-9));
  assert(pl.pts.slice(1, iEnd).every(q => q[1] < 0));
});
t('bulgePts: 반원(b=1) 중점 (0,-1), 모든 점이 반지름 1', () => {
  const a = DXF.bulgePts(-1, 0, 1, 0, 1, 10); assert(a.length >= 5); a.forEach(p => near(Math.hypot(p[0], p[1]), 1, 1e-9)); const mid = a.reduce((m, p) => Math.abs(p[0]) < Math.abs(m[0]) ? p : m); near(mid[1], -1, 1e-6);
  const c = DXF.bulgePts(-1, 0, 1, 0, -1, 10); near(c.reduce((m, p) => Math.abs(p[0]) < Math.abs(m[0]) ? p : m)[1], 1, 1e-6);   // 음수 = 반대쪽
});
t('문자 정리: %%c %%d, MTEXT 서식, 유니코드 이스케이프', () => {
  const T = DXF.parse(SAMPLE).ents.filter(e => e.t === 'T').map(e => e.s);
  assert(T.includes('맨홀Ø900 °')); assert(T.includes('Hello world'));
  assert.strictEqual(DXF.cleanText(BS + 'U+B9E8' + BS + 'U+D640'), '맨홀');
});
t('INSERT 삽입점/이름', () => { const i = DXF.parse(SAMPLE).ents.find(e => e.t === 'I'); assert.strictEqual(i.name, 'MH_BLOCK'); near(i.x, 50, 0); near(i.y, 60, 0); });
t('소유 블록(330)이 모형 공간이 아니면 제외', () => {
  const tables = g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'BLOCK_RECORD') + g(0, 'BLOCK_RECORD') + g(5, '1F') + g(2, '*Model_Space') + g(0, 'BLOCK_RECORD') + g(5, '2A') + g(2, '*Paper_Space') + g(0, 'ENDTAB') + g(0, 'ENDSEC');
  const r = DXF.parse(wrap(ent('LINE', 'M', [330, '1F'], [10, 0], [20, 0], [11, 1], [21, 1]) + ent('LINE', 'Q', [330, '2A'], [10, 0], [20, 0], [11, 5], [21, 5]) + ent('LWPOLYLINE', 'Q', [330, '2A'], [90, 2], [70, 0], [10, 0], [20, 0], [10, 1], [20, 1]), tables));
  assert.strictEqual(r.ents.length, 1); assert.strictEqual(r.layers[r.ents[0].l].name, 'M');
});
t('레이어 색상(ACI)/카운트', () => {
  const tbl = g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(0, 'LAYER') + g(2, 'A') + g(62, 1) + g(0, 'ENDTAB') + g(0, 'ENDSEC');
  const r = DXF.parse(wrap(ent('LINE', 'A', [10, 0], [20, 0], [11, 1], [21, 1]), tbl)); assert.strictEqual(r.layers[0].name, 'A'); assert.strictEqual(r.layers[0].count, 1); assert.strictEqual(r.layers[0].color, '#e11d48');
});
t('거리/꼭짓점/견고한 범위', () => {
  const r = DXF.parse(SAMPLE), ln = r.ents.find(e => e.t === 'L');
  near(DXF.distTo(ln, 5, 2.5), 0, 1e-9); near(DXF.distTo(ln, 0, 3), 30 / Math.hypot(10, 5), 1e-9); assert.strictEqual(DXF.vertices(ln).length, 2);
  const big = []; for (let k = 0; k < 100; k++) big.push({ t: '.', x: 1000 + k, y: 2000 + k }); big.push({ t: '.', x: -40000, y: 0 });
  const rb = DXF.robustBounds(big, 0.02); assert(rb.minx > 900 && rb.maxx < 1200);
});
t('core.js dxfBuilder 출력 왕복 (한글 이스케이프 → 복원)', () => {
  const d = GL.dxfBuilder(); d.layer('MH', 1); d.layer('PIPE', 5); d.line('PIPE', 0, 0, 30, 40); d.circle('MH', 0, 0, 0.6); d.text('MH', 1, 1, 0.5, '맨홀1 EL10.000'); d.point('MH', 3, 4, 9.5);
  const r = DXF.parse(d.toString()), c = {}; r.ents.forEach(e => c[e.t] = (c[e.t] || 0) + 1);
  assert.deepStrictEqual(c, { L: 1, C: 1, T: 1, '.': 1 }); assert.strictEqual(r.ents.find(e => e.t === 'T').s, '맨홀1 EL10.000');
  near(r.ents.find(e => e.t === '.').z, 9.5, 1e-9);
});
t('CP949 바이트 디코딩 (UTF-8 실패 시 euc-kr)', () => {
  const u8 = Uint8Array.from([0x31, 0x0a, 0xb8, 0xc7, 0xc8, 0xa6]);        // "1\n맨홀" (CP949)
  assert.strictEqual(DXF.decode(u8), '1\n맨홀');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
