import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = 'https://api.meritogo.pl';
const AUTH = 'https://login.wsb.pl';
const REDIRECT = 'https://meritogo.pl';
const CLIENT = 'meritogoservice';

const b64url = (v) => String(v).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const rand = (n = 32) => b64url(crypto.randomBytes(n).toString('base64'));
const challenge = (v) => b64url(crypto.createHash('sha256').update(v).digest('base64'));
const enc = (f) => Object.entries(f).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');

function readHeader(h, n) {
  if (!h) return '';
  if (typeof h.get === 'function') return h.get(n) || h.get(n.toLowerCase()) || '';
  return h[n] || h[n.toLowerCase()] || '';
}

function splitSetCookie(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return String(v).split(/,(?=\s*[^;,=\s]+=[^;,]+)/);
}

function saveCookies(jar, headers) {
  const direct = typeof headers?.getSetCookie === 'function' ? headers.getSetCookie() : null;
  const setCookies = direct?.length ? direct : splitSetCookie(readHeader(headers, 'set-cookie'));
  setCookies.forEach((cookie) => {
    const pair = String(cookie).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  });
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchCookies(url, options = {}, jar = new Map()) {
  const headers = { 'User-Agent': 'Mozilla/5.0', ...(options.headers || {}) };
  if (jar.size) headers.Cookie = cookieHeader(jar);
  const res = await fetch(url, { ...options, headers, redirect: options.redirect || 'manual' });
  saveCookies(jar, res.headers);
  return res;
}

function resolveUrl(loc, cur) {
  return new URL(loc, cur).toString();
}

async function follow(url, jar) {
  let current = url;
  let response = null;
  for (let i = 0; i < 12; i++) {
    response = await fetchCookies(current, {}, jar);
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: current };
    const loc = readHeader(response.headers, 'location');
    if (!loc) return { response, url: current };
    current = resolveUrl(loc, current);
  }
  return { response, url: current };
}

function val(html, name) {
  const inputs = String(html).match(/<input[\s\S]*?>/gi) || [];
  const input = inputs.find((x) => new RegExp(`\\bname=["']${name}["']`, 'i').test(x));
  return input?.match(/\bvalue=["']([^"']*)["']/i)?.[1] || '';
}

function hidden(html) {
  const fields = {};
  (String(html).match(/<input[\s\S]*?>/gi) || []).forEach((input) => {
    const type = (input.match(/\btype=["']([^"']*)["']/i)?.[1] || 'text').toLowerCase();
    if (type !== 'hidden') return;
    const name = input.match(/\bname=["']([^"']+)["']/i)?.[1];
    if (!name) return;
    fields[name] = input.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? '';
  });
  return fields;
}

