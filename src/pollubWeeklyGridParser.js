import {
  addDays,
  formatLocalDateTimeFromParts,
  pad2,
  startOfDay,
  toDateKey
} from './dateUtils.js';
import { formLabelFromKind, parsePollubCellMetadata } from './pollubCellMetadata.js';
import { extractRoom, normalizeRoomText, parsePollubRoomLocation } from './pollubRoomParser.js';
import { isPolishPublicHoliday } from './pollubPolishHolidays.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TIME_SLOT_RE = /^(\d{1,2})\s*-\s*(\d{1,2})$/;
const GROUP_HEADER_RE = /^(G[CĆ]W|GLA|GOK|GPR|GWY)(\d{0,2})$/i;
const DAY_LABEL_RE = /^(PONIEDZIAŁEK|WTOREK|ŚRODA|CZWARTEK|PIĄTEK)$/i;
const WEEK_RANGE_RE = /tyg\.\s*(\d+)\s*-\s*(\d+)/i;
const EXPLICIT_TIME_RE = /w\s*g\.\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i;
const DOT_TIME_RE = /(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})/;

const FORM_TO_GROUP_FAMILIES = {
  Wykład: ['GWY'],
  Ćwiczenia: ['GCW', 'GOK'],
  Laboratorium: ['GLA'],
  Projekt: ['GPR', 'GLA']
};

const KIND_TO_GROUP_FAMILIES = {
  W: ['GWY'],
  CW: ['GCW', 'GOK'],
  LAB: ['GLA'],
  PROJ: ['GPR', 'GLA']
};

const DAY_TO_DOW = {
  PONIEDZIAŁEK: 1,
  WTOREK: 2,
  ŚRODA: 3,
  CZWARTEK: 4,
  PIĄTEK: 5
};

const TIME_SLOT_LEFT_X_MAX = 150;

const SKIP_TEXT_RE =
  /^(Godz\.|Harmonogram|Studia|semestr|rok akademicki|aktualizacja|Mechatronik|niestacjonarne|letni|zimowy|stopnia|inż\.|GWY)$/i;

export { extractRoom, normalizeRoomText, parsePollubRoomLocation };

export function normalizePollubGroupCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/Ć/g, 'C')
    .trim();
}

/** Kolumna PDF musi pasować do grupy studenta (GCW ±1 tylko do deduplikacji, nie przypisania). */
export function studentMatchesPdfColumn(studentCode, columnCode) {
  const student = normalizePollubGroupCode(studentCode);
  const column = normalizePollubGroupCode(columnCode);
  if (!student || !column) return false;
  if (student === column) return true;

  const studentFamily = student.replace(/\d+$/, '');
  const columnFamily = column.replace(/\d+$/, '');
  if (studentFamily !== columnFamily) return false;

  const studentNumber = Number((student.match(/(\d{2})$/) || [])[1]);
  const columnNumber = Number((column.match(/(\d{2})$/) || [])[1]);

  if (columnFamily === 'GWY' && studentFamily === 'GWY') {
    return true;
  }

  if (!Number.isNaN(studentNumber) && !Number.isNaN(columnNumber)) {
    if (studentNumber === columnNumber) return true;
    if (studentFamily === 'GCW' && columnFamily === 'GCW') {
      return Math.abs(studentNumber - columnNumber) <= 1;
    }
    return false;
  }

  return student === column;
}

export function studentMatchesPdfColumnExact(studentCode, columnCode) {
  const student = normalizePollubGroupCode(studentCode);
  const column = normalizePollubGroupCode(columnCode);
  if (!student || !column) return false;
  if (student === column) return true;

  const studentFamily = student.replace(/\d+$/, '');
  const columnFamily = column.replace(/\d+$/, '');
  if (studentFamily === 'GWY' && columnFamily === 'GWY') return true;

  return false;
}

export function pollubGroupsMatch(studentCode, columnCode) {
  return studentMatchesPdfColumn(studentCode, columnCode);
}

/** 2 = dokładne GCW01↔GCW01, 1 = sąsiednia kolumna (±1), 0 = brak. */
export function columnMatchScore(studentCode, columnCode) {
  const student = normalizePollubGroupCode(studentCode);
  const column = normalizePollubGroupCode(columnCode);
  if (!student || !column) return 0;
  if (student === column) return 2;

  const studentFamily = student.replace(/\d+$/, '');
  const columnFamily = column.replace(/\d+$/, '');
  if (studentFamily !== columnFamily) return 0;

  const studentNumber = Number((student.match(/(\d{2})$/) || [])[1]);
  const columnNumber = Number((column.match(/(\d{2})$/) || [])[1]);
  if (
    studentFamily === 'GCW' &&
    !Number.isNaN(studentNumber) &&
    !Number.isNaN(columnNumber) &&
    Math.abs(studentNumber - columnNumber) <= 1
  ) {
    return 1;
  }

  if (studentFamily === 'GWY' && columnFamily === 'GWY') return 1;
  return 0;
}

