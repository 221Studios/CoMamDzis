/**
 * Test USOS UJ flow (login → opcjonalnie SMS → iCal).
 *
 * Wymaga: USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 * Opcjonalnie: USOS_MFA_CODE lub kod jako argv[2]
 *
 * node --import ./scripts/node-react-native-stub.mjs scripts/test-usos-uj-flow.mjs [kod_sms]
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { optionalEnv, usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { loginToUsosAndFetchIcal } = await import(join(root, 'src/usosClient.js'));

const { login, password, portalUrl } = usosCredentialsFromEnv({
  portalFallback: 'https://www.usosweb.uj.edu.pl'
});
const mfaCode = optionalEnv('USOS_MFA_CODE', process.argv[2] || '');

const phases = [];
try {
  const icalUrl = await loginToUsosAndFetchIcal({
    login,
    password,
    mfaCode,
    portalUrl,
    onPhase: (p) => {
      console.log('PHASE:', p);
      phases.push(p);
    }
  });
  console.log('\nSUCCESS iCal URL:', icalUrl);
} catch (e) {
  console.log('\nRESULT:', e.message);
  console.log('CODE:', e.code || '-');
  if (e.code === 'USOS_2FA_REQUIRED') {
    console.log('\nUruchom ponownie z kodem SMS:');
    console.log('  export USOS_MFA_CODE=KOD_SMS');
    console.log('  node --import ./scripts/node-react-native-stub.mjs scripts/test-usos-uj-flow.mjs');
  }
  process.exit(e.code === 'USOS_2FA_REQUIRED' ? 0 : 1);
}
