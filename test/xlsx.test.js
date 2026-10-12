// node test/xlsx.test.js — xlsx.js(의존성 없는 최소 .xlsx 작성기) 검증: ZIP 구조·CRC·시트 XML·한글·숫자 서식
const assert = require('assert');
const XL = require('../xlsx.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } }

const crcRef = u8 => { let c = ~0; for (const b of u8) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return ~c >>> 0; };
// 저장(STORE) 방식 ZIP 읽기: 중앙 디렉터리 → {이름: 바이트}
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = u8.length - 22;
  assert.strictEqual(dv.getUint32(e, true), 0x06054b50, '끝 레코드');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    assert.strictEqual(dv.getUint32(p, true), 0x02014b50, '중앙 디렉터리 항목');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = Buffer.from(u8.subarray(p + 46, p + 46 + nl)).toString('utf8');
    assert.strictEqual(method, 0, 'STORE');
    assert.strictEqual(dv.getUint32(lo, true), 0x04034b50, '로컬 헤더');
    const ln = dv.getUint16(lo + 26, true), lx = dv.getUint16(lo + 28, true), ds = lo + 30 + ln + lx, data = u8.subarray(ds, ds + size);
    assert.strictEqual(crcRef(data), crc, 'CRC ' + name);
    out[name] = data; p += 46 + nl + xl + cl;
  }
  return out;
}
const text = u8 => Buffer.from(u8).toString('utf8');
const SAMPLE = [
  { name: '측량점', headers: ['이름', '코드', 'N(X)', 'E(Y)', 'Z'], fmts: ['s', 's', 'n3', 'n3', 'n3'], rows: [['MH1', 'A&B', 510128.5, 177803.25, 10], ['P<2>', null, 510140.123456, NaN, '']] },
  { name: '정보', headers: ['항목', '값'], fmts: ['s', 's'], rows: [['좌표계', 'EPSG:5186'], ['내보낸 시각', '2026-10-12 19:00']] },
];

t('colName: A, Z, AA, AZ, BA', () => { assert.deepStrictEqual([0, 25, 26, 51, 52].map(XL.colName), ['A', 'Z', 'AA', 'AZ', 'BA']); });
t('crc32 표준 값 ("123456789" = CBF43926)', () => { assert.strictEqual(XL.crc32(new TextEncoder().encode('123456789')), 0xCBF43926); });
t('ZIP: 필수 파트가 모두 있고 CRC 가 맞다', () => {
  const z = readZip(XL.build(SAMPLE));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert(n in z, '없음: ' + n);
  assert(text(z['[Content_Types].xml']).includes('/xl/worksheets/sheet2.xml'));
  const wb = text(z['xl/workbook.xml']); assert(wb.includes('name="측량점"') && wb.includes('name="정보"'));
});
t('시트 XML: 한글 문자열·숫자 서식·특수문자 이스케이프·빈칸 건너뜀', () => {
  const s = text(readZip(XL.build(SAMPLE))['xl/worksheets/sheet1.xml']);
  assert(s.includes('<t>이름</t>'), '머리글');
  assert(/<c r="A2"[^>]*t="inlineStr"><is><t[^>]*>MH1<\/t><\/is><\/c>/.test(s), '문자열 셀');
  assert(/<c r="C2" s="2"><v>510128\.5<\/v><\/c>/.test(s), '숫자 셀(0.000 서식 s=2)');
  assert(s.includes('A&amp;B') && s.includes('P&lt;2&gt;'), '이스케이프');
  assert(!s.includes('r="B3"') && !s.includes('r="D3"') && !s.includes('r="E3"'), 'null/NaN/빈 문자열 셀은 만들지 않음');
  assert(/<c r="C3" s="2"><v>510140\.123456<\/v><\/c>/.test(s), '긴 소수는 값 그대로');
  assert(s.includes('state="frozen"'), '머리글 줄 고정');
});
t('열 너비: 한글이 긴 열은 넓게, 상한 44', () => {
  const s = text(readZip(XL.build([{ name: 'a', headers: ['짧음', '아주아주아주아주아주아주아주아주긴한글머리글입니다만더길게써서상한확인하기위한문장'], fmts: ['s', 's'], rows: [['x', 'y']] }]))['xl/worksheets/sheet1.xml']);
  const w = [...s.matchAll(/<col min="(\d)" max="\d" width="([\d.]+)"/g)].map(m => +m[2]);
  assert.strictEqual(w.length, 2); assert(w[1] > w[0] && w[1] <= 44);
});
t('시트 이름: 31자 초과·금지문자는 안전하게 바꾼다', () => {
  const z = readZip(XL.build([{ name: 'A:B/C?D*E[F]G' + 'x'.repeat(40), headers: ['a'], fmts: ['s'], rows: [] }]));
  const m = /name="([^"]+)"/.exec(text(z['xl/workbook.xml'])); assert(m[1].length <= 31 && !/[:\\/?*\[\]]/.test(m[1]), m[1]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
