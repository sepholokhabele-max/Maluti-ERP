// Export any report on screen: Excel (one sheet per table), Word (.doc that Word opens and edits) and PDF (print).
import { state, esc, printHtml, today, toast } from './core.js';
import { workbook, tablesToSheets, download } from './xlsx.js';

const css = `body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111}h1{font-size:18pt;margin:0 0 4pt}h2{font-size:14pt;margin:14pt 0 6pt;border-bottom:1px solid #999}h3{font-size:12pt;margin:10pt 0 4pt}
table{border-collapse:collapse;width:100%;margin:6pt 0}th,td{border:1px solid #bbb;padding:3pt 5pt;font-size:9.5pt;vertical-align:top}th{background:#eee;text-align:left}td.r,th.r{text-align:right}tr.tot td{font-weight:bold;background:#f6f6f6}
.muted{color:#666}.badge{border:1px solid #999;border-radius:6pt;padding:0 4pt;font-size:8pt}.cover{border-bottom:3px solid #333;margin-bottom:12pt;padding-bottom:8pt}button,.no-export{display:none}`;
const header = title => { const c = state.company || {}; return `<div class="cover"><div style="font-size:10pt;color:#555">${esc(c.name || '')}${c.reg_no ? ' · ' + esc(c.reg_no) : ''}</div><h1>${esc(title)}</h1><div class="muted" style="font-size:9pt">Printed ${new Date().toLocaleString()} by ${esc((state.user || {}).name || '')}</div></div>`; };
const clean = html => html.replace(/<button[\s\S]*?<\/button>/g, '').replace(/<input[^>]*type="checkbox"[^>]*>/g, '').replace(/<select[\s\S]*?<\/select>/g, '');
const fname = (title, ext) => `${String(title).replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').slice(0, 60)}-${today()}.${ext}`;

export function toExcel(root, title, extraSheets = []) {
  const sheets = [...tablesToSheets(root, title.slice(0, 28)), ...extraSheets];
  if (!sheets.length) throw new Error('There is no table to export');
  download(workbook(sheets), fname(title, 'xlsx'));
}
export function toWord(html, title, { bare } = {}) {
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${bare ? '' : header(title)}${clean(html)}</body></html>`;
  download(new Blob(['﻿', doc], { type: 'application/msword' }), fname(title, 'doc'));
}
export function toPdf(html, title, { bare } = {}) { printHtml(`<style>${css}</style>${bare ? '' : header(title)}${clean(html)}`); }
/** three buttons for a report area */
export function exportButtons(id = 'xp') { return `<span class="row no-print" style="gap:6px"><button class="btn btn-sm" id="${id}-pdf">🖨 PDF</button><button class="btn btn-sm" id="${id}-doc">⬇ Word</button><button class="btn btn-sm" id="${id}-xls">⬇ Excel</button></span>`; }
export function wireExport(id, getRoot, title, extra) {
  const r = () => typeof getRoot === 'function' ? getRoot() : document.querySelector(getRoot);
  const on = (k, f) => { const b = document.getElementById(`${id}-${k}`); if (b) b.onclick = () => { try { f(); } catch (e) { toast(e.message, 'err'); } }; };
  on('pdf', () => toPdf(r().innerHTML, typeof title === 'function' ? title() : title));
  on('doc', () => toWord(r().innerHTML, typeof title === 'function' ? title() : title));
  on('xls', () => toExcel(r(), typeof title === 'function' ? title() : title, extra ? extra() : []));
}
