import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import registry from '../../src/data/usosUniversities.js';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; CoMamDzis USOS probe) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const LOGIN_PROBE_REPORT_DIR = join(ROOT, 'scripts', '.usos-login-probe');

export function getUsosLoginStartUrl(portalUrl) {
  const cleanPortal = String(portalUrl || '').replace(/\/$/, '');
  const service = encodeURIComponent(`${cleanPortal}/kontroler.php?_action=logowaniecas/index`);
  const host = safeHost(portalUrl);

  if (/usos\.pw\.edu\.pl/i.test(host)) {
    return `https://cas.usos.pw.edu.pl/cas/login?locale=pl&service=${service}`;
  }
  if (/usosweb\.uj\.edu\.pl|uj\.edu\.pl/i.test(host)) {
    return `https://cas.uj.edu.pl/cas/login?service=${service}&locale=pl`;
  }
  if (/usosweb\.umcs\.pl|umcs\.pl/i.test(host)) {
    return `https://login.umcs.pl/login?service=${service}&locale=pl`;
  }
  if (/usosweb\.amu\.edu\.pl|amu\.edu\.pl/i.test(host)) {
    return `https://cas.amu.edu.pl/cas/login?service=${service}&locale=pl`;
  }

  if (/^usosweb\./i.test(host)) {
    const suffix = host.slice('usosweb.'.length);
    if (suffix) {
      return `https://cas.${suffix}/cas/login?service=${service}&locale=pl`;
    }
  }

  return `${cleanPortal}/kontroler.php?_action=logowaniecas/index`;
}

export function listProbeUniversities() {
  return registry.universities || [];
}

export function syntheticLoginForUniversity(university, prefix = 'comamdzi_probe') {
  const domain = (university.domains || [])
    .find((candidate) => !candidate.startsWith('student.') && !candidate.startsWith('st.'))
    || university.domains?.[0]
    || university.portalHost?.replace(/^usosweb\./, '')
    || 'example.invalid';

  const idPart = String(university.id || 'usos')
    .replace(/[^a-z0-9]+/gi, '.')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();

  return `${prefix}.${idPart}@${domain}`;
}

export function detectInvalidLoginMessage(html) {
  const text = normalizeText(stripHtml(html));
  if (!text) return { matched: false, message: '' };

  const patterns = [
    /nieprawid[łl]ow[ey] (login|has[łl]o|identyfikator|u[żz]ytkownik|po[sś]wiadczenia)/i,
    /nieprawid[łl]owa nazwa u[żz]ytkownika/i,
    /(login|has[łl]o|identyfikator|u[żz]ytkownik|po[sś]wiadczenia)[^.!?\n]{0,90}nieprawid[łl]ow/i,
    /b[łl][ęe]dn[ey] (login|has[łl]o|identyfikator|u[żz]ytkownik|po[sś]wiadczenia)/i,
    /(login|has[łl]o|identyfikator|u[żz]ytkownik|po[sś]wiadczenia)[^.!?\n]{0,90}b[łl][ęe]dn/i,
    /uwierzytelnianie[^.!?\n]{0,90}(nie powiod[łl]o|nieudane|odrzucone)/i,
    /nie mo[żz]na si[ęe] zalogowa[ćc]/i,
    /nie mog[ąa] zosta[ćc] uwierzytelnione/i,
    /authentication failed|invalid credentials|bad credentials|incorrect username|incorrect password/i,
    /invalid username|invalid password|login failed|sign in failed/i,
    /credentials you provided cannot be determined/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { matched: true, message: snippetAround(text, match.index || 0) };
    }
  }

  return { matched: false, message: '' };
}

export function detectChallengeOrRateLimit(html) {
  const text = normalizeText(stripHtml(html));
  if (/captcha|recaptcha|rate limit|too many attempts|zbyt wiele pr[oó]b|konto zablokowane/i.test(text)) {
    return snippetAround(text, text.search(/captcha|recaptcha|rate limit|too many attempts|zbyt wiele pr[oó]b|konto zablokowane/i));
  }
  return '';
}

