import { formatLocalDateTimeFromPolish } from './dateUtils';

const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MEET_LINK_RE = /https?:\/\/meet\.google\.com\/[\w-]+/i;
const ROOM_RE = /(?:^|\s)(?:s\.|sala\s*)(\d+[a-z]?)/i;

const SKIP_WORDS = new Set([
  'SOBOTA',
  'NIEDZIELA',
  'PONIEDZIAŁEK',
  'WTOREK',
  'ŚRODA',
  'CZWARTEK',
  'PIĄTEK',
  'link',
  '–',
  '/',
  'z',
  'p.',
  'Strona',
  'Studia',
  'stopnia',
  '(magisterskie),',
  'niestacjonarne,',
  'semestr',
  'letni',
  '2024/2025',
  'Zarządzanie,'
]);

function groupItemsByPage(items) {
  const pages = new Map();
  for (const item of items) {
    const page = Number(item.page) || 1;
    if (!pages.has(page)) pages.set(page, []);
    pages.get(page).push(item);
  }
  return [...pages.values()];
}

function closestDateColumn(x, dates) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < dates.length; i += 1) {
    const distance = Math.abs(x - dates[i].x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return dates[bestIndex].date;
}

function slotForY(y, slots) {
  for (const slot of slots) {
    const low = Math.min(slot.yStart, slot.yEnd) - 2;
    const high = Math.max(slot.yStart, slot.yEnd) + 15;
    if (y >= low && y <= high) return slot;
  }
  return null;
}

function buildEventText(parts) {
  return parts
    .sort((left, right) => {
      if (Math.abs(left.y - right.y) > 3) return right.y - left.y;
      return left.x - right.x;
    })
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRoom(text) {
  const match = text.match(ROOM_RE);
  if (!match) return '';
  return match[0].trim();
}

function extractMeetLink(text) {
  const match = text.match(MEET_LINK_RE);
  return match ? match[0] : '';
}

function buildTitle(text, room) {
  let title = text;
  if (room) {
    title = title.replace(room, '');
  }
  title = title.replace(MEET_LINK_RE, '').replace(/\s+/g, ' ').trim();
  return title || 'Zajęcia';
}

function createEvent({ date, startTime, endTime, text, index }) {
  const room = extractRoom(text);
  const hangoutLink = extractMeetLink(text);
  const title = buildTitle(text, room);
  const startIso = formatLocalDateTimeFromPolish(date, startTime);
  const endIso = formatLocalDateTimeFromPolish(date, endTime);

  return {
    id: `wszip-${startIso}-${index}`,
    type: 'WSZIP:PDF',
    title,
    module: '',
    form: '',
    start: startIso,
    end: endIso,
    room,
    teachers: '',
    teacherNames: [],
    buildingName: 'Główny Budynek WSZiP',
    buildingAddress: '',
    roomName: room || 'Brak danych o sali',
    subject: '',
    additionalInfo: hangoutLink ? 'Zajęcia online (Google Meet)' : '',
    locationMode: hangoutLink ? 'Online' : 'Budynek',
    color: '#10b981',
    status: '',
    hangoutLink,
    hangoutLinkLabel: hangoutLink ? 'Google Meet' : ''
  };
}

function parsePageItems(pageItems) {
  const dates = [];
  const times = [];
  const words = [];

  for (const item of pageItems) {
    const text = String(item.text || '').trim();
    if (!text) continue;

    const x = Number(item.x);
    const y = Number(item.y);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;

    if (DATE_RE.test(text)) {
      dates.push({ x, y, date: text });
    } else if (TIME_RE.test(text) && x < 90) {
      times.push({ x, y, time: text });
    } else {
      words.push({ text, x, y });
    }
  }

  if (dates.length < 2 || times.length < 2) return [];

  dates.sort((left, right) => left.x - right.x);
  times.sort((left, right) => left.y - right.y);

  const slots = [];
  for (let i = 0; i < times.length - 1; i += 2) {
    slots.push({
      start: times[i].time,
      end: times[i + 1].time,
      yStart: times[i].y,
      yEnd: times[i + 1].y
    });
  }

  const cells = new Map();
  for (const word of words) {
    if (SKIP_WORDS.has(word.text)) continue;
    if (word.x < 95 || word.y > 520 || word.y < 55) continue;

    const slot = slotForY(word.y, slots);
    if (!slot) continue;

    const date = closestDateColumn(word.x, dates);
    const key = `${date}|${slot.start}|${slot.end}`;
    if (!cells.has(key)) {
      cells.set(key, {
        date,
        startTime: slot.start,
        endTime: slot.end,
        parts: []
      });
    }
    cells.get(key).parts.push(word);
  }

  const events = [];
  for (const cell of cells.values()) {
    const text = buildEventText(cell.parts);
    if (text.replace(/\s+/g, '').length < 8) continue;
    events.push(createEvent({
      date: cell.date,
      startTime: cell.startTime,
      endTime: cell.endTime,
      text,
      index: events.length
    }));
  }

  return events;
}

export function parsePdfItemsToEvents(items) {
  if (!Array.isArray(items) || !items.length) return [];

  const events = [];
  for (const pageItems of groupItemsByPage(items)) {
    events.push(...parsePageItems(pageItems));
  }

  return events.sort((left, right) => new Date(left.start) - new Date(right.start));
}
