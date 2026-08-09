/**
 * Testy helperów WebView MFA (bez przeglądarki).
 * node scripts/test-usos-webview-mfa.mjs
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildMfaStepScript,
  isAdfsLoginUrl,
  isKeycloakLoginUrl,
  isMicrosoftEntraLoginUrl,
  isSupportedUsosLoginPageUrl,
  isUsosPortalHostUrl,
  isUsosPortalLoggedInUrl,
  isUsosPortalTicketCallbackUrl,
  isUsosSecondFactorUrl,
  getCollegeLoginStartUrl
} = await import(join(root, 'src/usosWebViewLogin.js'));

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

assert(
  isUsosSecondFactorUrl('https://sts.uj.edu.pl/adfs/ls/?wa=wsignin1.0'),
  'UJ ADFS MFA URL'
);
assert(
  !isUsosSecondFactorUrl('https://cas.usos.pw.edu.pl/cas/login'),
  'PW CAS nie jest MFA'
);
assert(
  getCollegeLoginStartUrl('https://www.usosweb.uj.edu.pl').includes('cas.uj.edu.pl'),
  'UJ start URL przez CAS'
);
assert(
  getCollegeLoginStartUrl('https://usosweb.usos.pw.edu.pl').includes('cas.usos.pw.edu.pl'),
  'PW start URL przez CAS'
);
assert(
  getCollegeLoginStartUrl('https://usosweb.umcs.pl').includes('login.umcs.pl'),
  'UMCS start URL przez login.umcs.pl'
);
assert(
  getCollegeLoginStartUrl('https://usosweb.amu.edu.pl').startsWith('https://cas.amu.edu.pl/cas/login'),
  'UAM start URL bezpośrednio przez cas.amu.edu.pl'
);
assert(
  isUsosPortalHostUrl(
    'https://usosweb.usos.pw.edu.pl/kontroler.php?_action=logowaniecas/index&ticket=ST-1',
    'https://usosweb.usos.pw.edu.pl'
  ),
  'PW portal host po CAS'
);
assert(
  isUsosPortalTicketCallbackUrl(
    'https://usosweb.usos.pw.edu.pl/kontroler.php?_action=logowaniecas/index&ticket=ST-1'
  ),
  'PW ticket callback wykrywany'
);
assert(
  !isUsosPortalLoggedInUrl(
    'https://usosweb.usos.pw.edu.pl/kontroler.php?_action=logowaniecas/index&ticket=ST-1',
    'https://usosweb.usos.pw.edu.pl'
  ),
  'PW ticket callback nie uruchamia iCal przed handshake'
);
assert(
  isUsosPortalLoggedInUrl(
    'https://usosweb.usos.pw.edu.pl/kontroler.php?_action=home/plan',
    'https://usosweb.usos.pw.edu.pl'
  ),
  'PW plan uznawany za zalogowany'
);

const script = buildMfaStepScript('123456', 'https://sts.uj.edu.pl/adfs/ls/', 'https://www.usosweb.uj.edu.pl');
assert(script.includes('123456'), 'skrypt zawiera kod');
assert(script.includes('usos-mfa'), 'skrypt wysyła postMessage MFA');
assert(script.includes('verificationOption'), 'skrypt szuka opcji SMS UJ');
assert(script.includes('verificationCodeInput'), 'skrypt UJ trafia w pole kodu (nie etykietę)');
assert(script.includes('signInButton'), 'skrypt UJ klika signInButton');
assert(!script.includes('#verificationCode,'), 'skrypt nie myli etykiety verificationCode z polem');

const { buildCasAutofillScript } = await import(join(root, 'src/usosWebViewLogin.js'));
const {
  buildGenericAdfsAutofillScript,
  buildKeycloakAutofillScript,
  buildMicrosoftEntraAutofillScript
} = await import(join(root, 'src/usosWebViewLogin.js'));
const sampleLogin = 'student@example.edu.pl';
const samplePassword = 'example-password';
const casScript = buildCasAutofillScript(sampleLogin, samplePassword);
assert(casScript.includes('form_submitted'), 'CAS wysyła potwierdzenie wysłania formularza');
assert(casScript.includes('form_missing'), 'CAS zgłasza brak formularza po retry');
assert(casScript.includes('setInterval'), 'CAS ponawia wypełnianie formularza');
assert(casScript.includes(sampleLogin), 'CAS wstawia login');
assert(isMicrosoftEntraLoginUrl('https://login.microsoftonline.com/common/oauth2/authorize'), 'Microsoft Entra URL wykrywany');
assert(isKeycloakLoginUrl('https://logowanie.uksw.edu.pl/realms/UKSW/protocol/cas/login'), 'Keycloak CAS URL wykrywany');
assert(isAdfsLoginUrl('https://sts.wat.edu.pl/adfs/oauth2/authorize/'), 'ADFS URL wykrywany');
assert(isSupportedUsosLoginPageUrl('https://cas.amu.edu.pl/cas/login'), 'CAS URL jest obsługiwany przez autofill');
assert(isSupportedUsosLoginPageUrl('https://login.microsoftonline.com/common/login'), 'Microsoft Entra URL uruchamia autofill');
assert(isSupportedUsosLoginPageUrl('https://login.awf.wroc.pl/auth/realms/AWF/login-actions/authenticate'), 'Keycloak authenticate URL uruchamia autofill');
assert(isSupportedUsosLoginPageUrl('https://sts.wat.edu.pl/adfs/ls/'), 'ADFS URL uruchamia autofill');
assert(casScript.includes('#username'), 'CAS obsługuje pole username UAM');
assert(casScript.includes('#password'), 'CAS obsługuje pole password UAM');
assert(casScript.includes('#fm1'), 'CAS obsługuje formularz fm1 UAM');
assert(casScript.includes('button[type="submit"]'), 'CAS klika standardowy przycisk submit UAM');
assert(casScript.includes('input[name="j_username"]'), 'CAS obsługuje pole j_username');
assert(casScript.includes('input[name="login"]'), 'CAS obsługuje pole login');
assert(casScript.includes('input[type="email"]'), 'CAS obsługuje pole email');
assert(casScript.includes('input[type="password"]'), 'CAS obsługuje dowolne pole password');

const msScript = buildMicrosoftEntraAutofillScript(sampleLogin, samplePassword);
assert(msScript.includes('#i0116'), 'Microsoft Entra skrypt szuka pola loginu');
assert(msScript.includes('#i0118'), 'Microsoft Entra skrypt szuka pola hasła');
assert(msScript.includes('username_submitted'), 'Microsoft Entra raportuje krok username');

const keycloakScript = buildKeycloakAutofillScript(sampleLogin, samplePassword);
assert(keycloakScript.includes('#kc-login'), 'Keycloak skrypt klika kc-login');
assert(keycloakScript.includes('username_submitted'), 'Keycloak obsługuje krok username-only');

const adfsScript = buildGenericAdfsAutofillScript(sampleLogin, samplePassword);
assert(adfsScript.includes('#userNameInput'), 'ADFS skrypt szuka userNameInput');
assert(adfsScript.includes('#passwordInput'), 'ADFS skrypt szuka passwordInput');

try {
  // eslint-disable-next-line no-new-func
  new Function(script.replace(/; true;$/, ''));
  assert(true, 'skrypt MFA jest poprawnym JS');
} catch (error) {
  assert(false, `skrypt MFA nieparsowalny: ${error.message}`);
}

if (failed) {
  console.error(`\n${failed} test(ów) nie przeszło.`);
  process.exit(1);
}

console.log('\nWszystkie testy helperów WebView MFA przeszły.');
console.log('Pełny flow 2FA w WebView wymaga aplikacji mobilnej (Expo/React Native).');
