/**
 * Odkrywa strony USOSweb z danymi studenta po zalogowaniu.
 *
 * Wymaga zmiennych środowiskowych:
 *   USOS_LOGIN, USOS_PASSWORD
 *   USOS_PORTAL_URL (opcjonalnie)
 *
 * node --import ./scripts/node-react-native-stub.mjs scripts/discover-usos-student-pages.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptsDir, '..');
const outDir = join(scriptsDir, '.usos-discovery');

const {
  establishUsosPortalSession,
  fetchUsosAuthenticatedPage
} = await import(join(root, 'src/usosClient.js'));
const { parseHtmlStudentProfile } = await import(join(root, 'src/studentProfile.js'));

const { login, password, portalUrl } = usosCredentialsFromEnv({
  portalFallback: 'https://usosweb.uw.edu.pl'
});

if (!portalUrl) {
  console.error('Ustaw USOS_PORTAL_URL (adres USOSweb uczelni).');
  process.exit(1);
}

const CANDIDATE_ACTIONS = [
  'kontroler.php?_action=home/index',
  'kontroler.php?_action=news/default',
  'kontroler.php?_action=home/plan',
  'kontroler.php?_action=dla_stud/studia/index',
  'kontroler.php?_action=dla_stud/studia/status',
  'kontroler.php?_action=dla_stud/studia/programy',
  'kontroler.php?_action=dla_stud/kontakt/index',
  'kontroler.php?_action=dla_stud/kontakt/edycja',
  'kontroler.php?_action=konto/index',
  'kontroler.php?_action=konto/profil',
  'kontroler.php?_action=konto/dane',
  'kontroler.php?_action=info/student/index',
  'kontroler.php?_action=info/student/dane',
  'kontroler.php?_action=info/student/status',
  'kontroler.php?_action=common/profile/index',
  'kontroler.php?_action=common/profile/edit',
  'kontroler.php?_action=dla_stud/studia/grupy/index'
];

mkdirSync(outDir, { recursive: true });

function extractActionLinks(html) {
  const links = new Set();
  const re = /_action=([a-z0-9_/]+)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const action = m[1].split('&')[0];
    if (/profil|kontakt|student|studia|konto|dane|status|program|grupa|album|indeks|osob/i.test(action)) {
      links.add(`kontroler.php?_action=${action}`);
    }
  }
  return [...links];
}

function scoreProfile(parsed) {
  return Object.values(parsed).filter((v) => String(v || '').trim()).length;
}

console.log('Portal:', portalUrl, '| login:', login);
const session = await establishUsosPortalSession({
  login,
  password,
  portalUrl,
  onPhase: (p) => console.log(' ', p)
});

const discoveredLinks = new Set(extractActionLinks(session.html));
const results = [];

for (const action of [...new Set([...CANDIDATE_ACTIONS, ...discoveredLinks])]) {
  try {
    const page = await fetchUsosAuthenticatedPage(session, action);
    const parsed = parseHtmlStudentProfile(page.html);
    const score = scoreProfile(parsed);
    const title = page.html.match(/<title>([^<]*)<\/title>/i)?.[1] || '';
    const loginWall = /login-url=["']|logowaniecas/i.test(page.html) && !/wyloguj/i.test(page.html);

    extractActionLinks(page.html).forEach((l) => discoveredLinks.add(l));

    results.push({ action, title, score, loginWall, parsed });
    if (score > 0 && !loginWall) {
      const safe = action.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
      writeFileSync(join(outDir, `${safe}.json`), JSON.stringify({ parsed, title, url: page.url }, null, 2));
    }
    console.log(
      `${loginWall ? 'WALL' : score > 0 ? 'DATA' : '----'} [${score}] ${action}`,
      title.slice(0, 55),
      score > 0 ? JSON.stringify(parsed) : ''
    );
  } catch (e) {
    console.log('ERR ', action, e.message);
  }
}

const best = [...results].filter((r) => !r.loginWall).sort((a, b) => b.score - a.score);
console.log('\nTop strony:');
best.slice(0, 5).forEach((r) => console.log(`  [${r.score}] ${r.action}`, JSON.stringify(r.parsed)));

writeFileSync(
  join(outDir, 'summary.json'),
  JSON.stringify({ portalUrl, login, results, discoveredLinks: [...discoveredLinks] }, null, 2)
);
console.log('\nZapisano:', outDir);