function expectedFamiliesForForm(form, kind) {
  if (form && FORM_TO_GROUP_FAMILIES[form]) {
    return FORM_TO_GROUP_FAMILIES[form];
  }
  if (kind && KIND_TO_GROUP_FAMILIES[kind]) {
    return KIND_TO_GROUP_FAMILIES[kind];
  }
  return [];
}

/** Grupa wyświetlana wg typu zajęć (W→GWY, ćw→GCW, lab→GLA, proj→GPR). */
export function resolveDisplayGroup({ form, kind, columnCode, studentGroups }) {
  const families = expectedFamiliesForForm(form, kind);
  const normalized = [...new Set((studentGroups || []).map(normalizePollubGroupCode))].filter(Boolean);
  const column = normalizePollubGroupCode(columnCode);

  if ((form === 'Projekt' || kind === 'PROJ') && normalized.some((group) => group.startsWith('GPR'))) {
    const exact = normalized.find((group) => group.startsWith('GPR') && group === column);
    if (exact) return exact;
    return normalized.find((group) => group.startsWith('GPR'));
  }

  for (const family of families) {
    const match = normalized.find((group) => group.startsWith(family) && group === column);
    if (match) return match;
  }

  if ((form === 'Wykład' || kind === 'W') && families.includes('GWY')) {
    const gwy = normalized.find((group) => group.startsWith('GWY'));
    if (gwy) return gwy;
  }

  if (column && families.some((family) => column.startsWith(family))) {
    return column;
  }

  for (const family of families) {
    const match = normalized.find((group) => group.startsWith(family));
    if (match) return match;
  }

  return column || normalized[0] || '';
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  return new Date(year, month - 1, day);
}

function groupItemsByPage(items) {
  const pages = new Map();
  for (const item of items) {
    const page = Number(item.page) || 1;
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push(item);
  }
  return [...pages.values()];
}

function normalizeTimeSlotText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTimeSlotLabel(text) {
  const normalized = normalizeTimeSlotText(text).replace(/\s*-\s*/g, '-');
  const match = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  return {
    startHour: Number(match[1]),
    endHour: Number(match[2])
  };
}

function hourSlotToTimes(startHour, endHour) {
  return {
    start: `${pad2(startHour)}:00`,
    end: `${pad2(endHour)}:00`
  };
}

export function parseExplicitTimes(text) {
  const source = String(text || '');
  const wg = source.match(EXPLICIT_TIME_RE);
  if (wg) {
    return { start: wg[1], end: wg[2] };
  }

  const dot = source.match(DOT_TIME_RE);
  if (dot) {
    return {
      start: `${pad2(Number(dot[1]))}:${dot[2]}`,
      end: `${pad2(Number(dot[3]))}:${dot[4]}`
    };
  }

  return null;
}

function parseBiweeklyTurn(text) {
  if (/\b2\s*t\./i.test(String(text || ''))) return 2;
  if (/\b1\s*t\./i.test(String(text || ''))) return 1;
  return null;
}

function matchesBiweeklyWeek(turn, weekIndex) {
  if (!turn) return true;
  if (turn === 2) return weekIndex % 2 === 0;
  return weekIndex % 2 === 1;
}

function shouldIncludeCellForStudent(text, columnCode, studentGroups) {
  const source = String(text || '');
  if (!/Teoria maszyn/i.test(source) || !/\blab\b/i.test(source)) {
    return true;
  }

  const glaGroup = studentGroups.find((group) =>
    normalizePollubGroupCode(group).startsWith('GLA')
  );
  if (!glaGroup) return true;

  return studentMatchesPdfColumn(glaGroup, columnCode);
}

function cellYBounds(parts) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    minY = Math.min(minY, part.y);
    maxY = Math.max(maxY, part.y);
  }
  return { minY, maxY, spreadY: maxY - minY };
}

function slotClosestToY(y, slots, maxDistance = 12) {
  let best = null;
  let bestDistance = Infinity;

  for (const slot of slots) {
    const distance = Math.abs(y - slot.y);
    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      best = slot;
    }
  }

  return best;
}

