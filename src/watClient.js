import {
  buildWatGroupIndexUrl,
  buildScheduleUrlFromIndex,
  buildWatScheduleUrl,
  guessWatFacultyIdForGroup,
  normalizeWatGroupHref,
  rankWmlIndexXmlUrl,
  scheduleBaseFromIndexUrl,
  WML_ROZKLADY_ZAJEC_URL,
  watFacultyById,
  watSemesterAlternatives,
  watSemesterForDate
} from './watConfig';
import { decodeWindows1250 } from './watEncoding';
import { parsePlansoftHtmlToEvents } from './watPlansoftParser';

export const WAT_STORED_PREFIX = 'wat-stored:v1:';

const REQUEST_TIMEOUT_MS = 45000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function browserHeaders() {
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9'
  };
}

async function fetchWithTimeout(url, options = {}) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Serwer WAT nie odpowiada. Sprawdź internet i spróbuj ponownie.'));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetch(url, {
        ...options,
        headers: {
          ...browserHeaders(),
          ...(options.headers || {})
        }
      }),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function encodeBase64Utf8(value) {
  const bytes = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(bytes);
  }
  throw new Error('Brak obsługi zapisu profilu WAT w tej wersji aplikacji.');
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

export function packWatStoredCredential(password, { facultyId, groupCode, groupHref, semesterFolder, semesterTerm }) {
  const payload = JSON.stringify({
    password: String(password || ''),
    facultyId: String(facultyId || 'wml'),
    groupCode: String(groupCode || '').trim(),
    groupHref: normalizeWatGroupHref(groupHref || groupCode),
    semesterFolder: String(semesterFolder || ''),
    semesterTerm: String(semesterTerm || '')
  });
  return `${WAT_STORED_PREFIX}${encodeBase64Utf8(payload)}`;
}

export function unpackWatStoredCredential(value) {
  const raw = String(value || '');
  if (!raw.startsWith(WAT_STORED_PREFIX)) return null;

  try {
    const parsed = JSON.parse(decodeBase64Utf8(raw.slice(WAT_STORED_PREFIX.length)));
    return {
      password: String(parsed.password || ''),
      facultyId: String(parsed.facultyId || guessWatFacultyIdForGroup(parsed.groupCode)),
      groupCode: String(parsed.groupCode || '').trim(),
      groupHref: normalizeWatGroupHref(parsed.groupHref || parsed.groupCode),
      semesterFolder: String(parsed.semesterFolder || ''),
      semesterTerm: String(parsed.semesterTerm || '')
    };
  } catch {
    return null;
  }
}

export function looksLikeWatStoredCredential(value) {
  return String(value || '').startsWith(WAT_STORED_PREFIX);
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

export function parseGroupsFromPlansoftIndexXml(xml, indexUrl = '') {
  const groups = [];
  const re = /<gro\b([^>]*)\/?>/gi;
  let match = re.exec(xml);
  while (match) {
    const attrs = match[1] || '';
    const hrefMatch = attrs.match(/\bhref="([^"]*)"/i);
    const textMatch = attrs.match(/\btext="([^"]*)"/i);
    const href = decodeXmlText(hrefMatch?.[1] || '');
    const label = decodeXmlText(textMatch?.[1] || '') || href.replace(/\.htm$/i, '');
    const code = label.trim() || href.replace(/\.htm$/i, '');
    if (href || code) {
      const normalizedHref = normalizeWatGroupHref(href || code);
      groups.push({
        code,
        href: normalizedHref,
        label: code || href.replace(/\.htm$/i, ''),
        scheduleUrl: indexUrl ? buildScheduleUrlFromIndex(indexUrl, normalizedHref) : ''
      });
    }
    match = re.exec(xml);
  }

  return groups.sort((a, b) => a.code.localeCompare(b.code, 'pl'));
}

function resolveAbsoluteUrl(baseUrl, ref) {
  try {
    return new URL(ref, baseUrl).href;
  } catch {
    return String(ref || '').trim();
  }
}

