import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  extractPdfCandidatesFromHtml,
  pickBestPdfCandidate,
  resolvePollubPlansPageUrl,
  scorePdfCandidate
} from '../src/pollubPlanDiscoveryCore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function wmStudyInfo(overrides = {}) {
  return {
    faculty: 'Wydział Mechaniczny Politechniki Lubelskiej',
    program: 'Mechatronika',
    studyKind: 'I stopnia',
    studySystem: 'stacjonarne',
    yearInProgram: 2,
    semesterInYear: 3,
    ...overrides
  };
}

const wmPageUrl = resolvePollubPlansPageUrl(wmStudyInfo());
assert.equal(wmPageUrl, 'https://wm.pollub.pl/studenci/plany-zajec');

const wmHtml = loadFixture('wm-plany-zajec.html');
const wmCandidates = extractPdfCandidatesFromHtml(wmHtml, wmPageUrl);
assert.ok(wmCandidates.some((item) => item.filename === 'mt1_2_rok_v4-1.pdf'));

const wmBest = pickBestPdfCandidate(wmCandidates, wmStudyInfo());
assert.equal(wmBest?.filename, 'mt1_2_rok_v4-1.pdf');

const wmWrongProgram = pickBestPdfCandidate(wmCandidates, wmStudyInfo({ program: 'Transport', yearInProgram: 2 }));
assert.equal(wmWrongProgram?.filename, 'tr1_2_rok_v2.pdf');

const wmitPageUrl = resolvePollubPlansPageUrl({
  faculty: 'Wydział Matematyki i Informatyki Technicznej',
  program: 'Informatyka'
});
assert.equal(wmitPageUrl, 'https://wmit.pollub.pl/studenci/rozklady-zajec');

const wmitHtml = loadFixture('wmit-rozklady-zajec.html');
const wmitCandidates = extractPdfCandidatesFromHtml(wmitHtml, wmitPageUrl);
const wmitBest = pickBestPdfCandidate(wmitCandidates, {
  faculty: 'Wydział Matematyki i Informatyki Technicznej',
  program: 'Informatyka stosowana',
  studyKind: 'I stopnia',
  studySystem: 'stacjonarne',
  yearInProgram: 2
});
assert.ok(wmitBest?.filename.includes('2_rok'));
assert.ok(!/grupy/i.test(wmitBest.filename));

const ignoredScore = scorePdfCandidate(
  { filename: 'terminy_zjazdow.pdf', linkText: '', context: 'Mechatronika' },
  wmStudyInfo()
);
assert.ok(ignoredScore < 0);

console.log('pollub plan discovery tests passed');
