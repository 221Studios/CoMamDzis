import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import registry from '../src/data/usosUniversities.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEDICATED_UNIVERSITIES = [
  {
    name: 'Collegium Da Vinci',
    integration: 'CDV (Wirtualna Uczelnia)',
    portal: 'https://wu.cdv.pl/?login=1',
    detection: 'login @edu.cdv.pl lub @cdv.pl'
  },
  {
    name: 'Uniwersytet WSB Merito',
    integration: 'Merito Go',
    portal: 'https://meritogo.pl/',
    detection: 'domeny merito.pl / wsb.pl, krótkie loginy studenckie'
  },
  {
    name: 'Wyższa Szkoła Zarządzania i Prawa (WSZiP)',
    integration: 'Moodle + PDF',
    portal: 'https://mdl.wszip.poznan.pl/',
    detection: 'domeny wszip.pl, wszip.poznan.pl'
  },
  {
    name: 'Politechnika Lubelska',
    integration: 'eHMS + PDF wydziału',
    portal: 'https://ehms.pollub.pl/standard/',
    detection: 'login 6-cyfrowy, ehms.pollub, pollub.edu.pl'
  },
  {
    name: 'Wyższa Szkoła Edukacji i Terapii (WSEIT)',
    integration: 'Wirtualny Dziekanat',
    portal: 'https://wd.wseit.pl/Logowanie',
    detection: 'krótki login studencki (np. zk40), domeny wseit.pl'
  }
];

const usosUniversities = registry.universities || [];
const generatedAt = new Date().toISOString().slice(0, 10);
const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo.version;

function writeFile(relativePath, content) {
  const target = path.join(ROOT, relativePath);
  fs.writeFileSync(target, content, 'utf8');
  console.log(`Wrote ${relativePath}`);
}

const supportedLines = [
  'CoMamDziś — obsługiwane uczelnie',
  `Wygenerowano: ${generatedAt}`,
  `Wersja aplikacji: ${appVersion}`,
  'Źródło: src/data/usosUniversities.js, src/schoolConfig.js',
  '',
  `Łącznie: ${usosUniversities.length + DEDICATED_UNIVERSITIES.length} uczelni`,
  `  - ${DEDICATED_UNIVERSITIES.length} integracji dedykowanych (poza rejestrem USOS)`,
  `  - ${usosUniversities.length} uczelni USOS (w tym Wojskowa Akademia Techniczna)`,
  '',
  '=== Integracje dedykowane (poza USOS) ===',
  ''
];

for (const university of DEDICATED_UNIVERSITIES) {
  supportedLines.push(university.name);
  supportedLines.push(`  Integracja: ${university.integration}`);
  supportedLines.push(`  Portal:     ${university.portal}`);
  supportedLines.push(`  Wykrywanie: ${university.detection}`);
  supportedLines.push('');
}

supportedLines.push('=== Uczelnie USOS ===', '');
for (const university of usosUniversities) {
  supportedLines.push(university.name);
}

writeFile('lista_uczelni_obslugiwane.txt', `${supportedLines.join('\n')}\n`);

const usosCompleteLines = [
  'KOMPLETNA BAZA UCZELNI KORZYSTAJĄCYCH Z USOSWEB',
  '='.repeat(80),
  `Wygenerowano: ${generatedAt} | Liczba: ${usosUniversities.length}`,
  `Źródło rejestru: ${registry.generatedAt || 'brak daty'}`,
  ''
];

for (const university of usosUniversities) {
  usosCompleteLines.push(`Instytucja: ${university.name}`);
  usosCompleteLines.push(`Domena:     ${university.portalHost}`);
  usosCompleteLines.push(`URL:        ${university.portalUrl}`);
  usosCompleteLines.push('-'.repeat(80));
}

writeFile('lista_usos_kompletna.txt', `${usosCompleteLines.join('\n')}\n`);

const usosApiLines = [
  'Potwierdzone, aktywne instalacje systemu USOS oraz endpointy API w Polsce',
  '='.repeat(80),
  `Wygenerowano: ${generatedAt} | Liczba: ${usosUniversities.length}`,
  `Źródło rejestru: ${registry.generatedAt || 'brak daty'}`,
  ''
];

for (const university of usosUniversities) {
  usosApiLines.push(`Instytucja: ${university.name}`);
  usosApiLines.push(`USOSweb:    ${university.portalUrl}`);
  usosApiLines.push(university.apiBaseUrl ? `USOS API:   ${university.apiBaseUrl}` : 'USOS API:');
  usosApiLines.push('-'.repeat(80));
}

writeFile('lista_usos_z_api.txt', `${usosApiLines.join('\n')}\n`);
