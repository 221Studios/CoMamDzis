import { parseUsosIcalEventLocation } from './planEventInfo.js';
import { isUsosSemesterValueValid, sanitizeUsosSemesterValue } from './usosStudentProfile.js';
import {
  extractUsosIcalUrl,
  isUsosIcalFeedUrl,
  normalizeUsosIcalUrl
} from './usosIcalExtract.js';
import {
  isNetworkFetchError,
  prepareCookieRequest,
  pullNativeCookiesToJar,
  readResponseHeader,
  resetNativeCookieSession,
  saveCookiesFromResponse,
  wrapFetchNetworkError
} from './httpCookies.js';
import { readRedirectLocation, usosHttpRequest } from './usosHttp.js';

const REQUEST_TIMEOUT_MS = 20000;
const MAX_RECURRENCE_INSTANCES = 250;
export const USOS_STORED_PREFIX = 'usos-stored:v1:';

const USOS_LOGIN_CANDIDATES = [
  'kontroler.php?_action=logowaniecas/index',
  'kontroler.php?_action=news/default'
];

const USOS_ICAL_CANDIDATE_ACTIONS = [
  'kontroler.php?_action=home/plan',
  'kontroler.php?_action=home/eksportujPlan',
  'kontroler.php?_action=home/plany/index',
  'kontroler.php?_action=home/plany/pokaz',
  'kontroler.php?_action=home/plany/przyklady',
  'kontroler.php?_action=home/kalendarz',
  'kontroler.php?_action=kalendarz/index',
  'kontroler.php?_action=news/default'
];

let pendingSecondFactor = null;

function encodeBase64Utf8(value) {
  const bytes = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(bytes);
  }
  throw new Error('Brak obsługi zapisu profilu USOS w tej wersji aplikacji.');
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

async function fetchWithTimeout(url, options = {}) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('USOS iCal nie odpowiedział na czas. Sprawdź link i internet.')), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fetch(url, options), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

function resolveUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function formEncode(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function attr(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(pattern);
  return decodeHtmlEntities(match?.[1] || match?.[2] || match?.[3] || '');
}

function extractInputValue(html, name) {
  const pattern = new RegExp(`<input[\\s\\S]*?name\\s*=\\s*(?:"${name}"|'${name}'|${name})[\\s\\S]*?>`, 'i');
  const input = String(html || '').match(pattern)?.[0] || '';
  return attr(input, 'value');
}

function extractFormAction(html, currentUrl) {
  const loginForm = String(html || '').match(/<form[^>]*id=["']loginForm["'][^>]*>/i)?.[0] || '';
  const form = loginForm || String(html || '').match(/<form[^>]*>/i)?.[0] || '';
  const action = attr(form, 'action') || currentUrl;
  const resolved = resolveUrl(decodeHtmlEntities(action), currentUrl);
  if (resolved && resolved !== 'about:blank') return resolved;
  if (isUjAdfsLoginUrl(currentUrl)) return adfsUrlForPortal('https://www.usosweb.uj.edu.pl') || currentUrl;
  return currentUrl;
}

function extractHiddenInputs(html) {
  const fields = {};
  const inputs = matchInputTags(html);
  inputs.forEach((input) => {
    const type = attr(input, 'type');
    const name = attr(input, 'name');
    if (!name || type.toLowerCase() !== 'hidden') return;
    fields[name] = attr(input, 'value');
  });
  return fields;
}

function browserHeaders(url, referer = url) {
  let origin = '';
  let site = 'none';
  try {
    const target = new URL(url);
    origin = target.origin;
    if (referer && referer !== url) {
      const ref = new URL(referer);
      site = ref.hostname === target.hostname ? 'same-origin' : 'cross-site';
    }
  } catch {
    // ignore malformed urls
  }

  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Connection: 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    Referer: referer || url,
    ...(origin ? { Origin: origin } : {}),
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': site,
    'Sec-Fetch-User': '?1'
  };
}

function matchInputTags(html) {
  return String(html || '').match(/<input[\s\S]*?>/gi) || [];
}

function pageHostLabel(url) {
  try {
    const parsed = new URL(url);
    if (/\/cas\/login/i.test(parsed.pathname)) {
      return `${parsed.hostname}/cas/login`;
    }
    return parsed.hostname;
  } catch {
    return String(url || '').slice(0, 60);
  }
}

/**
 * Single hop — followRedirect: false (blob-util) / redirect: manual (Node).
 * Set-Cookie from 302 is stored in jar before the caller reads Location.
 */
async function requestWithCookies(jar, url, options = {}) {
  const referer = options.referer || url;
  const headers = {
    ...browserHeaders(url, referer),
    ...(options.headers || {})
  };
  await prepareCookieRequest(url, jar, headers);

  const method = String(options.method || 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : options.body;

  try {
    const response = await usosHttpRequest(url, { method, headers, body });
    await saveCookiesFromResponse(jar, response.headers, url);
    return response;
  } catch (error) {
    throw wrapFetchNetworkError(error, url);
  }
}

/**
 * CAS/USOS chain: 302 → save cookies → GET Location → repeat until 2xx/4xx.
 */
async function followRequest(jar, url, options = {}, maxRedirects = 15) {
  let currentUrl = url;
  let currentOptions = { ...options };
  let referer = options.referer || url;
  let response = await requestWithCookies(jar, currentUrl, { ...currentOptions, referer });

  for (let index = 0; index < maxRedirects && response.status >= 300 && response.status < 400; index += 1) {
    const nextUrl = readRedirectLocation(response.headers, currentUrl);
    if (!nextUrl) break;

    referer = currentUrl;
    currentUrl = decodeHtmlEntities(nextUrl);
    const nextMethod = response.status === 303 || response.status === 302 || response.status === 301
      ? 'GET'
      : (currentOptions.method || 'GET');

    currentOptions = {
      method: nextMethod,
      headers: currentOptions.headers,
      referer
    };
    if (nextMethod === 'GET') {
      delete currentOptions.body;
    }

    response = await requestWithCookies(jar, currentUrl, currentOptions);
  }

  return {
    response,
    url: currentUrl
  };
}

function normalizeIcalUrl(value) {
  return String(value || '').trim();
}

export function looksLikeUsosIcalUrl(value) {
  return isUsosIcalFeedUrl(normalizeIcalUrl(value));
}

export function packUsosStoredCredential(password = '', icalUrl = '', profile = null) {
  const payload = {
    password: String(password || ''),
    icalUrl: normalizeIcalUrl(icalUrl)
  };
  if (profile && typeof profile === 'object') {
    payload.profile = {
      fullName: String(profile.fullName || ''),
      albumNumber: String(profile.albumNumber || ''),
      university: String(profile.university || ''),
      program: String(profile.program || ''),
      faculty: String(profile.faculty || ''),
      degreeLevel: String(profile.degreeLevel || ''),
      studyMode: String(profile.studyMode || ''),
      semester: sanitizeUsosSemesterValue(String(profile.semester || '')),
      group: String(profile.group || '')
    };
  }
  return `${USOS_STORED_PREFIX}${encodeBase64Utf8(JSON.stringify(payload))}`;
}

export function unpackUsosStoredCredential(value) {
  const raw = String(value || '');

  if (raw.startsWith(USOS_STORED_PREFIX)) {
    try {
      const parsed = JSON.parse(decodeBase64Utf8(raw.slice(USOS_STORED_PREFIX.length)));
      return {
        password: String(parsed.password || ''),
        icalUrl: normalizeIcalUrl(parsed.icalUrl),
        profile: parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : null
      };
    } catch {
      return null;
    }
  }

  if (looksLikeUsosIcalUrl(raw)) {
    return {
      password: '',
      icalUrl: normalizeIcalUrl(raw)
    };
  }

  return null;
}

export function looksLikeUsosStoredCredential(value) {
  return String(value || '').startsWith(USOS_STORED_PREFIX);
}

function extractLoginUrlFromUsos(html, baseUrl) {
  const text = String(html || '');
  const attrValue = text.match(/login-url=["']([^"']+)["']/i)?.[1] || '';
  if (attrValue) return resolveUrl(decodeHtmlEntities(attrValue), baseUrl);

  const casHref = text.match(/href=["'](https?:\/\/cas\.usos\.pw\.edu\.pl\/cas\/login[^"']*)["']/i)?.[1]
    || text.match(/href=["'](https?:\/\/cas\.uj\.edu\.pl\/cas\/login[^"']*)["']/i)?.[1]
    || '';
  if (casHref) return decodeHtmlEntities(casHref);

  const href = text.match(/href=["']([^"']*logowaniecas[^"']*)["']/i)?.[1] || '';
  if (href) return resolveUrl(decodeHtmlEntities(href), baseUrl);

  return '';
}

function stripCasGatewayParam(url) {
  try {
    const parsed = new URL(url);
    if (!/\/cas\/login/i.test(parsed.pathname) && !/login\.umcs\.pl\/login/i.test(`${parsed.hostname}${parsed.pathname}`)) {
      return url;
    }
    parsed.searchParams.delete('gateway');
    return parsed.toString();
  } catch {
    return String(url || '').replace(/([?&])gateway=true&?/i, '$1').replace(/[?&]$/, '');
  }
}

function extractCollegeLoginUrls(html, baseUrl) {
  const text = String(html || '');
  const found = [
    extractLoginUrlFromUsos(text, baseUrl),
    text.match(/https?:\/\/sts\.uj\.edu\.pl\/adfs\/ls\/\?[^"'<>\s]+/i)?.[0] || '',
    text.match(/https?:\/\/cas\.uj\.edu\.pl\/cas\/login[^"'<>\s]*/i)?.[0] || '',
    text.match(/https?:\/\/cas\.usos\.pw\.edu\.pl\/cas\/login[^"'<>\s]*/i)?.[0] || '',
    text.match(/https?:\/\/cas\.amu\.edu\.pl\/cas\/login[^"'<>\s]*/i)?.[0] || '',
    text.match(/https?:\/\/cas\.[a-z0-9.-]+\/cas\/login[^"'<>\s]*/i)?.[0] || '',
    text.match(/https?:\/\/login\.umcs\.pl\/login[^"'<>\s]*/i)?.[0] || ''
  ];
  return uniqueUrls(found.map((url) => stripCasGatewayParam(decodeHtmlEntities(url))));
}

function casLoginUrlForPortal(portalUrl) {
  const host = portalHost(portalUrl);
  const service = encodeURIComponent(usosUrl(portalUrl, 'kontroler.php?_action=logowaniecas/index'));

  if (/usosweb\.uj\.edu\.pl/i.test(host) || /(?:^|\.)uj\.edu\.pl$/i.test(host)) {
    return `https://cas.uj.edu.pl/cas/login?service=${service}&locale=pl`;
  }

  if (/usos\.pw\.edu\.pl/i.test(host)) {
    return `https://cas.usos.pw.edu.pl/cas/login?locale=pl&service=${service}`;
  }

  if (/usosweb\.umcs\.pl/i.test(host) || /(?:^|\.)umcs\.pl$/i.test(host)) {
    return `https://login.umcs.pl/login?service=${service}&locale=pl`;
  }

  if (/usosweb\.amu\.edu\.pl/i.test(host) || /(?:^|\.)amu\.edu\.pl$/i.test(host)) {
    return `https://cas.amu.edu.pl/cas/login?service=${service}&locale=pl`;
  }

  if (/^usosweb\./i.test(host)) {
    const suffix = host.slice('usosweb.'.length);
    if (suffix) {
      return `https://cas.${suffix}/cas/login?service=${service}&locale=pl`;
    }
  }

  return '';
}

function isCasLoginUrl(url) {
  const value = String(url || '');
  return /\/cas\/login/i.test(value) || /login\.umcs\.pl\/login/i.test(value);
}

function isPwCasLoginUrl(url) {
  return /cas\.usos\.pw\.edu\.pl/i.test(String(url || ''));
}

function isCasRoot404Url(url) {
  const value = String(url || '');
  return /cas\.usos\.pw\.edu\.pl/i.test(value) && !/\/cas\/login/i.test(value);
}

function isCasAuthFailureHtml(html) {
  return /dane uwierzytelniania nie mogą|nie mogą zostać uznane za poprawne|authentication failed|logowanie nie powiodło się/i.test(String(html || ''));
}

function collegeLoginIdentity(login, portalUrl) {
  const value = String(login || '').trim();
  const host = portalHost(portalUrl);
  if (/umcs\.pl/i.test(host) || /@umcs\.pl$/i.test(value.toLowerCase())) {
    if (/^ical(\d+@umcs\.pl)$/i.test(value)) {
      return value.replace(/^ical/i, '');
    }
  }
  return value;
}

function loginPageScore(html, url) {
  const value = String(html || '');
  if (isCasRoot404Url(url)) return 0;
  if (isSupportedLoginForm(value) || isUjAdfsMfaChallengePage(value)) return 4;
  if (/id=["']loginForm["']/i.test(value)) return 3;
  if (/name=["']username["']/i.test(value) && /name=["']password["']/i.test(value)) return 4;
  if (/sts\.uj\.edu\.pl/i.test(String(url || ''))) return 2;
  if (isCasLoginUrl(url)) return 2;
  return 0;
}

export const UJ_ADFS_LOGIN_URL =
  'https://sts.uj.edu.pl/adfs/ls/?wa=wsignin1.0&wtrealm=urn:cas:usos&wctx=adfsuj';

export const PW_CAS_LOGIN_URL = 'https://cas.usos.pw.edu.pl/cas/login?locale=pl';

function adfsUrlForPortal(portalUrl) {
  const host = (() => {
    try {
      return new URL(portalUrl).hostname;
    } catch {
      return '';
    }
  })();

  if (/usosweb\.uj\.edu\.pl/i.test(host) || /(?:^|\.)uj\.edu\.pl$/i.test(host)) {
    return UJ_ADFS_LOGIN_URL;
  }

  return '';
}

function isUjAdfsLoginUrl(url) {
  const value = String(url || '');
  if (!/sts\.uj\.edu\.pl/i.test(value)) return false;
  return /\/adfs\/ls/i.test(value) || /wa=wsignin/i.test(value);
}

function canProceedWithCollegeLogin(html, url, portalUrl) {
  if (isCasRoot404Url(url)) return false;
  if (isSupportedLoginForm(html) || hasCollegeLoginMarkup(html)) return true;
  if (isUjAdfsMfaChallengePage(html)) return true;

  if (isCasLoginUrl(url) && /name=["']username["']/i.test(String(html || ''))) return true;

  if (!adfsUrlForPortal(portalUrl) || !isUjAdfsLoginUrl(url)) return false;

  const body = String(html || '');
  if (body.length < 200) return false;

  return /userNameInput|passwordInput|loginForm|formsAuthenticationArea|Konto użytkownika|UserName/i.test(body)
    || body.length > 2500;
}

function uniqueUrls(urls) {
  const seen = new Set();
  return urls.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function extractLoginFormFields(html) {
  const formHtml = String(html || '').match(/<form[^>]*id=["']loginForm["'][^>]*>([\s\S]*?)<\/form>/i)?.[1] || '';
  const fields = {};
  matchInputTags(formHtml).forEach((input) => {
    const name = attr(input, 'name');
    const type = attr(input, 'type').toLowerCase();
    if (name && type !== 'submit') fields[name] = attr(input, 'value');
  });
  return fields;
}

function isUjAdfsMfaChallengePage(html) {
  const value = String(html || '');
  if (!/sts\.uj\.edu\.pl|Uwierzytelnianie wieloskładnikowe|Multi-Factor Authentication/i.test(value)) {
    return false;
  }
  if (isSupportedLoginForm(value)) return false;

  return /AzureMfaAuthentication|verificationOption\d+|viewDetailsLink|VerificationCode|id=["']authMethod["']/i.test(value)
    && /name=["']Context["']/i.test(value);
}

function mergeCookieJars(target, source) {
  source.forEach((value, key) => {
    target.set(key, value);
  });
}

function portalHost(portalUrl) {
  try {
    return new URL(portalUrl).hostname;
  } catch {
    return '';
  }
}

/** UJ/PW: CAS/2FA wymaga ukrytej WebView — bezpośrednie HTTP z RN pada na cas.usos.pw.edu.pl. */
function usosPrefersWebViewLogin(portalUrl) {
  const host = portalHost(portalUrl);
  return /uj\.edu\.pl|usosweb\.uj|usos\.pw\.edu\.pl/i.test(host);
}

function usosBlocksDirectCasOnMobile(portalUrl) {
  const host = portalHost(portalUrl);
  return /usos\.pw\.edu\.pl/i.test(host);
}

function isUsosPortalPage(url, portalUrl) {
  const host = portalHost(portalUrl);
  if (!host) return false;
  try {
    return new URL(url).hostname === host;
  } catch {
    return false;
  }
}

async function loadLoginPageAttempt(jar, target) {
  target = stripCasGatewayParam(target);
  if (!target || !/\/cas\/login|logowaniecas|sts\.uj\.edu\.pl\/adfs/i.test(target)) {
    const host = (() => {
      try {
        return new URL(target || '').hostname;
      } catch {
        return '';
      }
    })();
    if (/usos\.pw\.edu\.pl/i.test(host) && !/\/cas\/login/i.test(target || '')) {
      target = PW_CAS_LOGIN_URL;
    }
  }

  const page = await followRequest(jar, target, {
    headers: {
      ...browserHeaders(target),
      Origin: (() => {
        try {
          return new URL(target).origin;
        } catch {
          return undefined;
        }
      })()
    }
  });
  let html = await page.response.text();
  let url = page.url || target;

  if (!html?.trim() && page.response.status >= 300 && page.response.status < 400) {
    const location = readResponseHeader(page.response.headers, 'location');
    if (location) {
      url = resolveUrl(decodeHtmlEntities(location.trim()), url);
      const retry = await followRequest(jar, url);
      html = await retry.response.text();
      url = retry.url || url;
    }
  }

  return { html, url };
}

function findUjSmsVerificationOption(html) {
  const value = String(html || '');
  const match = value.match(
    /<a[^>]*id=["'](verificationOption\d+)["'][^>]*>[^<]*(?:sms|SMS|wyślij mi sms|text me)/i
  );
  return match?.[1] || (value.includes('verificationOption0') ? 'verificationOption0' : '');
}

async function submitUjAdfsPostback(jar, url, html, eventTarget = '', extraFields = {}) {
  const fields = extractLoginFormFields(html);
  const authMethod = String(html || '').match(/id=["']authMethod["'][^>]*value=["']([^"']+)/i)?.[1];
  if (authMethod) fields.AuthMethod = authMethod;
  if (eventTarget) fields.__EVENTTARGET = eventTarget;
  Object.assign(fields, extraFields);

  const action = url;
  const response = await followRequest(jar, action, {
    method: 'POST',
    headers: {
      ...browserHeaders(url),
      Referer: url,
      Origin: (() => {
        try {
          return new URL(url).origin;
        } catch {
          return undefined;
        }
      })(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(fields)
  });

  return {
    html: await response.response.text(),
    url: response.url || action
  };
}

async function fetchLoginFormPage(jar, portalUrl, onPhase) {
  const host = portalHost(portalUrl);
  const isPw = /usos\.pw\.edu\.pl/i.test(host);
  const directAdfs = adfsUrlForPortal(portalUrl);
  const casLogin = casLoginUrlForPortal(portalUrl);
  const usosLogin = portalUrl ? usosUrl(portalUrl, 'kontroler.php?_action=logowaniecas/index') : '';

  const attempts = uniqueUrls(
    isPw
      ? [casLogin, PW_CAS_LOGIN_URL, usosLogin, directAdfs]
      : [casLogin, directAdfs, usosLogin, casLogin, directAdfs]
  );

  let best = { html: '', url: casLogin || PW_CAS_LOGIN_URL || directAdfs || portalUrl || '', score: 0 };

  const consider = (page) => {
    const score = loginPageScore(page.html, page.url);
    if (score > best.score) best = { ...page, score };
    if (score >= 4) return true;
    if (canProceedWithCollegeLogin(page.html, page.url, portalUrl)) {
      best = { ...page, score: Math.max(score, 3) };
      return true;
    }
    return false;
  };

  let networkFailures = 0;

  for (const target of attempts) {
    if (!target) continue;
    onPhase?.(`USOS: otwieram ${pageHostLabel(target)}`);
    let page;
    try {
      page = await loadLoginPageAttempt(jar, target);
    } catch (error) {
      if (!isNetworkFetchError(error)) throw error;
      networkFailures += 1;
      onPhase?.(`USOS: brak połączenia z ${pageHostLabel(target)} — próbuję inny adres`);
      continue;
    }
    if (consider(page)) {
      onPhase?.(`USOS: ${describeLoginPage(page.html, page.url, portalUrl)}`);
      return page;
    }

    for (const extracted of extractCollegeLoginUrls(page.html, page.url || target)) {
      if (extracted === target) continue;
      onPhase?.(`USOS: przechodzę na ${pageHostLabel(extracted)}`);
      let viaExtracted;
      try {
        viaExtracted = await loadLoginPageAttempt(jar, extracted);
      } catch (error) {
        if (!isNetworkFetchError(error)) throw error;
        networkFailures += 1;
        onPhase?.(`USOS: brak połączenia z ${pageHostLabel(extracted)} — próbuję dalej`);
        continue;
      }
      if (consider(viaExtracted)) {
        onPhase?.(`USOS: ${describeLoginPage(viaExtracted.html, viaExtracted.url, portalUrl)}`);
        return viaExtracted;
      }
    }
  }

  if (networkFailures > 0 && best.score < 3) {
    throw new Error(
      'USOS: aplikacja nie otworzyła strony logowania uczelni (cas.usos.pw.edu.pl).'
        + ' Jeśli w przeglądarce telefonu logowanie działa, użyj „Dodaj link iCal”'
        + ' i wklej link z USOSweb po zalogowaniu w przeglądarce.'
    );
  }

  if (best.score >= 3) {
    onPhase?.(isPwCasLoginUrl(best.url) ? 'USOS: formularz CAS PW' : 'USOS: formularz logowania uczelni');
    return best;
  }

  if (directAdfs && best.score < 4) {
    onPhase?.('USOS: ponawiam otwarcie formularza UJ');
    const retry = await loadLoginPageAttempt(jar, directAdfs);
    if (consider(retry)) {
      onPhase?.(`USOS: ${describeLoginPage(retry.html, retry.url, portalUrl)}`);
      return retry;
    }
  }

  if (casLogin && !canProceedWithCollegeLogin(best.html, best.url, portalUrl)) {
    onPhase?.(`USOS: ponawiam formularz CAS (${pageHostLabel(casLogin)})`);
    const retry = await loadLoginPageAttempt(jar, casLogin);
    if (consider(retry)) {
      onPhase?.(`USOS: ${describeLoginPage(retry.html, retry.url, portalUrl)}`);
      return retry;
    }
    if (isSupportedLoginForm(retry.html) || hasCollegeLoginMarkup(retry.html)) {
      return retry;
    }
  }

  return best;
}

function credentialInputMeta(input) {
  const rawName = attr(input, 'name');
  const type = attr(input, 'type').toLowerCase();
  const id = attr(input, 'id');
  const placeholder = attr(input, 'placeholder');
  const ariaLabel = attr(input, 'aria-label');
  const title = attr(input, 'title');
  const autocomplete = attr(input, 'autocomplete');
  const name = rawName
    || (/user(name)?input|login|email|mail/i.test(id) ? 'UserName' : '')
    || (/passwordinput|password|hasło|haslo/i.test(id) ? 'Password' : '');
  const label = `${name} ${type} ${id} ${placeholder} ${ariaLabel} ${title} ${autocomplete}`;
  return { input, name, type, label };
}

function credentialInputs(html) {
  return matchInputTags(html).map(credentialInputMeta);
}

function isTextCredentialInput(entry) {
  if (!entry.name) return false;
  if (/hidden|password|submit|button|checkbox|radio|image|reset/i.test(entry.type)) return false;
  return !entry.type || /text|email|search|tel|url/i.test(entry.type) || /user|login|mail|email|konto|ident|principal/i.test(entry.label);
}

function isPasswordCredentialInput(entry) {
  return Boolean(entry.name) && (/password/i.test(entry.type) || /password|hasło|haslo/i.test(entry.label));
}

function findCredentialFormBlock(html) {
  const forms = String(html || '').match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
  return forms.find((block) => findLoginFieldName(block) && findPasswordFieldName(block))
    || forms.find((block) => /type=["']?password/i.test(block))
    || forms[0]
    || '';
}

function extractCasFormFields(html) {
  const formBlock = findCredentialFormBlock(html);
  return collectFormFields(formBlock);
}

function buildCasPayload(html, login, password) {
  const fields = extractCasFormFields(html);
  const loginField = findLoginFieldName(html) || 'username';
  const passwordField = findPasswordFieldName(html) || 'password';

  fields[loginField] = login;
  fields[passwordField] = password;
  if (!fields._eventId) fields._eventId = 'submit';
  return fields;
}

function buildAdfsPayload(html, login, password) {
  const fields = {
    ...extractLoginFormFields(html),
    ...extractHiddenInputs(html)
  };
  const loginField = findLoginFieldName(html) || 'UserName';
  const passwordField = findPasswordFieldName(html) || 'Password';

  fields[loginField] = login;
  fields[passwordField] = password;
  fields.UserName = login;
  fields.Password = password;
  if (!fields.AuthMethod) fields.AuthMethod = extractInputValue(html, 'AuthMethod') || 'FormsAuthentication';

  delete fields.Kmsi;
  return fields;
}

function isUmcsMfaProviderSelectionPage(html) {
  return /Multifactor Provider Selection|id=["']fm-mfa-simple["']/i.test(String(html || ''));
}

function isUmcsMfaChannelSelectionPage(html) {
  const value = String(html || '');
  return /CAS Multifactor Authentication Login/i.test(value)
    && /continueButton/i.test(value)
    && /type=["']checkbox["']/i.test(value)
    && !/name=["']token["']/i.test(value);
}

function isUmcsMfaCodeEntryPage(html) {
  return /name=["']token["']/i.test(String(html || ''))
    && /Hasło jednorazowe|one-time|kod jednorazowy/i.test(String(html || ''));
}

function isUmcsMfaPageHtml(html) {
  return isUmcsMfaProviderSelectionPage(html)
    || isUmcsMfaChannelSelectionPage(html)
    || isUmcsMfaCodeEntryPage(html);
}

function findUmcsMfaChannelCheckboxName(html) {
  const value = String(html || '');
  const inputs = value.match(/<input[^>]*type=["']checkbox["'][^>]*>/gi) || [];

  for (const input of inputs) {
    const name = input.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const index = value.indexOf(input);
    const nearby = index >= 0 ? value.slice(Math.max(0, index - 120), index + input.length + 320) : input;
    if (/e-mail|email|\*@|@\*|mail\.com/i.test(nearby)) return name;
  }

  for (const input of inputs) {
    const name = input.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const index = value.indexOf(input);
    const nearby = index >= 0 ? value.slice(Math.max(0, index - 120), index + input.length + 320) : input;
    if (/mobilny usos|telefon|phone|sms/i.test(nearby)) return name;
  }

  const fallback = inputs.map((input) => input.match(/name=["']([^"']+)["']/i)?.[1]).filter(Boolean);
  return fallback[0] || '';
}

function extractUmcsFormBlock(html, formId) {
  return String(html || '').match(new RegExp(`<form[^>]*id=["']${formId}["'][^>]*>[\\s\\S]*?<\\/form>`, 'i'))?.[0] || '';
}

function extractUmcsFormFields(html, formId) {
  const block = extractUmcsFormBlock(html, formId);
  const fields = collectFormFields(block);
  matchInputTags(block).forEach((input) => {
    const name = attr(input, 'name');
    const type = attr(input, 'type').toLowerCase();
    if (name && type === 'checkbox') fields[name] = attr(input, 'value') || 'on';
  });
  return fields;
}

function umcsMfaFormAction(html, url, formId = 'fm1') {
  const formTag = extractUmcsFormBlock(html, formId).match(/<form[^>]*>/i)?.[0] || '';
  const action = attr(formTag, 'action') || 'login';
  return resolveUrl(decodeHtmlEntities(action), url);
}

async function submitUmcsMfaForm(jar, html, url, extraFields = {}, formId = 'fm1') {
  const fields = {
    ...extractUmcsFormFields(html, formId),
    ...extraFields
  };
  const action = umcsMfaFormAction(html, url, formId);

  const response = await followRequest(jar, action, {
    method: 'POST',
    headers: {
      ...browserHeaders(url),
      Referer: url,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(fields)
  });

  return {
    html: await response.response.text(),
    url: response.url || action
  };
}

async function advanceUmcsMfaFlow(jar, html, url, mfaCode, onPhase) {
  let currentHtml = String(html || '');
  let currentUrl = url;

  if (isUmcsMfaProviderSelectionPage(currentHtml)) {
    onPhase?.('USOS: wybieram weryfikację dwuetapową (UMCS)');
    const step = await submitUmcsMfaForm(jar, currentHtml, currentUrl, {
      mfaProvider: 'mfa-simple',
      _eventId: 'submit'
    }, 'fm-mfa-simple');
    currentHtml = step.html;
    currentUrl = step.url;
  }

  if (isUmcsMfaChannelSelectionPage(currentHtml)) {
    onPhase?.('USOS: wysyłam kod na e-mail (UMCS)');
    const channel = findUmcsMfaChannelCheckboxName(currentHtml);
    const channelFields = { _eventId: 'select' };
    if (channel) channelFields[channel] = 'on';
    const step = await submitUmcsMfaForm(jar, currentHtml, currentUrl, channelFields, 'fm1');
    currentHtml = step.html;
    currentUrl = step.url;
  }

  if (isUmcsMfaCodeEntryPage(currentHtml)) {
    if (!String(mfaCode || '').trim()) {
      return { html: currentHtml, url: currentUrl, needsCode: true };
    }
    onPhase?.('USOS: wysyłam kod weryfikacyjny');
    const step = await submitUmcsMfaForm(jar, currentHtml, currentUrl, {
      token: String(mfaCode || '').trim(),
      _eventId: extractInputValue(currentHtml, '_eventId') || 'submit'
    }, 'fm1');
    currentHtml = step.html;
    currentUrl = step.url;
  }

  return { html: currentHtml, url: currentUrl, needsCode: false };
}

function isCasLoginForm(html, url) {
  const value = String(html || '');
  if (isUmcsMfaPageHtml(value)) return false;
  if (/name=["']username["']/i.test(value) && /name=["']password["']/i.test(value)) return true;
  return false;
}

function buildCollegeLoginPayload(html, login, password, url, portalUrl) {
  const identity = collegeLoginIdentity(login, portalUrl || url);
  if (isCasLoginForm(html, url)) return buildCasPayload(html, identity, password);
  return buildAdfsPayload(html, identity, password);
}

function extractCollegeFormAction(html, currentUrl) {
  const block = findCredentialFormBlock(html);
  const formTag = block.match(/<form[^>]*>/i)?.[0] || '';
  const action = attr(formTag, 'action');
  if (action) return resolveUrl(decodeHtmlEntities(action), currentUrl);
  return extractFormAction(html, currentUrl);
}

function findLoginFieldName(html) {
  const candidates = credentialInputs(html).filter(isTextCredentialInput);
  const passwordIndex = credentialInputs(html).findIndex(isPasswordCredentialInput);

  return candidates.find((entry) => /username|userName|user-name|login|email|mail|e-mail|konto|identifier|identyfikator|principal|uid/i.test(entry.label))?.name
    || candidates.find((entry) => /email/i.test(entry.type))?.name
    || (passwordIndex > 0 ? credentialInputs(html).slice(0, passwordIndex).reverse().find(isTextCredentialInput)?.name : '')
    || candidates[0]?.name
    || '';
}

function findPasswordFieldName(html) {
  return credentialInputs(html).find(isPasswordCredentialInput)?.name || '';
}

function isSupportedLoginForm(html) {
  const value = String(html || '');
  if (!value.trim()) return false;
  if (/id=["']loginForm["']/i.test(value) && /id=["']userNameInput["']/i.test(value) && /id=["']passwordInput["']/i.test(value)) {
    return true;
  }
  if (/userNameInput/i.test(value) && /passwordInput/i.test(value)) return true;
  if (/name=["']UserName["']/i.test(value) && /name=["']Password["']/i.test(value) && /type=["']password/i.test(value)) {
    return true;
  }
  if (/name=["']username["']/i.test(value) && /name=["']password["']/i.test(value) && /type=["']password/i.test(value)) {
    return true;
  }
  if (/id=["']username["']/i.test(value) && /id=["']password["']/i.test(value)) return true;

  return Boolean(findLoginFieldName(value) && findPasswordFieldName(value));
}

function hasCollegeLoginMarkup(html) {
  const value = String(html || '');
  return isSupportedLoginForm(value)
    || /id=["']loginForm["']/i.test(value)
    || (/name=["']username["']/i.test(value) && /name=["']password["']/i.test(value));
}

function hasAdfsLoginMarkup(html) {
  return hasCollegeLoginMarkup(html);
}

function describeLoginPage(html, url, portalUrl = '') {
  const value = String(html || '');
  const pageUrl = String(url || '');
  if (isSupportedLoginForm(value)) return 'formularz login/hasło';
  if (isUjAdfsMfaChallengePage(value)) return 'ekran MFA';
  if (/id=["']loginForm["']/i.test(value)) return 'formularz ADFS (loginForm)';
  if (/sts\.uj\.edu\.pl/i.test(pageUrl)) return 'strona ADFS UJ';
  if (isCasRoot404Url(pageUrl)) return 'błędny adres CAS PW (404 — użyj /cas/login)';
  if (/cas\.usos\.pw\.edu\.pl/i.test(pageUrl)) return 'strona CAS PW';
  if (/cas\.amu\.edu\.pl/i.test(pageUrl)) return 'strona CAS UAM (Identyfikator/Hasło)';
  if (/cas\.uj\.edu\.pl/i.test(pageUrl)) return 'strona CAS UJ';
  if (portalUrl && isUsosPortalPage(pageUrl, portalUrl)) {
    if (/amu\.edu\.pl/i.test(portalHost(portalUrl))) {
      return 'USOSweb UAM (formularz jest na cas.amu.edu.pl)';
    }
    return 'USOSweb (brama — formularz jest na stronie logowania uczelni)';
  }
  return 'nieznana strona logowania';
}

function detectSecondFactor(html) {
  if (isUjAdfsMfaChallengePage(html)) return true;
  if (isUmcsMfaPageHtml(html)) return true;

  const value = String(html || '');
  return /mfa|sms|otp|one.?time|verification|uwierzyteln|kod|phone|telefon/i.test(value)
    && /name=["'](code|Code|VerificationCode|Otp|otp|securityCode|AuthMethod|token)["']/i.test(value);
}

function hasSecondFactorCodeInput(html) {
  return /name=["'](code|Code|VerificationCode|Otp|otp|securityCode|ProofConfirmation|otc)["']/i.test(String(html || ''));
}

function isUjAdfsMfaCodeRejected(html) {
  const value = String(html || '');
  if (!/verificationCodeInput|name=["']VerificationCode["']/i.test(value)) return false;
  if (/Wprowadzony kod weryfikacyjny|różni się od oczekiwanego|rozni sie od oczekiwanego|invalid verification|incorrect verification/i.test(value)) {
    return true;
  }
  const errorDiv = value.match(/<div[^>]*id=["']errorDiv["'][^>]*>/i)?.[0] || '';
  return /display:\s*block/i.test(errorDiv);
}

function extractSmsAuthMethod(html) {
  const source = String(html || '');
  const inputs = source.match(/<input[^>]*>/gi) || [];
  for (const input of inputs) {
    const name = input.match(/name=["']([^"']+)["']/i)?.[1] || '';
    const value = decodeHtmlEntities(input.match(/value=["']([^"']+)["']/i)?.[1] || '');
    const index = source.indexOf(input);
    const nearby = index >= 0 ? source.slice(Math.max(0, index - 250), index + input.length + 250) : input;
    const label = `${input} ${nearby}`;
    if (!name) continue;
    if (/(sms|phone|telefon|mobile|text|otp|oneway)/i.test(`${name} ${value} ${label}`)) {
      return { name, value };
    }
  }

  const optionMatch = source.match(/<option[^>]+value=["']([^"']+)["'][^>]*>[^<]*(sms|telefon|phone|mobile|text)[^<]*<\/option>/i);
  if (optionMatch) {
    return {
      name: 'AuthMethod',
      value: decodeHtmlEntities(optionMatch[1])
    };
  }

  const authMethodMatch = source.match(/AuthMethod[^"'<>]*(OneWaySMS|SmsAuthentication|PhoneAppOTP|PhoneFactor|TextMessage|SMS)[^"'<>]*/i);
  if (authMethodMatch) {
    return {
      name: 'AuthMethod',
      value: authMethodMatch[1]
    };
  }

  return null;
}

function buildSmsMethodPayload(html) {
  const fields = extractHiddenInputs(html);
  const sms = extractSmsAuthMethod(html);
  if (sms?.name) {
    fields[sms.name] = sms.value || 'true';
  } else {
    fields.AuthMethod = 'SmsAuthentication';
  }
  return fields;
}

async function revealUjAdfsCodeFormIfNeeded({ html, jar, onPhase, url }) {
  if (hasSecondFactorCodeInput(html) || !isUjAdfsMfaChallengePage(html)) {
    return { html, url };
  }

  onPhase?.('USOS: otwieram formularz kodu SMS');
  const revealed = await submitUjAdfsPostback(jar, url, html, 'viewDetailsLink');
  if (hasSecondFactorCodeInput(revealed.html)) {
    return revealed;
  }

  return { html, url };
}

async function selectSmsSecondFactorIfAvailable({ html, jar, onPhase, url }) {
  const smsOption = findUjSmsVerificationOption(html);
  if (smsOption) {
    onPhase?.('USOS: wybieram metodę SMS/telefon');
    const challenge = await submitUjAdfsPostback(jar, url, html, smsOption);
    return revealUjAdfsCodeFormIfNeeded({
      html: challenge.html,
      jar,
      onPhase,
      url: challenge.url
    });
  }

  if (hasSecondFactorCodeInput(html)) {
    return revealUjAdfsCodeFormIfNeeded({ html, jar, onPhase, url });
  }

  if (!/sms|telefon|phone|mobile|text/i.test(String(html || ''))) {
    return { html, url };
  }

  onPhase?.('USOS: wybieram metodę SMS/telefon');
  const action = extractFormAction(html, url);
  const response = await followRequest(jar, action, {
    method: 'POST',
    headers: {
      ...browserHeaders(url),
      Referer: url,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(buildSmsMethodPayload(html))
  });

  return revealUjAdfsCodeFormIfNeeded({
    html: await response.response.text(),
    jar,
    onPhase,
    url: response.url || action
  });
}

function buildSecondFactorPayload(html, code) {
  if (/id=["']loginForm["']/i.test(String(html || ''))) {
    const fields = extractLoginFormFields(html);
    const authMethod = String(html || '').match(/id=["']authMethod["'][^>]*value=["']([^"']+)/i)?.[1];
    if (authMethod) fields.AuthMethod = authMethod;
    if (/name=["']VerificationCode["']/i.test(html)) {
      fields.VerificationCode = code;
      fields.SignIn = 'Zaloguj';
      return fields;
    }
  }

  const fields = extractHiddenInputs(html);
  const inputs = String(html || '').match(/<input[^>]*>/gi) || [];
  const candidateNames = inputs
    .map((input) => input.match(/name=["']([^"']+)["']/i)?.[1] || '')
    .filter((name) => name && !/UserName|Password|AuthMethod|Kmsi/i.test(name));

  const names = candidateNames.length
    ? candidateNames
    : ['VerificationCode', 'Code', 'code', 'Otp', 'otp', 'securityCode', 'ProofConfirmation'];

  names.forEach((name) => {
    fields[name] = code;
  });

  return fields;
}

async function submitSecondFactorCode({ challenge, mfaCode, onPhase }) {
  let html = challenge.html;
  let url = challenge.url;

  if (isUmcsMfaCodeEntryPage(html) || isUmcsMfaProviderSelectionPage(html) || isUmcsMfaChannelSelectionPage(html)) {
    const step = await advanceUmcsMfaFlow(challenge.jar, html, url, mfaCode, onPhase);
    return { html: step.html, url: step.url };
  }

  if (!hasSecondFactorCodeInput(html)) {
    onPhase?.('USOS: otwieram formularz kodu SMS');
    const revealed = await revealUjAdfsCodeFormIfNeeded({
      html,
      jar: challenge.jar,
      onPhase,
      url
    });
    html = revealed.html;
    url = revealed.url;
  }

  const action = extractFormAction(html, url);
  const response = await followRequest(challenge.jar, action, {
    method: 'POST',
    headers: {
      ...browserHeaders(url),
      Referer: url,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(buildSecondFactorPayload(html, mfaCode))
  });

  return {
    html: await response.response.text(),
    url: response.url || action
  };
}

function extractLooseHiddenFields(html) {
  const fields = {};
  matchInputTags(html).forEach((input) => {
    const name = attr(input, 'name');
    const type = attr(input, 'type').toLowerCase();
    if (name && (type === 'hidden' || type === '')) fields[name] = attr(input, 'value');
  });

  const textareas = String(html || '').match(/<textarea[\s\S]*?<\/textarea>/gi) || [];
  textareas.forEach((textarea) => {
    const name = attr(textarea, 'name');
    if (!name) return;
    const inlineValue = attr(textarea, 'value');
    const bodyValue = textarea.replace(/<textarea[^>]*>/i, '').replace(/<\/textarea>/i, '').trim();
    fields[name] = inlineValue || bodyValue;
  });

  return fields;
}

function collectFormFields(formBlock) {
  const fields = {};
  matchInputTags(formBlock).forEach((input) => {
    const name = attr(input, 'name');
    const type = attr(input, 'type').toLowerCase();
    if (name && (type === 'hidden' || type === '')) fields[name] = attr(input, 'value');
  });
  String(formBlock || '').match(/<textarea[\s\S]*?<\/textarea>/gi)?.forEach((textarea) => {
    const name = attr(textarea, 'name');
    if (!name) return;
    const bodyValue = textarea.replace(/<textarea[^>]*>/i, '').replace(/<\/textarea>/i, '').trim();
    fields[name] = attr(textarea, 'value') || bodyValue;
  });
  return fields;
}

function extractAutoPostForm(html, baseUrl) {
  const forms = String(html || '').match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];

  for (const formBlock of forms) {
    const formTag = formBlock.match(/<form[^>]*>/i)?.[0] || '';
    const action = resolveUrl(attr(formTag, 'action') || baseUrl, baseUrl);
    const fields = collectFormFields(formBlock);

    if (!Object.keys(fields).length) continue;

    const isPortalForm = /usosweb|usos\.pw\.edu\.pl|cas\.uj\.edu\.pl|cas\.usos\.pw\.edu\.pl|\/cas\//i.test(action);
    const isSamlForm = Boolean(fields.SAMLResponse || fields.RelayState || fields.wresult || fields.wa);
    if (isPortalForm || isSamlForm) {
      return { action, fields };
    }
  }

  const looseFields = extractLooseHiddenFields(html);
  if (looseFields.SAMLResponse || looseFields.RelayState || looseFields.wresult) {
    const actionMatch = String(html || '').match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
    const action = resolveUrl(actionMatch?.[1] || baseUrl, baseUrl);
    return { action, fields: looseFields };
  }

  return null;
}

function usosHtmlUserId(html) {
  const match = String(html || '').match(/user_id:\s*(\d+|null)/i);
  if (!match) return undefined;
  return match[1] === 'null' ? null : match[1];
}

function isUsosLoggedInHtml(html) {
  const value = String(html || '');
  const userId = usosHtmlUserId(value);
  if (userId) return true;
  if (userId === null || /mode=['"]anon['"]/i.test(value)) return false;

  return /plan_export_link|eksportujPlan|wyloguj|wyloguj się|mój USOSweb|moj USOSweb/i.test(value)
    && !/login-url=["']|logowaniecas\/index/i.test(value);
}

function isUsosLoginWallHtml(html) {
  const value = String(html || '');
  if (usosHtmlUserId(value) === null && /login-url=["']/i.test(value)) return true;

  return /login-url=["']|logowaniecas|zaloguj się do systemu|name=["']UserName["']/i.test(value)
    && !isUsosLoggedInHtml(value);
}

async function completeUsosPortalLogin(jar, html, url, portalUrl, onPhase) {
  let currentHtml = String(html || '');
  let currentUrl = url;

  for (let index = 0; index < 12; index += 1) {
    const autoPost = extractAutoPostForm(currentHtml, currentUrl);
    if (autoPost) {
      onPhase?.('USOS: przekazuję sesję do USOSweb');
      const page = await followRequest(jar, autoPost.action, {
        method: 'POST',
        headers: {
          ...browserHeaders(currentUrl),
          Referer: currentUrl,
          Origin: (() => {
            try {
              return new URL(currentUrl).origin;
            } catch {
              return undefined;
            }
          })(),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formEncode(autoPost.fields)
      });
      currentHtml = await page.response.text();
      currentUrl = page.url;
      if (isUsosPortalPage(currentUrl, portalUrl) && isUsosLoggedInHtml(currentHtml)) break;
      continue;
    }

    if (isUsosPortalPage(currentUrl, portalUrl) && isUsosLoggedInHtml(currentHtml)) break;

    if (/sts\.uj\.edu\.pl|cas\.uj\.edu\.pl/i.test(currentUrl)) {
      const home = await followRequest(jar, usosUrl(portalUrl, 'kontroler.php?_action=home/index'));
      currentHtml = await home.response.text();
      currentUrl = home.url;
      continue;
    }

    break;
  }

  if (!isUsosPortalPage(currentUrl, portalUrl) || !isUsosLoggedInHtml(currentHtml)) {
    onPhase?.('USOS: wchodzę na stronę główną USOSweb');
    const home = await followRequest(jar, usosUrl(portalUrl, 'kontroler.php?_action=home/index'));
    currentHtml = await home.response.text();
    currentUrl = home.url;
  }

  return { html: currentHtml, url: currentUrl };
}

function usosUrl(portalUrl, path) {
  return resolveUrl(path, portalUrl.endsWith('/') ? portalUrl : `${portalUrl}/`);
}

async function fetchIcalViaPlanExportDialog(jar, portalUrl, onPhase) {
  const homeUrl = usosUrl(portalUrl, 'kontroler.php?_action=home/index');
  const planUrl = usosUrl(portalUrl, 'kontroler.php?_action=home/plan');
  const exportUrl = usosUrl(portalUrl, 'kontroler.php?_action=home/eksportujPlan');

  onPhase?.('USOS: plan zajęć → eksport iCal (jak przycisk „eksportuj”)');
  const planPage = await followRequest(jar, planUrl, { referer: homeUrl });
  const planHtml = await planPage.response.text();

  if (isUsosLoginWallHtml(planHtml)) {
    return { found: '', loginWall: true, html: planHtml, url: planPage.url || planUrl };
  }

  const exportPage = await followRequest(jar, exportUrl, {
    referer: planPage.url || planUrl,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  const exportHtml = await exportPage.response.text();

  if (isUsosLoginWallHtml(exportHtml)) {
    return { found: '', loginWall: true, html: exportHtml, url: exportPage.url || exportUrl };
  }

  const found = extractUsosIcalUrl(exportHtml, portalUrl);
  return {
    found,
    loginWall: false,
    html: exportHtml,
    url: exportPage.url || exportUrl
  };
}

async function findIcalUrlAfterLogin(jar, portalUrl, onPhase) {
  let retriedPortalSession = false;

  const viaPlanExport = await fetchIcalViaPlanExportDialog(jar, portalUrl, onPhase);
  if (viaPlanExport.found) return viaPlanExport.found;

  if (viaPlanExport.loginWall && !retriedPortalSession) {
    retriedPortalSession = true;
    onPhase?.('USOS: odświeżam sesję USOSweb i ponawiam eksport planu');
    await completeUsosPortalLogin(jar, viaPlanExport.html, viaPlanExport.url, portalUrl, onPhase);
    const retry = await fetchIcalViaPlanExportDialog(jar, portalUrl, onPhase);
    if (retry.found) return retry.found;
    if (retry.loginWall) {
      onPhase?.('USOS: brak sesji na USOSweb — nie można pobrać eksportu planu');
      return '';
    }
  }

  for (const action of USOS_ICAL_CANDIDATE_ACTIONS) {
    const target = usosUrl(portalUrl, action);
    onPhase?.(`USOS: szukam iCal (${action.replace('kontroler.php?_action=', '')})`);
    const page = await followRequest(jar, target, {
      headers: {
        ...browserHeaders(target),
        Referer: usosUrl(portalUrl, 'kontroler.php?_action=home/plan')
      }
    });
    const html = await page.response.text();

    if (isUsosLoginWallHtml(html)) {
      if (!retriedPortalSession) {
        retriedPortalSession = true;
        onPhase?.('USOS: odświeżam sesję USOSweb i ponawiam eksport planu');
        await completeUsosPortalLogin(jar, html, page.url || target, portalUrl, onPhase);
        continue;
      }
      onPhase?.('USOS: brak sesji na USOSweb — nie można pobrać eksportu planu');
      return '';
    }

    const found = extractUsosIcalUrl(html, portalUrl);
    if (found) return found;

    const linkedActions = Array.from(html.matchAll(/href=["']([^"']*(?:eksportujPlan|plany|plan|kalendarz|calendar|ical|eksport|export)[^"']*)["']/gi))
      .map((match) => resolveUrl(decodeHtmlEntities(match[1]), page.url || target))
      .slice(0, 10);

    for (const linked of linkedActions) {
      const linkedPage = await followRequest(jar, linked);
      const linkedHtml = await linkedPage.response.text();
      const linkedFound = extractUsosIcalUrl(linkedHtml, portalUrl);
      if (linkedFound) return linkedFound;
    }
  }

  return '';
}

async function finalizeUsosSessionAndFindIcal(jar, html, url, portalUrl, onPhase) {
  const portalSession = await completeUsosPortalLogin(jar, html, url, portalUrl, onPhase);

  if (!isUsosLoggedInHtml(portalSession.html)) {
    onPhase?.('USOS: sesja USOSweb nieaktywna — ponawiam przekazanie logowania');
    const retry = await completeUsosPortalLogin(jar, portalSession.html, portalSession.url, portalUrl, onPhase);
    portalSession.html = retry.html;
    portalSession.url = retry.url;
  } else {
    onPhase?.('USOS: sesja USOSweb aktywna');
  }

  return findIcalUrlAfterLogin(jar, portalUrl, onPhase);
}

async function completeUsosLoginFetchProfileAndIcal(
  jar,
  html,
  url,
  portalUrl,
  { login = '', onPhase, onStudentProfile } = {}
) {
  const portalSession = await completeUsosPortalLogin(jar, html, url, portalUrl, onPhase);
  if (!isUsosLoggedInHtml(portalSession.html)) {
    onPhase?.('USOS: sesja USOSweb nieaktywna — ponawiam przekazanie logowania');
    const retry = await completeUsosPortalLogin(jar, portalSession.html, portalSession.url, portalUrl, onPhase);
    portalSession.html = retry.html;
    portalSession.url = retry.url;
  } else {
    onPhase?.('USOS: sesja USOSweb aktywna');
  }

  if (onStudentProfile) {
    try {
      const profile = await fetchUsosStudentProfileFromSession(
        { jar, portalUrl, html: portalSession.html, url: portalSession.url },
        { login, onPhase }
      );
      await onStudentProfile(profile);
    } catch {
      // profil opcjonalny
    }
  }

  return findIcalUrlAfterLogin(jar, portalUrl, onPhase);
}

export async function fetchIcalUrlUsingJar(jar, portalUrl, onPhase) {
  const found = await findIcalUrlAfterLogin(jar, portalUrl, onPhase);
  if (!found) {
    throw new Error(
      'USOS: zalogowano do konta uczelni, ale nie udało się pobrać linku iCal z USOSweb.'
        + ' Wejdź w USOS: Plan zajęć → eksportuj i wklej link ręcznie.'
    );
  }
  return found;
}

/** Zalogowanie do USOSweb (HTTP) bez pobierania iCal — do profilu studenta i testów. */
export async function establishUsosPortalSession({
  login,
  mfaCode = '',
  password,
  portalUrl,
  onPhase
}) {
  const jar = new Map();
  resetNativeCookieSession();
  onPhase?.('USOS: pobieram formularz logowania');
  const loginPage = await fetchLoginFormPage(jar, portalUrl, onPhase);

  const resolvedLoginHtml = loginPage.html;
  const resolvedLoginPageUrl = loginPage.url || portalUrl;

  if (!canProceedWithCollegeLogin(resolvedLoginHtml, resolvedLoginPageUrl, portalUrl)) {
    if (isUjAdfsMfaChallengePage(resolvedLoginHtml)) {
      throw new Error('USOS: wymagane 2FA — użyj aplikacji mobilnej lub podaj kod MFA.');
    }
    throw new Error('USOS: nie znaleziono formularza logowania uczelni.');
  }

  const action = isCasLoginForm(resolvedLoginHtml, resolvedLoginPageUrl)
    ? extractCollegeFormAction(resolvedLoginHtml, resolvedLoginPageUrl)
    : extractFormAction(resolvedLoginHtml, resolvedLoginPageUrl);

  onPhase?.('USOS: wysyłam login i hasło do systemu uczelni');
  const loginResponse = await followRequest(jar, action, {
    method: 'POST',
    headers: {
      ...browserHeaders(resolvedLoginPageUrl),
      Referer: resolvedLoginPageUrl,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(buildCollegeLoginPayload(resolvedLoginHtml, login, password, resolvedLoginPageUrl, portalUrl))
  });

  let postLoginHtml = await loginResponse.response.text();
  let postLoginUrl = loginResponse.url || action;

  if (isUmcsMfaPageHtml(postLoginHtml)) {
    const mfaStep = await advanceUmcsMfaFlow(jar, postLoginHtml, postLoginUrl, mfaCode, onPhase);
    postLoginHtml = mfaStep.html;
    postLoginUrl = mfaStep.url;
    if (mfaStep.needsCode) {
      throw new Error('USOS: wymagany kod 2FA.');
    }
  }

  if (detectSecondFactor(postLoginHtml)) {
    throw new Error('USOS: wymagane 2FA przed wejściem do USOSweb.');
  }

  const portalSession = await completeUsosPortalLogin(jar, postLoginHtml, postLoginUrl, portalUrl, onPhase);
  if (!isUsosLoggedInHtml(portalSession.html)) {
    throw new Error('USOS: nie udało się ustalić aktywnej sesji USOSweb.');
  }

  onPhase?.('USOS: sesja USOSweb gotowa');
  return { jar, portalUrl, html: portalSession.html, url: portalSession.url };
}

export async function fetchUsosAuthenticatedPage(session, actionPath) {
  const { jar, portalUrl } = session || {};
  if (!jar || !portalUrl) throw new Error('Brak sesji USOSweb.');

  const target = usosUrl(portalUrl, actionPath);
  const homeUrl = usosUrl(portalUrl, 'kontroler.php?_action=home/index');
  const page = await followRequest(jar, target, {
    headers: {
      ...browserHeaders(target),
      Referer: session.url || homeUrl
    }
  });
  const html = await page.response.text();
  return { html, url: page.url || target, actionPath };
}

export async function fetchUsosStudentProfileFromSession(session, { login = '', onPhase } = {}) {
  const { portalUrl } = session || {};
  if (!session?.jar || !portalUrl) return {};

  const {
    USOS_STUDENT_PROFILE_HOME_ACTION,
    USOS_STUDENT_PROFILE_GRUPY_ACTION,
    USOS_STUDENT_PROFILE_GRUPY_ZAJECIOWE_ACTION,
    USOS_STUDENT_PROFILE_RANKING_ACTION,
    buildUsosStudentProfileFromHtml,
    parseUsosHomeUserInfo,
    usosProfileActionForUserId
  } = await import('./usosStudentProfile.js');

  onPhase?.('USOS: pobieram dane studenta z USOSweb');
  const homePage = await fetchUsosAuthenticatedPage(session, USOS_STUDENT_PROFILE_HOME_ACTION);
  const homeInfo = parseUsosHomeUserInfo(homePage.html);

  let profileHtml = '';
  const profileAction = usosProfileActionForUserId(homeInfo.profileUserId);
  if (profileAction) {
    onPhase?.('USOS: pobieram profil użytkownika');
    const profilePage = await fetchUsosAuthenticatedPage(session, profileAction);
    profileHtml = profilePage.html;
  }

  let grupyHtml = '';
  try {
    onPhase?.('USOS: pobieram grupy i program studiów');
    const grupyPage = await fetchUsosAuthenticatedPage(session, USOS_STUDENT_PROFILE_GRUPY_ACTION);
    if (!/404|Strona nie istnieje/i.test(grupyPage.html)) {
      grupyHtml = grupyPage.html;
    }
  } catch {
    // nie każda rola ma moduł grup dziekańskich
  }

  let grupyZajecioweHtml = '';
  try {
    onPhase?.('USOS: pobieram semestr z grup zajęciowych');
    const grupyZajeciowePage = await fetchUsosAuthenticatedPage(session, USOS_STUDENT_PROFILE_GRUPY_ZAJECIOWE_ACTION);
    if (!/404|Strona nie istnieje/i.test(grupyZajeciowePage.html)) {
      grupyZajecioweHtml = grupyZajeciowePage.html;
    }
  } catch {
    // moduł grup zajęciowych bywa niedostępny
  }

  return buildUsosStudentProfileFromHtml({
    homeHtml: homePage.html,
    profileHtml,
    grupyHtml,
    grupyZajecioweHtml,
    portalUrl,
    login
  });
}

function isUsosProfileSemesterReady(profile) {
  return isUsosSemesterValueValid(profile?.semester);
}

export function usosProfileSnapshotFromStored(stored) {
  if (!stored?.profile || typeof stored.profile !== 'object') return {};
  const profile = stored.profile;
  return {
    fullName: String(profile.fullName || ''),
    albumNumber: String(profile.albumNumber || ''),
    university: String(profile.university || ''),
    program: String(profile.program || ''),
    faculty: String(profile.faculty || ''),
    degreeLevel: String(profile.degreeLevel || ''),
    studyMode: String(profile.studyMode || ''),
    semester: sanitizeUsosSemesterValue(String(profile.semester || '')),
    group: String(profile.group || '')
  };
}

/** Pobiera profil przez HTTP używając ciasteczek WebView (RN CookieManager). */
export async function fetchUsosStudentProfileFromNativeCookies(portalUrl, { login = '', onPhase } = {}) {
  const { cookieSyncUrlsForPortal } = await import('./usosWebViewLogin.js');
  const jar = new Map();
  for (const url of cookieSyncUrlsForPortal(portalUrl)) {
    await pullNativeCookiesToJar(url, jar);
  }
  if (!jar.size) return null;

  onPhase?.('USOS: pobieram dane z aktywnej sesji USOSweb');
  return fetchUsosStudentProfileFromSession({ jar, portalUrl }, { login, onPhase });
}

/** Szybka aktualizacja profilu z ciasteczek WebView (bez ponownego logowania, max ~8 s). */
export async function tryQuickUsosProfileFromCookies({
  login = '',
  portalUrl,
  onStudentProfile,
  timeoutMs = 8000
} = {}) {
  const { isReactNative } = await import('./httpCookies.js');
  if (!isReactNative() || !portalUrl) return null;

  try {
    const profile = await Promise.race([
      fetchUsosStudentProfileFromNativeCookies(portalUrl, { login }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('USOS profile cookie timeout')), timeoutMs);
      })
    ]);
    if (profile && (isUsosProfileSemesterReady(profile) || profile.fullName)) {
      await onStudentProfile?.(profile);
      return profile;
    }
  } catch {
    // brak aktywnej sesji — pomijamy bez blokowania syncu
  }
  return null;
}

/** Lekki odczyt samego semestru (2 strony, w tle — nie blokuje logowania). */
export async function tryQuickUsosSemesterFromCookies({
  portalUrl,
  onStudentProfile,
  timeoutMs = 4500
} = {}) {
  const { isReactNative } = await import('./httpCookies.js');
  if (!isReactNative() || !portalUrl) return null;

  const {
    deriveUsosSemesterLabel,
    isUsosSemesterValueValid,
    sanitizeUsosSemesterValue,
    USOS_STUDENT_PROFILE_GRUPY_ZAJECIOWE_ACTION,
    USOS_STUDENT_PROFILE_HOME_ACTION
  } = await import('./usosStudentProfile.js');

  try {
    const semester = await Promise.race([
      (async () => {
        const { cookieSyncUrlsForPortal } = await import('./usosWebViewLogin.js');
        const jar = new Map();
        for (const url of cookieSyncUrlsForPortal(portalUrl)) {
          await pullNativeCookiesToJar(url, jar);
        }
        if (!jar.size) return '';

        const session = { jar, portalUrl };
        const homePage = await fetchUsosAuthenticatedPage(session, USOS_STUDENT_PROFILE_HOME_ACTION);
        let grupyZajecioweHtml = '';
        try {
          const grupyPage = await fetchUsosAuthenticatedPage(session, USOS_STUDENT_PROFILE_GRUPY_ZAJECIOWE_ACTION);
          if (!/404|Strona nie istnieje/i.test(grupyPage.html)) {
            grupyZajecioweHtml = grupyPage.html;
          }
        } catch {
          // strona grup zajęciowych bywa niedostępna
        }
        return deriveUsosSemesterLabel({
          homeHtml: homePage.html,
          grupyZajecioweHtml
        });
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('USOS semester cookie timeout')), timeoutMs);
      })
    ]);

    const cleaned = sanitizeUsosSemesterValue(semester);
    if (!isUsosSemesterValueValid(cleaned)) return null;
    await onStudentProfile?.({ semester: cleaned });
    return cleaned;
  } catch {
    return null;
  }
}

/** @deprecated Użyj tryQuickUsosProfileFromCookies. Pełne logowanie WebView usunięte ze syncu. */
export async function refreshUsosStudentProfile(options = {}) {
  return tryQuickUsosProfileFromCookies(options);
}

async function tryUsosWebViewLogin({ login, mfaCode = '', password, portalUrl, onPhase, onStudentProfile }) {
  const { isReactNative } = await import('./httpCookies.js');
  if (!isReactNative()) return null;

  const { isUsosWebViewLoginAvailable, runUsosWebViewLogin } = await import('./usosWebViewBridge.js');
  if (!isUsosWebViewLoginAvailable()) return null;

  try {
    return await runUsosWebViewLogin({ login, mfaCode, password, portalUrl, onPhase, onStudentProfile });
  } catch (error) {
    if (error?.code === 'USOS_2FA_REQUIRED') throw error;
    if (error?.code === 'USOS_ICAL_AFTER_WEBVIEW') throw error;
    if (error?.code === 'USOS_WEBVIEW_TIMEOUT') {
      if (usosBlocksDirectCasOnMobile(portalUrl)) throw error;
      onPhase?.('USOS: przeglądarka nie dokończyła logowania — próbuję logowanie bezpośrednie');
      return null;
    }
    if (usosBlocksDirectCasOnMobile(portalUrl)) throw error;
    onPhase?.('USOS: logowanie WebView nie powiodło się — próbuję połączenie HTTP');
    return null;
  }
}

async function loginToUsosAndFetchIcalViaHttp({ login, mfaCode = '', password, portalUrl, onPhase, onStudentProfile }) {
  if (mfaCode && pendingSecondFactor?.jar) {
    onPhase?.('USOS: wysyłam kod weryfikacyjny');
    const challenge = pendingSecondFactor;
    const secondFactorResult = await submitSecondFactorCode({ challenge, mfaCode, onPhase });
    const secondFactorHtml = secondFactorResult.html;

    if (isUjAdfsMfaCodeRejected(secondFactorHtml) || (isUjAdfsMfaChallengePage(secondFactorHtml) && hasSecondFactorCodeInput(secondFactorHtml))) {
      pendingSecondFactor = {
        html: secondFactorHtml,
        jar: challenge.jar,
        portalUrl: challenge.portalUrl,
        url: secondFactorResult.url
      };
      const error = new Error(
        isUjAdfsMfaCodeRejected(secondFactorHtml)
          ? 'USOS: kod SMS/e-mail jest nieprawidłowy lub wygasł. Wpisz aktualny kod i kliknij „Zaloguj” ponownie.'
          : 'USOS: wymagany jest kod z e-mail lub SMS. Wpisz go w polu poniżej i kliknij „Zaloguj” ponownie (kod ważny kilka minut).'
      );
      error.code = 'USOS_2FA_REQUIRED';
      throw error;
    }

    pendingSecondFactor = null;

    const found = await completeUsosLoginFetchProfileAndIcal(
      challenge.jar,
      secondFactorHtml,
      secondFactorResult.url,
      portalUrl,
      { login, onPhase, onStudentProfile }
    );
    if (!found) {
      throw new Error(
        'USOS: zalogowano do konta uczelni, ale nie udało się pobrać linku iCal z USOSweb.'
          + ' Wejdź w USOS: Plan zajęć → eksportuj i wklej link ręcznie,'
          + ' albo spróbuj ponownie po pełnym kodzie SMS.'
      );
    }
    return found;
  }

  const jar = new Map();
  resetNativeCookieSession();
  onPhase?.('USOS: pobieram formularz logowania');
  const loginPage = await fetchLoginFormPage(jar, portalUrl, onPhase);

  const resolvedLoginHtml = loginPage.html;
  const resolvedLoginPageUrl = loginPage.url || portalUrl;

  if (!canProceedWithCollegeLogin(resolvedLoginHtml, resolvedLoginPageUrl, portalUrl)) {
    if (isUjAdfsMfaChallengePage(resolvedLoginHtml)) {
      const challenge = await selectSmsSecondFactorIfAvailable({
        html: resolvedLoginHtml,
        jar,
        onPhase,
        url: resolvedLoginPageUrl
      });
      pendingSecondFactor = {
        html: challenge.html,
        jar,
        portalUrl,
        url: challenge.url
      };
      const error = new Error('USOS: wysłano/wybrano SMS lub wymagane jest dodatkowe potwierdzenie. Wpisz kod z USOSweb.');
      error.code = 'USOS_2FA_REQUIRED';
      throw error;
    }

    const htmlLength = String(resolvedLoginHtml || '').length;
    const pageKind = describeLoginPage(resolvedLoginHtml, resolvedLoginPageUrl, portalUrl);
    const onUsosGateway = isUsosPortalPage(resolvedLoginPageUrl, portalUrl);
    const adfsHint = adfsUrlForPortal(portalUrl)
      ? ' Formularz login/hasło jest na stronie konta UJ (sts.uj.edu.pl), nie w HTML USOSweb.'
      : /amu\.edu\.pl/i.test(portalHost(portalUrl))
        ? ' Logowanie UAM jest na cas.amu.edu.pl (Identyfikator + Hasło), nie na usosweb.amu.edu.pl.'
        : '';
    throw new Error(
      `USOS: nie znaleziono pól loginu i hasła (${pageKind}, ${pageHostLabel(resolvedLoginPageUrl)}).`
        + (onUsosGateway ? adfsHint : '')
        + (htmlLength < 200 ? ' Serwer zwrócił pustą odpowiedź — spróbuj ponownie.' : '')
    );
  }

  const action = isCasLoginForm(resolvedLoginHtml, resolvedLoginPageUrl)
    ? extractCollegeFormAction(resolvedLoginHtml, resolvedLoginPageUrl)
    : extractFormAction(resolvedLoginHtml, resolvedLoginPageUrl);
  if (isUjAdfsLoginUrl(resolvedLoginPageUrl) && !isSupportedLoginForm(resolvedLoginHtml)) {
    onPhase?.('USOS: strona ADFS UJ — wysyłam login (pola niewidoczne w HTML aplikacji)');
  }
  if (isPwCasLoginUrl(resolvedLoginPageUrl)) {
    onPhase?.('USOS: logowanie CAS PW');
  }
  onPhase?.('USOS: wysyłam login i hasło do systemu uczelni');
  const loginResponse = await followRequest(jar, action, {
    method: 'POST',
    headers: {
      ...browserHeaders(resolvedLoginPageUrl),
      Referer: resolvedLoginPageUrl,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(buildCollegeLoginPayload(resolvedLoginHtml, login, password, resolvedLoginPageUrl, portalUrl))
  });
  const afterLoginHtml = await loginResponse.response.text();
  const afterLoginUrl = loginResponse.url || action;

  let postLoginHtml = afterLoginHtml;
  let postLoginUrl = afterLoginUrl;

  if (isUmcsMfaPageHtml(afterLoginHtml)) {
    const mfaStep = await advanceUmcsMfaFlow(jar, afterLoginHtml, afterLoginUrl, mfaCode, onPhase);
    postLoginHtml = mfaStep.html;
    postLoginUrl = mfaStep.url;
    if (mfaStep.needsCode) {
      pendingSecondFactor = {
        html: postLoginHtml,
        jar,
        portalUrl,
        url: postLoginUrl
      };
      const error = new Error('USOS: wysłano kod na e-mail. Wpisz go poniżej i kliknij „Zaloguj” ponownie (kod ważny kilka minut).');
      error.code = 'USOS_2FA_REQUIRED';
      throw error;
    }
  }

  const stillOnCasLogin = isCasLoginForm(postLoginHtml, postLoginUrl);
  const casLoginRejected = isCasLoginForm(resolvedLoginHtml, resolvedLoginPageUrl)
    && (loginResponse.response.status === 401 || stillOnCasLogin || isCasAuthFailureHtml(postLoginHtml));
  if (casLoginRejected) {
    throw new Error(
      'USOS: system logowania uczelni odrzucił login lub hasło.'
        + ' Sprawdź pełny adres e-mail (@umcs.pl, @pw.edu.pl itd.) i hasło.'
    );
  }
  if (!stillOnCasLogin && (isSupportedLoginForm(postLoginHtml) || /nieprawidł|invalid credentials|błędn|incorrect password|incorrect username/i.test(postLoginHtml))) {
    throw new Error('USOS: login lub hasło są nieprawidłowe albo uczelnia odrzuciła logowanie.');
  }

  if (detectSecondFactor(postLoginHtml)) {
    const challenge = await selectSmsSecondFactorIfAvailable({
      html: postLoginHtml,
      jar,
      onPhase,
      url: postLoginUrl
    });
    pendingSecondFactor = {
      html: challenge.html,
      jar,
      portalUrl,
      url: challenge.url
    };
    const error = new Error('USOS: wysłano/wybrano SMS lub wymagane jest dodatkowe potwierdzenie. Wpisz kod z USOSweb.');
    error.code = 'USOS_2FA_REQUIRED';
    throw error;
  }

  const found = await completeUsosLoginFetchProfileAndIcal(jar, postLoginHtml, postLoginUrl, portalUrl, {
    login,
    onPhase,
    onStudentProfile
  });
  if (!found) {
    throw new Error(
      'USOS: zalogowano do konta uczelni, ale nie udało się pobrać linku iCal z USOSweb.'
        + ' Wejdź w USOS: Plan zajęć → eksportuj i wklej link ręcznie,'
        + ' albo spróbuj ponownie po pełnym kodzie SMS.'
    );
  }

  return found;
}

export async function refreshUsosStudentProfileViaWebView({
  login,
  mfaCode = '',
  password,
  portalUrl,
  onPhase,
  onStudentProfile
} = {}) {
  const { isReactNative } = await import('./httpCookies.js');
  if (!isReactNative()) return;
  const { isUsosWebViewLoginAvailable, runUsosWebViewProfileRefresh } =
    await import('./usosWebViewBridge.js');
  if (!isUsosWebViewLoginAvailable()) return;
  try {
    await runUsosWebViewProfileRefresh({
      login,
      mfaCode,
      password,
      portalUrl,
      onPhase,
      onStudentProfile
    });
  } catch {
    // profil opcjonalny przy synchronizacji
  }
}

export async function loginToUsosAndFetchIcal({ login, mfaCode = '', password, portalUrl, onPhase, onStudentProfile }) {
  if (!login || !password) throw new Error('Wpisz login i hasło do USOSweb.');
  if (!portalUrl) throw new Error('Nie znam adresu USOSweb dla tej uczelni.');

  const trimmedCode = String(mfaCode || '').trim();
  const params = { login, mfaCode: trimmedCode, password, portalUrl, onPhase, onStudentProfile };
  const { isReactNative } = await import('./httpCookies.js');

  if (trimmedCode) {
    const { isUsosWebViewLoginAvailable, isUsosWebViewMfaWaiting, runUsosWebViewLogin } =
      await import('./usosWebViewBridge.js');

    // Ta sama ukryta WebView co po kroku 1 — nie mieszamy z osobnym HTTP (inny jar/cookies).
    if (isReactNative() && isUsosWebViewLoginAvailable() && isUsosWebViewMfaWaiting()) {
      pendingSecondFactor = null;
      try {
        const viaWebView = await runUsosWebViewLogin(params);
        if (viaWebView) return viaWebView;
      } catch (error) {
        if (error?.code === 'USOS_2FA_REQUIRED') throw error;
        throw error;
      }
    }

    if (pendingSecondFactor?.jar) {
      return loginToUsosAndFetchIcalViaHttp(params);
    }

    if (isReactNative()) {
      try {
        const viaWebView = await tryUsosWebViewLogin(params);
        if (viaWebView) return viaWebView;
      } catch (error) {
        if (error?.code !== 'USOS_2FA_REQUIRED') throw error;
      }
    }

    throw new Error(
      'USOS: sesja weryfikacji wygasła. Zaloguj się ponownie bez kodu, poczekaj na nowy kod e-mail/SMS i wpisz go od razu.'
    );
  }

  if (isReactNative()) {
    if (usosPrefersWebViewLogin(portalUrl)) {
      pendingSecondFactor = null;
      try {
        const viaWebView = await tryUsosWebViewLogin(params);
        if (viaWebView) return viaWebView;
      } catch (error) {
        if (error?.code === 'USOS_2FA_REQUIRED') throw error;
        throw error;
      }
      if (usosBlocksDirectCasOnMobile(portalUrl)) {
        throw new Error(
          'USOS: nie udało się pobrać planu w aplikacji mobilnej.'
            + ' Użyj „Dodaj link iCal” i wklej odnośnik z USOSweb (Plan zajęć → eksportuj).'
        );
      }
      onPhase?.('USOS: logowanie w przeglądarce nie powiodło się — próbuję połączenie bezpośrednie');
      return loginToUsosAndFetchIcalViaHttp(params);
    }

    // Inne uczelnie: najpierw HTTP, WebView jako zapas.
    let httpError = null;
    try {
      onPhase?.('USOS: logowanie bezpośrednie (CAS → USOSweb)');
      return await loginToUsosAndFetchIcalViaHttp(params);
    } catch (error) {
      if (error?.code === 'USOS_2FA_REQUIRED') throw error;
      httpError = error;
      onPhase?.('USOS: logowanie bezpośrednie nie powiodło się — próbuję w przeglądarce');
    }

    const viaWebView = await tryUsosWebViewLogin(params);
    if (viaWebView) return viaWebView;
    if (httpError) throw httpError;
    return loginToUsosAndFetchIcalViaHttp(params);
  }

  const viaWebView = await tryUsosWebViewLogin(params);
  if (viaWebView) return viaWebView;
  return loginToUsosAndFetchIcalViaHttp(params);
}

function validateIcalUrl(value) {
  const url = normalizeIcalUrl(value);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Wklej pełny prywatny link iCal z USOS, zaczynający się od http lub https.');
  }
  if (!looksLikeUsosIcalUrl(url)) {
    throw new Error('Ten link nie wygląda jak eksport iCal z USOS. Wklej prywatny link .ics z eksportu planu zajęć.');
  }
  return url;
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r?\n[ \t]/g, '');
}

function splitContentLine(line) {
  const separator = line.indexOf(':');
  if (separator < 0) return null;

  const rawName = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [name, ...parameterParts] = rawName.split(';');
  const parameters = {};

  parameterParts.forEach((part) => {
    const [key, ...rest] = part.split('=');
    if (!key) return;
    parameters[key.toUpperCase()] = rest.join('=').replace(/^"|"$/g, '');
  });

  return {
    name: name.toUpperCase(),
    parameters,
    value
  };
}

function unescapeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(value, parameters = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (parameters.VALUE === 'DATE' || /^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00`);
  }

  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const [, year, month, day, hour, minute, second = '00', utc] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${utc ? 'Z' : ''}`;
  return new Date(iso);
}

function parseRRule(value) {
  const rule = {};
  String(value || '').split(';').forEach((part) => {
    const [key, rawValue] = part.split('=');
    if (!key) return;
    rule[key.toUpperCase()] = rawValue || '';
  });
  return rule;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function parseExdates(values) {
  return values
    .map((entry) => entry.value.split(',').map((value) => parseIcsDate(value, entry.parameters)))
    .flat()
    .filter(Boolean);
}

function eventDurationMs(event) {
  if (!event.start || !event.end) return 0;
  return Math.max(0, event.end.getTime() - event.start.getTime());
}

function expandWeeklyEvent(event, rangeStart, rangeEnd) {
  if (!event.rrule || event.rrule.FREQ !== 'WEEKLY') return [event];

  const interval = Math.max(1, Number(event.rrule.INTERVAL || 1));
  const count = Math.min(MAX_RECURRENCE_INSTANCES, Number(event.rrule.COUNT || MAX_RECURRENCE_INSTANCES));
  const until = event.rrule.UNTIL ? parseIcsDate(event.rrule.UNTIL) : rangeEnd;
  const duration = eventDurationMs(event);
  const exclusions = parseExdates(event.exdates || []);
  const expanded = [];
  let current = new Date(event.start);

  for (let index = 0; index < count && expanded.length < MAX_RECURRENCE_INSTANCES; index += 1) {
    if (current > rangeEnd || current > until) break;

    const currentEnd = new Date(current.getTime() + duration);
    const excluded = exclusions.some((date) => sameDay(date, current));
    if (!excluded && currentEnd >= rangeStart && current <= rangeEnd) {
      expanded.push({
        ...event,
        id: `${event.id}-${current.toISOString()}`,
        start: current,
        end: currentEnd
      });
    }

    current = addDays(current, 7 * interval);
  }

  return expanded;
}

function readEventFromLines(lines, index) {
  const fields = {};
  const repeated = {};

  lines.forEach((line) => {
    const parsed = splitContentLine(line);
    if (!parsed) return;
    if (parsed.name === 'RRULE') {
      fields.rrule = parseRRule(parsed.value);
      return;
    }
    if (parsed.name === 'EXDATE') {
      repeated.EXDATE = [...(repeated.EXDATE || []), parsed];
      return;
    }
    fields[parsed.name] = parsed;
  });

  const start = parseIcsDate(fields.DTSTART?.value, fields.DTSTART?.parameters);
  const end = parseIcsDate(fields.DTEND?.value, fields.DTEND?.parameters);
  if (!start || !end) return null;

  const summary = unescapeIcsText(fields.SUMMARY?.value) || 'Zajęcia';
  const location = unescapeIcsText(fields.LOCATION?.value);
  const description = unescapeIcsText(fields.DESCRIPTION?.value);
  const parsedLocation = parseUsosIcalEventLocation(description, location);

  return {
    additionalInfo: parsedLocation.additionalInfo,
    buildingAddress: parsedLocation.buildingAddress,
    buildingName: parsedLocation.buildingName,
    color: '#2575ff',
    end,
    exdates: repeated.EXDATE || [],
    form: '',
    hangoutLink: '',
    hangoutLinkLabel: '',
    id: unescapeIcsText(fields.UID?.value) || `${start.toISOString()}-${index}`,
    locationMode: parsedLocation.buildingName || parsedLocation.roomName ? 'Budynek' : '',
    module: '',
    room: parsedLocation.roomName,
    roomName: parsedLocation.roomName,
    rrule: fields.rrule,
    start,
    status: unescapeIcsText(fields.STATUS?.value),
    subject: summary,
    teacherNames: [],
    teachers: '',
    title: summary,
    type: 'USOS:ICAL'
  };
}

function parseIcs(text, startDateKey, endDateKey) {
  const lines = unfoldIcs(text).split(/\r?\n/);
  const events = [];
  let current = null;

  lines.forEach((line) => {
    if (line === 'BEGIN:VEVENT') {
      current = [];
      return;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const event = readEventFromLines(current, events.length);
        if (event) events.push(event);
      }
      current = null;
      return;
    }
    if (current) current.push(line);
  });

  const rangeStart = new Date(`${startDateKey}T00:00:00`);
  const rangeEnd = new Date(`${endDateKey}T23:59:59`);

  return events
    .flatMap((event) => expandWeeklyEvent(event, rangeStart, rangeEnd))
    .filter((event) => event.end >= rangeStart && event.start <= rangeEnd)
    .map(({ exdates, rrule, ...event }) => ({
      ...event,
      end: event.end.toISOString(),
      start: event.start.toISOString()
    }))
    .sort((left, right) => new Date(left.start) - new Date(right.start));
}

/** Tylko do skryptów testowych Node (scripts/test-usos-uj-e2e.mjs). */
export async function debugUjSubmitSecondFactor(mfaCode, onPhase) {
  if (!pendingSecondFactor) {
    throw new Error('Brak oczekującej sesji 2FA — najpierw login bez kodu w tym samym procesie.');
  }
  return submitSecondFactorCode({ challenge: pendingSecondFactor, mfaCode, onPhase });
}

export function debugUjPendingChallengeMeta() {
  if (!pendingSecondFactor) return null;
  const { html, url } = pendingSecondFactor;
  return {
    url,
    hasCodeInput: /verificationCodeInput|name=["']VerificationCode["']/i.test(String(html || '')),
    title: String(html || '').match(/<title>([^<]*)<\/title>/i)?.[1] || ''
  };
}

export async function loginAndFetchSchedule({ credentials, endDateKey, onCredentials, onPhase, startDateKey }) {
  const stored = unpackUsosStoredCredential(credentials);
  const icalUrl = validateIcalUrl(stored?.icalUrl || credentials);
  onPhase?.('USOS: pobieram prywatny kalendarz iCal');

  const response = await fetchWithTimeout(icalUrl, {
    headers: {
      Accept: 'text/calendar,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'
    }
  });
  const text = await response.text();

  if (!response.ok || !/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('USOS nie zwrócił poprawnego pliku iCal. Sprawdź, czy wkleiłeś prywatny link z eksportu planu.');
  }

  const events = parseIcs(text, startDateKey, endDateKey);
  if (stored) {
    onCredentials?.(packUsosStoredCredential(stored.password, icalUrl, stored.profile || null));
  } else {
    onCredentials?.(icalUrl);
  }
  onPhase?.(`USOS: plan iCal zapisany (${events.length})`);
  return events;
}
