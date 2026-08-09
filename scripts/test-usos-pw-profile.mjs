/**
 * Test profilu studenta USOS — parser na fixture + opcjonalnie pobranie na żywo.
 *
 * Parser (bez sieci): zawsze uruchamiany na scripts/fixtures/usos/
 * Na żywo: wymaga USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { hasUsosCredentials, usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');
const fixturesDir = join(scriptsDir, 'fixtures/usos');

const { buildUsosStudentProfileFromHtml } = await import(join(root, 'src/usosStudentProfile.js'));
const { establishUsosPortalSession, fetchUsosStudentProfileFromSession } = await import(
  join(root, 'src/usosClient.js')
);

const portalUrl = 'https://usosweb.example.edu.pl';
const fixtureLogin = 'student@example.edu.pl';

console.log('=== Parser na fixture (bez sieci) ===');
const homeHtml = readFileSync(join(fixturesDir, 'home-index-sample.html'), 'utf8');
const grupyHtml = readFileSync(join(fixturesDir, 'grupy-dziekanskie-sample.html'), 'utf8');
console.log(
  JSON.stringify(
    buildUsosStudentProfileFromHtml({ homeHtml, grupyHtml, portalUrl, login: fixtureLogin }),
    null,
    2
  )
);

if (!hasUsosCredentials()) {
  console.log('\nPominięto pobranie na żywo (brak USOS_LOGIN / USOS_PASSWORD).');
  process.exit(0);
}

const { login, password, portalUrl: livePortal } = usosCredentialsFromEnv();
if (!livePortal) {
  console.error('Ustaw USOS_PORTAL_URL dla testu na żywo.');
  process.exit(1);
}

console.log('\n=== Pobranie na żywo ===');
const session = await establishUsosPortalSession({
  login,
  password,
  portalUrl: livePortal,
  onPhase: (p) => console.log(p)
});
const live = await fetchUsosStudentProfileFromSession(session, { login, onPhase: (p) => console.log(p) });
console.log(JSON.stringify(live, null, 2));