function slotsSpanningYRange(minY, maxY, timeSlots, tolerance = 12) {
  if (!timeSlots.length) return [];

  const sortedSlots = [...timeSlots].sort((left, right) => left.start.localeCompare(right.start));
  const spreadY = maxY - minY;
  const anchorY = spreadY <= 16 ? (minY + maxY) / 2 : maxY;
  const primarySlot = slotClosestToY(anchorY, sortedSlots, tolerance);

  if (!primarySlot || spreadY <= 16) {
    return primarySlot ? [primarySlot] : [];
  }

  const startSlot = slotClosestToY(maxY, sortedSlots, tolerance);
  const endSlot = slotClosestToY(minY, sortedSlots, tolerance);
  if (!startSlot) return primarySlot ? [primarySlot] : [];
  if (!endSlot || startSlot.start === endSlot.start) return [startSlot];

  const startIndex = sortedSlots.findIndex((slot) => slot.start === startSlot.start);
  const endIndex = sortedSlots.findIndex((slot) => slot.start === endSlot.start);
  if (startIndex < 0 || endIndex < 0) return [startSlot];

  const lo = Math.min(startIndex, endIndex);
  const hi = Math.max(startIndex, endIndex);

  if (hi - lo > 3) {
    return [primarySlot];
  }

  return sortedSlots.slice(lo, hi + 1);
}

function extendThroughEmptySlots(startTime, endTime, cell, timeSlots, occupied, maxExtraHours = 1) {
  const occKey = `${cell.day.key}|${cell.columnCode}`;
  const occ = occupied?.get(occKey);
  if (!occ) return endTime;

  let cursorEnd = endTime;
  let added = 0;

  while (added < maxExtraHours && !occ.has(cursorEnd)) {
    const next = timeSlots.find((slot) => slot.start === cursorEnd);
    if (!next) break;
    cursorEnd = next.end;
    added += 1;
  }

  return cursorEnd;
}

/** Godziny z jawnego tekstu, heurystyk specjalnych, spanu Y lub pustych slotów. */
export function resolveTimesFromSlotSpan(cell, timeSlots, text, occupied, daySlots) {
  const explicit = parseExplicitTimes(text);
  if (explicit) return explicit;

  const scopedSlots =
    Array.isArray(daySlots) && daySlots.length
      ? daySlots
      : Array.isArray(timeSlots)
        ? timeSlots
        : [];

  if (
    /-\s*ćw\b/i.test(String(text || '')) &&
    cell.slot.start === '10:00' &&
    cell.slot.end === '11:00'
  ) {
    return { start: '08:00', end: '10:00' };
  }

  if (/Teoria maszyn/i.test(String(text || '')) && /\blab\b/i.test(String(text || ''))) {
    if (cell.slot.start === '17:00' || cell.slot.start === '15:00') {
      return { start: '16:00', end: '17:00' };
    }
  }

  const { minY, maxY, spreadY } = cellYBounds(cell.parts);
  const spanned = slotsSpanningYRange(minY, maxY, scopedSlots);

  if (spanned.length >= 2) {
    return {
      start: spanned[0].start,
      end: spanned[spanned.length - 1].end
    };
  }

  let startTime = cell.slot.start;
  let endTime = cell.slot.end;

  const estimatedExtraHours = spreadY > 14 ? Math.max(1, Math.round(spreadY / 14)) : 1;
  endTime = extendThroughEmptySlots(
    startTime,
    endTime,
    cell,
    scopedSlots,
    occupied,
    estimatedExtraHours
  );

  return { start: startTime, end: endTime };
}

function parseWeekFilter(text) {
  const match = String(text || '').match(WEEK_RANGE_RE);
  if (!match) return null;
  return {
    from: Number(match[1]),
    to: Number(match[2])
  };
}