export function extractIndexXmlUrlsFromHtml(html, baseUrl) {
  const urls = new Set();
  const patterns = [
    /https?:\/\/[^"'<>\s]+index\.xml/gi,
    /(?:src|href)=["']([^"']+index\.xml)["']/gi
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      const raw = match[1] || match[0];
      const resolved = resolveAbsoluteUrl(baseUrl, raw);
      if (resolved) urls.add(resolved);
      match = pattern.exec(html);
    }
  }

  return [...urls];
}

export function extractWmlSemesterPageUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /href=["']([^"']*\/rozklady-zajec\/rozklady-zajec[^"']+)["']/gi;
  let match = pattern.exec(html);
  while (match) {
    const resolved = resolveAbsoluteUrl(baseUrl, match[1]);
    if (resolved.includes('wml.wat.edu.pl')) urls.add(resolved);
    match = pattern.exec(html);
  }
  return [...urls];
}

function sortIndexXmlUrls(indexUrls, semester) {
  return [...indexUrls].sort((left, right) => {
    const rankDiff = rankWmlIndexXmlUrl(left, semester) - rankWmlIndexXmlUrl(right, semester);
    if (rankDiff !== 0) return rankDiff;
    return right.localeCompare(left, 'pl');
  });
}

async function readResponseText(response, url = '') {
  const path = String(url || response.url || '').toLowerCase();
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  const useWindows1250 =
    /\.(htm|xml)(\?|$)/i.test(path) ||
    /windows-1250|iso-8859-2|cp1250/i.test(contentType);

  if (!useWindows1250) {
    return response.text();
  }

  if (typeof response.arrayBuffer === 'function') {
    try {
      const buffer = await response.arrayBuffer();
      return decodeWindows1250(buffer);
    } catch {
      // Fallback for środowisk bez arrayBuffer().
    }
  }

  return response.text();
}

async function discoverWmlIndexXmlUrls(pageHtml, pageUrl) {
  const urls = new Set(extractIndexXmlUrlsFromHtml(pageHtml, pageUrl));
  const semesterPages = extractWmlSemesterPageUrls(pageHtml, pageUrl);

  for (const semesterPage of semesterPages) {
    const response = await fetchWithTimeout(semesterPage);
    if (!response.ok) continue;
    const html = await readResponseText(response, semesterPage);
    for (const indexUrl of extractIndexXmlUrlsFromHtml(html, semesterPage)) {
      urls.add(indexUrl);
    }
  }

  return [...urls];
}

