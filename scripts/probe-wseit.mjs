import https from 'node:https';
import { URL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

import { wseitCredentialsFromEnv } from './lib/test-credentials.mjs';

const { login: LOGIN, password: PASS } = wseitCredentialsFromEnv();
const BASE = 'https://wd.wseit.pl';

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          ...(opts.headers || {}),
          ...(opts.cookie ? { Cookie: opts.cookie } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function fetchFollow(url, cookie, max = 8) {
  let current = url;
  let cookies = cookie;
  let response = null;
  for (let i = 0; i < max; i += 1) {
    response = await fetch(current, { cookie: cookies });
    cookies = mergeCookies(cookies, response.headers);
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) {
      return { response, cookies, url: current };
    }
    current = new URL(response.headers.location, BASE).href;
  }
  return { response, cookies, url: current };
}

function mergeCookies(existing, headers) {
  const jar = new Map();
  for (const part of String(existing || '').split('; ').filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  const set = headers['set-cookie'] || [];
  const arr = Array.isArray(set) ? set : [set].filter(Boolean);
  for (const cookie of arr) {
    const pair = String(cookie).split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

const loginPage = await fetch(`${BASE}/Logowanie`);
let cookies = mergeCookies('', loginPage.headers);
const token = loginPage.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
console.log('token', token ? 'ok' : 'missing');

const body = new URLSearchParams({
  __RequestVerificationToken: token,
  Username: LOGIN,
  Password: PASS
}).toString();

const post = await fetch(`${BASE}/Logowanie`, {
  method: 'POST',
  cookie: cookies,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: `${BASE}/Logowanie`
  },
  body
});
cookies = mergeCookies(cookies, post.headers);
console.log('login status', post.status, 'location', post.headers.location);

let html = post.body;
if (post.headers.location) {
  const nextUrl = new URL(post.headers.location, BASE).href;
  const after = await fetch(nextUrl, { cookie: cookies });
  cookies = mergeCookies(cookies, after.headers);
  html = after.body;
  console.log('after redirect', after.status, nextUrl);
}

writeFileSync(new URL('../tmp-wseit-after-login.html', import.meta.url), html);
console.log('title', html.match(/<title>([^<]+)/)?.[1]);

const contexts = [...html.matchAll(/href="(\/WybierzKontekst\?[^"]+)"[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/g)].map((m) => ({
  href: m[1],
  text: m[2].replace(/\s+/g, ' ').trim()
}));
console.log('contexts', contexts);

for (const context of contexts) {
  const freshLogin = await fetch(`${BASE}/Logowanie`);
  let ctxCookies = mergeCookies('', freshLogin.headers);
  const freshToken = freshLogin.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
  const freshBody = new URLSearchParams({
    __RequestVerificationToken: freshToken,
    Username: LOGIN,
    Password: PASS
  }).toString();
  const freshPost = await fetch(`${BASE}/Logowanie`, {
    method: 'POST',
    cookie: ctxCookies,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${BASE}/Logowanie`
    },
    body: freshBody
  });
  ctxCookies = mergeCookies(ctxCookies, freshPost.headers);
  const ctxHref = context.href.replace(/&amp;/g, '&');
  const ctx = await fetchFollow(`${BASE}${ctxHref}`, ctxCookies);
  cookies = ctx.cookies;
  html = ctx.response.body;
  const label = context.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  console.log('context', label, ctx.response.status, ctx.url);
  console.log(' blocked', /zablokowany|zaległość/i.test(html));
  const planFollow = await fetchFollow(`${BASE}/Plany/PlanyStudentow`, cookies);
  console.log(' plan', planFollow.response.status, planFollow.url, /zablokowany|zaległość/i.test(planFollow.response.body));
  if (!/zablokowany|zaległość/i.test(planFollow.response.body) && planFollow.response.body.length > 5000) {
    writeFileSync(new URL('../tmp-wseit-plany-studentow.html', import.meta.url), planFollow.response.body);
    writeFileSync(new URL('../tmp-wseit-home.html', import.meta.url), html);
    console.log('saved plan html for', label);
    break;
  }
}

const nav = [...html.matchAll(/href="([^"]+)"[^>]*>([^<]{2,80})</g)]
  .map((m) => ({ href: m[1], text: m[2].trim() }))
  .filter((m) => /plan|zaj|rozkl|karta|profil|harmon/i.test(`${m.href} ${m.text}`));
console.log('nav matches', nav.slice(0, 30));

const planFollow = await fetchFollow(`${BASE}/Plany/PlanyStudentow`, cookies);
cookies = planFollow.cookies;
writeFileSync(new URL('../tmp-wseit-plany-studentow.html', import.meta.url), planFollow.response.body);
console.log('plan status', planFollow.response.status, 'url', planFollow.url, 'len', planFollow.response.body.length);
const plan = planFollow.response;
console.log('plan title', plan.body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim());
console.log('plan h2', [...plan.body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 5));
console.log('callbacks', [...plan.body.matchAll(/PerformCallback|Callback|gridView|Plany/gi)].slice(0, 20).map((m) => m[0]));

for (const path of [
  '/TokStudiow/StudentTwojeDane/Osobowe',
  '/TokStudiow/StudentTokStudiow/DaneOToku',
  '/TokStudiow/StudentPrzedmiotyIOceny/Oceny'
]) {
  const page = (await fetchFollow(`${BASE}${path}`, cookies)).response;
  writeFileSync(new URL(`../tmp-wseit${path.replace(/\//g, '-')}.html`, import.meta.url), page.body);
  console.log(path, page.body.match(/Zuzanna|Kmieciak|BOS|kosmet|grupa|Kosmetologia/i));
}
