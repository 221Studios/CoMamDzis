/**
 * Test USOS flow (logowanie + iCal).
 *
 * Wymaga: USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 *
 * node --import ./scripts/node-react-native-stub.mjs scripts/test-usos-pw-flow.mjs
 */
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const { loginToUsosAndFetchIcal } = await import(pathToFileURL(join(root, 'src/usosClient.js')).href);

const { login, password, portalUrl, mfaCode } = usosCredentialsFromEnv();

if (!portalUrl) {
  console.error('Ustaw USOS_PORTAL_URL.');
  process.exit(1);
}

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