async function fetchGroupsFromIndexXml(indexUrl) {
  const response = await fetchWithTimeout(indexUrl);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać indeksu grup (${response.status}).`);
  }

  const xml = await readResponseText(response, indexUrl);
  const groups = parseGroupsFromPlansoftIndexXml(xml, indexUrl);
  if (!groups.length) {
    throw new Error('Indeks grup jest pusty.');
  }

  return { groups, indexUrl };
}

export async function fetchWatGroupsFromRozkladyPage({ onPhase }) {
  onPhase?.('WAT: Pobieram listę grup z WML');
  const pageUrl = WML_ROZKLADY_ZAJEC_URL;
  const response = await fetchWithTimeout(pageUrl);
  if (!response.ok) {
    throw new Error(`Nie udało się otworzyć strony rozkładów WML (${response.status}).`);
  }

  const html = await readResponseText(response, pageUrl);
  const indexUrls = sortIndexXmlUrls(await discoverWmlIndexXmlUrls(html, pageUrl), watSemesterForDate());
  if (!indexUrls.length) {
    throw new Error('Nie znaleziono indeksu grup na stronie WML.');
  }

  let lastError = null;
  for (const indexUrl of indexUrls) {
    try {
      const { groups } = await fetchGroupsFromIndexXml(indexUrl);
      const faculty = watFacultyById('wml');
      const semesterFolder = scheduleBaseFromIndexUrl(indexUrl).split('/').filter(Boolean).pop() || '';
      const semesterTerm = semesterFolder.includes('zima') ? 'zima' : 'lato';
      return {
        groups,
        faculty,
        semester: { term: semesterTerm, folder: semesterFolder },
        indexUrl,
        pageUrl
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Nie znaleziono grup na stronie WML.');
}

export async function fetchWatGroups({ facultyId, semester, onPhase }) {
  const faculty = watFacultyById(facultyId);
  if (faculty.id === 'wml') {
    return fetchWatGroupsFromRozkladyPage({ onPhase });
  }

  const term = semester || watSemesterForDate();
  const indexUrl = buildWatGroupIndexUrl(faculty, term);

  onPhase?.(`WAT: Pobieram listę grup (${faculty.shortName}, ${term.term})`);
  const { groups } = await fetchGroupsFromIndexXml(indexUrl);

  return { groups, faculty, semester: term, indexUrl };
}

export async function fetchWatScheduleHtml({ facultyId, groupCode, groupHref, semester, onPhase }) {
  const faculty = watFacultyById(facultyId);
  const groupRef = normalizeWatGroupHref(groupHref || groupCode);
  const label = String(groupCode || groupRef).trim() || groupRef;

  if (/^https?:\/\//i.test(groupRef)) {
    onPhase?.(`WAT: Pobieram plan grupy ${label}`);
    const response = await fetchWithTimeout(groupRef);
    if (!response.ok) {
      throw new Error(`Nie udało się pobrać planu grupy ${label} (${response.status}).`);
    }

    const html = await readResponseText(response, groupRef);
    if (html && /<table/i.test(html)) {
      const folder = groupRef.split('/').filter(Boolean).slice(-2, -1)[0] || '';
      const term = folder.includes('zima') ? 'zima' : 'lato';
      return {
        html,
        semester: semester || { term, folder },
        url: groupRef
      };
    }

    throw new Error(`Plan grupy ${label} jest pusty lub niedostępny.`);
  }

  const semesterCandidates = semester
    ? [semester, ...watSemesterAlternatives().filter((item) => item.term !== semester.term)]
    : watSemesterAlternatives();

  let lastStatus = 0;

  for (const term of semesterCandidates) {
    const url = buildWatScheduleUrl(faculty, term, groupRef);
    onPhase?.(`WAT: Pobieram plan grupy ${label} (${term.term})`);

    const response = await fetchWithTimeout(url);
    lastStatus = response.status;
    if (!response.ok) continue;

    const html = await readResponseText(response, url);
    if (html && /<table/i.test(html)) {
      return { html, semester: term, url };
    }
  }

  throw new Error(
    `Nie udało się pobrać planu grupy ${label}${lastStatus ? ` (${lastStatus})` : ''}. Sprawdź wydział i semestr.`
  );
}

export async function loginAndFetchSchedule({
  login,
  password,
  facultyId,
  groupCode,
  groupHref,
  startDateKey,
  endDateKey,
  onPhase
}) {
  const stored = unpackWatStoredCredential(password);
  const resolvedFacultyId = facultyId || stored?.facultyId || guessWatFacultyIdForGroup(groupCode || stored?.groupCode);
  const resolvedGroup = String(groupCode || stored?.groupCode || '').trim();
  const resolvedHref = normalizeWatGroupHref(groupHref || stored?.groupHref || resolvedGroup);
  if (!login?.trim()) {
    throw new Error('Wpisz uczelniany e-mail WAT.');
  }
  if (!resolvedGroup && !resolvedHref) {
    throw new Error('Wybierz grupę z listy.');
  }

  const semester =
    stored?.semesterFolder && stored?.semesterTerm
      ? { term: stored.semesterTerm, folder: stored.semesterFolder }
      : null;

  const { html, semester: resolvedSemester } = await fetchWatScheduleHtml({
    facultyId: resolvedFacultyId,
    groupCode: resolvedGroup || resolvedHref.replace(/\.htm$/i, ''),
    groupHref: resolvedHref,
    semester,
    onPhase
  });

  onPhase?.('WAT: Przetwarzam plan zajęć');
  const events = parsePlansoftHtmlToEvents(
    html,
    resolvedGroup || resolvedHref.replace(/\.htm$/i, ''),
    startDateKey,
    endDateKey
  );

  if (!events.length) {
    throw new Error(
      `Plan grupy ${resolvedGroup} jest pusty w tym semestrze. Sprawdź wydział i semestr (lato/zima).`
    );
  }

  onPhase?.(`WAT: Wczytano ${events.length} terminów`);
  return events;
}

export async function listWatGroupsForLogin({ facultyId, onPhase }) {
  return fetchWatGroups({ facultyId, onPhase });
}
