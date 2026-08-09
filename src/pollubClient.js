import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { prepareCookieRequest, saveCookiesFromResponse } from './httpCookies';
import { serializeCookieJar } from './portalSession';
import { parseHtmlStudentProfile } from './studentProfile';
import { parsePdfItemsToEvents } from './pollubWeeklyGridParser';
import {
  fetchWbiaPlanHtml,
  isPollubWbiaFaculty,
  parseWbiaPlanToEvents,
  resolveWbiaPlanId
} from './pollubWbiaClient';
import { discoverPollubPlanPdf } from './pollubPlanDiscovery';

export const POLLUB_STORED_PREFIX = 'pollub-stored:';
export const POLLUB_STORED_PREFIX_V2 = 'pollub-stored:v2:';
const POLLUB_PLAN_FILENAME = 'pollub-plan.pdf';
const BASE_URL = 'https://ehms.pollub.pl/standard/';
const GROUPS_URL = `${BASE_URL}?tab=3&sub=3`;
const STUDY_INFO_URL = `${BASE_URL}?tab=2`;
const REQUEST_TIMEOUT_MS = 30000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const GROUP_CODE_RE = /\b(G[CĆ]W\d{2}|GLA\d{2}|GOK\d{2}|GPR\d{2}|GWY\d{2})\b/gi;

function browserLikeHeaders(referer = BASE_URL) {
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9',
    ...(referer ? { Referer: referer } : {})
  };
}

function formPostHeaders(referer = BASE_URL) {
  return {
    ...browserLikeHeaders(referer),
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: 'https://ehms.pollub.pl'
  };
}

async function fetchWithTimeout(url, options = {}) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('eHMS nie odpowiada. Sprawdź internet i spróbuj ponownie.'));
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
    ...browserLikeHeaders(options.referer),
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

function resolveUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

async function followRedirects(url, jar, method = 'GET', body = null) {
  let currentUrl = url;
  let response = null;
  let nextMethod = method;
  let nextBody = body;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const isPost = nextMethod === 'POST' && nextBody != null;
    response = await fetchWithCookies(
      currentUrl,
      {
        method: nextMethod,
        body: nextBody,
        redirect: 'manual',
        referer: BASE_URL,
        ...(isPost ? { headers: formPostHeaders(BASE_URL) } : {})
      },
      jar
    );

    if (!isRedirect(response.status)) return response;

    const location = response.headers.get('location') || response.headers.get('Location');
    if (!location) return response;
    currentUrl = resolveUrl(location, currentUrl);
    nextMethod = 'GET';
    nextBody = null;
  }

  return response;
}

function encodeBase64Utf8(value) {
  const bytes = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(bytes);
  }
  throw new Error('Brak obsługi zapisu profilu POLLUB w tej wersji aplikacji.');
}

function decodeBase64Utf8(value) {
  const binary = globalThis.atob(value);
  return decodeURIComponent(
    binary
      .split('')
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join('')
  );
}

export function packPollubStoredCredential(password, pdfUriOrUris) {
  const pdfUris = Array.isArray(pdfUriOrUris)
    ? pdfUriOrUris.map((u) => String(u || '').trim()).filter(Boolean)
    : [String(pdfUriOrUris || '').trim()].filter(Boolean);
  const payload = JSON.stringify({
    password: String(password || ''),
    pdfUris
  });
  return `${POLLUB_STORED_PREFIX_V2}${encodeBase64Utf8(payload)}`;
}

export function unpackPollubStoredCredential(value) {
  const raw = String(value || '');
  if (!raw.startsWith(POLLUB_STORED_PREFIX)) return null;

  try {
    if (raw.startsWith(POLLUB_STORED_PREFIX_V2)) {
      const parsed = JSON.parse(decodeBase64Utf8(raw.slice(POLLUB_STORED_PREFIX_V2.length)));
      const pdfUris = Array.isArray(parsed.pdfUris)
        ? parsed.pdfUris.map((u) => String(u || '').trim()).filter(Boolean)
        : [];
      return {
        password: String(parsed.password || ''),
        pdfUris,
        pdfUri: pdfUris[0] || ''
      };
    }

    // v1: pollub-stored:{password,pdfUri}
    const parsed = JSON.parse(decodeBase64Utf8(raw.slice(POLLUB_STORED_PREFIX.length)));
    const pdfUri = String(parsed.pdfUri || '').trim();
    return {
      password: String(parsed.password || ''),
      pdfUris: pdfUri ? [pdfUri] : [],
      pdfUri
    };
  } catch {
    return null;
  }
}