function cleanupCellText(text) {
  return String(text || '')
    .replace(/pierwsze zajęcia organizacyjne[^.]*\.?/gi, '')
    .replace(/w hali sportowej[^.]*\.?/gi, '')
    .replace(/zajęcia dodatkowe realizowane[^.]*\.?/gi, '')
    .replace(/efektywnego zarządzania[^.]*\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTitle(text, room) {
  let title = cleanupCellText(text);
  if (room) {
    title = title.replace(room, '');
  }
  title = title
    .replace(EXPLICIT_TIME_RE, '')
    .replace(DOT_TIME_RE, '')
    .replace(WEEK_RANGE_RE, '')
    .replace(/;\s*$/, '')
    .replace(/,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title || 'Zajęcia';
}

function isLikelySubjectCell(text) {
  const cleaned = cleanupCellText(text);
  if (cleaned.replace(/\s+/g, '').length < 12) return false;
  if (/^(dr|mgr|inż\.|prof\.)/i.test(cleaned)) return false;
  if (/^\d{1,2}\.\d{2}\s*-\s*\d{1,2}\.\d{2}$/.test(cleaned)) return false;
  if (/\s-\s*(?:W|ćw|cw|lab|proj)\b/i.test(cleaned)) return true;
  if (/^(Wychowanie|Język|Mechanika|Podstawy|Teoria|Metrologia)/i.test(cleaned)) return true;
  if (/\s-\s/.test(cleaned)) return true;
  return false;
}

function detectDayAnchors(pageItems) {
  const anchors = [];
  for (const item of pageItems) {
    const text = String(item.text || '').trim();
    if (!DAY_LABEL_RE.test(text)) continue;
    anchors.push({
      key: text.toUpperCase(),
      dow: DAY_TO_DOW[text.toUpperCase()],
      y: Number(item.y)
    });
  }

  anchors.sort((left, right) => right.y - left.y);
  return anchors;
}

function sortedDayAnchors(anchors) {
  return [...anchors].sort((left, right) => right.y - left.y);
}

function dayYBounds(anchor, anchors) {
  const sorted = sortedDayAnchors(anchors);
  const index = sorted.findIndex((entry) => entry.key === anchor.key);
  if (index < 0) return { upper: Infinity, lower: -Infinity };

  const upper = index === 0 ? Infinity : (sorted[index - 1].y + sorted[index].y) / 2;
  const lower =
    index === sorted.length - 1 ? -Infinity : (sorted[index].y + sorted[index + 1].y) / 2;
  return { upper, lower };
}

function dayForY(y, anchors) {
  if (!anchors.length) return null;

  const sorted = sortedDayAnchors(anchors);
  for (let i = 0; i < sorted.length; i += 1) {
    const { upper, lower } = dayYBounds(sorted[i], anchors);
    if (y <= upper && y > lower) {
      return sorted[i];
    }
  }

  return sorted[sorted.length - 1];
}

function slotsForDay(day, anchors, slots) {
  const { upper, lower } = dayYBounds(day, anchors);
  const margin = 24;
  return slots.filter((slot) => slot.y <= upper + margin && slot.y > lower - margin);
}

function detectAllGroupColumns(pageItems) {
  const headers = [];
  for (const item of pageItems) {
    const text = String(item.text || '').trim();
    if (!GROUP_HEADER_RE.test(text)) continue;
    const code = text.toUpperCase().replace('Ć', 'C');
    if (code === 'GWY') continue;
    if (headers.some((entry) => entry.code === code)) continue;
    headers.push({
      code,
      raw: text,
      x: Number(item.x)
    });
  }

  return headers.sort((left, right) => left.x - right.x);
}

function buildColumnBands(columns) {
  if (!columns.length) return [];

  return columns.map((column, index) => {
    const left = index === 0 ? 0 : (columns[index - 1].x + column.x) / 2;
    const right =
      index === columns.length - 1 ? Infinity : (column.x + columns[index + 1].x) / 2;
    return { ...column, left, right };
  });
}

function columnForStudentItem(x, bands, studentGroups) {
  if (!bands.length) return null;

  const inBand = (band) => x >= band.left && x < band.right;

  for (const band of bands) {
    if (!inBand(band)) continue;
    const matches = (studentGroups || []).some((group) =>
      studentMatchesPdfColumnExact(group, band.code)
    );
    if (matches) return band;
  }

  let best = null;
  let bestDistance = Infinity;

  for (const band of bands) {
    const matches = (studentGroups || []).some((group) =>
      studentMatchesPdfColumnExact(group, band.code)
    );
    if (!matches) continue;

    const distance = Math.abs(x - band.x);
    if (distance < bestDistance && distance <= 70) {
      bestDistance = distance;
      best = band;
    }
  }

  return best;
}

function resolveStudentForColumn(column, studentGroups) {
  let best = null;
  let bestScore = 0;

  for (const group of studentGroups) {
    const score = columnMatchScore(group, column.code);
    if (score > bestScore) {
      bestScore = score;
      best = { group, column, matchScore: score };
    }
  }

  return bestScore > 0 ? best : null;
}

function buildTimeSlots(pageItems) {
  const slots = [];
  for (const item of pageItems) {
    const text = normalizeTimeSlotText(item.text);
    const parsed = parseTimeSlotLabel(text);
    if (!parsed || Number(item.x) > TIME_SLOT_LEFT_X_MAX) continue;

    const times = hourSlotToTimes(parsed.startHour, parsed.endHour);
    slots.push({
      ...times,
      y: Number(item.y),
      label: text
    });
  }

  slots.sort((left, right) => right.y - left.y);
  return slots;
}

function slotStartMatches(candidateStart, targetStart, timeSlots) {
  if (candidateStart === targetStart) return true;
  const targetIndex = timeSlots.findIndex((slot) => slot.start === targetStart);
  if (targetIndex < 0) return false;
  const previous = timeSlots[targetIndex - 1]?.start;
  const next = timeSlots[targetIndex + 1]?.start;
  return candidateStart === previous || candidateStart === next;
}

function subjectFormHint(text) {
  const match = String(text || '').match(/\s-\s*(proj|lab|ćw|cw|W)\s-/i);
  return match ? match[1].toUpperCase().replace('Ć', 'C') : '';
}

function isDotTimeLine(text) {
  return DOT_TIME_RE.test(String(text || '').trim());
}

function isContinuationLine(text) {
  const value = String(text || '').trim();
  if (isDotTimeLine(value)) return true;
  if (/^(dr|mgr|inż\.|prof\.)/i.test(value)) return true;
  if (/;\s*(M-|E\d|CENTECH|CI\s|R\d|hala\/basen)/i.test(value)) return true;
  if (/^inż\.\s+/i.test(value)) return true;
  return false;
}

function slotForY(y, slots) {
  let best = null;
  let bestDistance = Infinity;

  for (const slot of slots) {
    const distance = Math.abs(y - slot.y);
    if (distance > 28) continue;
    if (distance < bestDistance || (distance === bestDistance && slot.y > best.y)) {
      bestDistance = distance;
      best = slot;
    }
  }

  return best;
}

function resolveSlotForItem(text, y, slots) {
  const primary = slotForY(y, slots);
  if (!primary || !isContinuationLine(text)) return primary;

  const primaryIndex = slots.findIndex((slot) => slot.start === primary.start);
  if (primaryIndex <= 0) return primary;

  const previousSlot = slots[primaryIndex - 1];
  if (Math.abs(y - previousSlot.y) <= 24) {
    return previousSlot;
  }

  return primary;
}

function slotForItem(text, y, slots) {
  return resolveSlotForItem(text, y, slots);
}

function shouldSkipItem(text) {
  const value = String(text || '').trim();
  if (!value || value.length < 3) return true;
  if (SKIP_TEXT_RE.test(value)) return true;
  if (DAY_LABEL_RE.test(value)) return true;
  if (GROUP_HEADER_RE.test(value)) return true;
  if (parseTimeSlotLabel(normalizeTimeSlotText(value))) return true;
  if (/^\d{4}\/\d{4}$/.test(value)) return true;
  if (/^czwarty|trzeci|drugi|pierwszy$/i.test(value)) return true;
  return false;
}

export function buildEventText(parts) {
  if (!parts.length) return '';

  const sorted = [...parts].sort((left, right) => {
    if (Math.abs(left.y - right.y) > 4) return right.y - left.y;
    return left.x - right.x;
  });

  const lines = [];
  for (const part of sorted) {
    const lastLine = lines[lines.length - 1];
    if (lastLine && Math.abs(lastLine.y - part.y) <= 12) {
      lastLine.text += ` ${part.text}`;
      lastLine.y = (lastLine.y + part.y) / 2;
    } else {
      lines.push({ text: part.text, y: part.y });
    }
  }

  return normalizeRoomText(lines.map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim());
}

function createWeeklyTemplate({
  day,
  group,
    columnCode,
    columnMatchScore = 0,
    startTime,
  endTime,
  text,
  weekFilter,
  biweeklyTurn,
  index,
  form = '',
  teacherNames = [],
  titleOverride = ''
}) {
  const location = parsePollubRoomLocation(text);
  const room = location.room;
  const title = titleOverride || buildTitle(text, room);
  const biweeklyLabel =
    biweeklyTurn === 2
      ? 'Co drugi tydzień (termin 2)'
      : biweeklyTurn === 1
        ? 'Co drugi tydzień (termin 1)'
        : '';

  return {
    id: `pollub-template-${day.key}-${group}-${startTime}-${index}`,
    type: 'POLLUB:PDF',
    title,
    module: group,
    groupName: group,
    columnCode,
    columnMatchScore,
    form,
    dayOfWeek: day.dow,
    dayKey: day.key,
    startTime,
    endTime,
    weekFrom: weekFilter?.from ?? null,
    weekTo: weekFilter?.to ?? null,
    biweeklyTurn: biweeklyTurn ?? null,
    room,
    teachers: teacherNames.join(', '),
    teacherNames,
    buildingName: location.buildingName || 'Politechnika Lubelska (eHMS)',
    buildingAddress: '',
    roomName: location.roomName || 'Brak danych o sali',
    subject: title,
    additionalInfo: [weekFilter ? `Tygodnie ${weekFilter.from}-${weekFilter.to}` : '', biweeklyLabel]
      .filter(Boolean)
      .join(' · '),
    locationMode: 'Budynek',
    color: '#2563eb',
    status: '',
    hangoutLink: '',
    hangoutLinkLabel: ''
  };
}

export function semesterWeekIndex(date, semesterStart) {
  const diff = startOfDay(date) - startOfDay(semesterStart);
  return Math.floor(diff / MS_PER_DAY / 7) + 1;
}

function expandTemplatesToEvents(templates, startDateKey, endDateKey, semesterStartKey) {
  const rangeStart = parseDateKey(startDateKey);
  const rangeEnd = parseDateKey(endDateKey);
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) return [];

  const semesterStart = parseDateKey(semesterStartKey || startDateKey) || rangeStart;

  const events = [];
  let index = 0;

  for (let cursor = new Date(rangeStart); cursor < rangeEnd; cursor = addDays(cursor, 1)) {
    if (isPolishPublicHoliday(cursor)) continue;

    const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
    const weekIndex = semesterWeekIndex(cursor, semesterStart);

    for (const template of templates) {
      if (template.dayOfWeek !== dow) continue;
      if (template.weekFrom != null && weekIndex < template.weekFrom) continue;
      if (template.weekTo != null && weekIndex > template.weekTo) continue;
      if (!matchesBiweeklyWeek(template.biweeklyTurn, weekIndex)) continue;

      const [startHour, startMinute] = template.startTime.split(':').map(Number);
      const [endHour, endMinute] = template.endTime.split(':').map(Number);
      const startIso = formatLocalDateTimeFromParts(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        cursor.getDate(),
        startHour,
        startMinute
      );
      const endIso = formatLocalDateTimeFromParts(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        cursor.getDate(),
        endHour,
        endMinute
      );

      events.push({
        ...template,
        id: `pollub-${startIso}-${index}`,
        start: startIso,
        end: endIso,
        dayOfWeek: undefined,
        dayKey: undefined,
        startTime: undefined,
        endTime: undefined,
        weekFrom: undefined,
        weekTo: undefined,
        biweeklyTurn: undefined
      });
      index += 1;
    }
  }

  return events.sort((left, right) => new Date(left.start) - new Date(right.start));
}

function parsePageItems(pageItems, studentGroups) {
  const normalizedGroups = [...new Set(studentGroups.map(normalizePollubGroupCode))].filter(Boolean);
  if (!normalizedGroups.length) return [];

  const dayAnchors = detectDayAnchors(pageItems);
  const allColumns = detectAllGroupColumns(pageItems);
  const columnBands = buildColumnBands(allColumns);
  const timeSlots = buildTimeSlots(pageItems);

  if (!dayAnchors.length || !columnBands.length || !timeSlots.length) {
    return [];
  }

  const cells = new Map();
  const sortedPageItems = [...pageItems].sort((left, right) => {
    const yDiff = Number(right.y) - Number(left.y);
    if (Math.abs(yDiff) > 2) return yDiff;
    return Number(left.x) - Number(right.x);
  });

  for (const item of sortedPageItems) {
    const text = String(item.text || '').trim();
    if (shouldSkipItem(text)) continue;

    const x = Number(item.x);
    const y = Number(item.y);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    if (x < 115) continue;

    const day = dayForY(y, dayAnchors);
    if (!day) continue;

    const band = columnForStudentItem(x, columnBands, normalizedGroups);
    if (!band) continue;

    const groupMatch = resolveStudentForColumn(band, normalizedGroups);
    if (!groupMatch) continue;

    const daySlots = slotsForDay(day, dayAnchors, timeSlots);
    const slot = slotForItem(text, y, daySlots.length ? daySlots : timeSlots);
    if (!slot) continue;

    let key = `${day.key}|${band.code}|${slot.start}`;

    if (!isContinuationLine(text)) {
      key = `${key}|${subjectFormHint(text)}|${Math.round(y / 14)}`;
    } else {
      let bestKey = null;
      let bestScore = -Infinity;
      for (const [candidateKey, candidateCell] of cells.entries()) {
        const parts = candidateKey.split('|');
        if (parts[1] !== band.code) continue;
        const daySlotsForCell = slotsForDay(day, dayAnchors, timeSlots);
        const slotsRef = daySlotsForCell.length ? daySlotsForCell : timeSlots;
        if (parts[0] !== day.key || !slotStartMatches(parts[2], slot.start, slotsRef)) continue;
        const anchorY =
          candidateCell.parts.reduce((sum, part) => sum + part.y, 0) / candidateCell.parts.length;
        const distance = Math.abs(y - anchorY);
        if (distance > 28) continue;
        const formPenalty = parts[3] === 'PROJ' ? 4 : 0;
        const columnBonus = parts[1] === band.code ? 20 : 0;
        const score = -distance - formPenalty + columnBonus;
        if (score > bestScore) {
          bestScore = score;
          bestKey = candidateKey;
        }
      }
      if (!bestKey) continue;
      key = bestKey;
    }

    const targetCell = cells.get(key);
    const groupMatchForCell = targetCell
      ? {
          group: targetCell.group,
          column: { code: targetCell.columnCode },
          matchScore: targetCell.columnMatchScore || 0
        }
      : groupMatch;

    if (!cells.has(key)) {
      cells.set(key, {
        day,
        group: groupMatchForCell.group,
        columnCode: groupMatchForCell.column.code,
        columnMatchScore: groupMatchForCell.matchScore,
        slot,
        parts: [],
        weekFilter: parseWeekFilter(text)
      });
    }

    const cell = cells.get(key);
    cell.parts.push({ text, x, y });
    cell.columnMatchScore = Math.max(cell.columnMatchScore || 0, groupMatchForCell.matchScore || 0);
    const weekFilter = parseWeekFilter(text);
    if (weekFilter) {
      cell.weekFilter = weekFilter;
    }
  }

  const templates = [];
  const sortedCells = [...cells.values()]
    .map((cell) => {
      const text = buildEventText(cell.parts);
      return { cell, text };
    });

  const filteredCells = sortedCells
    .filter(({ text }) => isLikelySubjectCell(text));

  const mappedCells = filteredCells
    .map(({ cell, text }) => {
      const explicit = parseExplicitTimes(text);
      const kind = normalizeKindFromTitle(text);
      return {
        cell,
        text,
        explicit,
        kind
      };
    })
    .sort((a, b) => {
      if (a.cell.day.key !== b.cell.day.key) return a.cell.day.key.localeCompare(b.cell.day.key);
      if (a.cell.columnCode !== b.cell.columnCode) {
        return a.cell.columnCode.localeCompare(b.cell.columnCode);
      }
      return a.cell.slot.start.localeCompare(b.cell.slot.start);
    });

  const occupied = new Map();
  for (const entry of mappedCells) {
    const key = `${entry.cell.day.key}|${entry.cell.columnCode}`;
    if (!occupied.has(key)) occupied.set(key, new Set());
    occupied.get(key).add(entry.cell.slot.start);
  }

  for (const entry of mappedCells) {
    const cell = entry.cell;
    const text = entry.text;
    if (!shouldIncludeCellForStudent(text, cell.columnCode, normalizedGroups)) continue;

    const meta = parsePollubCellMetadata(
      text,
      cell.parts.map((part) => part.text)
    );
    const form = meta.form || formLabelFromKind(entry.kind);

    if (!formMatchesColumn(form, entry.kind, cell.columnCode)) continue;

    const daySlots = slotsForDay(cell.day, dayAnchors, timeSlots);
    const { start: startTime, end: endTime } = resolveTimesFromSlotSpan(
      cell,
      timeSlots,
      text,
      occupied,
      daySlots
    );
    const biweeklyTurn = parseBiweeklyTurn(text);
    const displayGroup = resolveDisplayGroup({
      form,
      kind: entry.kind,
      columnCode: cell.columnCode,
      studentGroups: normalizedGroups
    });

    templates.push(
      createWeeklyTemplate({
        day: cell.day,
        group: displayGroup,
        columnCode: cell.columnCode,
        columnMatchScore: cell.columnMatchScore || 0,
        startTime,
        endTime,
        text,
        weekFilter: cell.weekFilter,
        biweeklyTurn,
        index: templates.length,
        form,
        teacherNames: meta.teachers,
        titleOverride: meta.title
      })
    );
  }

  return dedupeTemplatesByColumnPreference(templates);
}

function dedupeTemplatesByColumnPreference(templates) {
  const byKey = new Map();

  for (const template of templates) {
    const key = [
      template.dayKey,
      template.startTime,
      template.endTime,
      String(template.title || '').trim().toLowerCase()
    ].join('|');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, template);
      continue;
    }

    const existingScore = Number(existing.columnMatchScore) || 0;
    const nextScore = Number(template.columnMatchScore) || 0;
    if (nextScore > existingScore) {
      byKey.set(key, template);
    }
  }

  return [...byKey.values()];
}

