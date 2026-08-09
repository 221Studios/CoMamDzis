import { prepareCookieRequest, readResponseHeader, saveCookiesFromResponse } from './httpCookies';
import { parseHtmlStudentProfile } from './studentProfile';
import { serializeCookieJar } from './portalSession';

const BASE_URL = 'https://wu.cdv.pl';
const LOGIN_URL = `${BASE_URL}/?login=1`;
const MAIN_URL = `${BASE_URL}/?page=Main`;
const PLAN_URL = `${BASE_URL}/?page=Plan`;
const REQUEST_TIMEOUT_MS = 45000;
const DETAIL_FETCH_CONCURRENCY = 20;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function fetchWithTimeout(url, options = {}) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('WU CDV nie odpowiada. Sprawdz internet i sprobuj ponownie.'));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fetch(url, options), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithCookies(url, options = {}, jar) {
  const headers = {
    ...browserLikeHeaders(),
    ...(options.headers || {})
  };

  const { credentials } = await prepareCookieRequest(url, jar, headers);

  const response = await fetchWithTimeout(url, {
    ...options,
    headers,
    credentials
  });

  await saveCookiesFromResponse(jar, response.headers, url);
  return response;
}

function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function browserLikeHeaders(referer = '') {
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(referer ? { Referer: referer } : {})
  };
}

function ajaxPostHeaders() {
  return {
    ...browserLikeHeaders(PLAN_URL),
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: BASE_URL,
    Referer: PLAN_URL,
    'X-Requested-With': 'XMLHttpRequest'
  };
}

function ajaxGetHeaders() {
  return {
    ...browserLikeHeaders(PLAN_URL),
    Accept: 'application/json, text/javascript, */*; q=0.01',
    Referer: PLAN_URL,
    'X-Requested-With': 'XMLHttpRequest'
  };
}

function resolveUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

async function followRedirects(url, jar) {
  let currentUrl = url;
  let response = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await fetchWithCookies(currentUrl, { redirect: 'manual' }, jar);
    if (!isRedirect(response.status)) return response;

    const location = readResponseHeader(response.headers, 'location');
    if (!location) return response;
    currentUrl = resolveUrl(location, currentUrl);
  }

  return response;
}

function hasLoginForm(html) {
  const source = String(html || '');
  return /name=["']login["']/i.test(source) && /name=["']password["']/i.test(source);
}

function isLoginFailure(html) {
  const source = String(html || '');
  return (
    hasLoginForm(source) &&
    (/nieprawid/i.test(source) || /błędn|bledn/i.test(source) || /invalid|incorrect/i.test(source))
  );
}

function isLoggedIn(html, jar) {
  const source = String(html || '');
  if (/wyloguj/i.test(source) || /logout/i.test(source)) return true;
  if (jar.has('WU_PHPSESSID') && !hasLoginForm(source)) return true;
  return false;
}

async function readJsonResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok || !data) {
    if (data?.error_code === 56) {
      throw new Error('CDV przyjelo logowanie, ale sesja nie pozwala pobrac planu. Sprobuj wylogowac sie i zalogowac ponownie.');
    }
    throw new Error(fallbackMessage);
  }

  return data;
}

async function openWuLoginPage(jar) {
  await fetchWithCookies(LOGIN_URL, { redirect: 'manual' }, jar);
  return LOGIN_URL;
}

async function submitWuLoginForm(loginUrl, email, password, jar) {
  return fetchWithCookies(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...browserLikeHeaders(loginUrl),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode({
      redirectURL: MAIN_URL,
      login: email,
      password
    })
  }, jar);
}

