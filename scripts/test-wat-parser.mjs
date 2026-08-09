import fs from 'fs';
import { decodeWindows1250 } from '../src/watEncoding.js';

const ROMAN_MONTHS = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
const SLOT_TIMES = {
  '1-2': ['08', '00', '09', '30'],
  '3-4': ['10', '00', '11', '30'],
  '5-6': ['12', '00', '13', '30'],
  '7-8': ['14', '00', '15', '30']
};
const DAY_LABELS = new Set(['pon.', 'wt.', 'śr.', 'sr.', 'czw.', 'pt.', 'sob.', 'niedz.']);

function parseSpanAttribute(attrs, name) {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*"?([0-9]+)"?`, 'i'));
  return match ? Number(match[1]) : 1;
}

function isLegendTd(attrs) {
  return /mergeWith=/i.test(attrs) || /WIDTH\s*=\s*100/i.test(attrs);
}

function parseTdCells(rowHtml) {
  const cells = [];
  const cellRe = /<TD([^>]*)>([\s\S]*?)<\/TD>/gi;
  let match = cellRe.exec(rowHtml);
  while (match) {
    const attrs = match[1];
    if (isLegendTd(attrs)) {
      match = cellRe.exec(rowHtml);
      continue;
    }
    const innerHtml = match[2];
    const text = innerHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const bgMatch = attrs.match(/BGCOLOR=([^ >]+)/i);
    cells.push({
      text,
      bg: (bgMatch?.[1] || '').toLowerCase(),
      rowspan: parseSpanAttribute(attrs, 'ROWSPAN'),
      colspan: parseSpanAttribute(attrs, 'COLSPAN')
    });
    match = cellRe.exec(rowHtml);
  }
  return cells;
}

function buildScheduleMatrix(rows) {
  const matrix = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    while (matrix.length <= rowIndex) matrix.push(Array(600).fill(null));
    let col = 0;
    for (const cell of parseTdCells(rows[rowIndex])) {
      while (col < 600 && matrix[rowIndex][col] != null) col += 1;
      for (let rowOffset = 0; rowOffset < cell.rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        while (matrix.length <= targetRow) matrix.push(Array(600).fill(null));
        for (let colOffset = 0; colOffset < cell.colspan; colOffset += 1) {
          matrix[targetRow][col + colOffset] = cell;
        }
      }
      col += cell.colspan;
    }
  }
  return matrix;
}

function isDataCell(cell) {
  if (!cell?.text || cell.text === '\u00a0' || cell.text === '&nbsp') return false;
  if (!cell.bg || cell.bg === 'silver' || cell.bg === '#ffffff') return false;
  return cell.bg.startsWith('#');
}

const raw = fs.readFileSync('/tmp/WMT24AX1S1.htm');
const decoded = decodeWindows1250(raw);
const tableMatch = decoded.match(/<table[^>]*style="font-size:5px;">([\s\S]*?)<\/table>/i);
const rows = [...tableMatch[1].matchAll(/<TR[^>]*>([\s\S]*?)<\/TR>/gi)].map((m) => m[1]);
const matrix = buildScheduleMatrix(rows);

const june3 = [];
for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
  const slotLabel = matrix[rowIndex][1]?.text?.trim() || '';
  if (SLOT_TIMES[slotLabel]) continue;
  const dayLabel = matrix[rowIndex][0]?.text?.trim().toLowerCase() || '';
  if (!DAY_LABELS.has(dayLabel)) continue;

  let col03 = null;
  for (let c = 0; c < 600; c += 1) {
    if (matrix[rowIndex][c]?.text === '03 VI') col03 = c;
  }
  if (col03 == null) continue;

  let slotRowIndex = rowIndex + 1;
  while (slotRowIndex < matrix.length) {
    const slot = matrix[slotRowIndex][1]?.text?.trim() || '';
    const times = SLOT_TIMES[slot];
    if (!times) break;
    const cell = matrix[slotRowIndex][col03];
    if (isDataCell(cell)) {
      june3.push({ slot, text: cell.text, times });
    }
    slotRowIndex += 1;
  }
}

console.log('June 3 WMT24AX1S1:');
for (const e of june3) {
  console.log(`${e.times[0]}:${e.times[1]}-${e.times[2]}:${e.times[3]}`, e.text);
}
