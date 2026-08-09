import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const {
  buildUsosStudentProfileFromHtml,
  formatUsosSemesterLabel,
  parseUsosGrupyDziekanskie,
  parseUsosGrupyZajeciowe,
  parseUsosRankingSemester
} = await import(pathToFileURL(join(root, 'src/usosStudentProfile.js')).href);

assert.equal(formatUsosSemesterLabel({ semesterNumber: 4, term: 'letni' }), 'II rok, semestr 4, letni');
assert.equal(formatUsosSemesterLabel({ semesterNumber: 2, term: 'letni' }), 'I rok, semestr 2, letni');

const rankingSample =
  'LK, j. pol., sem. 4, st. rektora 2026L [1130-2026L-REK-LK000-S4-ISP-113C] Mój wynik: 4.27';
const ranking = parseUsosRankingSemester(rankingSample);
assert.equal(ranking.semNumber, 4);
assert.equal(ranking.cycle.code, '2026L');
assert.equal(ranking.term, 'letni');

const grupyZajecioweHtml = `
<h2>Grupy, których jestem uczestnikiem</h2>
<ul class="no-bullets">
  <li>
    <span class="screen-reader-only">rok akademicki 2025/2026 - sem. letni</span>
    <ul class="no-bullets lista-zajec">
      <li>
        <span class='note'>2026L</span>
        <span class='note'>1130-LK000-ISP-4001</span>
        Aerodynamika 1
      </li>
      <li>
        <span class='note'>2026L</span>
        <span class='note'>1130-LK000-ISP-4002</span>
        Astronautyka
      </li>
    </ul>
  </li>
  <li>
    <span class="screen-reader-only">rok akademicki 2025/2026 - sem. zimowy</span>
    <ul class="no-bullets lista-zajec">
      <li>
        <span class='note'>2025Z</span>
        <span class='note'>1130-00000-ISP-3001</span>
        Analiza 3
      </li>
    </ul>
  </li>
</ul>`;

const grupyZajeciowe = parseUsosGrupyZajeciowe(grupyZajecioweHtml);
assert.equal(grupyZajeciowe.term, 'letni');
assert.equal(grupyZajeciowe.semNumber, 4);
assert.equal(grupyZajeciowe.semester, 'rok akademicki 2025/2026, sem. letni');
assert.equal(grupyZajeciowe.cycle.code, '2026L');

const grupyHtml = `
<usos-frame>
  <h2 slot="title">Lotnictwo i Kosmonautyka</h2>
  <ul class="no-bullets separated">
    <li>
      <div><span class="font-medium">Grupa dziekańska</span>: Grupa 4 [4.1-LK-ISP-S2-2025L]</div>
      <div><span class="font-medium">Cykl</span>: 2025L</div>
      <div><span class="font-medium">Etap</span>:
        <a>sem. 2, Lotnictwo i Kosmonautyka, studia stacjonarne I stopnia [LK000-S2-ISP-1130]</a>
      </div>
    </li>
  </ul>
</usos-frame>`;

const grupy = parseUsosGrupyDziekanskie(grupyHtml);
assert.equal(grupy.semNumber, 2);
assert.equal(grupy.semester, 'I rok, semestr 2, letni');

const merged = buildUsosStudentProfileFromHtml({
  homeHtml: '',
  grupyHtml,
  grupyZajecioweHtml,
  rankingHtml: rankingSample
});
assert.equal(merged.semester, 'rok akademicki 2025/2026, sem. letni');

const grupyOnly = buildUsosStudentProfileFromHtml({ homeHtml: '', grupyHtml });
assert.equal(grupyOnly.semester, 'I rok, semestr 2, letni');

const { shouldRefreshUsosStudentProfile, sanitizeUsosSemesterValue } = await import(pathToFileURL(join(root, 'src/usosStudentProfile.js')).href);
assert.equal(sanitizeUsosSemesterValue('Semestr'), '');
assert.equal(shouldRefreshUsosStudentProfile({ semester: 'Semestr', fullName: 'A', university: 'B', faculty: 'C', program: 'D' }), true);
assert.equal(shouldRefreshUsosStudentProfile({ semester: 'I rok, semestr 2, letni', fullName: 'A', university: 'B', faculty: 'C', program: 'D' }), true);
assert.equal(shouldRefreshUsosStudentProfile({ semester: 'rok akademicki 2025/2026, sem. letni', fullName: 'A', university: 'B', faculty: 'C', program: 'D' }), false);
assert.equal(shouldRefreshUsosStudentProfile({ semester: 'rok akademicki 2025/2026, sem. letni', fullName: 'A', university: 'B', faculty: 'C', program: 'D' }), false);

console.log('test-usos-semester-profile: ok');