export function parsePdfItemsToWeeklyTemplates(items, studentGroups) {
  if (!Array.isArray(items) || !items.length) return [];

  const templates = [];
  for (const pageItems of groupItemsByPage(items)) {
    templates.push(...parsePageItems(pageItems, studentGroups));
  }

  return templates;
}

export function parsePdfItemsToEvents(items, studentGroups, startDateKey, endDateKey, semesterStartKey) {
  const templates = parsePdfItemsToWeeklyTemplates(items, studentGroups);
  if (!templates.length) return [];

  const startKey = startDateKey || toDateKey(new Date());
  const endKey = endDateKey || toDateKey(addDays(new Date(startKey), 180));
  const semesterKey = semesterStartKey || startKey;

  const expanded = expandTemplatesToEvents(templates, startKey, endKey, semesterKey);
  return filterConflictingStudentEvents(expanded, studentGroups);
}

export function normalizeKindFromTitle(title) {
  const t = String(title || '');
  if (/\s-\s*W\s-/i.test(t) || /\bWykład\b/i.test(t)) return 'W';
  if (/\s-\s*lab\b/i.test(t) || /\blab\b/i.test(t)) return 'LAB';
  if (/\s-\s*proj\b/i.test(t) || /\bproj\b/i.test(t)) return 'PROJ';
  if (/\s-\s*ćw\b/i.test(t) || /\bćw\b/i.test(t)) return 'CW';
  return 'OTHER';
}

