import { addDays, formatLocalDateTimeFromParts, startOfDay, toDateKey } from './dateUtils';

const WBIA_BASE_URL = 'https://planywbia.pollub.pl/';
const WBIA_PLAN_VIEWPORT = {
  winW: 1200,
  winH: 800,
  loadBG: '000000'
};

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPollubWbiaFaculty(studyInfo) {
  const faculty = normalizeText(studyInfo?.faculty).toLowerCase();
  // Najczęstsza nazwa: "Wydział Budownictwa i Architektury"
  return faculty.includes('budownictwa') && faculty.includes('architekt');
}

function programPrefix(program) {
  const value = normalizeText(program).toLowerCase();
  if (value.includes('architekt')) return 'A';
  if (value.includes('budown')) return 'B';
  return '';
}

function degreeNumber(studyKind) {
  const value = normalizeText(studyKind).toLowerCase();
  if (value.includes('i stopnia') || value.includes('1 stopnia')) return '1';
  if (value.includes('ii stopnia') || value.includes('2 stopnia')) return '2';
  return '';
}

function systemLetter(studySystem) {
  const value = normalizeText(studySystem).toLowerCase();
  if (value.includes('stacjon')) return 'S';
  if (value.includes('niestacjon')) return 'N';
  return '';
}

export function wbiaPlanLabelFromStudyInfo(studyInfo) {
  const prefix = programPrefix(studyInfo?.program);
  const degree = degreeNumber(studyInfo?.studyKind);
  const system = systemLetter(studyInfo?.studySystem);
  const sem = Number(studyInfo?.semesterInYear);
  if (!prefix || !degree || !system || !sem) return '';
  return `${prefix}${degree}${system} semestr ${sem}`;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error(`POLLUB WBiA: błąd pobierania (${response.status})`);
  }
  return response.text();
}

