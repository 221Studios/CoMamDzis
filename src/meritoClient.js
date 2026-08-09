import { fromByteArray } from 'base64-js';
import * as Crypto from 'expo-crypto';

import { resolveMeritoEventPresentation } from './meritoEventStatus';
import { serializeCookieJar } from './portalSession';
import { parseHtmlStudentProfile } from './studentProfile';

const API_BASE_URL = 'https://api.meritogo.pl';
const AUTH_BASE_URL = 'https://login.wsb.pl';
const REDIRECT_URI = 'https://meritogo.pl';
const CLIENT_ID = 'meritogoservice';
const RESPONSE_TYPE = 'code';
const LANGUAGE = 'pl_PL';
const REQUEST_TIMEOUT_MS = 20000;
const MERITO_IMPORTANT_SCHEDULE_CATEGORIES = ['STUDY', 'EVENTS', 'OFFICE_HOURS', 'PAYMENTS'];
const MERITO_IMPORTANT_LABEL = 'Ważny termin';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function fetchWithTimeout(url, options = {}) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Logowanie Merito trwa za dlugo. Sprawdz internet i sprobuj ponownie.'));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fetch(url, options), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

function base64Url(value) {
  return String(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function bytesToBase64(bytes) {
  return fromByteArray(Uint8Array.from(bytes));
}

function stringToBase64(value) {
  const bytes = Array.from(String(value)).map((character) => character.charCodeAt(0));
  return bytesToBase64(bytes);
}

function randomBase64Url(length = 32) {
  const bytes = Crypto.getRandomBytes(length);
  return base64Url(bytesToBase64(bytes));
}

async function codeChallenge(verifier) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64
  });
  return base64Url(digest);
}

function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value ?? '')}`)
    .join('&');
}

function readHeader(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}

function splitSetCookie(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(/,(?=\s*[^;,=\s]+=[^;,]+)/);
}

function saveCookies(jar, headers) {
  const direct = typeof headers?.getSetCookie === 'function' ? headers.getSetCookie() : null;
  const setCookies = direct?.length ? direct : splitSetCookie(readHeader(headers, 'set-cookie'));

  setCookies.forEach((cookie) => {
    const pair = String(cookie).split(';')[0];
    const separator = pair.indexOf('=');
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  });
}

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function fetchWithCookies(url, options = {}, jar) {
  const headers = {
    ...browserLikeHeaders(),
    ...(options.headers || {})
  };

  if (jar.size) headers.Cookie = cookieHeader(jar);

  const response = await fetchWithTimeout(url, {
    ...options,
    headers,
    credentials: 'include',
    redirect: options.redirect || 'manual'
  });

  saveCookies(jar, response.headers);
  return response;
}

function resolveUrl(location, currentUrl) {
  return new URL(location, currentUrl).toString();
}

async function followRedirects(url, jar) {
  let currentUrl = url;
  let response = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    response = await fetchWithCookies(currentUrl, {}, jar);
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: currentUrl };

    const location = readHeader(response.headers, 'location');
    if (!location) return { response, url: currentUrl };

    currentUrl = resolveUrl(location, currentUrl);
    if (currentUrl.startsWith(REDIRECT_URI) && currentUrl.includes('code=')) {
      return { response, url: currentUrl };
    }
  }

  return { response, url: currentUrl };
}

function extractInputValue(html, name) {
  const inputs = String(html).match(/<input[\s\S]*?>/gi) || [];
  const matchingInput = inputs.find((input) => new RegExp(`\\bname=["']${name}["']`, 'i').test(input));
  if (!matchingInput) return '';

  return matchingInput.match(/\bvalue=["']([^"']*)["']/i)?.[1] || '';
}

function extractHiddenFormFields(html) {
  const fields = {};
  const inputs = String(html).match(/<input[\s\S]*?>/gi) || [];

  inputs.forEach((input) => {
    const type = (input.match(/\btype=["']([^"']*)["']/i)?.[1] || 'text').toLowerCase();
    if (type !== 'hidden') return;

    const name = input.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name) return;

    fields[name] = input.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? '';
  });

  return fields;
}

function buildCasLoginPayload(html, login, password) {
  return {
    ...extractHiddenFormFields(html),
    username: login,
    password,
    _eventId: 'submit',
    submit: 'LOGIN'
  };
}

