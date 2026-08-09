import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'scripts/fixtures/usos');
const { buildUsosStudentProfileFromHtml } = await import(
  pathToFileURL(join(root, 'src/usosStudentProfile.js')).href
);

const homeHtml = readFileSync(join(fixturesDir, 'home-index-sample.html'), 'utf8');
const grupyHtml = readFileSync(join(fixturesDir, 'grupy-dziekanskie-sample.html'), 'utf8');

const profile = buildUsosStudentProfileFromHtml({
  homeHtml,
  grupyHtml,
  portalUrl: 'https://usosweb.example.edu.pl',
  login: 'student@example.edu.pl'
});

assert.equal(profile.fullName, 'Jan Testowy');
assert.equal(profile.albumNumber, '123456');
assert.match(profile.university, /Politechnika Przykładowa/i);
assert.match(profile.faculty, /Mechaniczny/i);
assert.match(profile.program, /Lotnictwo i Kosmonautyka/i);
assert.equal(profile.degreeLevel, 'I stopień');
assert.equal(profile.studyMode, 'stacjonarne');
assert.equal(profile.semester, 'rok akademicki 2025/2026, sem. letni');
assert.match(profile.group, /Lotnictwo/i);

console.log('test-usos-student-profile: ok');
