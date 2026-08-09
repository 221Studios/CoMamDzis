/**
 * Poświadczenia do skryptów testowych — wyłącznie ze zmiennych środowiskowych.
 * Nigdy nie commituj loginów ani haseł do repozytorium.
 *
 * Przykład:
 *   export USOS_LOGIN='twoj@email.uczelni.pl'
 *   export USOS_PASSWORD='haslo'
 *   export USOS_PORTAL_URL='https://usosweb.uczelnia.pl'   # opcjonalnie
 *   export USOS_MFA_CODE='123456'                          # opcjonalnie (2FA)
 */

function clean(value) {
  return String(value || '').trim();
}

export function requireEnv(name, hint = '') {
  const value = clean(process.env[name]);
  if (!value) {
    console.error(`Brak zmiennej środowiskowej ${name}.${hint ? ` ${hint}` : ''}`);
    process.exit(1);
  }
  return value;
}

export function optionalEnv(name, fallback = '') {
  const value = clean(process.env[name]);
  return value || fallback;
}

export function usosCredentialsFromEnv({ portalFallback = '' } = {}) {
  return {
    login: requireEnv('USOS_LOGIN', 'np. export USOS_LOGIN=twoj@email.uczelni.pl'),
    password: requireEnv('USOS_PASSWORD'),
    portalUrl: optionalEnv('USOS_PORTAL_URL', portalFallback),
    mfaCode: optionalEnv('USOS_MFA_CODE', '')
  };
}

export function wseitCredentialsFromEnv() {
  return {
    login: requireEnv('WSEIT_LOGIN', 'np. export WSEIT_LOGIN=zk40'),
    password: requireEnv('WSEIT_PASSWORD')
  };
}

export function hasUsosCredentials() {
  return Boolean(clean(process.env.USOS_LOGIN) && clean(process.env.USOS_PASSWORD));
}
