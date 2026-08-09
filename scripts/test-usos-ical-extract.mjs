import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { extractUsosIcalUrl, isUsosIcalFeedUrl } = await import(
  pathToFileURL(join(root, 'src/usosIcalExtract.js')).href
);

const exportHtml = readFileSync(join(root, 'scripts/fixtures/usos/eksportuj-plan-sample.html'), 'utf8');
const url = extractUsosIcalUrl(exportHtml, 'https://usosweb.example.edu.pl');

assert.match(url, /services\/tt\/upcoming_ical/);
assert.match(url, /user_id=999001/);
assert.match(url, /key=/);
assert.equal(isUsosIcalFeedUrl(url), true);

console.log('test-usos-ical-extract: ok');
