/**
 * Pobiera wybrane strony USOS po zalogowaniu i zapisuje HTML do scripts/.usos-discovery/
 *
 * Wymaga: USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');
const outDir = join(scriptsDir, '.usos-discovery');

const { establishUsosPortalSession, fetchUsosAuthenticatedPage } = await import(join(root, 'src/usosClient.js'));

const { login, password, portalUrl } = usosCredentialsFromEnv();
if (!portalUrl) {
  console.error('Ustaw USOS_PORTAL_URL.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const session = await establishUsosPortalSession({
  login,
  password,
  portalUrl,
  onPhase: (p) => console.log(p)
});

const pages = [
  'kontroler.php?_action=home/index',
  'kontroler.php?_action=dla_stud/studia/grupyDziekanskie',
  'kontroler.php?_action=katalog2/osoby/pokazOsobe'
];

for (const action of pages) {
  const { html, url } = await fetchUsosAuthenticatedPage(session, action);
  const safe = action.replace(/[^a-z0-9]+/gi, '_');
  writeFileSync(join(outDir, `${safe}.html`), html);
  const profileLinks = [...html.matchAll(/href=["']([^"']*(?:profil|osob|katalog2)[^"']*)["']/gi)].map((m) => m[1]);
  console.log('\n', action);
  console.log('url', url);
  console.log('profile links', profileLinks.slice(0, 8));
}