function hasCasUsernameField(html) {
  return /name=["']username["']/i.test(String(html));
}

function browserLikeHeaders(referer = '') {
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...(referer ? { Referer: referer } : {})
  };
}

function extractCodeFromText(text, expectedState) {
  const source = String(text);
  const code = source.match(/[?&]code=([^&"'<>\\s]+)/i)?.[1];
  if (!code) return '';

  const returnedState = source.match(/[?&]state=([^&"'<>\\s]+)/i)?.[1];
  if (expectedState && returnedState && returnedState !== expectedState) return '';

  return decodeURIComponent(code);
}

function isCasLoginFailure(status, html, url) {
  const source = String(html || '');
  const currentUrl = String(url || '');

  if (status === 401) return true;

  if (!currentUrl.includes('/cas/login') || !hasCasUsernameField(source)) return false;

  return (
    /login details are incorrect/i.test(source) ||
    /Nieprawid/i.test(source) ||
    /credentials?.*(invalid|incorrect)/i.test(source)
  );
}

function extractFormAction(html) {
  return html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1] || '';
}

function resolveFormAction(action, currentUrl) {
  const resolved = resolveUrl(action || currentUrl, currentUrl);

  try {
    const parsedCurrent = new URL(currentUrl);
    const parsedResolved = new URL(resolved);
    const keepsCasLoginPath =
      parsedCurrent.hostname === parsedResolved.hostname &&
      parsedCurrent.pathname === '/cas/login' &&
      parsedResolved.pathname === '/cas/login' &&
      parsedCurrent.searchParams.has('service') &&
      !parsedResolved.searchParams.has('service');

    if (keepsCasLoginPath) return currentUrl;
  } catch {
    return resolved;
  }

  return resolved;
}

async function readJson(response, fallbackMessage) {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.message || fallbackMessage);
  }

  return data;
}

function authUrl(verifier, state) {
  const params = new URLSearchParams({
    protocol: 'oauth2',
    response_type: RESPONSE_TYPE,
    access_type: '',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: '',
    state,
    code_challenge_method: 'S256'
  });
  return codeChallenge(verifier).then((challenge) => {
    params.set('code_challenge', challenge);
    return `${AUTH_BASE_URL}/oauth2.0/authorize?${params.toString()}`;
  });
}

async function casLoginUrl(verifier, state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: '',
    redirect_uri: REDIRECT_URI,
    response_type: RESPONSE_TYPE,
    state,
    protocol: 'oauth2',
    access_type: '',
    code_challenge_method: 'S256',
    client_name: 'CasOAuthClient'
  });

  params.set('code_challenge', await codeChallenge(verifier));

  const serviceUrl = `${AUTH_BASE_URL}/cas/oauth2.0/callbackAuthorize?${params.toString()}`;
  return `${AUTH_BASE_URL}/cas/login?service=${encodeURIComponent(serviceUrl)}`;
}

function extractCodeFromUrl(url, expectedState) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const returnedState = parsed.searchParams.get('state');
    if (code && (!expectedState || returnedState === expectedState)) return code;
  } catch {
    return '';
  }

  return '';
}

async function loginWithNativeCookies(login, password, verifier, state, authorizationUrl, onPhase) {
  const loginUrls = [authorizationUrl, await casLoginUrl(verifier, state)];

  for (const [index, loginUrl] of loginUrls.entries()) {
    if (index > 0) onPhase?.('Merito: próbuję alternatywny formularz logowania');
    const code = await loginWithNativeCookiesFromUrl(login, password, state, loginUrl);
    if (code) return code;
  }

  return '';
}

