/**
 * Test USOS UMCS flow.
 *
 * Wymaga: USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 * Opcjonalnie: USOS_MFA_CODE
 *
 * node --import ./scripts/node-react-native-stub.mjs scripts/test-usos-umcs-flow.mjs
 */
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { loginToUsosAndFetchIcal } = await import(pathToFileURL(join(root, 'src/usosClient.js')).href);

const { login, password, portalUrl, mfaCode } = usosCredentialsFromEnv({
  portalFallback: 'https://usosweb.umcs.pl'
});

try {
  const icalUrl = await loginToUsosAndFetchIcal({
    login,
    password,
    mfaCode,
    portalUrl,
    onPhase: (p) => console.log('PHASE:', p)
  });
  console.log('\nSUCCESS iCal URL:', icalUrl);
} catch (e) {
  console.log('\nRESULT:', e.message);
  console.log('CODE:', e.code || '-');
  process.exit(1);
}