function modulePrefix(module) {
  const m = String(module || '').toUpperCase();
  if (m.startsWith('GPR')) return 'GPR';
  if (m.startsWith('GLA')) return 'GLA';
  if (m.startsWith('GCW') || m.startsWith('GOK')) return 'GCW';
  if (m.startsWith('GWY')) return 'GWY';
  return '';
}

function columnFamilyFromCode(columnCode) {
  return normalizePollubGroupCode(columnCode).replace(/\d+$/, '');
}

/** ćw→kolumna GCW, lab→GLA, proj→GPR/GLA; wykład może być w dowolnej kolumnie. */
export function formMatchesColumn(form, kind, columnCode) {
  const family = columnFamilyFromCode(columnCode);
  if (!family) return true;

  const effectiveForm =
    form ||
    (kind === 'W'
      ? 'Wykład'
      : kind === 'CW'
        ? 'Ćwiczenia'
        : kind === 'LAB'
          ? 'Laboratorium'
          : kind === 'PROJ'
            ? 'Projekt'
            : '');

  if (effectiveForm === 'Wykład' || kind === 'W') return true;
  if (effectiveForm === 'Ćwiczenia' || kind === 'CW') {
    return family === 'GCW' || family === 'GOK';
  }
  if (effectiveForm === 'Laboratorium' || kind === 'LAB') {
    return family === 'GLA';
  }
  if (effectiveForm === 'Projekt' || kind === 'PROJ') {
    return family === 'GPR' || family === 'GLA' || family === 'GCW';
  }

  return true;
}