function hasUser(html) {
  return /name=["']username["']/i.test(String(html));
}

function codeFromUrl(url, state) {
  try {
    const p = new URL(url);
    const code = p.searchParams.get('code');
    const st = p.searchParams.get('state');
    if (code && (!state || st === state)) return code;
  } catch {}
  return '';
}

async function authUrl(verifier, state) {
  const p = new URLSearchParams({
    protocol: 'oauth2', response_type: 'code', access_type: '', client_id: CLIENT,
    redirect_uri: REDIRECT, scope: '', state, code_challenge_method: 'S256', code_challenge: challenge(verifier)
  });
  return `${AUTH}/oauth2.0/authorize?${p}`;
}

async function casUrl(verifier, state) {
  const p = new URLSearchParams({
    client_id: CLIENT, scope: '', redirect_uri: REDIRECT, response_type: 'code', state,
    protocol: 'oauth2', access_type: '', code_challenge_method: 'S256',
    code_challenge: challenge(verifier), client_name: 'CasOAuthClient'
  });
  const service = `${AUTH}/cas/oauth2.0/callbackAuthorize?${p}`;
  return `${AUTH}/cas/login?service=${encodeURIComponent(service)}`;
}

async function loginToMerito(login, password) {
  const jar = new Map();
  const verifier = rand();
  const state = b64url(Buffer.from(JSON.stringify({ nonce: rand(), ts: Date.now() }), 'utf8').toString('base64'));
  const urls = [await authUrl(verifier, state), await casUrl(verifier, state)];
  let code = '';
  for (const loginUrl of urls) {
    const step = await follow(loginUrl, jar);
    code = codeFromUrl(step.url, state);
    if (code) break;
    let html = await step.response.text();
    let formUrl = step.url;
    if (!hasUser(html) || !val(html, 'execution')) continue;
    const action = html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1] || formUrl;
    const postUrl = new URL(action, formUrl).toString();
    const post = await fetchCookies(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: enc({ ...hidden(html), username: login, password, _eventId: 'submit', submit: 'LOGIN' })
    }, jar);
    let next = formUrl;
    if ([301, 302, 303, 307, 308].includes(post.status)) {
      next = resolveUrl(readHeader(post.headers, 'location'), postUrl);
      next = (await follow(next, jar)).url;
    } else {
      html = await post.text();
      code = html.match(/[?&]code=([^&"'<>\\s]+)/i)?.[1] || '';
    }
    if (!code) code = codeFromUrl(next, state);
    if (code) break;
  }
  if (!code) throw new Error('login failed');

  const tokenRes = await fetch(`${API}/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code, redirect_uri: REDIRECT, audience: '', grant_type: '', code_verifier: verifier,
      client_id: CLIENT, response_type: 'code'
    })
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData?.token?.access_token;
  const ctx = tokenData?.contexts;
  const contextId = ctx?.appSettings?.defaultContext?.id || ctx?.contexts?.[0]?.id;
  if (!accessToken || !contextId) throw new Error('token failed');
  return { accessToken, contextId };
}

const login = process.env.MERITO_LOGIN;
const password = process.env.MERITO_PASSWORD;
if (!login || !password) {
  console.error('Set MERITO_LOGIN and MERITO_PASSWORD');
  process.exit(1);
}

const session = await loginToMerito(login, password);
const headers = {
  Authorization: `Bearer ${session.accessToken}`,
  'Accept-Language': 'pl_PL',
  'X-Language': 'pl_PL',
  'X-Timezone': 'Europe/Warsaw',
  'context-id': session.contextId
};

const ranges = [
  ['2026-06-01', '2026-06-30'],
  ['2026-03-01', '2026-06-30'],
  ['2025-09-01', '2026-08-31']
];

const report = { ranges: [], detailSamples: [] };

for (const [from, to] of ranges) {
  const params = new URLSearchParams({ dateFrom: from, dateTo: to, categoryNames: 'CLASS_SCHEDULE' });
  const res = await fetch(`${API}/v2/class_schedule/v3/schedule/student?${params}`, { headers });
  const data = await res.json();
  const events = data?.events || [];
  const statuses = {};
  const samples = [];
  for (const event of events) {
    const key = String(event.status ?? '(null)');
    statuses[key] = (statuses[key] || 0) + 1;
    if (event.status || event.reasonOfRescheduled || event.finalMovedFrom) {
      samples.push({
        id: event.id,
        name: event.name,
        start: event.start,
        end: event.end,
        status: event.status,
        reasonOfRescheduled: event.reasonOfRescheduled,
        finalMovedFrom: event.finalMovedFrom,
        finalMovedTo: event.finalMovedTo,
        keys: Object.keys(event)
      });
    }
  }
  report.ranges.push({ from, to, total: events.length, statuses, samples: samples.slice(0, 15) });

  for (const event of events.filter((e) => /komunikacja marketingowa/i.test(e.name || '')).slice(0, 2)) {
    const dres = await fetch(`${API}/v2/class_schedule/v2/event/${encodeURIComponent(event.id)}`, { headers });
    const detail = await dres.json();
    report.detailSamples.push({ list: event, detail: detail?.data || detail });
  }
}

writeFileSync('merito-status-probe.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