export function looksLikePollubStoredCredential(value) {
  const raw = String(value || '');
  return raw.startsWith(POLLUB_STORED_PREFIX_V2) || raw.startsWith(POLLUB_STORED_PREFIX);
}

export function pollubPdfLabel(pdfUri) {
  const uri = String(pdfUri || '').trim();
  if (!uri) return '';
  const parts = uri.split('/');
  return decodeURIComponent(parts[parts.length - 1] || POLLUB_PLAN_FILENAME);
}

async function persistPdfInAppStorage(sourceUri) {
  const destination = `${FileSystem.documentDirectory}${POLLUB_PLAN_FILENAME}`;
  const source = String(sourceUri || '').trim();
  if (!source) {
    throw new Error('Nie udało się odczytać wybranego pliku PDF.');
  }

  try {
    await FileSystem.copyAsync({ from: source, to: destination });
    const copied = await FileSystem.getInfoAsync(destination);
    if (copied.exists) return destination;
  } catch {
    // content:// na Androidzie czasem wymaga odczytu base64.
  }

  const base64 = await FileSystem.readAsStringAsync(source, {
    encoding: 'base64'
  });
  await FileSystem.writeAsStringAsync(destination, base64, {
    encoding: 'base64'
  });

  const saved = await FileSystem.getInfoAsync(destination);
  if (!saved.exists) {
    throw new Error('Nie udało się zapisać wybranego pliku PDF w aplikacji.');
  }

  return destination;
}

function resolvePickedPdfUri(result) {
  if (!result || result.canceled) return '';
  return result.assets?.[0]?.uri || result.uri || '';
}

export async function pickPollubPdfFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false
  });

  const sourceUri = resolvePickedPdfUri(result);
  if (!sourceUri) return null;

  return persistPdfInAppStorage(sourceUri);
}

function parseLoginFormFields(html) {
  const source = String(html || '');
  const loginMatch = source.match(/name="(login_[a-f0-9]+)"/i);
  const passMatch = source.match(/name="(pass_[a-f0-9]+)"/i);
  const counterMatch = source.match(/name="counter"\s+value="([^"]+)"/i);

  if (!loginMatch || !passMatch) {
    throw new Error('Nie udało się odczytać formularza logowania eHMS.');
  }

  return {
    loginField: loginMatch[1],
    passwordField: passMatch[1],
    counter: counterMatch?.[1] || ''
  };
}

function hasLoginForm(html) {
  return /log_form/i.test(html) && /name="login_/i.test(html);
}

function isLoggedIn(html) {
  const source = String(html || '');
  if (hasLoginForm(source)) return false;
  return /wyloguj/i.test(source) || /logout/i.test(source) || /MOJE STUDIA/i.test(source);
}