function formFamilyMatchScore(form, module) {
  const kind =
    form === 'Wykład'
      ? 'W'
      : form === 'Ćwiczenia'
        ? 'CW'
        : form === 'Laboratorium'
          ? 'LAB'
          : form === 'Projekt'
            ? 'PROJ'
            : '';
  const families = expectedFamiliesForForm(form, kind);
  if (!families.length) return 0;

  const prefix = modulePrefix(module);
  if (families.includes(prefix)) return 10;
  if (form === 'Projekt' && prefix === 'GLA' && families.includes('GLA')) return 8;
  return 0;
}

function modulePrefixScore(prefix) {
  if (prefix === 'GLA' || prefix === 'GPR') return 3;
  if (prefix === 'GCW') return 2;
  if (prefix === 'GWY') return 1;
  return 0;
}

export function filterConflictingStudentEvents(events, studentGroups) {
  if (!Array.isArray(events) || !events.length) return [];

  const eventDayKey = (event) => String(event.start || '').slice(0, 10);

  const byDay = new Map();
  for (const event of events) {
    const key = eventDayKey(event);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }

  function overlaps(a, b) {
    const aStart = new Date(a.start).getTime();
    const aEnd = new Date(a.end).getTime();
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    return aStart < bEnd && bStart < aEnd;
  }

  function eventHasFineTimes(event) {
    const start = String(event.start || '');
    const end = String(event.end || '');
    if (!start.includes('T') || !end.includes('T')) return false;
    return start.slice(14, 16) !== '00' || end.slice(14, 16) !== '00';
  }

  function pickPreferred(a, b) {
    const sa =
      formFamilyMatchScore(a.form, a.module) +
      formFamilyMatchScore(a.form, a.columnCode) +
      modulePrefixScore(modulePrefix(a.module)) +
      (eventHasFineTimes(a) ? 15 : 0);
    const sb =
      formFamilyMatchScore(b.form, b.module) +
      formFamilyMatchScore(b.form, b.columnCode) +
      modulePrefixScore(modulePrefix(b.module)) +
      (eventHasFineTimes(b) ? 15 : 0);
    if (sa !== sb) return sa > sb ? a : b;

    if (eventHasFineTimes(a) !== eventHasFineTimes(b)) {
      return eventHasFineTimes(a) ? a : b;
    }

    return String(a.title || '').length >= String(b.title || '').length ? a : b;
  }

  const result = [];
  for (const dayEvents of byDay.values()) {
    const dedup = new Map();
    for (const ev of dayEvents) {
      const key = `${ev.start}|${ev.end}|${String(ev.title || '').trim().toLowerCase()}`;
      if (!dedup.has(key)) {
        dedup.set(key, ev);
      } else {
        dedup.set(key, pickPreferred(ev, dedup.get(key)));
      }
    }
    const list = [...dedup.values()].sort((a, b) => new Date(a.start) - new Date(b.start));

    const kept = [];
    for (const ev of list) {
      let replaced = false;
      for (let i = 0; i < kept.length; i += 1) {
        if (!overlaps(ev, kept[i])) continue;

        kept[i] = pickPreferred(ev, kept[i]);
        replaced = true;
        break;
      }
      if (!replaced) kept.push(ev);
    }

    result.push(...kept);
  }

  return result.sort((a, b) => new Date(a.start) - new Date(b.start));
}
