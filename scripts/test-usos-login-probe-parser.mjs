import {
  buildLoginFormBody,
  detectChallengeOrRateLimit,
  detectInvalidLoginMessage,
  findLoginForm,
  getUsosLoginStartUrl,
  syntheticLoginForUniversity
} from './lib/usos-login-probe.mjs';

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

const casHtml = `
  <html>
    <body>
      <form id="fm1" action="/cas/login?service=https%3A%2F%2Fusosweb.example.edu.pl" method="post">
        <input type="hidden" name="execution" value="e1s1">
        <input type="hidden" name="_eventId" value="submit">
        <input id="username" name="username" type="text">
        <input id="password" name="password" type="password">
        <input name="submit" type="submit" value="ZALOGUJ">
      </form>
    </body>
  </html>
`;

const adfsHtml = `
  <html>
    <body>
      <form id="loginForm" action="/adfs/ls/" method="post">
        <input id="userNameInput" name="UserName" type="email">
        <input id="passwordInput" name="Password" type="password">
        <input id="submitButton" type="submit" name="SignIn" value="Zaloguj">
      </form>
    </body>
  </html>
`;

const casForm = findLoginForm(casHtml, 'https://cas.example.edu.pl/cas/login');
assert(casForm?.usernameName === 'username', 'CAS: wykrywa pole username');
assert(casForm?.passwordName === 'password', 'CAS: wykrywa pole password');
assert(casForm?.action === 'https://cas.example.edu.pl/cas/login?service=https%3A%2F%2Fusosweb.example.edu.pl', 'CAS: absolutyzuje action');

const casBody = buildLoginFormBody(casForm, 'test@example.edu.pl', 'test');
assert(casBody.get('username') === 'test@example.edu.pl', 'CAS: body zawiera login');
assert(casBody.get('password') === 'test', 'CAS: body zawiera hasło');
assert(casBody.get('execution') === 'e1s1', 'CAS: body zachowuje hidden execution');
assert(casBody.get('_eventId') === 'submit', 'CAS: body zachowuje hidden _eventId');

const adfsForm = findLoginForm(adfsHtml, 'https://sts.example.edu.pl/adfs/ls/');
assert(adfsForm?.usernameName === 'UserName', 'ADFS: wykrywa pole UserName');
assert(adfsForm?.passwordName === 'Password', 'ADFS: wykrywa pole Password');
assert(buildLoginFormBody(adfsForm, 'probe@example.edu.pl', 'test').get('SignIn') === 'Zaloguj', 'ADFS: dołącza submit');

const invalidPl = detectInvalidLoginMessage('<div class="errors">Nieprawidłowy login lub hasło.</div>');
assert(invalidPl.matched, 'wykrywa polski komunikat nieprawidłowego loginu');

const invalidEn = detectInvalidLoginMessage('<div class="message-body">Authentication failed. Invalid credentials.</div>');
assert(invalidEn.matched, 'wykrywa angielski komunikat invalid credentials');

const captcha = detectChallengeOrRateLimit('<p>Too many attempts. Complete reCAPTCHA.</p>');
assert(Boolean(captcha), 'wykrywa CAPTCHA/rate-limit');

assert(
  getUsosLoginStartUrl('https://usosweb.usos.pw.edu.pl').startsWith('https://cas.usos.pw.edu.pl/cas/login'),
  'PW: start przez cas.usos.pw.edu.pl'
);
assert(
  getUsosLoginStartUrl('https://usosweb.uj.edu.pl').startsWith('https://cas.uj.edu.pl/cas/login'),
  'UJ: start przez cas.uj.edu.pl'
);
assert(
  getUsosLoginStartUrl('https://usosweb.umcs.pl').startsWith('https://login.umcs.pl/login'),
  'UMCS: start przez login.umcs.pl'
);
assert(
  getUsosLoginStartUrl('https://usosweb.amu.edu.pl').startsWith('https://cas.amu.edu.pl/cas/login'),
  'UAM: start bezpośrednio przez cas.amu.edu.pl'
);

const login = syntheticLoginForUniversity({
  id: 'pw-edu-pl',
  portalHost: 'usosweb.usos.pw.edu.pl',
  domains: ['usos.pw.edu.pl', 'pw.edu.pl']
});
assert(login === 'comamdzi_probe.pw.edu.pl@usos.pw.edu.pl', 'syntetyczny login używa domeny uczelni');

if (failed) {
  console.error(`\n${failed} test(ów) nie przeszło.`);
  process.exit(1);
}

console.log('\nWszystkie testy parsera probe USOS przeszły.');
