import { formatLocalDateTimeFromParts, toDateKey } from './dateUtils';

const ROMAN_MONTHS = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12
};

const DAY_LABEL_TO_DOW = {
  'pon.': 0,
  'wt.': 1,
  'śr.': 2,
  'sr.': 2,
  'czw.': 3,
  'pt.': 4,
  'sob.': 5,
  'niedz.': 6
};

const SLOT_TIMES = {
  '1-2': ['08', '00', '09', '30'],
  '3-4': ['10', '00', '11', '30'],
  '5-6': ['12', '00', '13', '30'],
  '7-8': ['14', '00', '15', '30'],
  '9-10': ['16', '00', '17', '30'],
  '11-12': ['18', '00', '19', '30'],
  '13-14': ['20', '00', '21', '30'],
  '15-16': ['22', '00', '23', '30']
};

const FORM_LABELS = {
  w: 'Wykład',
  W: 'Wykład',
  l: 'Laboratorium',
  L: 'Laboratorium',
  'ć': 'Ćwiczenia',
  'Ć': 'Ćwiczenia',
  c: 'Ćwiczenia',
  e: 'Egzamin',
  E: 'Egzamin',
  s: 'Seminarium',
  S: 'Seminarium',
  z: 'Zaliczenie',
  Z: 'Zaliczenie',
  p: 'Projekt',
  P: 'Projekt'
};

function decodePlansoftHtml(html) {
  return String(html || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/gi, ' ');
}

function extractSemesterMeta(html) {
  const decoded = decodePlansoftHtml(html);
  const years = decoded.match(/(\d{4})\s*\/\s*(\d{4})/);
  const isSummer = /LATO|SUMMER/i.test(decoded);
  const isWinter = /ZIMA|WINTER/i.test(decoded);
  return {
    start: years ? Number(years[1]) : null,
    end: years ? Number(years[2]) : null,
    term: isSummer ? 'lato' : isWinter ? 'zima' : 'lato'
  };
}

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
      innerHtml,
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
    while (matrix.length <= rowIndex) {
      matrix.push(Array(600).fill(null));
    }

    let col = 0;
    for (const cell of parseTdCells(rows[rowIndex])) {
      while (col < 600 && matrix[rowIndex][col] != null) {
        col += 1;
      }

      for (let rowOffset = 0; rowOffset < cell.rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        while (matrix.length <= targetRow) {
          matrix.push(Array(600).fill(null));
        }
        for (let colOffset = 0; colOffset < cell.colspan; colOffset += 1) {
          matrix[targetRow][col + colOffset] = cell;
        }
      }

      col += cell.colspan;
    }
  }

  return matrix;
}

function isDayLabel(label) {
  return DAY_LABEL_TO_DOW[String(label || '').trim().toLowerCase()] != null;
}

function parseRomanDateLabel(label, semesterMeta) {
  const match = String(label || '')
    .trim()
    .match(/^(\d{1,2})\s+([IVXLC]+)$/i);
  if (!match) return null;

  const day = Number(match[1]);
  const month = ROMAN_MONTHS[match[2].toUpperCase()];
  if (!month || !day) return null;

  const ayStart = semesterMeta?.start;
  const ayEnd = semesterMeta?.end;
  const term = semesterMeta?.term || 'lato';

  let year = new Date().getFullYear();
  if (ayStart && ayEnd) {
    if (term === 'lato') {
      year = month >= 2 && month <= 7 ? ayEnd : ayStart;
    } else if (month >= 9) {
      year = ayStart;
    } else if (month <= 2) {
      year = ayEnd;
    } else {
      year = ayEnd;
    }
  }

  return new Date(year, month - 1, day);
}

function extractDateColumns(matrix, rowIndex, semesterMeta) {
  const dateColumns = [];
  for (let col = 0; col < 600; col += 1) {
    const cell = matrix[rowIndex][col];
    if (!cell || cell.bg !== 'silver') continue;
    const parsed = parseRomanDateLabel(cell.text, semesterMeta);
    if (parsed) {
      dateColumns.push({ col, date: parsed });
    }
  }
  return dateColumns;
}

function isDataCell(cell) {
  if (!cell?.text || cell.text === '\u00a0' || cell.text === '&nbsp') return false;
  if (!cell.bg || cell.bg === 'silver' || cell.bg === '#ffffff') return false;
  if (cell.bg.includes('outofrange')) return false;
  return cell.bg.startsWith('#');
}