async function finishWuLoginResponse(response, loginUrl, jar) {
  if (![200, 302, 303].includes(response.status)) {
    throw new Error('Nie udalo sie zalogowac. Sprawdz login i haslo.');
  }

  const location = readResponseHeader(response.headers, 'location');
  const finalResponse = isRedirect(response.status) && location
    ? await followRedirects(resolveUrl(location, loginUrl), jar)
    : response;
  const html = await finalResponse.text().catch(() => '');

  if (isLoginFailure(html)) {
    throw new Error('Nie udalo sie zalogowac. Sprawdz login i haslo.');
  }

  if (!isLoggedIn(html, jar)) {
    throw new Error('Nie udalo sie zalogowac. Sprawdz login i haslo.');
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeEvent(event) {
  return {
    id: String(event.term_id || `${event.start}-${event.title}`),
    termId: event.term_id,
    egsamTermId: event.egsam_term_id,
    groupId: event.group_id,
    type: event.type || '',
    title: event.title || 'Zajecia',
    module: event.module || '',
    form: event.form || '',
    start: event.start,
    end: event.end,
    room: event.room,
    teachers: event.teachers,
    teacherNames: [],
    buildingName: '',
    buildingAddress: '',
    roomName: '',
    subject: '',
    additionalInfo: '',
    locationMode: event.hangoutLink ? 'Online' : '',
    color: event.backgroundColor || '#0ea5e9',
    status: event.status || '',
    hangoutLink: event.hangoutLink || '',
    hangoutLinkLabel: event.hangoutLink ? 'Otwórz Google Meet' : ''
  };
}

function normalizeTeacher(teacher) {
  if (!teacher || typeof teacher !== 'object') return '';

  const parts = [
    teacher.tytul || teacher.stopien || teacher.title,
    teacher.imie || teacher.name || teacher.firstName || teacher.first_name,
    teacher.nazwisko || teacher.surname || teacher.lastName || teacher.last_name
  ].filter(Boolean);

  return parts.join(' ').trim();
}

function isOnlineLocation(...values) {
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes('online'));
}

function normalizeDetails(event, details) {
  const room = details?.room || details?.ASSIGNED_ROOM || {};
  const teachers = details?.teacher || details?.TEACHER || [];
  const teacherNames = Array.isArray(teachers)
    ? teachers.map(normalizeTeacher).filter(Boolean)
    : [normalizeTeacher(teachers)].filter(Boolean);

  const buildingName = room.nazwaBudynku || room.buildingName || '';
  const buildingAddress = room.adres || room.address || '';
  const roomName = room.nazwaSali || room.roomName || '';
  const isOnline = event.hangoutLink || isOnlineLocation(buildingName, buildingAddress, roomName);

  return {
    ...event,
    teacherNames,
    buildingName,
    buildingAddress,
    roomName,
    subject: details?.przedmiot || details?.subject || event.subject || '',
    additionalInfo: details?.ADDITIONAL_INFO || details?.additionalInfo || event.additionalInfo || '',
    locationMode: isOnline ? 'Online' : buildingName || roomName ? 'Budynek' : ''
  };
}

export async function loginToWu(email, password, onPhase) {
  const jar = new Map();

  onPhase?.('CDV: wysyłam formularz logowania');
  try {
    await finishWuLoginResponse(await submitWuLoginForm(LOGIN_URL, email, password, jar), LOGIN_URL, jar);
  } catch {
    jar.clear();
    onPhase?.('CDV: otwieram Wirtualną Uczelnię');
    const loginUrl = await openWuLoginPage(jar);
    await finishWuLoginResponse(await submitWuLoginForm(loginUrl, email, password, jar), loginUrl, jar);
  }

  return jar;
}

export async function fetchScheduleList(startDateKey, endDateKey, jar = new Map(), onPhase) {
  onPhase?.('CDV: sprawdzam sesję i listę zajęć');
  const response = await fetchWithCookies(`${BASE_URL}/ajax.php?action=get-student-plan`, {
    method: 'POST',
    headers: ajaxPostHeaders(),
    body: formEncode({
      poczatek: startDateKey,
      koniec: endDateKey
    })
  }, jar);

  const data = await readJsonResponse(response, 'CDV nie zwrocilo poprawnej odpowiedzi z planem. Sprobuj ponownie za chwile.');
  if (data.error_code !== 0) {
    if (data.error_code === 56) {
      throw new Error('CDV przyjelo logowanie, ale sesja nie pozwala pobrac planu. Sprobuj wylogowac sie i zalogowac ponownie.');
    }
    throw new Error('WU zwrocila blad podczas pobierania planu.');
  }

  return (data.return || [])
    .map(normalizeEvent)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function eventDetailKey(event) {
  return [event.id, event.type, event.start, event.end, event.title].filter(Boolean).join('|');
}

function orderEventsByFocusDate(events, focusDate = new Date()) {
  const focusTime = focusDate.getTime();
  return [...events].sort((left, right) => {
    const leftDistance = Math.abs(new Date(left.start).getTime() - focusTime);
    const rightDistance = Math.abs(new Date(right.start).getTime() - focusTime);
    return leftDistance - rightDistance;
  });
}

export async function enrichScheduleDetails(events, jar = new Map(), onPhase, options = {}) {
  const { focusDate = new Date(), onEventEnriched } = options;
  if (!events.length) return events;
  onPhase?.(`CDV: pobieram szczegóły zajęć (${events.length})`);
  const orderedEvents = orderEventsByFocusDate(events, focusDate);
  const enrichedByKey = new Map();

  await mapWithConcurrency(orderedEvents, DETAIL_FETCH_CONCURRENCY, async (event) => {
    const enriched = await fetchEventDetails(event, jar);
    enrichedByKey.set(eventDetailKey(enriched), enriched);
    onEventEnriched?.(enriched);
  });

  return events.map((event) => enrichedByKey.get(eventDetailKey(event)) || event);
}

export async function fetchSchedule(startDateKey, endDateKey, jar = new Map(), onPhase) {
  const events = await fetchScheduleList(startDateKey, endDateKey, jar, onPhase);
  return enrichScheduleDetails(events, jar, onPhase);
}

export async function fetchEventDetails(event, jar = new Map()) {
  if (event.type === 'EGSAM') return fetchEgsamDetails(event, jar);
  if (event.type === 'MEETING') return fetchMeetingDetails(event, jar);
  if (event.type !== 'PLAN' || !event.termId) return event;

  try {
    const response = await fetchWithCookies(`${BASE_URL}/ajax.php?action=get-classes-term-details-for-student`, {
      method: 'POST',
      headers: ajaxPostHeaders(),
      body: formEncode({
        room_id: event.room || '',
        teacher_id: event.teachers || '',
        term_id: event.termId,
        group_id: event.groupId || ''
      })
    }, jar);

    const data = await readJsonResponse(response, 'Nie udalo sie pobrac szczegolow zajec CDV.');
    if (data.error_code !== 0) return event;
    return normalizeDetails(event, data.return);
  } catch {
    return event;
  }
}

async function fetchEgsamDetails(event, jar = new Map()) {
  if (!event.egsamTermId) return event;

  try {
    const response = await fetchWithCookies(
      `${BASE_URL}/ajax.php?action=get-egsam-term-details-for-student&egsam_term_id=${encodeURIComponent(event.egsamTermId)}`,
      {
        method: 'GET',
        headers: ajaxGetHeaders()
      },
      jar
    );

    const data = await readJsonResponse(response, 'Nie udalo sie pobrac szczegolow zaliczenia CDV.');
    if (data.error_code !== 0) return event;
    return normalizeDetails(event, data.return);
  } catch {
    return event;
  }
}

async function fetchMeetingDetails(event, jar = new Map()) {
  if (!event.termId) return event;

  try {
    const response = await fetchWithCookies(
      `${BASE_URL}/ajax.php?action=get-meeting-term-details-for-student&term_id=${encodeURIComponent(event.termId)}`,
      {
        method: 'GET',
        headers: ajaxGetHeaders()
      },
      jar
    );

    const data = await readJsonResponse(response, 'Nie udalo sie pobrac szczegolow spotkania CDV.');
    if (data.error_code !== 0) return event;
    return normalizeDetails(event, data.return);
  } catch {
    return event;
  }
}

export async function fetchWuStudentProfile(jar = new Map(), onPhase) {
  onPhase?.('CDV: pobieram dane studenta');
  const response = await fetchWithCookies(MAIN_URL, { redirect: 'manual' }, jar);
  const html = await response.text().catch(() => '');
  return parseHtmlStudentProfile(html);
}

export async function loginAndFetchSchedule({ email, password, startDateKey, endDateKey, onPhase, onStudentProfile }) {
  const jar = await loginToWu(email, password, onPhase);
  onPhase?.('CDV: pobieram plan semestru');
  const [events, studentProfile] = await Promise.all([
    fetchScheduleList(startDateKey, endDateKey, jar, onPhase),
    fetchWuStudentProfile(jar, onPhase).catch(() => ({}))
  ]);
  await onStudentProfile?.({
    ...studentProfile,
    albumNumber: studentProfile?.albumNumber || String(email || '').trim(),
    university: 'Collegium Da Vinci'
  });
  onPhase?.('CDV: plan gotowy');
  return {
    events,
    enrichDetails: (options) => enrichScheduleDetails(events, jar, onPhase, options),
    portalCookies: serializeCookieJar(jar)
  };
}