async function loginWithNativeCookiesFromUrl(login, password, state, loginUrl) {
  const initialResponse = await fetchWithTimeout(loginUrl, {
    credentials: 'include',
    redirect: 'follow',
    headers: browserLikeHeaders()
  });
  const initialUrl = initialResponse.url || loginUrl;
  const codeFromInitialUrl = extractCodeFromUrl(initialUrl, state);

  if (codeFromInitialUrl) return codeFromInitialUrl;

  const html = await initialResponse.text();
  const formAction = resolveFormAction(extractFormAction(html) || initialUrl, initialUrl);

  if (!hasCasUsernameField(html) || !extractInputValue(html, 'execution')) {
    return '';
  }

  const loginResponse = await fetchWithTimeout(formAction, {
    method: 'POST',
    credentials: 'include',
    redirect: 'follow',
    headers: {
      ...browserLikeHeaders(initialUrl),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(buildCasLoginPayload(html, login, password))
  });

  const finalUrl = loginResponse.url || formAction;
  const codeFromFinalUrl = extractCodeFromUrl(finalUrl, state);
  if (codeFromFinalUrl) return codeFromFinalUrl;

  const responseHtml = await loginResponse.text();
  const codeFromHtml = extractCodeFromText(responseHtml, state);
  if (codeFromHtml) return codeFromHtml;

  if (isCasLoginFailure(loginResponse.status, responseHtml, finalUrl)) {
    throw new Error('Nie udalo sie zalogowac do Merito. Sprawdz login i haslo.');
  }

  return '';
}

async function loginWithManualCookies(login, password, verifier, state, authorizationUrl, jar, onPhase) {
  const initial = await followRedirects(authorizationUrl, jar);
  if (initial.url.startsWith(REDIRECT_URI) && initial.url.includes('code=')) {
    return extractCodeFromUrl(initial.url, state);
  }

  let formHtml = await initial.response.text();
  let formUrl = initial.url;
  let execution = extractInputValue(formHtml, 'execution');
  let formAction = extractFormAction(formHtml) || formUrl;
  let code = '';

  if (!execution || !hasCasUsernameField(formHtml)) {
    onPhase?.('Merito: szukam bezpośredniego formularza CAS');
    const directLogin = await followRedirects(await casLoginUrl(verifier, state), jar);
    formHtml = await directLogin.response.text();
    formUrl = directLogin.url;
    execution = extractInputValue(formHtml, 'execution');
    formAction = extractFormAction(formHtml) || formUrl;
  }

  if (!execution || !hasCasUsernameField(formHtml)) return '';

  onPhase?.('Merito: wysyłam login i hasło');
  const postUrl = resolveFormAction(formAction, formUrl);
  const loginResponse = await fetchWithCookies(
    postUrl,
    {
      method: 'POST',
      headers: {
        ...browserLikeHeaders(formUrl),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formEncode(buildCasLoginPayload(formHtml, login, password))
    },
    jar
  );

  let codeUrl = formUrl;
  if ([301, 302, 303, 307, 308].includes(loginResponse.status)) {
    codeUrl = resolveUrl(readHeader(loginResponse.headers, 'location'), postUrl);
    codeUrl = (await followRedirects(codeUrl, jar)).url;
  } else {
    const responseHtml = await loginResponse.text();
    code = extractCodeFromText(responseHtml, state);
    if (!code && isCasLoginFailure(loginResponse.status, responseHtml, formUrl)) {
      throw new Error('Nie udalo sie zalogowac do Merito. Sprawdz login i haslo.');
    }
  }

  if (!code) {
    code = extractCodeFromUrl(codeUrl, state) || extractCodeFromText(codeUrl, state);
  }

  return code;
}

async function finalizeMeritoLogin(code, verifier, jar, onPhase) {
  const session = await exchangeMeritoCode(code, verifier, onPhase);
  try {
    await fetchWithCookies(`${REDIRECT_URI}/`, { credentials: 'include' }, jar);
  } catch {
    // best-effort cookies for portal WebView
  }
  return {
    accessToken: session.accessToken,
    contextId: session.contextId,
    contextsData: session.contextsData,
    cookieJar: jar,
    cookies: serializeCookieJar(jar)
  };
}

export async function loginToMerito(login, password, onPhase) {
  const jar = new Map();
  const verifier = randomBase64Url();
  const state = base64Url(
    stringToBase64(
      JSON.stringify({
        nonce: randomBase64Url(),
        ts: Date.now()
      })
    )
  );

  onPhase?.('Merito: otwieram stronę logowania CAS');
  const authorizationUrl = await authUrl(verifier, state);

  // React Native cannot read Set-Cookie headers, so native cookie storage is required.
  let code = await loginWithNativeCookies(login, password, verifier, state, authorizationUrl, onPhase);

  if (!code) {
    onPhase?.('Merito: próbuję alternatywną metodę logowania');
    code = await loginWithManualCookies(login, password, verifier, state, authorizationUrl, jar, onPhase);
  }

  if (!code) {
    throw new Error('Nie udalo sie zalogowac do Merito. Sprawdz login i haslo.');
  }

  return finalizeMeritoLogin(code, verifier, jar, onPhase);
}

async function exchangeMeritoCode(code, verifier, onPhase) {
  onPhase?.('Merito: wymieniam kod logowania na token');
  const tokenResponse = await fetchWithTimeout(`${API_BASE_URL}/v1/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code,
      redirect_uri: REDIRECT_URI,
      audience: '',
      grant_type: '',
      code_verifier: verifier,
      client_id: CLIENT_ID,
      response_type: RESPONSE_TYPE
    })
  });

  const tokenData = await readJson(tokenResponse, 'Nie udalo sie pobrac tokenu Merito.');
  const accessToken = tokenData?.token?.access_token;
  const contextsData = tokenData?.contexts || null;
  const contextId =
    contextsData?.appSettings?.defaultContext?.id ||
    contextsData?.appSettings?.defaultContextExtended?.context?.id ||
    contextsData?.contexts?.[0]?.id;

  if (!accessToken || !contextId) {
    throw new Error('Merito nie zwrocilo pelnych danych sesji.');
  }

  return {
    accessToken,
    contextId,
    contextsData
  };
}

function apiHeaders(session) {
  return {
    Authorization: `Bearer ${session.accessToken}`,
    'Accept-Language': LANGUAGE,
    'X-Language': LANGUAGE,
    'X-Timezone': 'Europe/Warsaw',
    'context-id': session.contextId
  };
}

function mergeProfiles(...profiles) {
  return profiles.reduce((merged, profile) => {
    Object.entries(profile || {}).forEach(([key, value]) => {
      const text = cleanMeritoProfileValue(value);
      if (text && !String(merged[key] || '').trim()) merged[key] = text;
    });
    return merged;
  }, {});
}

function cleanMeritoProfileValue(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  return text
    .replace(/\s*[/|]\s*(?:wydzia[łl]|status\s*studenta|statusstudenta|uczelnia|rodzaj\s*studi[oó]w|rodzajstudi[oó]w|poziom\s*studi[oó]w|poziomstudi[oó]w|forma\s*studi[oó]w|formastudi[oó]w|wpis\s+na\s+semestr)[\s\S]*$/i, '')
    .replace(/\s{2,}(?:wydzia[łl]|status\s*studenta|statusstudenta|uczelnia|rodzaj\s*studi[oó]w|rodzajstudi[oó]w|poziom\s*studi[oó]w|poziomstudi[oó]w|forma\s*studi[oó]w|formastudi[oó]w|wpis\s+na\s+semestr)[\s\S]*$/i, '')
    .trim();
}

function profileFromMeritoUser(user) {
  const fullName = [user?.firstName || user?.name, user?.lastName || user?.surname]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    fullName: fullName || user?.fullName || user?.displayName || '',
    albumNumber: user?.studentNumber || user?.indexNumber || user?.albumNumber || user?.login || '',
    university: user?.universityName || user?.university || user?.schoolName || '',
    program: user?.fieldOfStudy || user?.studyProgram || user?.courseName || '',
    faculty: user?.facultyName || user?.departmentName || '',
    degreeLevel: user?.studyLevel || user?.degreeLevel || user?.educationLevel || '',
    studyMode: user?.studyMode || user?.studyForm || user?.educationForm || user?.studyKind || user?.studyType || user?.educationType || '',
    semester: user?.semester ? `Semestr ${user.semester}` : '',
    group: Array.isArray(user?.groups) ? user.groups.join(', ') : user?.groupName || ''
  };
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return asText(
      value.name ||
      value.title ||
      value.label ||
      value.value ||
      value.displayName ||
      value.fullName ||
      ''
    );
  }
  return '';
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function valueAtPath(source, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current?.[key], source);
}

function firstPath(source, paths) {
  return firstText(...paths.map((path) => valueAtPath(source, path)));
}

function profileFromMeritoContexts(contextsData) {
  const extended = contextsData?.appSettings?.defaultContextExtended || contextsData || {};
  const profile = extended.profile || {};
  const studyData = extended.studyData || {};
  const context = extended.context || contextsData?.appSettings?.defaultContext || {};
  const faculty = context.faculty || {};
  const sots = context.sots || {};

  return {
    fullName: firstText(
      profile.fullName,
      [profile.firstName || profile.name, profile.lastName || profile.surname].filter(Boolean).join(' ')
    ),
    albumNumber: firstPath(studyData, ['albumNumber', 'album_number', 'studentNumber', 'indexNumber']),
    university: firstText(
      firstPath(studyData, ['university.name', 'universityName', 'school.name', 'schoolName']),
      firstPath(context, ['university.name', 'universityName']),
      sots.name
    ),
    program: firstText(
      firstPath(studyData, [
        'fieldOfStudy.name',
        'fieldOfStudy',
        'studyProgram.name',
        'studyProgram',
        'studyProgramName',
        'courseName'
      ])
    ),
    faculty: firstText(
      firstPath(studyData, ['faculty.name', 'facultyName', 'department.name', 'departmentName']),
      faculty.name
    ),
    degreeLevel: firstPath(studyData, [
      'studyLevel.name',
      'studyLevel',
      'degreeLevel.name',
      'degreeLevel',
      'educationLevel.name',
      'educationLevel'
    ]),
    studyMode: firstPath(studyData, [
      'studyForm.name',
      'studyForm',
      'studyMode.name',
      'studyMode',
      'educationForm.name',
      'educationForm',
      'studyKind.name',
      'studyKind',
      'studyType.name',
      'studyType',
      'educationType.name',
      'educationType'
    ]),
    semester: firstText(studyData.semester ? `Semestr ${asText(studyData.semester)}` : '', studyData.semesterName),
    group: firstText(studyData.groupName, studyData.group, studyData.groups)
  };
}

async function fetchMeritoContexts(session) {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/v2/drupal/v1/contexts`, {
      headers: apiHeaders(session)
    });
    if (!response.ok) return null;
    return readJson(response, 'Nie udalo sie pobrac kontekstu Merito.');
  } catch {
    return null;
  }
}

async function fetchMeritoPortalPage(session, path) {
  const jar = session.cookieJar || new Map();
  const response = await fetchWithCookies(
    `${REDIRECT_URI}${path}`,
    {
      credentials: 'include',
      headers: browserLikeHeaders(REDIRECT_URI),
      redirect: 'follow'
    },
    jar
  );
  if (!response.ok) return '';
  return response.text();
}

async function fetchStudentEvents(session, startDateKey, endDateKey, categoryNames, onPhase) {
  onPhase?.(`Merito: pobieram kalendarz ${categoryNames}`);
  const params = new URLSearchParams({
    dateFrom: startDateKey,
    dateTo: endDateKey,
    categoryNames
  });
  const response = await fetchWithTimeout(`${API_BASE_URL}/v2/class_schedule/v3/schedule/student?${params.toString()}`, {
    headers: apiHeaders(session)
  });
  const data = await readJson(response, 'Nie udalo sie pobrac planu Merito.');
  return data?.events || [];
}

async function fetchMeritoMessageCalendarEvents(session, startDateKey, endDateKey, onPhase) {
  onPhase?.('Merito: pobieram ważne terminy z wiadomości');
  const params = new URLSearchParams({
    date_from: startDateKey,
    date_to: endDateKey
  });
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/v2/messages/v1/calendar-events?${params.toString()}`, {
      headers: apiHeaders(session)
    });
    const data = await readJson(response, 'Nie udalo sie pobrac terminów z wiadomości Merito.');
    return data?.data || [];
  } catch {
    return [];
  }
}

async function fetchMeritoPaymentCalendarEvents(session, startDateKey, endDateKey, onPhase) {
  onPhase?.('Merito: pobieram terminy płatności');
  const params = new URLSearchParams({
    dateFrom: startDateKey,
    dateTo: endDateKey
  });
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/v2/payments/v1/events?${params.toString()}`, {
      headers: apiHeaders(session)
    });
    const data = await readJson(response, 'Nie udalo sie pobrac terminów płatności Merito.');
    return data?.events || [];
  } catch {
    return [];
  }
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isMeritoImportantScheduleCategory(categoryName) {
  return Boolean(categoryName && categoryName !== 'CLASS_SCHEDULE');
}

