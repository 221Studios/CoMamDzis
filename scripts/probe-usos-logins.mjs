#!/usr/bin/env node
/**
 * Masowy probe USOS:
 * - sprawdza odpowiedź portalu,
 * - sprawdza endpoint API, jeśli jest w rejestrze,
 * - przechodzi do strony CAS/logowania i wykrywa formularz,
 * - opcjonalnie wysyła syntetyczne, nieistniejące dane i oczekuje komunikatu błędnego logowania.
 *
 * Domyślnie nie wysyła formularzy. Realny POST do stron logowania wymaga flagi:
 *   node scripts/probe-usos-logins.mjs --submit-invalid-login
 */
import {
  listProbeUniversities,
  probeUniversities,
  summarizeProbeResults,
  writeProbeReports
} from './lib/usos-login-probe.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.invalidLoginPrefix.includes('@')) {
  console.error('Prefix loginu nie może zawierać @. Skrypt sam dobiera domenę uczelni.');
  process.exit(1);
}

let universities = listProbeUniversities();
if (args.only) {
  const only = new Set(args.only.split(',').map((id) => id.trim()).filter(Boolean));
  universities = universities.filter((university) => only.has(university.id) || only.has(university.portalHost));
}
if (args.limit) {
  universities = universities.slice(0, args.limit);
}

if (!universities.length) {
  console.error('Brak uczelni do sprawdzenia.');
  process.exit(1);
}

console.log(`USOS probe: ${universities.length} uczelni`);
console.log(`Submit invalid login: ${args.submitInvalidLogin ? 'tak' : 'nie (tylko formularz)'}`);
console.log(`Concurrency: ${args.concurrency}, timeout: ${args.timeoutMs} ms, delay: ${args.delayMs} ms`);
console.log('');

const results = await probeUniversities(universities, {
  submitInvalidLogin: args.submitInvalidLogin,
  invalidLoginPrefix: args.invalidLoginPrefix,
  invalidPassword: args.invalidPassword,
  concurrency: args.concurrency,
  timeoutMs: args.timeoutMs,
  delayMs: args.delayMs,
  onResult(result, index) {
    const api = result.api.skipped ? 'api:-' : `api:${result.api.ok ? 'ok' : 'fail'}(${result.api.status || result.api.error || 0})`;
    const submit = result.submit.attempted
      ? `submit:${result.submit.authFailed ? 'auth_failed' : 'check'}`
      : 'submit:-';
    console.log(
      `[${String(index + 1).padStart(3, ' ')}/${universities.length}] `
      + `${result.ok ? 'OK   ' : 'CHECK'} `
      + `${result.id} portal:${result.portal.ok ? 'ok' : 'fail'}(${result.portal.status || result.portal.error || 0}) `
      + `${api} form:${result.loginPage.formFound ? 'ok' : 'fail'} ${submit}`
    );
  }
});

const summary = summarizeProbeResults(results);
const paths = writeProbeReports(results, summary, args.outDir);

console.log('');
console.log('Podsumowanie:');
console.log(`- Portal OK: ${summary.portalOk}/${summary.count}`);
console.log(`- API OK: ${summary.apiOk}/${summary.apiTotal}`);
console.log(`- Formularz logowania: ${summary.formFound}/${summary.count}`);
console.log(`- Submit wykonany: ${summary.submitted}/${summary.count}`);
console.log(`- Komunikat błędnego logowania: ${summary.authFailed}/${summary.submitted}`);
if (summary.challenge) {
  console.log(`- CAPTCHA/rate-limit/challenge: ${summary.challenge}`);
}
console.log(`- JSON: ${paths.jsonPath}`);
console.log(`- MD: ${paths.mdPath}`);

if (args.submitInvalidLogin && summary.authFailed !== summary.submitted) {
  process.exitCode = 2;
} else if (summary.formFound !== summary.count) {
  process.exitCode = 2;
}

function parseArgs(argv) {
  const parsed = {
    submitInvalidLogin: false,
    invalidLoginPrefix: 'comamdzi_probe',
    invalidPassword: 'test',
    concurrency: 2,
    timeoutMs: 20000,
    delayMs: 750,
    limit: 0,
    only: '',
    outDir: undefined,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--submit-invalid-login') parsed.submitInvalidLogin = true;
    else if (arg === '--login-prefix') parsed.invalidLoginPrefix = argv[++i] || parsed.invalidLoginPrefix;
    else if (arg === '--password') parsed.invalidPassword = argv[++i] || parsed.invalidPassword;
    else if (arg === '--concurrency') parsed.concurrency = Math.max(1, Number(argv[++i] || parsed.concurrency));
    else if (arg === '--timeout-ms') parsed.timeoutMs = Math.max(1000, Number(argv[++i] || parsed.timeoutMs));
    else if (arg === '--delay-ms') parsed.delayMs = Math.max(0, Number(argv[++i] || parsed.delayMs));
    else if (arg === '--limit') parsed.limit = Math.max(0, Number(argv[++i] || 0));
    else if (arg === '--only') parsed.only = argv[++i] || '';
    else if (arg === '--out-dir') parsed.outDir = argv[++i] || undefined;
    else {
      console.error(`Nieznany argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/probe-usos-logins.mjs [options]

Options:
  --submit-invalid-login       Wysyła syntetyczne dane i oczekuje błędu logowania.
  --login-prefix PREFIX        Prefix lokalnej części syntetycznego e-maila.
  --password PASSWORD          Hasło testowe, domyślnie: test.
  --concurrency N              Równoległość, domyślnie: 2.
  --timeout-ms N               Timeout jednego requestu, domyślnie: 20000.
  --delay-ms N                 Pauza po każdym probe w workerze, domyślnie: 750.
  --limit N                    Sprawdza pierwsze N uczelni.
  --only ID[,ID]               Sprawdza wybrane id lub hosty z rejestru.
  --out-dir PATH               Katalog raportu, domyślnie scripts/.usos-login-probe.

Przykłady:
  node scripts/probe-usos-logins.mjs --limit 5
  node scripts/probe-usos-logins.mjs --submit-invalid-login --concurrency 2
`);
}