function extractRootBranchIds(leftMenuHtml) {
  const html = String(leftMenuHtml || '');
  const ids = [];
  const re = /branch\(1,(\d+),/g;
  let match = re.exec(html);
  while (match) {
    ids.push(Number(match[1]));
    match = re.exec(html);
  }
  return [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
}

function extractChildBranchIds(feedHtml) {
  const html = String(feedHtml || '');
  const ids = [];
  const re = /branch\(1,(\d+),/g;
  let match = re.exec(html);
  while (match) {
    ids.push(Number(match[1]));
    match = re.exec(html);
  }
  return [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0);
}

function decodeAts4IsoText(value) {
  // planywbia HTML bywa w iso-8859-2 i znaki diakrytyczne mogą przyjść jako „±”, „³” itd.
  // Na potrzeby dopasowań labeli nie musimy perfekcyjnie dekodować — normalizujemy do ASCII-ish.
  return normalizeText(value)
    .replace(/±/g, 'a')
    .replace(/³/g, 'l')
    .replace(/¦/g, 's')
    .replace(/ê/g, 'e')
    .replace(/ñ/g, 'n')
    .replace(/œ/g, 's')
    .replace(/¿/g, 'z');
}

function extractPlanLinks(html) {
  const source = String(html || '');
  const plans = [];
  const re = /<a href="plan\.php\?type=(\d+)&amp;id=(\d+)"[^>]*>([^<]+)<\/a>/gi;
  let match = re.exec(source);
  while (match) {
    plans.push({
      type: Number(match[1]),
      id: Number(match[2]),
      label: decodeAts4IsoText(match[3])
    });
    match = re.exec(source);
  }
  return plans;
}

export async function fetchWbiaPlansIndex() {
  const leftMenuHtml = await fetchText(`${WBIA_BASE_URL}left_menu.php?type=1`);
  const roots = extractRootBranchIds(leftMenuHtml);
  const queue = [...roots];
  const seen = new Set();
  const plans = [];

  while (queue.length && plans.length < 500) {
    const branch = queue.shift();
    if (!branch || seen.has(branch)) continue;
    seen.add(branch);

    const feedHtml = await fetchText(`${WBIA_BASE_URL}left_menu_feed.php?type=1&branch=${branch}&link=0`);
    plans.push(...extractPlanLinks(feedHtml));
    for (const child of extractChildBranchIds(feedHtml)) {
      if (!seen.has(child)) queue.push(child);
    }
  }

  const unique = new Map();
  for (const plan of plans) {
    const key = `${plan.type}:${plan.id}`;
    if (!unique.has(key)) unique.set(key, plan);
  }
  return [...unique.values()];
}

export async function resolveWbiaPlanId(studyInfo) {
  const target = wbiaPlanLabelFromStudyInfo(studyInfo);
  if (!target) {
    throw new Error('POLLUB WBiA: brak danych do wyboru planu (semestr/tryb/stopień).');
  }

  const plans = await fetchWbiaPlansIndex();
  const normalizedTarget = target.toLowerCase();
  const match = plans.find((plan) => normalizeText(plan.label).toLowerCase() === normalizedTarget);
  if (!match) {
    throw new Error(`POLLUB WBiA: nie znaleziono planu "${target}" na planywbia.`);
  }

  return match.id;
}

export async function fetchWbiaPlanHtml(planId) {
  const id = Number(planId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('POLLUB WBiA: nieprawidłowe id planu.');

  const params = new URLSearchParams({
    type: '2',
    id: String(id),
    winW: String(WBIA_PLAN_VIEWPORT.winW),
    winH: String(WBIA_PLAN_VIEWPORT.winH),
    loadBG: WBIA_PLAN_VIEWPORT.loadBG
  });

  return fetchText(`${WBIA_BASE_URL}plan.php?${params.toString()}`);
}

function parsePx(value) {
  const match = String(value || '').match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseStyleBox(style) {
  const s = String(style || '');
  const top = parsePx((s.match(/top:\s*([^;]+);/i) || [])[1]);
  const left = parsePx((s.match(/left:\s*([^;]+);/i) || [])[1]);
  const width = parsePx((s.match(/width:\s*([^;]+);/i) || [])[1]);
  const height = parsePx((s.match(/height:\s*([^;]+);/i) || [])[1]);
  return { top, left, width, height };
}

function htmlToInlineText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*a\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseHeaders(html) {
  const source = String(html || '');
  const headerDivRe = /<div class="cd"\s+style="([^"]+)">([^<]+)<\/div>/gi;
  const dayHeaders = [];
  const groupHeaders = [];
  const timeHeaders = [];

  let match = headerDivRe.exec(source);
  while (match) {
    const style = match[1];
    const text = decodeAts4IsoText(match[2]);
    const box = parseStyleBox(style);
    const top = box.top ?? -1;
    const left = box.left ?? -1;
    const width = box.width ?? 0;
    const height = box.height ?? 0;

    if (/^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(text)) {
      timeHeaders.push({ text, top, left, width, height });
    } else if (top === 192 && width >= 400) {
      dayHeaders.push({ text, top, left, width, height });
    } else if (top === 214 && width >= 50) {
      groupHeaders.push({ text, top, left, width, height });
    }

    match = headerDivRe.exec(source);
  }

  dayHeaders.sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  groupHeaders.sort((a, b) => (a.left ?? 0) - (b.left ?? 0));
  timeHeaders.sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
  return { dayHeaders, groupHeaders, timeHeaders };
}

function weekdayFromPolish(label) {
  const value = decodeAts4IsoText(label).toLowerCase();
  if (value.includes('pon')) return 1;
  if (value.includes('wto')) return 2;
  if (value.includes('sro') || value.includes('¦ro') || value.includes('śro')) return 3;
  if (value.includes('czw')) return 4;
  if (value.includes('pi')) return 5;
  return null;
}

function timeParts(time) {
  const [h, m] = String(time).split(':').map(Number);
  return { h, m };
}

function minutesBetween(start, end) {
  const a = timeParts(start);
  const b = timeParts(end);
  return (b.h * 60 + b.m) - (a.h * 60 + a.m);
}

function findDay(dayHeaders, x) {
  const xx = Number(x);
  if (!Number.isFinite(xx)) return null;
  return (
    dayHeaders.find((d) => xx >= d.left && xx < d.left + d.width) ||
    dayHeaders[dayHeaders.length - 1] ||
    null
  );
}

function findGroup(groupHeaders, x, day) {
  const xx = Number(x);
  if (!Number.isFinite(xx) || !day) return null;
  // W ramach dnia wybieramy najbliższą kolumnę.
  const candidates = groupHeaders.filter((g) => xx >= g.left && xx < g.left + g.width);
  if (candidates.length) return candidates[0];

  // fallback: najbliższa po lewej
  const withinDay = groupHeaders.filter((g) => g.left >= day.left && g.left < day.left + day.width);
  if (!withinDay.length) return null;
  let best = withinDay[0];
  let bestDist = Math.abs(xx - best.left);
  for (const g of withinDay) {
    const dist = Math.abs(xx - g.left);
    if (dist < bestDist) {
      best = g;
      bestDist = dist;
    }
  }
  return best;
}

function findTimeSlot(timeHeaders, y) {
  const yy = Number(y);
  if (!Number.isFinite(yy) || !timeHeaders.length) return null;
  let best = timeHeaders[0];
  let bestDist = Math.abs(yy - best.top);
  for (const t of timeHeaders) {
    const dist = Math.abs(yy - t.top);
    if (dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  return best;
}

function median(values) {
  const list = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 0 ? (list[mid - 1] + list[mid]) / 2 : list[mid];
}

function parseCourses(html) {
  const source = String(html || '');
  const courses = [];
  const re = /<div[^>]+name="course"[^>]*style="([^"]+)"[^>]*>([\s\S]*?)<\/div>/gi;
  let match = re.exec(source);
  while (match) {
    const style = match[1];
    const inner = match[2];
    const box = parseStyleBox(style);
    const text = htmlToInlineText(inner);
    courses.push({ box, inner, text });
    match = re.exec(source);
  }
  return courses;
}

function wbiaFormLabel(kind) {
  const value = normalizeText(kind).toUpperCase();
  if (value === 'W') return 'Wykład';
  if (value === 'LAB') return 'Laboratorium';
  if (value === 'PROJ') return 'Projekt';
  if (value === 'CW' || value === 'ĆW') return 'Ćwiczenia';
  return kind;
}

function parseCourseContent(text) {
  const lines = String(text || '').split('\n').map((l) => normalizeText(l)).filter(Boolean);
  const first = lines[0] || '';
  const [titleRaw, kindRaw] = first.split(',').map((p) => normalizeText(p));
  const title = titleRaw || first;
  const kind = kindRaw || '';
  const teacher = lines[1] || '';
  const room = lines[2] || '';
  return { title, kind, teacher, room };
}

function iterDays(startDate, endExclusive) {
  const days = [];
  let current = startOfDay(startDate);
  const end = startOfDay(endExclusive);
  while (current < end) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days;
}

function jsDowToIsoDow(jsDow) {
  // JS: 0=Sun..6=Sat, ISO: 1=Mon..7=Sun
  return jsDow === 0 ? 7 : jsDow;
}

export function parseWbiaPlanToEvents({
  html,
  startDateKey,
  endDateKey,
  planId
}) {
  const { dayHeaders, groupHeaders, timeHeaders } = parseHeaders(html);
  const courses = parseCourses(html);

  const slotHeights = [];
  for (let i = 1; i < timeHeaders.length; i += 1) {
    slotHeights.push((timeHeaders[i].top ?? 0) - (timeHeaders[i - 1].top ?? 0));
  }
  const slotPx = median(slotHeights) || 60;

  const [startTimeSample, endTimeSample] = String(timeHeaders[0]?.text || '08:00-09:00').split('-').map((p) => p.trim());
  const slotMinutes = minutesBetween(startTimeSample, endTimeSample) || 60;

  const startDate = new Date(String(startDateKey));
  const endExclusive = new Date(String(endDateKey));
  const allDays = iterDays(startDate, endExclusive);

  const weeklyTemplates = courses
    .map((course, index) => {
      const day = findDay(dayHeaders, course.box.left);
      const group = findGroup(groupHeaders, course.box.left, day);
      const time = findTimeSlot(timeHeaders, course.box.top);
      if (!day || !time) return null;
      const dow = weekdayFromPolish(day.text);
      if (!dow) return null;

      const [startTimeRaw, endTimeRaw] = String(time.text).split('-').map((p) => p.trim());
      const height = Number(course.box.height) || slotPx;
      const slots = Math.max(1, Math.round(height / slotPx));
      const durationMinutes = slots * slotMinutes;

      const content = parseCourseContent(course.text);
      const groupLabel = decodeAts4IsoText(group?.text || '');

      return {
        templateId: `pollub-wbia-${planId || 'plan'}-${index}`,
        dow,
        startTime: startTimeRaw,
        durationMinutes,
        groupLabel,
        ...content
      };
    })
    .filter(Boolean);

  const events = [];
  for (const day of allDays) {
    const isoDow = jsDowToIsoDow(day.getDay());
    for (const tpl of weeklyTemplates) {
      if (tpl.dow !== isoDow) continue;

      const { h, m } = timeParts(tpl.startTime);
      const startIso = formatLocalDateTimeFromParts(
        day.getFullYear(),
        day.getMonth() + 1,
        day.getDate(),
        h,
        m
      );
      const endDate = new Date(startIso);
      endDate.setMinutes(endDate.getMinutes() + tpl.durationMinutes);
      const endIso = endDate.toISOString();

      const titleParts = [tpl.title, tpl.kind].filter(Boolean);
      const title = titleParts.join(', ');
      const teacherNames = tpl.teacher ? [tpl.teacher] : [];

      events.push({
        id: `${tpl.templateId}-${toDateKey(day)}`,
        type: 'POLLUB:WBIA',
        title,
        start: startIso,
        end: endIso,
        form: wbiaFormLabel(tpl.kind),
        teacherName: tpl.teacher,
        teacherNames,
        teachers: tpl.teacher,
        roomName: tpl.room,
        buildingName: 'Politechnika Lubelska (WBiA plan)',
        groupName: tpl.groupLabel,
        module: tpl.groupLabel,
        additionalInfo: '',
        locationMode: 'Budynek',
        color: '#2fb9e6',
        status: ''
      });
    }
  }

  return events;
}