async function fetchEventDetails(session, event) {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/v2/class_schedule/v2/event/${encodeURIComponent(event.id)}`, {
      headers: apiHeaders(session)
    });
    const data = await readJson(response, 'Nie udalo sie pobrac szczegolow zajec Merito.');
    return data?.data || event;
  } catch {
    return event;
  }
}

function eventColor(event) {
  if (event.categoryName === 'STUDY') return '#141E50';
  if (event.categoryName === 'PAYMENTS') return '#141E50';
  if (event.categoryName === 'EVENTS') return '#E85D04';
  if (event.categoryName === 'OFFICE_HOURS') return '#006EFA';
  if (event.isOnline) return '#006EFA';
  return '#0EA5E9';
}

function normalizeLocation(localization) {
  if (!localization) return '';
  if (Array.isArray(localization)) return '';
  return localization.address || '';
}

function normalizeMeritoEvent(event, details = {}, options = {}) {
  const merged = {
    ...event,
    ...details
  };
  const categoryName = event.categoryName || merged.categoryName || 'CLASS_SCHEDULE';
  const isImportantDate = options.isImportantDate ?? isMeritoImportantScheduleCategory(categoryName);
  const rooms = merged.rooms || event.rooms || [];
  const lecturers = merged.lecturers || event.lecturers || [];
  const locationAddress = normalizeLocation(merged.localization || event.localization);
  const isOnline = Boolean(merged.isOnline || event.isOnline || merged.linkToOnlineEvent);
  const classFormName = merged.classFormName || event.classFormShortName || (categoryName === 'STUDY' ? 'Egzamin' : '');
  const eventStatus = String(merged.status || event.status || '').trim();
  const presentation = resolveMeritoEventPresentation(eventStatus, {
    reasonOfRescheduled: merged.reasonOfRescheduled,
    finalMovedFrom: merged.finalMovedFrom,
    finalMovedTo: merged.finalMovedTo
  });
  const notes = [
    presentation.rescheduleNotes,
    merged.description,
    merged.subformName ? `Tryb szczegolowy: ${merged.subformName}` : '',
    merged.groups?.length ? `Grupa: ${merged.groups.join(', ')}` : ''
  ].filter(Boolean);

  return {
    id: String(event.id),
    type: `MERITO:${categoryName}`,
    title: merged.name || event.name || (isImportantDate ? 'Ważny termin' : 'Zajecia'),
    module: '',
    form: classFormName,
    isImportantDate,
    isCrossedOut: presentation.isCrossedOut,
    isRescheduled: presentation.isRescheduled,
    statusLabel: presentation.statusLabel,
    start: merged.date?.from || event.start,
    end: merged.date?.to || event.end,
    room: '',
    teachers: '',
    teacherNames: lecturers.map((lecturer) => lecturer.fullName).filter(Boolean),
    buildingName: '',
    buildingAddress: locationAddress,
    roomName: Array.isArray(rooms) ? rooms.join(', ') : rooms || '',
    subject: '',
    additionalInfo: notes.join('\n'),
    locationMode: isOnline ? 'Online' : locationAddress || rooms?.length ? 'Budynek' : '',
    color: eventColor({ ...merged, categoryName }),
    status: eventStatus,
    hangoutLink: merged.linkToOnlineEvent || '',
    hangoutLinkLabel: merged.linkToOnlineEvent ? 'Otwórz Teams' : ''
  };
}

function normalizeMeritoMessageEvent(event) {
  const categoryName = String(event.categoryId || event.categoryName || 'MESSAGES');
  const description = stripHtml(event.content);
  return {
    id: `msg-${event.id}`,
    type: `MERITO:MSG:${categoryName}`,
    title: event.title || MERITO_IMPORTANT_LABEL,
    module: '',
    form: '',
    isImportantDate: true,
    start: event.calendarFrom,
    end: event.calendarTo || event.calendarFrom,
    room: '',
    teachers: '',
    teacherNames: [],
    buildingName: '',
    buildingAddress: '',
    roomName: '',
    subject: '',
    additionalInfo: description,
    locationMode: '',
    color: eventColor({ categoryName }),
    status: '',
    hangoutLink: '',
    hangoutLinkLabel: ''
  };
}

function normalizeMeritoPaymentEvent(event) {
  const title = event.type?.name || 'Płatność';
  const balance = event.balance != null ? String(event.balance) : '';
  const date = event.date || event.start;
  return {
    id: `pay-${event.id}`,
    type: 'MERITO:PAYMENTS',
    title,
    module: '',
    form: '',
    isImportantDate: true,
    start: date,
    end: date,
    room: '',
    teachers: '',
    teacherNames: [],
    buildingName: '',
    buildingAddress: '',
    roomName: '',
    subject: '',
    additionalInfo: balance ? `Saldo: ${balance}` : '',
    locationMode: '',
    color: eventColor({ categoryName: 'PAYMENTS' }),
    status: '',
    hangoutLink: '',
    hangoutLinkLabel: ''
  };
}

function orderEventsByFocusDate(events, focusDate = new Date()) {
  const focusTime = focusDate.getTime();
  return [...events].sort((left, right) => {
    const leftDistance = Math.abs(new Date(left.start).getTime() - focusTime);
    const rightDistance = Math.abs(new Date(right.start).getTime() - focusTime);
    return leftDistance - rightDistance;
  });
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

async function fetchMeritoStudentProfile(session, onPhase) {
  onPhase?.('Merito: pobieram dane studenta');
  let apiProfile = {};
  const contextsData = session.contextsData || await fetchMeritoContexts(session);
  const contextProfile = profileFromMeritoContexts(contextsData);
  const candidates = [
    `${API_BASE_URL}/v2/users/me`,
    `${API_BASE_URL}/v2/user/me`,
    `${API_BASE_URL}/v1/users/me`
  ];

  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, { headers: apiHeaders(session) });
      if (!response.ok) continue;
      const data = await response.json();
      const user = data?.data || data?.user || data;
      apiProfile = profileFromMeritoUser(user);
      if (Object.values(apiProfile).some(Boolean)) break;
    } catch {
      // try next endpoint
    }
  }

  const portalProfile = await Promise.all([
    fetchMeritoPortalPage(session, '/user/profile'),
    fetchMeritoPortalPage(session, '/user/study-tracks')
  ])
    .then((pages) => parseHtmlStudentProfile(pages.join('\n')))
    .catch(() => ({}));

  return mergeProfiles(contextProfile, portalProfile, apiProfile);
}

export async function loginAndFetchSchedule({ login, password, startDateKey, endDateKey, onPhase, onStudentProfile }) {
  const session = await loginToMerito(login, password, onPhase);
  const studentProfile = await fetchMeritoStudentProfile(session, onPhase).catch(() => ({}));
  await onStudentProfile?.({
    ...studentProfile,
    albumNumber: studentProfile?.albumNumber || String(login || '').trim()
  });
  onPhase?.('Merito: pobieram ważne terminy');
  const [
    classEvents,
    importantScheduleEvents,
    messageEvents,
    paymentEvents
  ] = await Promise.all([
    fetchStudentEvents(session, startDateKey, endDateKey, 'CLASS_SCHEDULE', onPhase),
    Promise.all(
      MERITO_IMPORTANT_SCHEDULE_CATEGORIES.map((categoryName) =>
        fetchStudentEvents(session, startDateKey, endDateKey, categoryName, onPhase).catch(() => [])
      )
    ).then((lists) => lists.flat()),
    fetchMeritoMessageCalendarEvents(session, startDateKey, endDateKey, onPhase),
    fetchMeritoPaymentCalendarEvents(session, startDateKey, endDateKey, onPhase)
  ]);

  const allEvents = [...classEvents, ...importantScheduleEvents];
  const events = [
    ...classEvents.map((event) => normalizeMeritoEvent(event, {}, { isImportantDate: false })),
    ...importantScheduleEvents.map((event) => normalizeMeritoEvent(event, {}, { isImportantDate: true })),
    ...messageEvents.map((event) => normalizeMeritoMessageEvent(event)),
    ...paymentEvents.map((event) => normalizeMeritoPaymentEvent(event))
  ].sort((a, b) => new Date(a.start) - new Date(b.start));

  return {
    events,
    enrichDetails: async (options = {}) => {
      const { focusDate = new Date(), onEventEnriched } = options;
      onPhase?.(`Merito: pobieram szczegóły zajęć (${allEvents.length})`);
      const rawById = new Map(allEvents.map((event) => [String(event.id), event]));
      const enrichedById = new Map();

      await mapWithConcurrency(orderEventsByFocusDate(events, focusDate), 16, async (snapshot) => {
        const raw = rawById.get(String(snapshot.id));
        if (!raw) return snapshot;
        const details = await fetchEventDetails(session, raw);
        const normalized = normalizeMeritoEvent(raw, details, {
          isImportantDate: isMeritoImportantScheduleCategory(raw.categoryName)
        });
        enrichedById.set(String(normalized.id), normalized);
        onEventEnriched?.(normalized);
        return normalized;
      });

      return events.map((event) => enrichedById.get(String(event.id)) || event);
    },
    portalCookies: session.cookies || []
  };
}