function extractCellLines(innerHtml) {
  return String(innerHtml || '')
    .split(/<br\s*\/?>/i)
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseCellContent(cell) {
  const lines = extractCellLines(cell.innerHtml);
  if (lines.length >= 3) {
    const formChar = lines[lines.length - 1];
    const subject = lines[lines.length - 2];
    const room = lines[lines.length - 3];
    const instructor = lines.length > 3 ? lines.slice(0, lines.length - 3).join(' ') : lines[0];
    const form = FORM_LABELS[formChar] || formChar;
    const module = [instructor, room, subject, formChar].filter(Boolean).join(' ');

    return {
      title: subject || module,
      subject: subject || '',
      form,
      room: room.replace(/\s+/g, ' ').trim(),
      module
    };
  }

  const text = String(cell.text || '').trim();
  if (!text) {
    return { title: 'Zajęcia', form: '', room: '', subject: '' };
  }

  const formChar = text.slice(-1);
  const form = FORM_LABELS[formChar] || formChar;
  const body = FORM_LABELS[formChar] ? text.slice(0, -1).trim() : text;

  const roomMatch = body.match(/(\d{1,3}(?:\s*[/;]\s*\d{1,3})*(?:\s+\d{1,3})*)/);
  const room = roomMatch ? roomMatch[1].replace(/\s+/g, ' ').trim() : '';

  const subjectMatch = body.match(/([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{2,6})$/);
  const subject = subjectMatch ? subjectMatch[1] : '';

  return {
    title: subject || body,
    subject,
    form,
    room,
    module: body
  };
}

function normalizeEvent({ date, startParts, endParts, cell, groupCode }) {
  const start = formatLocalDateTimeFromParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    startParts[0],
    startParts[1]
  );
  const end = formatLocalDateTimeFromParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    endParts[0],
    endParts[1]
  );
  const parsed = parseCellContent(cell);
  const title = parsed.subject || parsed.title;

  return {
    id: `wat-${groupCode}-${toDateKey(date)}-${start}-${title}-${parsed.room}`,
    type: 'WAT',
    title,
    module: parsed.module,
    form: parsed.form,
    start,
    end,
    room: parsed.room,
    roomName: parsed.room,
    teachers: [],
    teacherNames: [],
    buildingName: '',
    buildingAddress: '',
    subject: parsed.subject,
    additionalInfo: cell.text,
    groupName: groupCode,
    locationMode: '',
    color: '#ff6600',
    status: '',
    hangoutLink: '',
    hangoutLinkLabel: ''
  };
}

function parseDateKeyLocal(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function parsePlansoftHtmlToEvents(html, groupCode, startDateKey, endDateKey) {
  const decoded = decodePlansoftHtml(html);
  const semesterMeta = extractSemesterMeta(decoded);

  const tableMatch =
    decoded.match(/<table[^>]*style="font-size:5px;">([\s\S]*?)<\/table>/i) ||
    decoded.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) {
    throw new Error('Nie rozpoznano siatki planu WAT (Plansoft).');
  }

  const rows = [...tableMatch[1].matchAll(/<TR[^>]*>([\s\S]*?)<\/TR>/gi)].map((m) => m[1]);
  const matrix = buildScheduleMatrix(rows);

  const startDate = parseDateKeyLocal(startDateKey);
  const endExclusive = parseDateKeyLocal(endDateKey);
  const events = [];

  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    const slotLabel = matrix[rowIndex][1]?.text?.trim() || '';
    if (SLOT_TIMES[slotLabel]) continue;

    const dayLabel = matrix[rowIndex][0]?.text?.trim() || '';
    if (!isDayLabel(dayLabel)) continue;

    const dateColumns = extractDateColumns(matrix, rowIndex, semesterMeta);
    if (!dateColumns.length) continue;

    let slotRowIndex = rowIndex + 1;
    while (slotRowIndex < matrix.length) {
      const slot = matrix[slotRowIndex][1]?.text?.trim() || '';
      const times = SLOT_TIMES[slot];
      if (!times) break;

      for (const { col, date } of dateColumns) {
        if (date < startDate || date >= endExclusive) continue;

        const cell = matrix[slotRowIndex][col];
        if (!isDataCell(cell)) continue;

        events.push(
          normalizeEvent({
            date,
            startParts: [times[0], times[1]],
            endParts: [times[2], times[3]],
            cell,
            groupCode
          })
        );
      }

      slotRowIndex += 1;
    }
  }

  const unique = new Map();
  for (const event of events) {
    unique.set(`${event.start}|${event.title}|${event.room}|${event.form}`, event);
  }

  return [...unique.values()].sort((a, b) => a.start.localeCompare(b.start));
}
