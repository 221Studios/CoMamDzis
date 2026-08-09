import { prepareCookieRequest, saveCookiesFromResponse } from './httpCookies';
import { serializeCookieJar } from './portalSession';
import { parseHtmlStudentProfile } from './studentProfile';
import { parseWseitScheduleHtmlToEvents } from './wseitScheduleParser';

export const WSEIT_STORED_PREFIX = 'wseit-stored:v1:';
export const WSEIT_CONTEXT_REQUIRED = 'WSEIT_CONTEXT_REQUIRED';

const BASE_URL = 'https://wd.wseit.pl';
const LOGIN_URL = `${BASE_URL}/Logowanie`;
const SCHEDULE_URL = `${BASE_URL}/Plany/PlanyStudentow`;
const PROFILE_URL = `${BASE_URL}/TokStudiow/StudentTwojeDane/Osobowe`;
const STUDY_INFO_URL = `${BASE_URL}/TokStudiow/StudentTokStudiow/DaneOToku`;
const REQUEST_TIMEOUT_MS = 45000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function browserLikeHeaders(referer = BASE_URL) {
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9',
    ...(referer ? { Referer: referer } : {})
  };
}

function formPostHeaders(referer = LOGIN_URL) {
  return {
    ...browserLikeHeaders(referer),
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: BASE_URL
  };
}

async function fetchWithTimeout(url, options = {}) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('WSEIT nie odpowiada. Sprawdź internet i spróbuj ponownie.'));
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

function resolveUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

async function followRedirects(url, jar, method = 'GET', body = null, referer = BASE_URL) {
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
        referer,
        ...(isPost ? { headers: formPostHeaders(referer) } : {})
      },
      jar
    );

    if (!isRedirect(response.status)) {
      return { response, url: currentUrl };
    }

    const location = response.headers.get('location') || response.headers.get('Location');
    if (!location) return { response, url: currentUrl };
    currentUrl = resolveUrl(location, currentUrl);
    nextMethod = 'GET';
    nextBody = null;
  }

  return { response, url: currentUrl };
}

function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function encodeBase64Utf8(value) {
  const bytes = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(bytes);
  }
  throw new Error('Brak obsługi zapisu profilu WSEIT w tej wersji aplikacji.');
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

export function packWseitStoredCredential(password, { contextId = '', contextLabel = '' } = {}) {
  const payload = JSON.stringify({
    password: String(password || ''),
    contextId: String(contextId || ''),
    contextLabel: String(contextLabel || '')
  });
  return `${WSEIT_STORED_PREFIX}${encodeBase64Utf8(payload)}`;
}

export function unpackWseitStoredCredential(value) {
  const raw = String(value || '');
  if (!raw.startsWith(WSEIT_STORED_PREFIX)) return null;

  try {
    const parsed = JSON.parse(decodeBase64Utf8(raw.slice(WSEIT_STORED_PREFIX.length)));
    return {
      password: String(parsed.password || ''),
      contextId: String(parsed.contextId || ''),
      contextLabel: String(parsed.contextLabel || '')
    };
  } catch {
    return null;
  }
}

export function looksLikeWseitStoredCredential(value) {
  return String(value || '').startsWith(WSEIT_STORED_PREFIX);
}

function hasLoginForm(html) {
  const source = String(html || '');
  return /name="__RequestVerificationToken"/i.test(source) && /name="Username"/i.test(source);
}

function isLoggedIn(html) {
  const source = String(html || '');
  if (hasLoginForm(source)) return false;
  return /Wyloguj/i.test(source) || /loginContextSelect/i.test(source) || /WybierzKontekst/i.test(source);
}

function isLoginFailure(html) {
  const source = String(html || '');
  if (!hasLoginForm(source)) return false;
  return /nieprawid|błędn|bledn|invalid|incorrect/i.test(source);
}

export function isWseitAccountBlocked(html) {
  const source = String(html || '');
  return /Dostęp do serwisu został zablokowany/i.test(source) || /zaległość jest zbyt duża/i.test(source);
}

function extractBlockedDebtMessage(html) {
  const source = String(html || '');
  const match = source.match(/Dostęp do serwisu został zablokowany[^<]*/i);
  if (match?.[0]) {
    return match[0].replace(/\s+/g, ' ').trim();
  }
  return 'Dostęp do planu zajęć w WSEIT jest zablokowany z powodu zaległości finansowych. Ureguluj opłaty w dziekanacie i spróbuj ponownie.';
}

function cleanWseitContextLabel(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;|—/g, '—')
    .replace(/Student\s*—\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWseitContextsFromHtml(html) {
  const source = String(html || '');
  const contexts = [];
  const seen = new Set();

  const optionPattern =
    /<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi;
  let optionMatch = optionPattern.exec(source);
  while (optionMatch) {
    const id = String(optionMatch[1] || '').trim();
    const label = cleanWseitContextLabel(optionMatch[2]);
    if (id && label && !seen.has(id)) {
      seen.add(id);
      contexts.push({ id, label });
    }
    optionMatch = optionPattern.exec(source);
  }

  const linkPattern =
    /href="(\/WybierzKontekst\?[^"]+)"[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/gi;
  let linkMatch = linkPattern.exec(source);
  while (linkMatch) {
    const href = String(linkMatch[1] || '').replace(/&amp;/g, '&');
    const idMatch = href.match(/[?&]id=(\d+)/i);
    const id = idMatch?.[1] || '';
    const label = cleanWseitContextLabel(linkMatch[2]);
    if (id && label && !seen.has(id)) {
      seen.add(id);
      contexts.push({ id, label, href });
    }
    linkMatch = linkPattern.exec(source);
  }

  return contexts;
}

