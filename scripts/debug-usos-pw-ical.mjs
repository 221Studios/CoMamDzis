/**
 * Debug USOS iCal flow.
 *
 * Wymaga: USOS_LOGIN, USOS_PASSWORD, USOS_PORTAL_URL
 */
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { usosCredentialsFromEnv } from './lib/test-credentials.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { loginToUsosAndFetchIcal } = await import(pathToFileURL(join(root, 'src/usosClient.js')).href);

const { login, password, portalUrl, mfaCode } = usosCredentialsFromEnv();

if (!portalUrl) {
  console.error('Ustaw USOS_PORTAL_URL.');
  process.exit(1);
}

const icalUrl = await loginToUsosAndFetchIcal({
  login,
  password,
  mfaCode,
  portalUrl,
  onPhase: (p) => console.log(p)
});

console.log('iCal:', icalUrl);
