import { looksLikePollubStoredCredential } from './pollubClient';
import { looksLikeUsosIcalUrl, looksLikeUsosStoredCredential } from './usosClient';
import { looksLikeWatStoredCredential } from './watClient';
import { looksLikeWseitStoredCredential } from './wseitClient';
import { looksLikeWszipPdfCredential, looksLikeWszipStoredCredential } from './wszipClient';
import {
  listUsosUniversities,
  resolveUsosPortalUrl,
  usosUniversityById,
  usosUniversityForLogin as lookupUsosUniversityByEmail
} from './usosRegistry.js';

export const SCHOOL_CDV = 'cdv';
export const SCHOOL_MERITO = 'merito';
export const SCHOOL_USOS = 'usos';
export const SCHOOL_WSZIP = 'wszip';
export const SCHOOL_POLLUB = 'pollub';
export const SCHOOL_WAT = 'wat';
export const SCHOOL_WSEIT = 'wseit';

/** Wyróżnione uczelnie (logo w UI). Pełny rejestr: listUsosUniversities(). */
export const USOS_FEATURED_UNIVERSITIES = [
  { registryId: 'usos-pw-edu-pl', id: 'pw' },
  { registryId: 'uj-edu-pl', id: 'uj' },
  { registryId: 'umcs-pl', id: 'umcs' }
];

function loginDomain(login) {
  const value = String(login || '').trim().toLowerCase();
  return value.includes('@') ? value.split('@').pop() : value;
}

function matchesUsosDomains(domain, domains) {
  return domains.some((instanceDomain) => domain === instanceDomain || domain.endsWith(`.${instanceDomain}`));
}

export function usosFeaturedUniversityForLogin(login) {
  const domain = loginDomain(login);
  if (!domain) return null;

  for (const featured of USOS_FEATURED_UNIVERSITIES) {
    const full = usosUniversityById(featured.registryId);
    if (full && matchesUsosDomains(domain, full.domains || [])) {
      return { ...full, id: featured.id };
    }
  }
  return null;
}

export function usosInstanceForLogin(login) {
  return usosUniversityForLogin(login);
}

export function usosUniversityForLogin(login) {
  return usosFeaturedUniversityForLogin(login) || lookupUsosUniversityByEmail(login);
}

export { listUsosUniversities, resolveUsosPortalUrl, usosUniversityById };

function matchesWszipDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  return normalized === 'wszip'
    || normalized === 'wszip.pl'
    || normalized.endsWith('.wszip.pl')
    || normalized === 'wszip.poznan.pl'
    || normalized.endsWith('.wszip.poznan.pl');
}

function looksLikeWszipLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  if (!value) return false;
  if (value.includes('wszip')) return true;
  return matchesWszipDomain(loginDomain(login));
}

function looksLikeEhmsLogin(login) {
  const value = String(login || '').trim();
  return /^\d{6}$/.test(value);
}

function looksLikeMeritoLogin(login) {
  const value = String(login || '').trim();
  return /^[A-Za-z]+\d{6}$/.test(value);
}

export function looksLikeWseitLogin(login) {
  const value = String(login || '').trim();
  if (!value) return false;
  if (/wseit/i.test(value)) return true;
  const domain = loginDomain(login);
  return domain === 'wseit.pl' || domain === 'wd.wseit.pl' || domain.endsWith('.wseit.pl');
}

function looksLikeWseitPortalLogin(login) {
  const value = String(login || '').trim();
  return /^[a-z]{2}\d{2,5}$/i.test(value);
}

function looksLikePollubLogin(login) {
  const value = String(login || '').trim().toLowerCase();
  if (!value) return false;
  if (looksLikeEhmsLogin(login)) return true;
  if (value.includes('ehms.pollub') || value.includes('pollub.pl/')) return true;
  const domain = loginDomain(login);
  return domain === 'pollub.edu.pl' || domain.endsWith('.pollub.edu.pl');
}

export function looksLikeWatLogin(login) {
  const domain = loginDomain(login);
  return (
    domain === 'wat.edu.pl' ||
    domain === 'student.wat.edu.pl' ||
    domain.endsWith('.wat.edu.pl')
  );
}