function buildContextUrl(context) {
  if (context?.href) {
    const href = String(context.href).replace(/&amp;/g, '&');
    return href.startsWith('http') ? href : `${BASE_URL}${href}`;
  }
  const id = String(context?.id || context?.contextId || '').trim();
  if (!id) return '';
  return `${BASE_URL}/WybierzKontekst?id=${encodeURIComponent(id)}&personType=1`;
}

async function readHtml(response) {
  return response.text();
}

async function openLoginPage(jar) {
  const { response } = await followRedirects(LOGIN_URL, jar);
  return readHtml(response);
}

async function submitLogin(login, password, jar) {
  const loginHtml = await openLoginPage(jar);
  const token = loginHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i)?.[1];
  if (!token) {
    throw new Error('Nie udało się odczytać formularza logowania WSEIT.');
  }

  const body = formEncode({
    __RequestVerificationToken: token,
    Username: login,
    Password: password
  });

  const { response, url } = await followRedirects(LOGIN_URL, jar, 'POST', body, LOGIN_URL);
  const html = await readHtml(response);

  if (isLoginFailure(html)) {
    throw new Error('Nieprawidłowy login lub hasło do WSEIT.');
  }
  if (!isLoggedIn(html)) {
    throw new Error('Logowanie do WSEIT nie powiodło się. Sprawdź login i hasło.');
  }

  return { html, url };
}

async function selectContext(jar, context, refererHtml = '') {
  const contexts = parseWseitContextsFromHtml(refererHtml);
  const resolved =
    contexts.find((entry) => entry.id === String(context?.id || context?.contextId || '')) ||
    context;
  const targetUrl = buildContextUrl(resolved);
  if (!targetUrl) return refererHtml;

  const { response } = await followRedirects(targetUrl, jar, 'GET', null, BASE_URL);
  return readHtml(response);
}

export async function loginToWseit(login, password, onPhase, context = null, options = {}) {
  const requireContextSelection = options.requireContextSelection !== false;
  onPhase?.('WSEIT: loguję do dziekanatu');
  const jar = new Map();
  const loginResult = await submitLogin(login, password, jar);
  let html = loginResult.html;

  const contexts = parseWseitContextsFromHtml(html);
  const contextId = String(context?.id || context?.contextId || '').trim();

  if (contextId) {
    onPhase?.('WSEIT: wybieram profil studiów');
    html = await selectContext(jar, { id: contextId }, html);
  } else if (contexts.length === 1) {
    onPhase?.('WSEIT: wybieram profil studiów');
    html = await selectContext(jar, contexts[0], html);
  } else if (contexts.length > 1 && requireContextSelection) {
    const error = new Error('Wybierz profil studiów WSEIT.');
    error.code = WSEIT_CONTEXT_REQUIRED;
    error.contexts = contexts;
    throw error;
  }

  return { jar, html, contexts };
}

export async function listWseitContextsForLogin({ login, password, onPhase }) {
  const { contexts } = await loginToWseit(login, password, onPhase, null, {
    requireContextSelection: false
  });
  return contexts;
}

async function fetchProfile(jar, onPhase) {
  onPhase?.('WSEIT: pobieram dane studenta');
  const pages = [];
  for (const path of [PROFILE_URL, STUDY_INFO_URL]) {
    const { response } = await followRedirects(path, jar);
    pages.push(await readHtml(response));
  }
  return parseHtmlStudentProfile(pages.join('\n'));
}

async function fetchScheduleHtml(jar, onPhase) {
  onPhase?.('WSEIT: pobieram plan zajęć');
  const { response, url } = await followRedirects(SCHEDULE_URL, jar);
  const html = await readHtml(response);

  if (isWseitAccountBlocked(html)) {
    throw new Error(extractBlockedDebtMessage(html));
  }

  const finalUrl = String(url || response.url || '');
  if (/Finanse|Oplaty|DaneDoPrzelewow/i.test(finalUrl) && !/Plany/i.test(finalUrl)) {
    throw new Error(extractBlockedDebtMessage(html));
  }

  if (hasLoginForm(html)) {
    throw new Error('Sesja WSEIT wygasła. Zaloguj się ponownie.');
  }

  return html;
}

export async function loginAndFetchSchedule({
  login,
  password,
  startDateKey,
  endDateKey,
  onPhase,
  onStudentProfile,
  contextId = '',
  contextLabel = ''
}) {
  const stored = unpackWseitStoredCredential(password);
  const resolvedPassword = stored?.password || password;
  const resolvedContextId = String(contextId || stored?.contextId || '').trim();
  const resolvedContextLabel = String(contextLabel || stored?.contextLabel || '').trim();

  const { jar } = await loginToWseit(
    login,
    resolvedPassword,
    onPhase,
    resolvedContextId ? { id: resolvedContextId, label: resolvedContextLabel } : null
  );

  const profile = await fetchProfile(jar, onPhase);
  await onStudentProfile?.({
    ...profile,
    university: profile.university || 'WSEIT',
    program: profile.program || resolvedContextLabel
  });

  const scheduleHtml = await fetchScheduleHtml(jar, onPhase);
  const events = parseWseitScheduleHtmlToEvents(scheduleHtml, startDateKey, endDateKey);

  if (!events.length && !/dxgvDataRow/i.test(scheduleHtml)) {
    throw new Error(
      'Nie udało się odczytać planu zajęć z WSEIT. Jeśli konto ma zaległości finansowe, dostęp do planu może być zablokowany do czasu ich uregulowania.'
    );
  }

  return {
    events,
    portalCookies: serializeCookieJar(jar)
  };
}
