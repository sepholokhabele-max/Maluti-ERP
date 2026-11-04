// Tiny Excel (.xlsx) writer – no libraries. Sheets of rows; numbers stay numbers, first row bold.
const enc = new TextEncoder();
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** zip with "stored" entries (no compression) – plenty for spreadsheets */
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** sheets: [{ name, rows: [[cell…]…] }] – a cell is a string or a number */
export function workbook(sheets) {
  const used = new Set();
  const names = sheets.map((s, i) => { let n = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Sheet${i + 1}`; let k = n, j = 2; while (used.has(k)) k = `${n.slice(0, 28)} ${j++}`; used.add(k); return k; });
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`]
  ];
  sheets.forEach((s, i) => {
    const widths = [];
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = col(ci) + (ri + 1); const head = (ri === 0 && s.header !== false) || (s.boldRows || []).includes(ri);
      widths[ci] = Math.max(widths[ci] || 8, Math.min(60, String(v ?? '').length + 2));
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${Number.isInteger(v) ? (head ? ' s="1"' : '') : (head ? ' s="3"' : ' s="2"')}><v>${v}</v></c>`;
      if (v === null || v === undefined || v === '') return '';
      return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData></worksheet>`]);
  });
  return zip(files);
}

/** "M 1,234.50" → 1234.5 ; "12%" → 12 ; dates and text stay text */
export function cellValue(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const m = /^(-?)\s*(?:M|R|LSL|ZAR)?\s*(-?)([\d,]+(?:\.\d+)?)\s*(%|h|kg)?$/.exec(t);
  if (m && /\d/.test(m[3]) && !/^0\d/.test(m[3].replace(/,/g, ''))) { const n = Number(m[3].replace(/,/g, '')); if (isFinite(n)) return (m[1] || m[2] ? -1 : 1) * n; }
  return t;
}

/** every visible table on the screen becomes a sheet; buttons, inputs and selects are read as their values */
export function tablesToSheets(root, title) {
  const tables = [...root.querySelectorAll('table')].filter(t => t.offsetParent !== null && t.rows.length > 1);
  return tables.map((t, i) => {
    // the nearest heading above the table names the sheet (e.g. "Income", "Expenses"), else the card's title
    let h = null; for (let el = t.closest('.table-wrap') || t; el && !h; el = el.previousElementSibling) if (/^H[2-4]$/.test(el.tagName)) h = el;
    if (!h) { const card = t.closest('.card'); h = card && card.querySelector('h3'); }
    const rows = [...t.rows].map(tr => [...tr.cells].map(td => {
      const inp = td.querySelector('input:not([type=checkbox]), select');
      if (inp) return cellValue(inp.tagName === 'SELECT' ? (inp.selectedOptions[0] || {}).textContent || '' : inp.value);
      const cb = td.querySelector('input[type=checkbox]'); if (cb) return cb.checked ? 'Yes' : '';
      const c = td.cloneNode(true); c.querySelectorAll('button').forEach(b => b.remove()); c.querySelectorAll('br').forEach(b => b.replaceWith(' '));
      return td.tagName === 'TH' ? c.textContent.replace(/\s+/g, ' ').trim() : cellValue(c.textContent);
    }));
    const tot = [...t.rows].map((tr, ri) => tr.classList.contains('tot') || tr.parentElement.tagName === 'TFOOT' ? ri : -1).filter(x => x >= 0);
    return { name: (h && h.textContent.trim()) || (tables.length > 1 ? `${title} ${i + 1}` : title), rows, header: !!(t.tHead && t.tHead.rows.length), boldRows: tot };
  });
}

export function download(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
