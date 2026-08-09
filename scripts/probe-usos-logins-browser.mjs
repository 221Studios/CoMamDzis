#!/usr/bin/env node
/**
 * Browser fallback dla IdP renderowanych JS-em, głównie Microsoft Entra.
 *
 * Wymaga lokalnego Chromium. Nie zapisuje poświadczeń; używa syntetycznego loginu
 * i hasła testowego tak jak scripts/probe-usos-logins.mjs.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getUsosLoginStartUrl,
  listProbeUniversities,
  syntheticLoginForUniversity
} from './lib/usos-login-probe.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const universities = listProbeUniversities().filter((university) => {
    if (!args.only) return true;
    const allowed = new Set(args.only.split(',').map((id) => id.trim()).filter(Boolean));
    return allowed.has(university.id) || allowed.has(university.portalHost);
  });

  if (!universities.length) {
    console.error('Brak uczelni do sprawdzenia.');
    process.exit(1);
  }

  const browser = await launchChromium();
  const results = [];
  try {
    for (let i = 0; i < universities.length; i += 1) {
      const university = universities[i];
      const login = syntheticLoginForUniversity(university);
      const result = await probeInBrowser(browser.port, {
        url: getUsosLoginStartUrl(university.portalUrl),
        login,
        password: args.password,
        timeoutMs: args.timeoutMs
      });
      results.push({ id: university.id, name: university.name, login, ...result });
      console.log(
        `[${String(i + 1).padStart(2, ' ')}/${universities.length}] `
        + `${result.authFailed ? 'OK   ' : 'CHECK'} ${university.id} ${result.state} ${result.message || result.finalUrl}`
      );
    }
  } finally {
    browser.close();
  }

  const ok = results.filter((result) => result.authFailed).length;
  console.log(`\nBrowser auth failed confirmed: ${ok}/${results.length}`);
  if (ok !== results.length) process.exitCode = 2;
}

async function probeInBrowser(port, { url, login, password, timeoutMs }) {
  const target = await createTarget(port, url);
  const page = new CdpPage(target.webSocketDebuggerUrl);
  const startedAt = Date.now();

  try {
    await page.open();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await sleep(2500);

    let last = null;
    while (Date.now() - startedAt < timeoutMs) {
      last = await page.evaluate(buildBrowserAutofillSource(login, password));
      if (last.authFailed || last.formSubmitted || last.usernameSubmitted) {
        await sleep(last.authFailed ? 300 : 2500);
      } else {
        await sleep(900);
      }
      const check = await page.evaluate(buildBrowserAutofillSource(login, password));
      last = check || last;
      if (last?.authFailed) break;
      if (last?.formSubmitted) {
        await sleep(2500);
      }
    }

    const finalUrl = await page.evaluate('window.location.href');
    return {
      authFailed: Boolean(last?.authFailed),
      state: last?.state || 'unknown',
      message: last?.message || '',
      finalUrl
    };
  } finally {
    page.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
  }
}

function buildBrowserAutofillSource(login, password) {
  return `(function () {
    const login = ${JSON.stringify(login)};
    const password = ${JSON.stringify(password)};
    function visible(el) {
      if (!el || el.disabled) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && r.width >= 0 && r.height >= 0;
    }
    function setValue(el, value) {
      if (!el) return;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: String(value).slice(-1) || 'a' })); } catch (e) {}
    }
    function click(el) {
      if (!el) return false;
      if (el.disabled) el.disabled = false;
      el.click();
      return true;
    }
    const text = (document.body?.innerText || '').trim();
    const error = document.querySelector('#usernameError, #passwordError, #error, [role="alert"], .alert-error, .message-error');
    const errorText = ((error && (error.innerText || error.textContent)) || text).trim();
    if (/nieprawidłowa|nieprawidlowa|nieprawidłowy|nieprawidlowy|doesn.?t exist|couldn.?t find|incorrect|invalid|wrong password|nie znaleziono|nie istnieje|authentication failed/i.test(errorText)) {
      return { authFailed: true, state: 'auth_failed', message: errorText.slice(0, 240), url: location.href };
    }

    const pass = document.querySelector('#i0118, input[name="passwd"], #passwordInput, input[name="Password"], #password, input[name="password"], input[type="password"]');
    const user = document.querySelector('#i0116, input[name="loginfmt"], #userNameInput, input[name="UserName"], #username, input[name="username"], input[type="email"]');
    const submit = document.querySelector('#idSIButton9, #submitButton, #kc-login, input[type="submit"], button[type="submit"]');
    const next = document.querySelector('#nextButton') || submit;

    if (pass && visible(pass) && !window.__probePasswordSubmitted) {
      setValue(pass, password);
      window.__probePasswordSubmitted = true;
      setTimeout(function () { click(submit); }, 250);
      return { formSubmitted: true, state: 'password_submitted', url: location.href };
    }
    if (user && visible(user) && !window.__probeUsernameSubmitted) {
      setValue(user, login);
      window.__probeUsernameSubmitted = true;
      setTimeout(function () { click(next); }, 250);
      return { usernameSubmitted: true, state: 'username_submitted', url: location.href };
    }
    return { state: 'waiting', hasUser: Boolean(user), hasPass: Boolean(pass), url: location.href };
  })();`;
}

async function launchChromium() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const userDataDir = mkdtempSync(join(tmpdir(), 'comamdzi-chromium-'));
  const chromium = process.env.CHROMIUM_BIN || 'chromium';
  const child = spawn(chromium, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return {
          port,
          close() {
            child.kill('SIGTERM');
            rmSync(userDataDir, { recursive: true, force: true });
          }
        };
      }
    } catch {
      // wait
    }
    await sleep(250);
  }

  child.kill('SIGTERM');
  rmSync(userDataDir, { recursive: true, force: true });
  throw new Error('Chromium remote debugging did not start.');
}

async function createTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT'
  });
  if (!response.ok) throw new Error(`Cannot create Chromium target: HTTP ${response.status}`);
  return response.json();
}

function CdpPage(wsUrl) {
  this.wsUrl = wsUrl;
  this.nextId = 1;
  this.pending = new Map();
  this.ws = null;
}

CdpPage.prototype.open = function open() {
  return new Promise((resolve, reject) => {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener('open', resolve, { once: true });
    this.ws.addEventListener('error', reject, { once: true });
    this.ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !this.pending.has(payload.id)) return;
      const { resolve: done, reject: fail } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) fail(new Error(payload.error.message || 'CDP error'));
      else done(payload.result);
    });
  });
};

CdpPage.prototype.send = function send(method, params = {}) {
  const id = this.nextId;
  this.nextId += 1;
  this.ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    this.pending.set(id, { resolve, reject });
  });
};

CdpPage.prototype.evaluate = async function evaluate(expression) {
  const result = await this.send('Runtime.evaluate', {
    expression,
    awaitPromise: false,
    returnByValue: true
  });
  return result.result?.value;
};

CdpPage.prototype.close = function close() {
  try {
    this.ws?.close();
  } catch {
    // ignore
  }
};

function parseArgs(argv) {
  const parsed = { only: '', password: 'test', timeoutMs: 25000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') parsed.only = argv[++i] || '';
    else if (arg === '--password') parsed.password = argv[++i] || parsed.password;
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++i] || parsed.timeoutMs);
    else {
      console.error(`Nieznany argument: ${arg}`);
      process.exit(1);
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
