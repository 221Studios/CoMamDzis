export const WML_ROZKLADY_ZAJEC_URL = 'https://wml.wat.edu.pl/rozklady-zajec/';

/** Wydziały WAT — indeksy Plansoft (index.xml) i szablony URL planów. */
export const WAT_FACULTIES = [
  {
    id: 'wml',
    name: 'Mechatroniki, Uzbrojenia i Lotnictwa',
    shortName: 'WML',
    groupIndex: {
      lato: 'https://wml.wat.edu.pl/wp-content/uploads/rozklady_zajec/{folder}/index.xml',
      zima: 'https://wml.wat.edu.pl/wp-content/uploads/rozklady_zajec/{folder}/index.xml'
    },
    scheduleUrl: {
      lato: 'https://wml.wat.edu.pl/wp-content/uploads/rozklady_zajec/{folder}/{group}.htm',
      zima: 'https://wml.wat.edu.pl/wp-content/uploads/rozklady_zajec/{folder}/{group}.htm'
    }
  },
  {
    id: 'wlo',
    name: 'Bezpieczeństwa, Logistyki i Zarządzania',
    shortName: 'WLO',
    groupIndex: {
      lato: 'https://wlo.wat.edu.pl/planzajec/letni/index.xml',
      zima: 'https://wlo.wat.edu.pl/planzajec/zima/index.xml'
    },
    scheduleUrl: {
      lato: 'https://wlo.wat.edu.pl/planzajec/letni/{group}.htm',
      zima: 'https://wlo.wat.edu.pl/planzajec/zima/{group}.htm'
    }
  },
  {
    id: 'wel',
    name: 'Elektroniki',
    shortName: 'WEL',
    groupIndex: {
      lato: 'https://plany.wel.wat.edu.pl/lato/index.xml',
      zima: 'https://plany.wel.wat.edu.pl/zima/index.xml'
    },
    scheduleUrl: {
      lato: 'https://plany.wel.wat.edu.pl/lato/{group}.htm',
      zima: 'https://plany.wel.wat.edu.pl/zima/{group}.htm'
    }
  },
  {
    id: 'wim',
    name: 'Inżynierii Mechanicznej',
    shortName: 'WIM',
    groupIndex: {
      lato: 'https://www.wim.wat.edu.pl/wp-content/uploads/rozklady/lato/index.xml',
      zima: 'https://www.wim.wat.edu.pl/wp-content/uploads/rozklady/zima/index.xml'
    },
    scheduleUrl: {
      lato: 'https://www.wim.wat.edu.pl/wp-content/uploads/rozklady/lato/{group}.htm',
      zima: 'https://www.wim.wat.edu.pl/wp-content/uploads/rozklady/zima/{group}.htm'
    }
  },
  {
    id: 'ioe',
    name: 'Optoelektroniki',
    shortName: 'IOE',
    groupIndex: {
      lato: 'https://ioe.wat.edu.pl/plany/lato/index.xml',
      zima: 'https://ioe.wat.edu.pl/plany/zima/index.xml'
    },
    scheduleUrl: {
      lato: 'https://ioe.wat.edu.pl/plany/lato/{group}.htm',
      zima: 'https://ioe.wat.edu.pl/plany/zima/{group}.htm'
    }
  },
  {
    id: 'wtc',
    name: 'Cybernetyki',
    shortName: 'WTC',
    groupIndex: {
      lato: 'https://www.wtc.wat.edu.pl/Plany/index.xml',
      zima: 'https://www.wtc.wat.edu.pl/Plany/index.xml'
    },
    scheduleUrl: {
      lato: 'https://www.wtc.wat.edu.pl/Plany/{group}.htm',
      zima: 'https://www.wtc.wat.edu.pl/Plany/{group}.htm'
    }
  }
];

export function watFacultyById(id) {
  return WAT_FACULTIES.find((f) => f.id === id) || WAT_FACULTIES[0];
}

/** Semestr WAT (lato / zima) i folder na serwerze, np. 2025_sem_lato. */
export function watSemesterForDate(date = new Date()) {
  const month = date.getMonth();
  const year = date.getFullYear();

  if (month >= 9 || month <= 1) {
    const ayStart = month >= 9 ? year : year - 1;
    return {
      term: 'zima',
      folder: `${ayStart}_sem_zima`
    };
  }

  const ayStart = month >= 2 ? year - 1 : year - 1;
  return {
    term: 'lato',
    folder: `${ayStart}_sem_lato`
  };
}

export function buildWatGroupIndexUrl(faculty, semester) {
  const template = faculty.groupIndex[semester.term] || faculty.groupIndex.lato;
  return template.replace('{folder}', semester.folder);
}

export function normalizeWatGroupHref(groupRef) {
  const raw = String(groupRef || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.toLowerCase().endsWith('.htm') ? raw : `${raw}.htm`;
}

export function scheduleBaseFromIndexUrl(indexUrl) {
  const href = String(indexUrl || '').trim();
  if (!href) return '';
  const slash = href.lastIndexOf('/');
  return slash >= 0 ? href.slice(0, slash + 1) : href;
}

export function buildScheduleUrlFromIndex(indexUrl, groupHref) {
  const base = scheduleBaseFromIndexUrl(indexUrl);
  const file = normalizeWatGroupHref(groupHref);
  if (!base || !file) return file;
  if (/^https?:\/\//i.test(file)) return file;
  try {
    return new URL(file, base).href;
  } catch {
    return `${base}${file}`;
  }
}

export function rankWmlIndexXmlUrl(indexUrl, semester) {
  const url = String(indexUrl || '').toLowerCase();
  const folder = String(semester?.folder || '').toLowerCase();
  const term = String(semester?.term || '').toLowerCase();
  if (folder && url.includes(folder)) return 0;
  if (term && url.includes(`_${term}`)) return 1;
  return 2;
}

export function buildWatScheduleUrl(faculty, semester, groupRef) {
  const template = faculty.scheduleUrl[semester.term] || faculty.scheduleUrl.lato;
  const href = normalizeWatGroupHref(groupRef);
  const baseName = href.replace(/\.htm$/i, '');

  return template
    .replace('{folder}', semester.folder || '')
    .replace('{group}.htm', href)
    .replace('{group}', baseName);
}

export function watSemesterAlternatives(date = new Date()) {
  const primary = watSemesterForDate(date);
  const month = date.getMonth();
  const year = date.getFullYear();
  const ayStart = month >= 9 || month <= 1 ? (month >= 9 ? year : year - 1) : year - 1;

  const alternate =
    primary.term === 'lato'
      ? { term: 'zima', folder: `${ayStart}_sem_zima` }
      : { term: 'lato', folder: `${ayStart}_sem_lato` };

  return [primary, alternate];
}

/** Domyślny wydział po prefiksie kodu grupy. */
export function guessWatFacultyIdForGroup(groupCode) {
  const code = String(groupCode || '').toUpperCase();
  if (code.startsWith('WMT') || code.startsWith('WM')) return 'wml';
  if (code.startsWith('SDR') || code.startsWith('SD') || /^\dPL/.test(code)) return 'wlo';
  if (code.startsWith('WEL') || code.startsWith('WE')) return 'wel';
  if (code.startsWith('WIM') || code.startsWith('WI')) return 'wim';
  if (code.startsWith('WTC') || code.startsWith('WC')) return 'wtc';
  if (code.startsWith('IOE') || code.startsWith('IO')) return 'ioe';
  return 'wml';
}
