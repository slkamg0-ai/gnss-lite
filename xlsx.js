/* 최소 .xlsx(엑셀) 작성기 — 외부 라이브러리 없이 ZIP(STORE) + OOXML 로 만든다. 브라우저(window.XL)와 Node(module.exports) 공용.
   시트 형식: { name, headers: [..], rows: [[..]], fmts: ['s' | 'n0' | 'n1' | 'n2' | 'n3' | 'n5' ...] }
   - 숫자 칸(n*)에 유한한 수가 있으면 숫자 셀(서식 적용), null/NaN/빈 문자열은 빈칸, 그 외는 문자열 셀.
   - 첫 줄(머리글) 고정, 열 너비 자동. */
(function (root) {
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : new (require('util').TextEncoder)();

  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  const esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(i) { let n = i + 1, s = ''; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; }
  const safeSheetName = (n, used) => {
    let s = String(n).replace(/[:\\\/?*\[\]]/g, '_').slice(0, 31) || 'Sheet';
    let k = 2, base = s; while (used.has(s.toLowerCase())) { const suf = '_' + k++; s = base.slice(0, 31 - suf.length) + suf; }
    used.add(s.toLowerCase()); return s;
  };

  // 서식 → 스타일 번호(cellXfs 순서와 일치)
  const STYLE = { s: 0, n3: 2, n2: 3, n1: 4, n5: 5, n0: 6 };

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<styleSheet xmlns="${NS}">` +
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="0.000"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="0.0"/><numFmt numFmtId="167" formatCode="0.00000"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EBD8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF7D8F5A"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const strW = s => { let w = 0; for (const ch of String(s)) w += ch.charCodeAt(0) > 255 ? 2 : 1; return w; };

  function sheetXml(sh, first) {
    const fm = sh.fmts || [], H = sh.headers || [], R = sh.rows || [];
    const ncol = Math.max(H.length, ...R.map(r => r.length), 1);
    const widths = Array.from({ length: ncol }, (_, c) => {
      let w = strW(H[c] == null ? '' : H[c]);
      for (const r of R) { const v = r[c]; if (v != null && v !== '') w = Math.max(w, typeof v === 'number' ? 11 : strW(v)); }
      return Math.min(44, Math.max(8, w + 2));
    });
    const cell = (r, c, v, fmt) => {
      const ref = colName(c) + r;
      if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
      const st = STYLE[fmt];
      if (st !== undefined && fmt !== 's' && typeof v === 'number') return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + `<worksheet xmlns="${NS}">`;
    x += `<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;
    x += '<sheetFormatPr defaultRowHeight="15"/><cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
    x += '<row r="1" ht="22" customHeight="1">' + H.map((h, c) => `<c r="${colName(c)}1" s="1" t="inlineStr"><is><t>${esc(h)}</t></is></c>`).join('') + '</row>';
    R.forEach((row, i) => { x += `<row r="${i + 2}">` + row.map((v, c) => cell(i + 2, c, v, fm[c] || 's')).join('') + '</row>'; });
    return x + '</sheetData></worksheet>';
  }

  function zip(files) {
    const parts = [], central = []; let off = 0;
    const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const lh = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(crc), ...u32(sz), ...u32(sz), ...u16(nm.length), ...u16(0)]);
      parts.push(lh, nm, f.data); central.push({ nm, crc, sz, off }); off += lh.length + nm.length + sz;
    }
    const cdStart = off; let cdSize = 0;
    for (const c of central) {
      const h = Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosT), ...u16(dosD), ...u32(c.crc), ...u32(c.sz), ...u32(c.sz), ...u16(c.nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(c.off)]);
      parts.push(h, c.nm); cdSize += h.length + c.nm.length;
    }
    parts.push(Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(cdStart), ...u16(0)]));
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function build(sheets) {
    const used = new Set(), names = sheets.map(s => safeSheetName(s.name, used)), n = sheets.length;
    const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const files = [
      { name: '[Content_Types].xml', text: xmlHead + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: xmlHead + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: xmlHead + `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` + names.map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: xmlHead + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', text: STYLES },
    ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s, i === 0) })));
    return zip(files.map(f => ({ name: f.name, data: enc.encode(f.text) })));
  }

  const api = { build, colName, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XL = api;
})(typeof window !== 'undefined' ? window : globalThis);
