/**
 * E2E USOS z 2FA w jednym procesie.
 *
 * Wymaga: USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 * Opcjonalnie: USOS_MFA_CODE lub argv[2] (kod testowy — nie używaj prawdziwego w repo)
 *
 * node --import ./scripts/node-react-native-stub.mjs scripts/test-usos-uj-e2e.mjs [kod_sms]
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { optionalEnv, usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');

const {
  loginToUsosAndFetchIcal,
  debugUjSubmitSecondFactor,
  debugUjPendingChallengeMeta
} = await import(join(root, 'src/usosClient.js'));
const { buildUjAdfsMfaScript } = await import(join(root, 'src/usosWebViewLogin.js'));

const { login, password, portalUrl } = usosCredentialsFromEnv({
  portalFallback: 'https://www.usosweb.uj.edu.pl'
});
const testCode = optionalEnv('USOS_MFA_CODE', process.argv[2] || '');

function logPhase(p) {
  console.log('PHASE:', p);
}

function summarizeMfaHtml(html, label) {
  const text = String(html || '');
  const error = text.match(/id=["']errorText["'][^>]*>([^<]*)</i)?.[1]
    || text.match(/errorText['"][^>]*>([^<]+)/i)?.[1]
    || '';
  console.log(`\n--- ${label} ---`);
  console.log('title:', text.match(/<title>([^<]*)<\/title>/i)?.[1] || '?');
  console.log('verificationCodeInput:', /id=["']verificationCodeInput["']/i.test(text));
  console.log('error:', error || '(brak)');
}

function simulateWebViewMfaOnHtml(html, code) {
  const messages = [];
  const elements = new Map();

  for (const m of String(html).matchAll(/<input[^>]*id=["']([^"']+)["'][^>]*>/gi)) {
    const tag = m[0];
    const id = m[1];
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1] || '';
    const type = tag.match(/type=["']([^"']+)["']/i)?.[1] || 'text';
    elements.set(id, { id, name, type, value: '', tagName: 'INPUT', disabled: false, style: {} });
  }

  const doc = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(sel) {
      if (sel.includes('verificationCodeInput')) return elements.get('verificationCodeInput') || null;
      if (sel.includes('name="VerificationCode"')) {
        for (const el of elements.values()) {
          if (el.name === 'VerificationCode') return el;
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel.includes('verificationCodeInput') || sel.includes('VerificationCode')) {
        const el = this.querySelector('input[name="VerificationCode"]') || elements.get('verificationCodeInput');
        return el ? [el] : [];
      }
      return [];
    },
    getElementById_signIn: elements.get('signInButton')
  };

  const submitBtn = {
    id: 'signInButton',
    type: 'submit',
    name: 'SignIn',
    value: 'Zaloguj',
    disabled: false,
    click() {
      messages.push('CLICK_SIGNIN');
    }
  };
  elements.set('signInButton', submitBtn);

  const window = {
    __usosUjMfaBusy: false,
    ReactNativeWebView: { postMessage: (p) => messages.push(JSON.parse(p)) },
    document: doc,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
  };

  Object.assign(doc, {
    getElementById(id) {
      if (id === 'signInButton') return submitBtn;
      return elements.get(id) || null;
    }
  });

  const input = elements.get('verificationCodeInput');
  if (input && code) {
    input.value = code;
    submitBtn.click();
  }

  return { inputValue: input?.value || '', messages };
}

console.log('=== KROK 1 (jak aplikacja): CAS → ADFS → wybór SMS ===\n');
try {
  await loginToUsosAndFetchIcal({ login, password, mfaCode: '', portalUrl, onPhase: logPhase });
} catch (e) {
  if (e.code !== 'USOS_2FA_REQUIRED') {
    console.error('KROK 1 FAIL:', e.message);
    process.exit(1);
  }
  console.log('KROK 1 OK: USOS_2FA_REQUIRED (pole kodu w aplikacji)\n');
}

const meta = debugUjPendingChallengeMeta();
console.log('Sesja 2FA w pamięci:', meta);

console.log('\n=== KROK 2 (jak „Zaloguj” z kodem w aplikacji): kod testowy', testCode, '===\n');
let afterCode;
try {
  afterCode = await debugUjSubmitSecondFactor(testCode, logPhase);
  writeFileSync(join(scriptsDir, '.uj-after-code.html'), afterCode.html || '');
  writeFileSync(join(scriptsDir, '.uj-login-state.json'), JSON.stringify({ url: afterCode.url, html: afterCode.html }, null, 0));
} catch (e) {
  console.error('KROK 2 FAIL:', e.message);
  process.exit(1);
}

summarizeMfaHtml(afterCode.html, 'Odpowiedź serwera po kodzie');

const sim = simulateWebViewMfaOnHtml(afterCode.html, testCode);
console.log('\nSymulacja WebView (skrypt MFA):');
console.log('  wpisany kod w verificationCodeInput:', sim.inputValue || '(nie trafił)');
console.log('  postMessage:', sim.messages.map((m) => m.state || m.type).join(', ') || '-');

const script = buildUjAdfsMfaScript(testCode);
console.log('\nSkrypt produkcyjny: verificationCodeInput=', script.includes('verificationCodeInput'));
console.log('Skrypt produkcyjny: signInButton=', script.includes('signInButton'));

console.log('\n=== KROK 2b: finalize (iCal) — oczekiwane FAIL przy złym kodzie ===\n');
try {
  const ical = await loginToUsosAndFetchIcal({ login, password, mfaCode: testCode, portalUrl, onPhase: logPhase });
  console.log('Niespodziewany sukces iCal:', ical);
} catch (e) {
  console.log('Wynik finalize:', e.message.slice(0, 200));
}
