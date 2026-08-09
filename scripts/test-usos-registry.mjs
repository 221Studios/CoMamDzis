import {
  resolveUsosPortalUrl,
  usosUniversityForLogin,
  listUsosUniversities,
  guessUsosPortalUrlFromEmail
} from '../src/usosRegistry.js';

let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    failed += 1;
  } else {
    console.log('OK:', message);
  }
}

const all = listUsosUniversities();
assert(all.length >= 65, `rejestr ma ${all.length} zweryfikowanych uczelni (>= 65)`);

assert(
  usosUniversityForLogin('jan@pw.edu.pl')?.portalUrl === 'https://usosweb.usos.pw.edu.pl',
  'PW z domeny pw.edu.pl'
);
assert(
  usosUniversityForLogin('jan@student.uw.edu.pl')?.portalUrl === 'https://usosweb.uw.edu.pl',
  'UW z student.uw.edu.pl'
);
assert(
  usosUniversityForLogin('jan@at.edu.pl')?.portalUrl === 'https://usosweb.at.edu.pl',
  'AT z at.edu.pl'
);
assert(
  usosUniversityForLogin('jan@umcs.pl')?.portalUrl === 'https://usosweb.umcs.pl',
  'UMCS'
);
assert(
  resolveUsosPortalUrl('jan@uj.edu.pl') === 'https://www.usosweb.uj.edu.pl',
  'UJ portal'
);
assert(
  guessUsosPortalUrlFromEmail('jan@nowa.edu.pl') === 'https://usosweb.nowa.edu.pl',
  'heurystyka dla nieznanej domeny'
);

if (failed) {
  console.error(`\n${failed} test(ów) nie przeszło.`);
  process.exit(1);
}

console.log(`\nWszystkie testy rejestru USOS przeszły (${all.length} uczelni).`);