function isLoginFailure(html) {
  const source = String(html || '');
  if (!hasLoginForm(source)) return false;
  // eHMS: „niepoprawny UID lub hasło” w alert-danger. Nie używać /nieprawid/ — w stopce RODO jest „nieprawidłowe”.
  return (
    /niepoprawny\s+UID/i.test(source) ||
    /class="[^"]*alert-danger[^"]*"[^>]*>[\s\S]{0,200}?niepoprawny/i.test(source)
  );
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*tr\s*>/gi, '\n')
    .replace(/<\/\s*td\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDtDdField(html, label) {
  const safe = escapeRegex(String(label || '').trim());
  const re = new RegExp(`<dt[^>]*>\\s*${safe}\\s*:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i');
  const match = String(html || '').match(re);
  if (!match?.[1]) return '';
  return stripHtmlToText(match[1]);
}

function extractTokLabelField(html, title) {
  const safe = escapeRegex(String(title || '').trim());
  const re = new RegExp(`title="${safe}">([^<]+)<`, 'i');
  const match = String(html || '').match(re);
  return match ? String(match[1]).trim() : '';
}

function formatPollubFullName(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const commaIndex = raw.indexOf(',');
  const last = raw.slice(0, commaIndex).trim();
  const first = raw.slice(commaIndex + 1).trim();
  if (!last || !first) return raw;
  return `${first} ${last}`.trim();
}

function extractStudyField(text, label) {
  const source = String(text || '');
  const safe = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`${safe}\\s*\\n\\s*([^\\n]{1,200})`, 'i'),
    new RegExp(`${safe}\\s*[:\\-–—]\\s*([^\\n]{1,200})`, 'i')
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }

  return '';
}

export function parseStudyInfoFromHtml(html) {
  const source = String(html || '');
  const text = stripHtmlToText(source);
  const faculty =
    extractDtDdField(source, 'Wydział') ||
    extractTokLabelField(source, 'Wydział') ||
    extractStudyField(text, 'Wydział');
  const program =
    extractDtDdField(source, 'Kierunek') ||
    extractTokLabelField(source, 'Kierunek') ||
    extractStudyField(text, 'Kierunek');
  const specialization = extractDtDdField(source, 'Specjalność') || extractStudyField(text, 'Specjalność');
  const studySystem =
    extractDtDdField(source, 'System studiów') ||
    extractTokLabelField(source, 'System studiów') ||
    extractStudyField(text, 'System studiów');
  const studyKind =
    extractDtDdField(source, 'Rodzaj studiów') ||
    extractTokLabelField(source, 'Rodzaj studiów') ||
    extractStudyField(text, 'Rodzaj studiów');
  const semesterLabel = extractDtDdField(source, 'Semestr') || extractStudyField(text, 'Semestr');
  const yearSemesterRaw =
    extractDtDdField(source, 'Rok / semestr (w roku akad.)') ||
    extractStudyField(text, 'Rok / semestr (w roku akad.)');
  const rawFullName =
    extractDtDdField(source, 'Nazwisko, Imię') ||
    extractDtDdField(source, 'Imię i nazwisko') ||
    extractStudyField(text, 'Imię i nazwisko') ||
    extractStudyField(text, 'Nazwisko, Imię') ||
    extractStudyField(text, 'Nazwisko i imię');
  const fullName = formatPollubFullName(rawFullName) || rawFullName;
  const albumNumber =
    extractDtDdField(source, 'Nr albumu') ||
    extractDtDdField(source, 'Numer albumu') ||
    extractStudyField(text, 'Numer albumu') ||
    extractStudyField(text, 'Nr albumu') ||
    extractStudyField(text, 'Numer indeksu') ||
    extractStudyField(text, 'Indeks');

  // Przykład: "2 / 4 (2025/26)"
  const yearSemesterMatch = yearSemesterRaw.match(/(\d+)\s*\/\s*(\d+)(?:\s*\(([^)]+)\))?/);
  const yearInProgram = yearSemesterMatch ? Number(yearSemesterMatch[1]) : null;
  const semesterInYear = yearSemesterMatch ? Number(yearSemesterMatch[2]) : null;
  const academicYear = yearSemesterMatch ? String(yearSemesterMatch[3] || '').trim() : '';

  return {
    faculty,
    program,
    specialization,
    studySystem,
    studyKind,
    semesterLabel,
    academicYear,
    yearInProgram,
    semesterInYear,
    fullName,
    albumNumber,
    university: 'Politechnika Lubelska',
    degreeLevel: studyKind
  };
}

export function mergePollubStudyInfo(studyInfo, groupsHtml) {
  const next = { ...(studyInfo || {}) };
  const groupsProfile = groupsHtml ? parseHtmlStudentProfile(groupsHtml) : {};

  if (!next.fullName && groupsProfile.fullName) next.fullName = groupsProfile.fullName;
  if (!next.albumNumber && groupsProfile.albumNumber) next.albumNumber = groupsProfile.albumNumber;
  if (!next.program && groupsProfile.program) next.program = groupsProfile.program;
  if (!next.faculty && groupsProfile.faculty) next.faculty = groupsProfile.faculty;
  if (!next.degreeLevel && groupsProfile.degreeLevel) next.degreeLevel = groupsProfile.degreeLevel;
  if (!next.studySystem && groupsProfile.studyMode) next.studySystem = groupsProfile.studyMode;
  if (!next.university) next.university = groupsProfile.university || 'Politechnika Lubelska';

  return next;
}

export function parseGroupsFromHtml(html) {
  const source = String(html || '');
  const groups = new Set();
  let match = GROUP_CODE_RE.exec(source);

  while (match) {
    groups.add(String(match[1]).toUpperCase().replace('Ć', 'C'));
    match = GROUP_CODE_RE.exec(source);
  }

  return [...groups].sort();
}

export async function loginToPollub(login, password, onPhase) {
  const jar = new Map();
  onPhase?.('POLLUB: Otwieram eHMS');
  const loginPage = await followRedirects(BASE_URL, jar);
  const loginHtml = await loginPage.text();
  const fields = parseLoginFormFields(loginHtml);

  onPhase?.('POLLUB: Loguję do eHMS');
  const body = formEncode({
    log_form: 'yes',
    [fields.loginField]: String(login || '').trim(),
    [fields.passwordField]: String(password || ''),
    ...(fields.counter ? { counter: fields.counter } : {})
  });

  const authResponse = await followRedirects(BASE_URL, jar, 'POST', body);
  const authHtml = await authResponse.text();

  if (isLoginFailure(authHtml)) {
    throw new Error('Nieprawidłowy login lub hasło eHMS.');
  }

  if (isLoggedIn(authHtml)) {
    return jar;
  }

  onPhase?.('POLLUB: Sprawdzam sesję eHMS');
  const sessionCheck = await followRedirects(GROUPS_URL, jar);
  const sessionHtml = await sessionCheck.text();

  if (isLoginFailure(sessionHtml)) {
    throw new Error('Nieprawidłowy login lub hasło eHMS.');
  }

  if (!isLoggedIn(sessionHtml)) {
    throw new Error('Nie udało się zalogować do eHMS. Sprawdź dane i spróbuj ponownie.');
  }

  return jar;
}

export async function fetchPollubStudentGroups(login, password, onPhase) {
  const jar = await loginToPollub(login, password, onPhase);
  const result = await fetchPollubStudentGroupsWithJar(jar, onPhase);
  return result.groups;
}

async function fetchPollubStudentGroupsWithJar(jar, onPhase) {
  onPhase?.('POLLUB: Pobieram grupy studenta');
  const groupsResponse = await followRedirects(GROUPS_URL, jar);
  const groupsHtml = await groupsResponse.text();

  if (!isLoggedIn(groupsHtml)) {
    throw new Error('Sesja eHMS wygasła podczas pobierania grup.');
  }

  const groups = parseGroupsFromHtml(groupsHtml);
  if (!groups.length) {
    throw new Error('Nie znaleziono grup na stronie eHMS (Grupy studenta).');
  }

  return { groups, html: groupsHtml };
}

export async function fetchPollubStudyInfo(login, password, onPhase) {
  const jar = await loginToPollub(login, password, onPhase);
  return fetchPollubStudyInfoWithJar(jar, onPhase);
}

async function fetchPollubStudyInfoWithJar(jar, onPhase) {
  onPhase?.('POLLUB: Pobieram tok studiów');
  const response = await followRedirects(STUDY_INFO_URL, jar);
  const html = await response.text();

  if (!isLoggedIn(html)) {
    throw new Error('Sesja eHMS wygasła podczas pobierania toku studiów.');
  }

  const info = parseStudyInfoFromHtml(html);
  if (!info?.faculty) {
    throw new Error('Nie udało się odczytać wydziału z eHMS (Tok studiów).');
  }

  return info;
}

function eventKey(event) {
  return [
    event?.type,
    event?.start,
    event?.end,
    event?.title,
    event?.roomName,
    event?.teacherName,
    event?.groupName
  ]
    .filter(Boolean)
    .join('|');
}

function mergeUniqueEvents(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      const key = eventKey(event);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged;
}

async function readPdfBase64FromUri(pdfUri) {
  const uri = String(pdfUri || '').trim();
  if (!uri) {
    throw new Error('Brak pliku PDF planu POLLUB.');
  }

  return FileSystem.readAsStringAsync(uri, {
    encoding: 'base64'
  });
}

export async function fetchScheduleFromPdf({
  pdfUri,
  studentGroups,
  startDateKey,
  endDateKey,
  onPhase,
  extractPdfTextLocal
}) {
  if (!extractPdfTextLocal) {
    throw new Error('Brak lokalnego parsera PDF w aplikacji.');
  }

  if (!studentGroups?.length) {
    throw new Error('Brak grup studenta z eHMS — nie można dopasować kolumn planu.');
  }

  onPhase?.('POLLUB: Wczytuję plik PDF planu');
  const base64Pdf = await readPdfBase64FromUri(pdfUri);

  onPhase?.('POLLUB: Wyciągam tekst z PDF (proces lokalny)...');
  const extracted = await extractPdfTextLocal(base64Pdf);
  const items = Array.isArray(extracted) ? extracted : [];

  if (!items.length || items[0]?.text == null) {
    throw new Error('Nie udało się odczytać siatki planu z PDF. Sprawdź plik z wydziału.');
  }

  onPhase?.(`POLLUB: Filtruję plan po grupach: ${studentGroups.join(', ')}`);
  const events = parsePdfItemsToEvents(items, studentGroups, startDateKey, endDateKey);

  if (!events.length) {
    throw new Error(
      `Nie znaleziono zajęć dla Twoich grup (${studentGroups.join(', ')}) w tym PDF. Sprawdź, czy to właściwy plan rocznika.`
    );
  }

  onPhase?.(`POLLUB: Wczytano ${events.length} terminów z planu tygodniowego`);
  return events;
}

export async function loginAndFetchSchedule({
  login,
  password,
  pdfUri,
  pdfUris,
  startDateKey,
  endDateKey,
  onPhase,
  extractPdfTextLocal,
  onStudentMeta
}) {
  const jar = await loginToPollub(login, password, onPhase);
  const [groupsResult, studyInfo] = await Promise.all([
    fetchPollubStudentGroupsWithJar(jar, onPhase),
    fetchPollubStudyInfoWithJar(jar, onPhase)
  ]);
  const groups = groupsResult.groups;
  const mergedStudyInfo = mergePollubStudyInfo(studyInfo, groupsResult.html);

  onPhase?.(`POLLUB: Grupy z eHMS: ${groups.join(', ')}`);

  let effectivePdfUris = (Array.isArray(pdfUris) ? pdfUris : [pdfUri])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  let wbiaEvents = [];
  const isWbia = isPollubWbiaFaculty(mergedStudyInfo);
  let discoveredPlan = null;

  if (!isWbia && effectivePdfUris.length === 0) {
    try {
      discoveredPlan = await discoverPollubPlanPdf({ studyInfo: mergedStudyInfo, onPhase });
      if (discoveredPlan?.localUri) {
        effectivePdfUris = [discoveredPlan.localUri];
      }
    } catch {
      // Brak PDF na stronie wydziału — logowanie może iść dalej bez planu.
    }
  }

  onStudentMeta?.({
    studyInfo: mergedStudyInfo,
    groups,
    isWbia,
    pdfUris: effectivePdfUris,
    discoveredPlan
  });

  if (isWbia) {
    onPhase?.('POLLUB WBiA: Szukam planu');
    const planId = await resolveWbiaPlanId(mergedStudyInfo);
    onPhase?.('POLLUB WBiA: Pobieram plan');
    const html = await fetchWbiaPlanHtml(planId);
    onPhase?.('POLLUB WBiA: Przetwarzam plan');
    wbiaEvents = parseWbiaPlanToEvents({ html, startDateKey, endDateKey, planId });
  }

  const pdfEventsLists = [];
  for (let index = 0; index < effectivePdfUris.length; index += 1) {
    const currentPdf = effectivePdfUris[index];
    onPhase?.(`POLLUB: PDF (${index + 1}/${effectivePdfUris.length})`);
    try {
      const events = await fetchScheduleFromPdf({
        pdfUri: currentPdf,
        studentGroups: groups,
        startDateKey,
        endDateKey,
        onPhase,
        extractPdfTextLocal
      });
      pdfEventsLists.push(events);
    } catch (error) {
      // Jeśli są inne źródła (np. WBiA), nie blokujemy całości przez jeden zły PDF.
      if (!wbiaEvents.length && effectivePdfUris.length === 1) throw error;
    }
  }

  const merged = mergeUniqueEvents(wbiaEvents, ...pdfEventsLists);
  const portalCookies = serializeCookieJar(jar);
  if (!merged.length) {
    // Dla nie-WBiA dopuszczamy logowanie bez PDF, żeby użytkownik mógł dodać go później.
    if (!isWbia && effectivePdfUris.length === 0) {
      return { events: [], portalCookies, discoveredPollubPdfUris: [] };
    }

    throw new Error('Nie znaleziono planu. Dodaj PDF planu (Ustawienia → PDF planów) albo upewnij się, że jesteś na WBiA.');
  }
  return {
    events: merged,
    portalCookies,
    discoveredPollubPdfUris: discoveredPlan?.localUri ? [discoveredPlan.localUri] : []
  };
}