export function detectSchool(login) {
  const value = String(login || '').trim().toLowerCase();

  if (value.includes('@edu.cdv.pl') || value.includes('@cdv.pl')) return SCHOOL_CDV;
  if (looksLikeWatLogin(login)) return SCHOOL_WAT;
  if (looksLikeWseitLogin(login) || looksLikeWseitPortalLogin(login)) return SCHOOL_WSEIT;
  if (looksLikePollubLogin(login)) return SCHOOL_POLLUB;
  if (looksLikeWszipLogin(login)) return SCHOOL_WSZIP;
  if (value.includes('merito.pl') || value.includes('wsb.pl')) return SCHOOL_MERITO;
  if (looksLikeMeritoLogin(login)) return SCHOOL_MERITO;
  if (usosUniversityForLogin(login) || value.includes('usos')) return SCHOOL_USOS;
  if (value.includes('.edu.pl') || value.includes('.edu')) return SCHOOL_USOS;

  return null;
}

export function resolveSchoolForLogin(login, credentials = '') {
  if (looksLikeWszipPdfCredential(credentials) || looksLikeWszipStoredCredential(credentials)) {
    return SCHOOL_WSZIP;
  }
  if (looksLikeWatStoredCredential(credentials)) {
    return SCHOOL_WAT;
  }
  if (looksLikeWseitStoredCredential(credentials)) {
    return SCHOOL_WSEIT;
  }
  if (looksLikePollubStoredCredential(credentials)) {
    return SCHOOL_POLLUB;
  }
  if (looksLikePollubLogin(login)) {
    return SCHOOL_POLLUB;
  }
  if (looksLikeWszipLogin(login)) {
    return SCHOOL_WSZIP;
  }
  if (looksLikeUsosStoredCredential(credentials) || looksLikeUsosIcalUrl(credentials) || looksLikeUsosIcalUrl(login)) {
    return SCHOOL_USOS;
  }

  return detectSchool(login);
}

export function portalUrlForLogin(login, options = {}) {
  const school = resolveSchoolForLogin(login);
  if (school === SCHOOL_USOS) {
    return resolveUsosPortalUrl(login, options) || schoolProfiles[SCHOOL_USOS].portalUrl;
  }

  return schoolProfiles[school]?.portalUrl || schoolProfiles[SCHOOL_CDV].portalUrl;
}

export const schoolProfiles = {
  [SCHOOL_CDV]: {
    id: SCHOOL_CDV,
    loginPlaceholder: 'Login/mail studenta',
    portalUrl: 'https://wu.cdv.pl/?login=1',
    subtitle: 'Collegium Da Vinci'
  },
  [SCHOOL_MERITO]: {
    id: SCHOOL_MERITO,
    loginPlaceholder: 'Login/mail studenta',
    portalUrl: 'https://meritogo.pl/',
    subtitle: 'WSB Merito'
  },
  [SCHOOL_USOS]: {
    id: SCHOOL_USOS,
    loginPlaceholder: 'E-mail studenta USOS',
    portalUrl: 'https://usosweb.uw.edu.pl',
    subtitle: 'USOS'
  },
  [SCHOOL_WSZIP]: {
    id: SCHOOL_WSZIP,
    loginPlaceholder: 'E-mail studenta WSZiP',
    portalUrl: 'https://mdl.wszip.poznan.pl/',
    subtitle: 'WSZiP'
  },
  [SCHOOL_POLLUB]: {
    id: SCHOOL_POLLUB,
    loginPlaceholder: 'Login do eHMS',
    portalUrl: 'https://ehms.pollub.pl/standard/',
    subtitle: 'Politechnika Lubelska (eHMS)'
  },
  [SCHOOL_WAT]: {
    id: SCHOOL_WAT,
    loginPlaceholder: 'E-mail studenta WAT',
    portalUrl: 'https://www.wojsko-polskie.pl/wat/rozklady-zajec/',
    subtitle: 'Wojskowa Akademia Techniczna'
  },
  [SCHOOL_WSEIT]: {
    id: SCHOOL_WSEIT,
    loginPlaceholder: 'Login do WSEIT (np. zk40)',
    portalUrl: 'https://wd.wseit.pl/Logowanie',
    subtitle: 'WSEIT'
  }
};

export function schoolProfileForLogin(school) {
  if (school && schoolProfiles[school]) return schoolProfiles[school];
  return {
    loginPlaceholder: 'Login lub e-mail studenta',
    portalUrl: schoolProfiles[SCHOOL_CDV].portalUrl,
    subtitle: null
  };
}
