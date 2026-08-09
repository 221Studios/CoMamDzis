import registry from './data/usosUniversities.js';

const USOS_UNIVERSITIES = registry.universities || [];

/** Indeks domen e-mail → uczelnia (najdłuższe dopasowanie wygrywa). */
const DOMAIN_INDEX = buildDomainIndex(USOS_UNIVERSITIES);

const BY_ID = new Map(USOS_UNIVERSITIES.map((u) => [u.id, u]));
const BY_PORTAL_HOST = new Map(USOS_UNIVERSITIES.map((u) => [u.portalHost, u]));

function buildDomainIndex(universities) {
  const rows = [];
  for (const university of universities) {
    for (const domain of university.domains || []) {
      rows.push({ domain: domain.toLowerCase(), university });
    }
  }
  rows.sort((a, b) => b.domain.length - a.domain.length);
  return rows;
}

export function loginDomain(login) {
  const value = String(login || '').trim().toLowerCase();
  return value.includes('@') ? value.split('@').pop() : value;
}

function domainMatches(emailDomain, registryDomain) {
  return emailDomain === registryDomain || emailDomain.endsWith(`.${registryDomain}`);
}

export function usosUniversityForEmailDomain(emailDomain) {
  const domain = String(emailDomain || '').trim().toLowerCase();
  if (!domain) return null;

  for (const row of DOMAIN_INDEX) {
    if (domainMatches(domain, row.domain)) {
      return row.university;
    }
  }
  return null;
}

export function usosUniversityForLogin(login) {
  return usosUniversityForEmailDomain(loginDomain(login));
}

export function usosUniversityById(id) {
  return BY_ID.get(String(id || '')) || null;
}

export function usosUniversityByPortalUrl(portalUrl) {
  try {
    const host = new URL(portalUrl).hostname.toLowerCase();
    return BY_PORTAL_HOST.get(host) || null;
  } catch {
    return null;
  }
}

export function listUsosUniversities() {
  return USOS_UNIVERSITIES;
}

export function guessUsosPortalUrlFromEmail(login) {
  const domain = loginDomain(login);
  if (!domain || !/\.(edu\.pl|pl|mil\.pl)$/i.test(domain)) return '';

  const candidates = [
    `https://usosweb.${domain}`,
    `https://www.usosweb.${domain}`,
    `https://usosweb.usos.${domain}`
  ];

  for (const url of candidates) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (BY_PORTAL_HOST.has(host)) {
        return BY_PORTAL_HOST.get(host).portalUrl;
      }
    } catch {
      // skip
    }
  }

  return candidates[0];
}

/**
 * Zwraca portal USOSweb dla loginu (e-mail) lub wybranej uczelni (id).
 * Kolejność: id → rejestr domen → heurystyka URL.
 */
export function resolveUsosPortalUrl(login, options = {}) {
  const selectedId = options.universityId || options.selectedUniversityId;
  if (selectedId) {
    const selected = usosUniversityById(selectedId);
    if (selected?.portalUrl) return selected.portalUrl;
  }

  const fromRegistry = usosUniversityForLogin(login);
  if (fromRegistry?.portalUrl) return fromRegistry.portalUrl;

  return guessUsosPortalUrlFromEmail(login);
}

export function apiBaseUrlForUsosPortal(portalUrl) {
  const fromRegistry = usosUniversityByPortalUrl(portalUrl);
  if (fromRegistry?.apiBaseUrl) return fromRegistry.apiBaseUrl;

  const host = (() => {
    try {
      return new URL(portalUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (!host.startsWith('usosweb.')) return '';

  const suffix = host.slice('usosweb.'.length);
  const candidates = [
    `https://usosapps.${suffix}`,
    `https://apps.usos.${suffix}`,
    `https://usosapps.usos.${suffix}`
  ];

  if (suffix.startsWith('usos.')) {
    candidates.unshift(`https://apps.usos.${suffix.slice('usos.'.length)}`);
  }

  return candidates[0];
}

export { USOS_UNIVERSITIES };