export function findLoginForm(html, pageUrl) {
  const forms = extractForms(html);
  const scored = forms
    .map((form) => ({ form, score: scoreLoginForm(form) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen = scored[0]?.form || null;
  if (!chosen) return null;

  const username = findUsernameField(chosen);
  const password = findPasswordField(chosen);
  if (!username || !password) return null;

  const action = absolutizeUrl(chosen.attrs.action || pageUrl, pageUrl);
  const method = String(chosen.attrs.method || 'post').toUpperCase() === 'GET' ? 'GET' : 'POST';

  return {
    action,
    method,
    usernameName: username.name,
    passwordName: password.name,
    formId: chosen.attrs.id || '',
    formName: chosen.attrs.name || '',
    inputCount: chosen.inputs.length,
    submitName: findSubmitField(chosen)?.name || '',
    fields: chosen.inputs
  };
}

export function findUsernameStepForm(html, pageUrl) {
  const forms = extractForms(html);
  const scored = forms
    .map((form) => ({ form, score: scoreUsernameStepForm(form) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen = scored[0]?.form || null;
  if (!chosen) return null;

  const username = findUsernameField(chosen, { allowHidden: false });
  if (!username || findPasswordField(chosen)) return null;

  const action = absolutizeUrl(chosen.attrs.action || pageUrl, pageUrl);
  const method = String(chosen.attrs.method || 'post').toUpperCase() === 'GET' ? 'GET' : 'POST';

  return {
    action,
    method,
    usernameName: username.name,
    formId: chosen.attrs.id || '',
    formName: chosen.attrs.name || '',
    inputCount: chosen.inputs.length,
    submitName: findSubmitField(chosen)?.name || '',
    fields: chosen.inputs
  };
}

export function buildLoginFormBody(loginForm, login, password) {
  const params = new URLSearchParams();
  const submitField = findSubmitField({ inputs: loginForm.fields || [] });

  for (const input of loginForm.fields || []) {
    if (!input.name) continue;
    const type = String(input.type || 'text').toLowerCase();
    if (['button', 'image', 'file', 'reset'].includes(type)) continue;
    if (['checkbox', 'radio'].includes(type) && !input.checked) continue;
    if (type === 'submit' && submitField && input !== submitField) continue;

    let value = input.value || '';
    if (input.name === loginForm.usernameName) value = login;
    if (input.name === loginForm.passwordName) value = password;
    if (input.name === 'deviceFingerprint' && !value) value = fingerprintFor(login);
    params.append(input.name, value);
  }

  if (submitField?.name && !params.has(submitField.name)) {
    params.append(submitField.name, submitField.value || 'submit');
  }

  return params;
}

export function buildUsernameStepFormBody(usernameForm, login) {
  const params = new URLSearchParams();
  const submitField = findSubmitField({ inputs: usernameForm.fields || [] });

  for (const input of usernameForm.fields || []) {
    if (!input.name) continue;
    const type = String(input.type || 'text').toLowerCase();
    if (['button', 'image', 'file', 'reset'].includes(type)) continue;
    if (['checkbox', 'radio'].includes(type) && !input.checked) continue;
    if (type === 'submit' && submitField && input !== submitField) continue;

    let value = input.value || '';
    if (input.name === usernameForm.usernameName) value = login;
    params.append(input.name, value);
  }

  if (submitField?.name && !params.has(submitField.name)) {
    params.append(submitField.name, submitField.value || 'submit');
  }

  return params;
}

export async function probeUniversityLogin(university, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const submitInvalidLogin = Boolean(options.submitInvalidLogin);
  const invalidPassword = String(options.invalidPassword || 'test');
  const invalidLoginPrefix = String(options.invalidLoginPrefix || 'comamdzi_probe');
  const login = syntheticLoginForUniversity(university, invalidLoginPrefix);
  const client = new HttpClient({ timeoutMs, userAgent: options.userAgent || DEFAULT_USER_AGENT });
  const startedAt = new Date().toISOString();
  const startUrl = getUsosLoginStartUrl(university.portalUrl);

  const result = {
    id: university.id,
    name: university.name,
    portalUrl: university.portalUrl,
    apiBaseUrl: university.apiBaseUrl || '',
    startUrl,
    testLogin: login,
    startedAt,
    portal: { ok: false, status: 0, finalUrl: '', error: '' },
    api: { ok: false, status: 0, finalUrl: '', skipped: !university.apiBaseUrl, error: '' },
    loginPage: { ok: false, status: 0, finalUrl: '', formFound: false, form: null, error: '' },
    submit: { requested: submitInvalidLogin, attempted: false, ok: false, status: 0, finalUrl: '', authFailed: false, message: '', challenge: '', error: '' },
    redirects: []
  };

  try {
    const portal = await client.follow(university.portalUrl, { maxRedirects: 8 });
    result.portal = {
      ok: portal.response.status >= 200 && portal.response.status < 500,
      status: portal.response.status,
      finalUrl: portal.finalUrl,
      error: ''
    };
  } catch (error) {
    result.portal.error = errorMessage(error);
  }

  if (university.apiBaseUrl) {
    try {
      const api = await client.follow(`${university.apiBaseUrl.replace(/\/$/, '')}/services/apisrv/installation`, {
        maxRedirects: 4
      });
      result.api = {
        ok: api.response.status >= 200 && api.response.status < 500,
        status: api.response.status,
        finalUrl: api.finalUrl,
        skipped: false,
        error: ''
      };
    } catch (error) {
      result.api.error = errorMessage(error);
      result.api.skipped = false;
    }
  }

  let loginPage;
  try {
    loginPage = await client.follow(startUrl, { maxRedirects: 12 });
    result.redirects = loginPage.redirects;
    result.loginPage.status = loginPage.response.status;
    result.loginPage.finalUrl = loginPage.finalUrl;
    result.loginPage.ok = loginPage.response.status >= 200 && loginPage.response.status < 500;

    let form = findLoginForm(loginPage.body, loginPage.finalUrl);
    result.loginPage.formFound = Boolean(form);
    result.loginPage.form = form ? {
      action: form.action,
      method: form.method,
      usernameName: form.usernameName,
      passwordName: form.passwordName,
      formId: form.formId,
      formName: form.formName,
      inputCount: form.inputCount,
      submitName: form.submitName
    } : null;

    if (!form && submitInvalidLogin) {
      const usernameStep = await tryUsernameStepThenFindPasswordForm(client, loginPage.body, loginPage.finalUrl, login);
      if (usernameStep?.failure) {
        result.loginPage.formFound = true;
        result.loginPage.form = usernameStep.formInfo;
        result.submit.attempted = true;
        result.submit.ok = usernameStep.status >= 200 && usernameStep.status < 500;
        result.submit.status = usernameStep.status;
        result.submit.finalUrl = usernameStep.finalUrl;
        result.submit.authFailed = true;
        result.submit.message = usernameStep.failure.message;
        return finalizeProbeResult(result);
      }
      form = usernameStep?.form || null;
      if (form) {
        result.loginPage.formFound = true;
        result.loginPage.form = {
          action: form.action,
          method: form.method,
          usernameName: form.usernameName,
          passwordName: form.passwordName,
          formId: form.formId,
          formName: form.formName,
          inputCount: form.inputCount,
          submitName: form.submitName,
          step: 'username_then_password'
        };
      }
    }

    if (!form || !submitInvalidLogin) {
      return finalizeProbeResult(result);
    }

    result.submit.attempted = true;
    const submit = await submitLoginForm(client, form, login, invalidPassword, loginPage.finalUrl);
    result.submit.status = submit.response.status;
    result.submit.finalUrl = submit.finalUrl;
    result.submit.ok = submit.response.status >= 200 && submit.response.status < 500;

    const failure = detectInvalidLoginMessage(submit.body);
    const formAfterSubmit = findLoginForm(submit.body, submit.finalUrl);
    const httpAuthFailed = submit.response.status === 401 && Boolean(formAfterSubmit);
    const returnedToLoginForm = submit.response.status === 200 && Boolean(formAfterSubmit);
    result.submit.authFailed = failure.matched || httpAuthFailed || returnedToLoginForm;
    result.submit.message = failure.message
      || (httpAuthFailed ? 'HTTP 401 po wysłaniu formularza logowania CAS' : '')
      || (returnedToLoginForm ? 'Formularz logowania ponownie wyświetlony po wysłaniu błędnych danych' : '');
    result.submit.challenge = detectChallengeOrRateLimit(submit.body);
    return finalizeProbeResult(result);
  } catch (error) {
    if (loginPage) {
      result.submit.error = errorMessage(error);
    } else {
      result.loginPage.error = errorMessage(error);
    }
    return finalizeProbeResult(result);
  }
}

export async function probeUniversities(universities, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency || 2));
  const results = [];
  let index = 0;

  async function worker() {
    while (index < universities.length) {
      const currentIndex = index;
      index += 1;
      const university = universities[currentIndex];
      options.onProgress?.({ index: currentIndex, total: universities.length, university });
      const result = await probeUniversityLogin(university, options);
      results[currentIndex] = result;
      options.onResult?.(result, currentIndex);
      if (options.delayMs) {
        await sleep(Number(options.delayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, universities.length) }, () => worker()));
  return results;
}

export function summarizeProbeResults(results) {
  const count = results.length;
  const portalOk = results.filter((row) => row.portal.ok).length;
  const apiTotal = results.filter((row) => !row.api.skipped).length;
  const apiOk = results.filter((row) => !row.api.skipped && row.api.ok).length;
  const formFound = results.filter((row) => row.loginPage.formFound).length;
  const submitted = results.filter((row) => row.submit.attempted).length;
  const authFailed = results.filter((row) => row.submit.authFailed).length;
  const challenge = results.filter((row) => row.submit.challenge).length;

  return { count, portalOk, apiTotal, apiOk, formFound, submitted, authFailed, challenge };
}

export function writeProbeReports(results, summary, outDir = LOGIN_PROBE_REPORT_DIR) {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(outDir, `usos-login-probe-${stamp}.json`);
  const mdPath = join(outDir, `usos-login-probe-${stamp}.md`);

  writeFileSync(jsonPath, `${JSON.stringify({ summary, results }, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, renderMarkdownReport(results, summary), 'utf8');

  return { jsonPath, mdPath };
}

export function renderMarkdownReport(results, summary) {
  const lines = [
    '# USOS Login Probe',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `- Universities: ${summary.count}`,
    `- Portal OK: ${summary.portalOk}/${summary.count}`,
    `- API OK: ${summary.apiOk}/${summary.apiTotal}`,
    `- Login form found: ${summary.formFound}/${summary.count}`,
    `- Invalid login submitted: ${summary.submitted}/${summary.count}`,
    `- Invalid login rejected: ${summary.authFailed}/${summary.submitted}`,
    `- CAPTCHA/rate-limit/challenge: ${summary.challenge}`,
    '',
    '| Result | University | Portal | API | Login form | Invalid-login response |',
    '|---|---|---:|---:|---:|---|'
  ];

  for (const row of results) {
    const api = row.api.skipped ? '-' : statusCell(row.api.ok, row.api.status);
    const response = row.submit.attempted
      ? (row.submit.authFailed ? `OK: ${escapeMd(row.submit.message || 'auth failed')}` : escapeMd(row.submit.error || row.submit.challenge || row.submit.finalUrl || 'not confirmed'))
      : 'not submitted';
    const ok = row.loginPage.formFound && (!row.submit.attempted || row.submit.authFailed);
    lines.push([
      ok ? 'OK' : 'CHECK',
      escapeMd(row.name),
      statusCell(row.portal.ok, row.portal.status || row.portal.error),
      api,
      row.loginPage.formFound ? 'OK' : escapeMd(row.loginPage.error || `HTTP ${row.loginPage.status || 0}`),
      response
    ].join(' | '));
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function submitLoginForm(client, form, login, password, referer) {
  const params = buildLoginFormBody(form, login, password);
  const method = form.method || 'POST';

  if (method === 'GET') {
    const url = new URL(form.action);
    for (const [key, value] of params.entries()) {
      url.searchParams.append(key, value);
    }
    return client.follow(url.toString(), { maxRedirects: 8, referer });
  }

  return client.follow(form.action, {
    method: 'POST',
    body: params.toString(),
    referer,
    maxRedirects: 8,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}

async function tryUsernameStepThenFindPasswordForm(client, html, pageUrl, login) {
  const usernameForm = findUsernameStepForm(html, pageUrl);
  if (!usernameForm) return null;

  const params = buildUsernameStepFormBody(usernameForm, login);
  const method = usernameForm.method || 'POST';
  let step;

  if (method === 'GET') {
    const url = new URL(usernameForm.action);
    for (const [key, value] of params.entries()) {
      url.searchParams.append(key, value);
    }
    step = await client.follow(url.toString(), { maxRedirects: 8, referer: pageUrl });
  } else {
    step = await client.follow(usernameForm.action, {
      method: 'POST',
      body: params.toString(),
      referer: pageUrl,
      maxRedirects: 8,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  }

  const failure = detectInvalidLoginMessage(step.body);
  if (failure.matched) {
    return {
      failure,
      status: step.response.status,
      finalUrl: step.finalUrl,
      formInfo: {
        action: usernameForm.action,
        method: usernameForm.method,
        usernameName: usernameForm.usernameName,
        passwordName: '',
        formId: usernameForm.formId,
        formName: usernameForm.formName,
        inputCount: usernameForm.inputCount,
        submitName: usernameForm.submitName,
        step: 'username_rejected'
      }
    };
  }

  const form = findLoginForm(step.body, step.finalUrl);
  return form ? { form } : null;
}

function finalizeProbeResult(result) {
  result.finishedAt = new Date().toISOString();
  result.ok = result.submit.requested
    ? Boolean(result.loginPage.formFound && result.submit.attempted && result.submit.authFailed)
    : Boolean(result.portal.ok && result.loginPage.formFound);
  return result;
}

class HttpClient {
  constructor({ timeoutMs, userAgent }) {
    this.timeoutMs = timeoutMs;
    this.userAgent = userAgent;
    this.jar = new CookieJar();
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        redirect: 'manual',
        body: options.body,
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pl,en;q=0.8',
          ...(options.referer ? { Referer: options.referer } : {}),
          ...(this.jar.cookieHeader(url) ? { Cookie: this.jar.cookieHeader(url) } : {}),
          ...(options.headers || {})
        }
      });
      this.jar.storeFromHeaders(response.headers, url);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async follow(url, options = {}) {
    let currentUrl = url;
    let method = options.method || 'GET';
    let body = options.body;
    let headers = options.headers || {};
    let referer = options.referer || '';
    const redirects = [];
    const maxRedirects = Number(options.maxRedirects || 10);

    for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
      const response = await this.request(currentUrl, { method, body, headers, referer });
      const text = await response.text();
      const status = response.status;
      const location = response.headers.get('location');

      if (!isRedirectStatus(status) || !location || attempt === maxRedirects) {
        return { response: { status, headers: response.headers }, body: text, finalUrl: currentUrl, redirects };
      }

      const nextUrl = absolutizeUrl(location, currentUrl);
      redirects.push({ status, from: currentUrl, to: nextUrl });
      referer = currentUrl;
      currentUrl = nextUrl;
      if (status === 303 || ((status === 301 || status === 302) && method !== 'GET')) {
        method = 'GET';
        body = undefined;
        headers = {};
      }
    }

    throw new Error(`Too many redirects: ${url}`);
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  storeFromHeaders(headers, responseUrl) {
    const values = getSetCookieValues(headers);
    for (const value of values) {
      const cookie = parseSetCookie(value, responseUrl);
      if (!cookie) continue;
      this.cookies.set(`${cookie.domain}|${cookie.path}|${cookie.name}`, cookie);
    }
  }

  cookieHeader(requestUrl) {
    const url = new URL(requestUrl);
    const parts = [];
    for (const cookie of this.cookies.values()) {
      if (!domainMatches(url.hostname, cookie.domain)) continue;
      if (!url.pathname.startsWith(cookie.path)) continue;
      parts.push(`${cookie.name}=${cookie.value}`);
    }
    return parts.join('; ');
  }
}

function parseSetCookie(value, responseUrl) {
  const url = new URL(responseUrl);
  const parts = String(value || '').split(';').map((part) => part.trim()).filter(Boolean);
  const [pair, ...attrs] = parts;
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;

  const cookie = {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    domain: url.hostname.toLowerCase(),
    path: defaultCookiePath(url.pathname)
  };

  for (const attr of attrs) {
    const attrEq = attr.indexOf('=');
    const key = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).trim().toLowerCase();
    const attrValue = attrEq >= 0 ? attr.slice(attrEq + 1).trim() : '';
    if (key === 'domain' && attrValue) {
      cookie.domain = attrValue.replace(/^\./, '').toLowerCase();
    }
    if (key === 'path' && attrValue) {
      cookie.path = attrValue;
    }
    if (key === 'max-age' && attrValue === '0') {
      return null;
    }
  }

  return cookie;
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const value = headers.get('set-cookie');
  if (!value) return [];
  return splitSetCookieHeader(value);
}

function splitSetCookieHeader(value) {
  return String(value || '').split(/,(?=\s*[^;,\s]+=)/g).map((part) => part.trim()).filter(Boolean);
}

function extractForms(html) {
  const forms = [];
  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match;
  while ((match = formRegex.exec(String(html || '')))) {
    forms.push({
      attrs: parseAttrs(match[1]),
      html: match[2],
      inputs: extractInputs(match[2])
    });
  }
  return forms;
}

function extractInputs(html) {
  const inputs = [];
  const inputRegex = /<input\b([^>]*)>/gi;
  const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = inputRegex.exec(String(html || '')))) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.name) continue;
    inputs.push({
      name: decodeHtml(attrs.name),
      id: decodeHtml(attrs.id || ''),
      type: decodeHtml(attrs.type || 'text'),
      value: decodeHtml(attrs.value || ''),
      checked: Object.prototype.hasOwnProperty.call(attrs, 'checked')
    });
  }
  while ((match = buttonRegex.exec(String(html || '')))) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.name) continue;
    inputs.push({
      name: decodeHtml(attrs.name),
      id: decodeHtml(attrs.id || ''),
      type: decodeHtml(attrs.type || 'submit'),
      value: decodeHtml(attrs.value || stripHtml(match[2]).trim() || 'submit'),
      checked: false
    });
  }
  return inputs;
}

function parseAttrs(raw) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRegex.exec(String(raw || '')))) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function scoreLoginForm(form) {
  const haystack = normalizeText(`${form.attrs.id || ''} ${form.attrs.name || ''} ${form.attrs.action || ''} ${form.html || ''}`);
  let score = 0;
  if (form.inputs.some((input) => String(input.type || '').toLowerCase() === 'password')) score += 80;
  if (/login|logowanie|cas|signin|sign-in|fm1|adfs/i.test(haystack)) score += 20;
  if (findUsernameField(form)) score += 20;
  if (findPasswordField(form)) score += 20;
  return score;
}

function findUsernameField(form, { allowHidden = true } = {}) {
  const visible = form.inputs.filter((input) => !['hidden', 'password', 'submit'].includes(String(input.type || '').toLowerCase()));
  const hidden = allowHidden ? form.inputs.filter((input) => String(input.type || '').toLowerCase() === 'hidden') : [];
  return visible.find((input) => /^(username|user|login|email|j_username|UserName)$/i.test(input.name))
    || visible.find((input) => /user|login|email|identifier|name/i.test(`${input.name} ${input.id}`))
    || hidden.find((input) => /^(username|user|login|email|j_username|UserName)$/i.test(input.name))
    || hidden.find((input) => /user|login|email|identifier|name/i.test(`${input.name} ${input.id}`))
    || visible[0]
    || null;
}

function findPasswordField(form) {
  return form.inputs.find((input) => String(input.type || '').toLowerCase() === 'password')
    || form.inputs.find((input) => /pass|password|haslo|has[łl]o/i.test(`${input.name} ${input.id}`))
    || null;
}

function findSubmitField(form) {
  const submits = (form.inputs || []).filter((input) => String(input.type || '').toLowerCase() === 'submit');
  return submits.find((input) => /login|log|zaloguj|sign|submit/i.test(`${input.name} ${input.id} ${input.value}`))
    || submits[0]
    || null;
}

function scoreUsernameStepForm(form) {
  const haystack = normalizeText(`${form.attrs.id || ''} ${form.attrs.name || ''} ${form.attrs.action || ''} ${form.html || ''}`);
  let score = 0;
  if (findPasswordField(form)) return 0;
  if (findUsernameField(form, { allowHidden: false })) score += 50;
  if (/login|logowanie|signin|sign-in|authenticate|kc-form|adfs|microsoftonline/i.test(haystack)) score += 20;
  if (findSubmitField(form)) score += 10;
  return score;
}

function stripHtml(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function snippetAround(text, index) {
  const start = Math.max(0, Number(index || 0) - 90);
  return text.slice(start, start + 240).trim();
}

function fingerprintFor(value) {
  return String(Math.abs([...String(value || 'android')].reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)));
}

function defaultCookiePath(pathname) {
  const value = pathname || '/';
  if (!value || value[0] !== '/') return '/';
  if (value === '/') return '/';
  return value.slice(0, value.lastIndexOf('/') + 1) || '/';
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function absolutizeUrl(url, baseUrl) {
  return new URL(url, baseUrl).toString();
}

function statusCell(ok, value) {
  return `${ok ? 'OK' : 'FAIL'} ${value || ''}`.trim();
}

function escapeMd(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  const code = error?.cause?.code || error?.code || '';
  const host = error?.cause?.hostname || '';
  const base = error?.message || String(error);
  return [base, code, host].filter(Boolean).join(' ');
}
