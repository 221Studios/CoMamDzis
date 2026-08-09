import { formatLocalDateTimeFromParts, toDateKey } from './dateUtils';

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

const EXAM_REGEX = /exam|egzamin/i;
const CANCELLED_REGEX = /canceled|cancelled|odwoł|odwol/i;

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCellText(html) {
  return stripHtml(html);
}

function parsePolishDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dotted = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotted) return new Date(Number(dotted[3]), Number(dotted[2]) - 1, Number(dotted[1]));
  return null;
}

function parseTimeParts(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function detectScheduleGridId(html) {
  const source = String(html || '');
  const match =
    source.match(/id="(gridViewPlany[^"]*)"/i) ||
    source.match(/id="(gridViewPlan[^"]*)"/i) ||
    source.match(/gridViewPlanyTokow/i);
  if (match?.[1]) return match[1];
  if (/gridViewPlanyTokow/i.test(source)) return 'gridViewPlanyTokow';
  return '';
}

function extractGroupDates(html, gridId) {
  const source = String(html || '');
  const safeId = gridId || 'gridViewPlanyTokow';
  const pattern = new RegExp(
    `id="${safeId}_DXGroupRowExp[^"]*"[^>]*>([\\s\\S]*?)<\\/tr>`,
    'gi'
  );
  const dates = [];
  let match = pattern.exec(source);
  while (match) {
    const text = extractCellText(match[1])
      .replace(/Data zajęć:\s*/i, '')
      .replace(/Date of classes:\s*/i, '')
      .trim();
    dates.push(text);
    match = pattern.exec(source);
  }
  return dates;
}

function extractDataRows(html) {
  const source = String(html || '');
  const pattern = /<tr[^>]*class="[^"]*dxgvDataRow[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let match = pattern.exec(source);
  while (match) {
    const cells = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch = cellPattern.exec(match[1]);
    while (cellMatch) {
      cells.push(extractCellText(cellMatch[1]));
      cellMatch = cellPattern.exec(match[1]);
    }
    if (cells.length >= 4) rows.push(cells);
    match = pattern.exec(source);
  }
  return rows;
}

function createRowObject(cells) {
  const startDate = cells[1];
  if (!startDate || !/^\d{1,2}:\d{2}$/.test(startDate)) return null;

  const comments = cells[10] || '';
  return {
    startDate,
    endDate: cells[2] || '',
    duration: cells[3] || '',
    subject: cells[4] || '',
    form: cells[5] || '',
    group: cells[6] || '',
    place: cells[7] || '',
    lecturer: cells[8] || '',
    passing: cells[9] || '',
    comments,
    isExam: EXAM_REGEX.test(comments),
    isCancelled: CANCELLED_REGEX.test(comments)
  };
}

function groupRowsByDate(rows, dates) {
  const flat = [];
  let currentDateIndex = 0;
  let maxHour = 0;

  for (const cells of rows) {
    const row = createRowObject(cells);
    if (!row) continue;
    const rowHour = Number(row.startDate.split(':')[0]);
    if (flat.length && rowHour < maxHour) currentDateIndex += 1;
    maxHour = rowHour;
    flat.push({
      ...row,
      date: dates[currentDateIndex] || dates[dates.length - 1] || ''
    });
  }

  return flat;
}

function normalizeEvent(row, index) {
  const date = parsePolishDate(row.date);
  const startParts = parseTimeParts(row.startDate);
  const endParts = parseTimeParts(row.endDate) || (startParts ? [startParts[0] + 1, startParts[1]] : null);
  if (!date || !startParts || !endParts) return null;

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

  const title = row.subject || 'Zajęcia';
  const room = row.place || '';
  const form = row.form || '';
  const lecturer = row.lecturer || '';
  const status = row.isCancelled ? 'cancelled' : row.isExam ? 'exam' : '';

  return {
    id: `wseit-${toDateKey(date)}-${start}-${title}-${room}-${index}`,
    type: 'WSEIT',
    title,
    module: [lecturer, room, title, form].filter(Boolean).join(' '),
    form,
    start,
    end,
    room,
    roomName: room,
    teachers: lecturer ? [lecturer] : [],
    teacherNames: lecturer ? [lecturer] : [],
    buildingName: '',
    buildingAddress: '',
    subject: title,
    additionalInfo: [row.comments, row.group, row.passing].filter(Boolean).join(' · '),
    groupName: row.group || '',
    locationMode: '',
    color: '#04427c',
    status,
    hangoutLink: '',
    hangoutLinkLabel: ''
  };
}

export function parseWseitScheduleHtmlToEvents(html, startDateKey, endDateKey) {
  const source = String(html || '');
  if (!source.trim()) return [];

  const gridId = detectScheduleGridId(source);
  const dates = extractGroupDates(source, gridId);
  const rows = extractDataRows(source);
  const groupedRows = groupRowsByDate(rows, dates);

  const rangeStart = parseDateKey(startDateKey);
  const rangeEnd = parseDateKey(endDateKey);
  const events = [];
  let index = 0;

  for (const row of groupedRows) {
    const event = normalizeEvent(row, index);
    index += 1;
    if (!event) continue;

    const eventDate = parseDateKey(event.start.slice(0, 10));
    if (rangeStart && eventDate && eventDate < rangeStart) continue;
    if (rangeEnd && eventDate && eventDate > rangeEnd) continue;
    events.push(event);
  }

  return events;
}
