/** Pobieranie profilu studenta z USOSweb (wspólne dla uczelni na tym samym szablonie). */

import { mergeAutoStudentProfile } from './studentProfile.js';

const USOS_HOME_ACTION = 'kontroler.php?_action=home/index';
const USOS_GRUPY_ACTION = 'kontroler.php?_action=dla_stud/studia/grupyDziekanskie';
const USOS_GRUPY_ZAJECIOWE_ACTION = 'kontroler.php?_action=home/grupy';
const USOS_RANKING_ACTION = 'kontroler.php?_action=dla_stud/studia/rankingi';
const USOS_PROFILE_ACTION_PREFIX = 'kontroler.php?_action=katalog2/osoby/pokazOsobe&os_id=';

function cleanLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripTags(value) {
  return cleanLine(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
  );
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanLine(value);
    if (text) return text;
  }
  return '';
}

export function parseUsosCycleCode(code) {
  const match = String(code || '').match(/\b(20\d{2})([LZ])\b/i);
  if (!match) return null;
  const year = Number(match[1]);
  const letter = match[2].toUpperCase();
  const term = letter === 'L' ? 'letni' : 'zimowy';
  return {
    year,
    term,
    code: `${match[1]}${letter}`,
    sortKey: year * 10 + (letter === 'L' ? 2 : 1)
  };
}

export function parseSemesterNumberFromText(text) {
  const source = String(text || '');
  const etp = source.match(/LK000-S(\d+)/i) || source.match(/[-_]S(\d+)-(?:ISP|REK)/i);
  if (etp) return Number(etp[1]);
  const sem = source.match(/sem\.?\s*(\d+)/i);
  return sem ? Number(sem[1]) : 0;
}

function formatStudyYearLabel(studyYear) {
  const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  if (studyYear >= 1 && studyYear <= roman.length) return `${roman[studyYear]} rok`;
  return `Rok ${studyYear}`;
}

export function formatUsosSemesterLabel({ semesterNumber = 0, term = '' } = {}) {
  const sem = Number(semesterNumber);
  if (!sem) return '';
  const studyYear = Math.ceil(sem / 2);
  const parts = [formatStudyYearLabel(studyYear), `semestr ${sem}`];
  if (term) parts.push(term);
  return parts.join(', ');
}

function parseGrupyListItem(itemHtml) {
  const groupMatch = itemHtml.match(/Grupa dziekańska<\/span>:\s*([\s\S]*?)(?:<span|<\/div>)/i);
  const cycleMatch = itemHtml.match(/Cykl<\/span>:\s*([^<]+)/i);
  const stageLinkMatch = itemHtml.match(/Etap<\/span>:[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
  const stageMatch = itemHtml.match(/Etap<\/span>:\s*([\s\S]*?)(?:<\/div>|<\/a>)/i);
  const groupCodeMatch = itemHtml.match(/\[([^\]]+)\]/);
  const stageText = cleanLine(stripTags(stageLinkMatch?.[1] || stageMatch?.[1] || ''));
  const cycleText = cleanLine(cycleMatch?.[1] || '');
  const cycle =
    parseUsosCycleCode(cycleText)
    || parseUsosCycleCode(groupCodeMatch?.[1]?.match(/(20\d{2}[LZ])/i)?.[1]);
  const semNumber =
    parseSemesterNumberFromText(stageText)
    || parseSemesterNumberFromText(groupCodeMatch?.[1] || '');
  const term =
    cycle?.term
    || (/letni/i.test(stageText) ? 'letni' : /zimow/i.test(stageText) ? 'zimowy' : '');

  return {
    group: cleanLine(stripTags(groupMatch?.[1] || '')),
    cycle,
    stageText,
    semNumber,
    term
  };
}

function selectBestGrupyItem(items) {
  if (!items.length) return null;
  return items.reduce((best, item) => {
    const bestKey = best.cycle?.sortKey || 0;
    const itemKey = item.cycle?.sortKey || 0;
    if (itemKey !== bestKey) return itemKey > bestKey ? item : best;
    return item.semNumber >= best.semNumber ? item : best;
  });
}

export function parseUsosHomeAcademicCycle(html) {
  const source = String(html || '');
  const cycles = [
    ...source.matchAll(/\bank_kod=\d+-(20\d{2}[LZ])/gi),
    ...source.matchAll(/\b(20\d{2}[LZ])\b/g)
  ]
    .map((match) => parseUsosCycleCode(match[1]))
    .filter(Boolean);
  cycles.sort((a, b) => b.sortKey - a.sortKey);
  return cycles[0] || null;
}

function normalizeUsosHtmlText(html) {
  return String(html || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+);/gi, ' ');
}

function findUsosGrupyZajecioweInHtmlParts(...htmlParts) {
  for (const html of htmlParts) {
    const parsed = parseUsosGrupyZajeciowe(html);
    if (parsed?.semester || parsed?.term) return parsed;
  }
  return null;
}

export function formatSemesterFromHomeCycle(cycle) {
  if (!cycle?.term || !cycle?.year) return '';
  if (cycle.term === 'letni') {
    return `rok akademicki ${cycle.year - 1}/${cycle.year}, sem. letni`;
  }
  return `rok akademicki ${cycle.year}/${cycle.year + 1}, sem. zimowy`;
}

/** Semestr z HTML już pobranego w sesji (bez dodatkowych requestów). */
export function deriveUsosSemesterLabel({ homeHtml = '', grupyZajecioweHtml = '', profileHtml = '' } = {}) {
  const parsed = findUsosGrupyZajecioweInHtmlParts(grupyZajecioweHtml, homeHtml, profileHtml);
  const parsedSemester = sanitizeUsosSemesterValue(parsed?.semester || '');
  if (isUsosSemesterValueValid(parsedSemester)) return parsedSemester;

  const combined = `${homeHtml}\n${grupyZajecioweHtml}\n${profileHtml}`;
  const plain = stripTags(normalizeUsosHtmlText(combined));
  const match = plain.match(/rok akademicki\s+(\d{4})\/(\d{4})\s*[-–—]\s*sem\.?\s*(letni|zimowy)/i);
  if (match) {
    const term = /letni/i.test(match[3]) ? 'letni' : 'zimowy';
    return `rok akademicki ${match[1]}/${match[2]}, sem. ${term}`;
  }

  const cycle = parseUsosHomeAcademicCycle(combined);
  if (cycle) {
    return sanitizeUsosSemesterValue(formatSemesterFromHomeCycle(cycle) || `sem. ${cycle.term}`);
  }

  return '';
}

function extractGrupyZajecioweSectionChunk(source, headerPos) {
  const afterHeader = String(source || '').slice(headerPos);
  const nextHeader = afterHeader.slice(40).search(/rok akademicki\s+\d{4}\/\d{4}\s*-\s*sem\./i);
  if (nextHeader >= 0) return afterHeader.slice(0, 40 + nextHeader);
  return afterHeader.slice(0, 160000);
}

function collectSemesterNumbersFromGrupyZajecioweChunk(chunk) {
  const numbers = [];
  for (const match of String(chunk || '').matchAll(/-ISP-(\d)\d{3}/gi)) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 12) numbers.push(value);
  }
  for (const match of String(chunk || '').matchAll(/LK000-S(\d+)/gi)) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 12) numbers.push(value);
  }
  return numbers;
}

/** Semestr z „Grupy, których jestem uczestnikiem” (home/grupy lub skrót na stronie głównej). */
export function parseUsosGrupyZajeciowe(html) {
  const raw = String(html || '');
  if (!raw) return null;
  const source = normalizeUsosHtmlText(raw);

  const sections = [];
  const headerPattern = /rok akademicki\s+(\d{4})\/(\d{4})\s*[-–—]\s*sem\.?\s*(letni|zimowy)/gi;
  let match;
  while ((match = headerPattern.exec(source)) !== null) {
    const startYear = Number(match[1]);
    const endYear = Number(match[2]);
    const term = /letni/i.test(match[3]) ? 'letni' : 'zimowy';
    const cycleYear = term === 'letni' ? endYear : startYear;
    const letter = term === 'letni' ? 'L' : 'Z';
    let cycle = parseUsosCycleCode(`${cycleYear}${letter}`);
    const chunk = extractGrupyZajecioweSectionChunk(source, match.index);
    const semNumbers = collectSemesterNumbersFromGrupyZajecioweChunk(chunk);
    for (const cycleMatch of chunk.matchAll(/<span[^>]*class=['"][^'"]*\bnote\b[^'"]*['"][^>]*>\s*(20\d{2}[LZ])\s*<\/span>/gi)) {
      const parsedCycle = parseUsosCycleCode(cycleMatch[1]);
      if (parsedCycle && (!cycle || parsedCycle.sortKey >= cycle.sortKey)) {
        cycle = parsedCycle;
      }
    }
    sections.push({
      startYear,
      endYear,
      term,
      cycle,
      sortKey: cycle?.sortKey || 0,
      semNumbers,
      chunk
    });
  }

  if (!sections.length) {
    const plain = stripTags(source);
    const plainMatch = plain.match(/rok akademicki\s+(\d{4})\/(\d{4})\s*[-–—]\s*sem\.?\s*(letni|zimowy)/i);
    if (plainMatch) {
      const startYear = Number(plainMatch[1]);
      const endYear = Number(plainMatch[2]);
      const term = /letni/i.test(plainMatch[3]) ? 'letni' : 'zimowy';
      return {
        term,
        cycle: parseUsosCycleCode(`${term === 'letni' ? endYear : startYear}${term === 'letni' ? 'L' : 'Z'}`),
        semNumber: 0,
        semester: `rok akademicki ${startYear}/${endYear}, sem. ${term}`,
        academicYearLabel: `rok akademicki ${startYear}/${endYear}`,
        startYear,
        endYear
      };
    }

    const cycles = [
      ...raw.matchAll(/<span[^>]*class=['"][^'"]*\bnote\b[^'"]*['"][^>]*>\s*(20\d{2}[LZ])\s*<\/span>/gi),
      ...source.matchAll(/\b(20\d{2}[LZ])\b/g)
    ]
      .map((cycleMatch) => parseUsosCycleCode(cycleMatch[1]))
      .filter(Boolean);
    if (!cycles.length) return null;
    cycles.sort((a, b) => b.sortKey - a.sortKey);
    const cycle = cycles[0];
    return {
      term: cycle.term,
      cycle,
      semNumber: 0,
      semester: cycle.term ? `sem. ${cycle.term}` : '',
      academicYearLabel: ''
    };
  }

  sections.sort((a, b) => {
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    const bSem = b.semNumbers.length ? Math.max(...b.semNumbers) : 0;
    const aSem = a.semNumbers.length ? Math.max(...a.semNumbers) : 0;
    return bSem - aSem;
  });

  const best = sections[0];
  const semNumber = best.semNumbers.length ? Math.max(...best.semNumbers) : 0;
  const academicYearLabel = `rok akademicki ${best.startYear}/${best.endYear}`;
  const semester = `${academicYearLabel}, sem. ${best.term}`;

  return {
    term: best.term,
    cycle: best.cycle,
    semNumber,
    semester,
    academicYearLabel,
    startYear: best.startYear,
    endYear: best.endYear
  };
}

export function parseUsosRankingSemester(html) {
  const source = stripTags(String(html || ''));
  if (!source) return null;

  const match =
    source.match(/sem\.?\s*(\d+)[^[]*?(20\d{2}[LZ])[^[]*?LK000-S(\d+)/i)
    || source.match(/sem\.?\s*(\d+)[,\s]+(?:st\.[^,]*,?\s*)?(20\d{2}[LZ])/i)
    || source.match(/LK000-S(\d+)[^[]*?(20\d{2}[LZ])/i);
  if (!match) return null;

  const semNumber = Number(match[3] || match[1]) || parseSemesterNumberFromText(match[0]);
  const cycle = parseUsosCycleCode(match[2]);
  return {
    semNumber,
    cycle,
    term: cycle?.term || ''
  };
}

function findUsosRankingSemesterInHtmlParts(...htmlParts) {
  for (const html of htmlParts) {
    const parsed = parseUsosRankingSemester(html);
    if (parsed?.semNumber) return parsed;
  }
  return null;
}

function resolveUsosSemesterInfo({ grupyZajecioweInfo, grupyItem, rankingInfo, homeCycle }) {
  const candidates = [];

  if (grupyZajecioweInfo?.term || grupyZajecioweInfo?.semNumber || grupyZajecioweInfo?.semester) {
    return {
      semNumber: grupyZajecioweInfo.semNumber || 0,
      term: grupyZajecioweInfo.term || grupyZajecioweInfo.cycle?.term || '',
      cycle: grupyZajecioweInfo.cycle || null,
      semester: grupyZajecioweInfo.semester
        || (grupyZajecioweInfo.semNumber
          ? formatUsosSemesterLabel({
            semesterNumber: grupyZajecioweInfo.semNumber,
            term: grupyZajecioweInfo.term || grupyZajecioweInfo.cycle?.term || ''
          })
          : grupyZajecioweInfo.term
            ? `sem. ${grupyZajecioweInfo.term}`
            : '')
    };
  }

  if (grupyItem?.semNumber) {
    candidates.push({
      semNumber: grupyItem.semNumber,
      term: grupyItem.term || grupyItem.cycle?.term || '',
      cycle: grupyItem.cycle,
      sortKey: (grupyItem.cycle?.sortKey || 0) * 100 + grupyItem.semNumber
    });
  }

  if (rankingInfo?.semNumber) {
    candidates.push({
      semNumber: rankingInfo.semNumber,
      term: rankingInfo.term || rankingInfo.cycle?.term || '',
      cycle: rankingInfo.cycle,
      sortKey: (rankingInfo.cycle?.sortKey || 0) * 100 + rankingInfo.semNumber
    });
  }

  if (!candidates.length) {
    if (homeCycle?.term) {
      return { semester: '', semNumber: 0, term: homeCycle.term, cycle: homeCycle };
    }
    return { semester: '', semNumber: 0, term: '', cycle: null };
  }

  candidates.sort((a, b) => b.sortKey - a.sortKey);
  const best = candidates[0];
  return {
    semNumber: best.semNumber,
    term: best.term,
    cycle: best.cycle,
    semester: formatUsosSemesterLabel({ semesterNumber: best.semNumber, term: best.term })
  };
}

export function parseUsosCasBarName(html) {
  const match = String(html || '').match(/<cas-bar[^>]*\slogged-user=['"]([^'"]+)['"]/i);
  return cleanLine(match?.[1] || '');
}

export function parseUsosUniversityName(html) {
  const header = String(html || '').match(/<app-header[^>]*\sdisplay-name=["']([^"']+)["']/i)?.[1];
  if (header) return cleanLine(header);
  const footer = String(html || '').match(/<footer-panel[^>]*\sheader=["']([^"']+)["']/i)?.[1];
  return cleanLine(footer || '');
}

export function parseUsosHomeUserInfo(html) {
  const source = String(html || '');
  const infoBlock = source.match(/<usos-frame[^>]*class=["'][^"']*extras[^"']*["'][^>]*id=["']info-frame["'][\s\S]*?<\/usos-frame>/i)?.[0]
    || source.match(/Informacje o użytkowniku[\s\S]{0,6000}?<\/usos-frame>/i)?.[0]
    || source;

  const albumMatch = infoBlock.match(/Numer albumu:[\s\S]*?<b>\s*([^<]+)\s*<\/b>/i);
  const facultyMatch = infoBlock.match(
    /<a[^>]*kontroler\.php\?_action=katalog2\/jednostki\/pokazJednostke[^>]*>([^<]+)<\/a>/i
  );
  const profileIdMatch = source.match(/pokazOsobe&(?:amp;)?os_id=(\d+)/i);

  return {
    albumNumber: cleanLine(albumMatch?.[1] || ''),
    faculty: cleanLine(facultyMatch?.[1] || ''),
    profileUserId: cleanLine(profileIdMatch?.[1] || '')
  };
}

export function parseUsosProfilePage(html) {
  const source = String(html || '');
  const titleName = cleanLine(source.match(/<title>([^<|–-]+)/i)?.[1] || '');
  const h1Name = cleanLine(source.match(/<h1[^>]*class=['"][^'"]*uwb-inline-heading[^'"]*['"][^>]*>([^<]+)</i)?.[1] || '');

  let firstName = '';
  let lastName = '';
  const defs = source.match(/<div class=['"]uwb-side-defs['"][\s\S]*?<\/div>\s*<\/div>/i)?.[0] || '';
  if (defs) {
    const rows = [...defs.matchAll(/<div>([^<]+)<\/div>\s*<div>([^<]*)<\/div>/gi)];
    for (const row of rows) {
      const label = cleanLine(row[1]);
      const value = cleanLine(row[2]);
      if (/^imiona$/i.test(label)) firstName = value;
      if (/^nazwisko$/i.test(label)) lastName = value;
    }
  }

  const fullName = pickFirstNonEmpty(
    h1Name,
    titleName,
    [firstName, lastName].filter(Boolean).join(' ')
  );

  return { fullName, firstName, lastName };
}

export function parseUsosGrupyDziekanskie(html) {
  const source = String(html || '');
  const frameMatch = source.match(/<usos-frame[\s\S]*?<ul class=["']no-bullets separated["'][\s\S]*?<\/ul>[\s\S]*?<\/usos-frame>/i);
  if (!frameMatch) return {};

  const frameHtml = frameMatch[0];
  const programHeading = frameHtml.match(/<h2[^>]*slot=["']title["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '';
  const program = cleanLine(stripTags(programHeading).replace(/\[[^\]]+\]\s*$/, '').trim());

  const items = [...frameHtml.matchAll(/<li>([\s\S]*?)<\/li>/gi)]
    .map((match) => parseGrupyListItem(match[1]))
    .filter((item) => item.group || item.stageText || item.semNumber);
  if (!items.length) return { program };

  const bestItem = selectBestGrupyItem(items);
  const stageText = bestItem.stageText;
  let degreeLevel = '';
  let studyMode = '';

  if (/pierwszego stopnia|I stopnia/i.test(stageText) || /I stopnia/i.test(program)) {
    degreeLevel = 'I stopień';
  } else if (/drugiego stopnia|II stopnia/i.test(stageText) || /II stopnia/i.test(program)) {
    degreeLevel = 'II stopień';
  }

  if (/stacjonarne/i.test(stageText) || /stacjonarne/i.test(program)) studyMode = 'stacjonarne';
  else if (/niestacjonarne/i.test(stageText) || /niestacjonarne/i.test(program)) studyMode = 'niestacjonarne';

  const programFromStage = stageText.replace(/^sem\.?\s*\d+,?\s*/i, '').replace(/\[[^\]]+\]\s*$/, '').trim();
  const semesterInfo = resolveUsosSemesterInfo({ grupyItem: bestItem, rankingInfo: null, homeCycle: null });

  return {
    program: pickFirstNonEmpty(programFromStage, program),
    group: bestItem.group,
    semester: semesterInfo.semester,
    semNumber: semesterInfo.semNumber,
    term: semesterInfo.term,
    cycle: semesterInfo.cycle,
    degreeLevel,
    studyMode
  };
}

export function mergeUsosStudentProfile(parts = {}, portalUrl = '') {
  const home = parts.home || {};
  const profile = parts.profile || {};
  const grupy = parts.grupy || {};
  const ranking = parts.ranking || {};
  const grupyZajeciowe = parts.grupyZajeciowe || {};
  const rankingHtml = String(parts.rankingHtml || '');
  const homeCycle = parts.homeCycle || null;

  let semesterInfo;
  if (grupyZajeciowe.term || grupyZajeciowe.semNumber || grupyZajeciowe.semester) {
    semesterInfo = resolveUsosSemesterInfo({
      grupyZajecioweInfo: grupyZajeciowe,
      homeCycle
    });
  } else if (ranking.semNumber) {
    semesterInfo = resolveUsosSemesterInfo({
      rankingInfo: ranking,
      homeCycle
    });
  } else if (rankingHtml) {
    semesterInfo = resolveUsosSemesterInfo({
      grupyItem: grupy.semNumber
        ? { semNumber: grupy.semNumber, term: grupy.term, cycle: grupy.cycle }
        : null,
      homeCycle
    });
  } else if (grupy.semNumber || grupy.semester) {
    semesterInfo = resolveUsosSemesterInfo({
      grupyItem: { semNumber: grupy.semNumber, term: grupy.term, cycle: grupy.cycle },
      homeCycle
    });
    if (!semesterInfo.semester && grupy.semester) {
      semesterInfo = { ...semesterInfo, semester: grupy.semester };
    }
  } else if (homeCycle?.term) {
    semesterInfo = {
      semNumber: 0,
      term: homeCycle.term,
      cycle: homeCycle,
      semester: `sem. ${homeCycle.term}`
    };
  } else {
    semesterInfo = {
      semester: '',
      semNumber: 0,
      term: homeCycle?.term || '',
      cycle: homeCycle
    };
  }

  const fullName = pickFirstNonEmpty(
    parseUsosCasBarName(parts.homeHtml || parts.profileHtml || ''),
    profile.fullName,
    parts.casName
  );
  const derivedSemester = deriveUsosSemesterLabel({
    homeHtml: parts.homeHtml,
    grupyZajecioweHtml: parts.grupyZajecioweHtml,
    profileHtml: parts.profileHtml
  });

  return mergeAutoStudentProfile(
    {},
    {
      fullName,
      albumNumber: pickFirstNonEmpty(home.albumNumber, parts.albumFromLogin),
      university: pickFirstNonEmpty(
        parseUsosUniversityName(parts.homeHtml || ''),
        parts.universityName
      ),
      program: pickFirstNonEmpty(grupy.program, profile.program),
      faculty: pickFirstNonEmpty(home.faculty, grupy.faculty),
      degreeLevel: grupy.degreeLevel,
      studyMode: grupy.studyMode,
      semester: sanitizeUsosSemesterValue(
        pickFirstNonEmpty(semesterInfo.semester, grupy.semester, derivedSemester)
      ),
      group: grupy.group
    }
  );
}

export function buildUsosStudentProfileFromHtml({
  homeHtml = '',
  profileHtml = '',
  grupyHtml = '',
  grupyZajecioweHtml = '',
  rankingHtml = '',
  portalUrl = '',
  login = ''
} = {}) {
  const home = parseUsosHomeUserInfo(homeHtml);
  const profile = parseUsosProfilePage(profileHtml || homeHtml);
  const grupy = parseUsosGrupyDziekanskie(grupyHtml);
  const grupyZajeciowe =
    findUsosGrupyZajecioweInHtmlParts(grupyZajecioweHtml, homeHtml, profileHtml)
    || {};
  const ranking = findUsosRankingSemesterInHtmlParts(rankingHtml, homeHtml, profileHtml, grupyHtml) || {};
  const homeCycle = parseUsosHomeAcademicCycle(homeHtml);
  const albumFromLogin = String(login || '').match(/\b\d{4,8}\b/)?.[0] || '';

  return mergeUsosStudentProfile(
    {
      home,
      profile,
      grupy,
      grupyZajeciowe,
      ranking,
      rankingHtml,
      homeCycle,
      homeHtml,
      profileHtml,
      grupyZajecioweHtml,
      casName: parseUsosCasBarName(homeHtml || profileHtml),
      albumFromLogin,
      universityName: parseUsosUniversityName(homeHtml)
    },
    portalUrl
  );
}

export const USOS_STUDENT_PROFILE_HOME_ACTION = USOS_HOME_ACTION;
export const USOS_STUDENT_PROFILE_GRUPY_ACTION = USOS_GRUPY_ACTION;
export const USOS_STUDENT_PROFILE_GRUPY_ZAJECIOWE_ACTION = USOS_GRUPY_ZAJECIOWE_ACTION;
export const USOS_STUDENT_PROFILE_RANKING_ACTION = USOS_RANKING_ACTION;

export function usosProfileActionForUserId(userId) {
  const id = String(userId || '').trim();
  if (!id) return '';
  return `${USOS_PROFILE_ACTION_PREFIX}${encodeURIComponent(id)}`;
}

export function sanitizeUsosSemesterValue(semester) {
  const text = cleanLine(semester);
  if (!text) return '';
  if (/^semestr\.?$/i.test(text)) return '';
  if (/^semestr\s*[:\\-–—]?\s*$/i.test(text)) return '';
  if (/^semestr\s*studiów\.?$/i.test(text)) return '';
  return text;
}

export function isUsosSemesterValueValid(semester) {
  const text = sanitizeUsosSemesterValue(semester);
  if (!text) return false;
  if (/rok,\s*semestr\s+\d+/i.test(text)) return true;
  if (/^rok akademicki\s+\d{4}\/\d{4},\s*sem\.\s*(letni|zimowy)$/i.test(text)) return true;
  if (/^sem\.\s*(letni|zimowy)$/i.test(text)) return true;
  return false;
}

export function isUsosProfileIncomplete(profile) {
  const fullName = cleanLine(profile?.fullName);
  const university = cleanLine(profile?.university);
  const faculty = cleanLine(profile?.faculty);
  const program = cleanLine(profile?.program);
  return !fullName || !university || !faculty || !program;
}

/** Czy warto ponownie pobrać profil (np. brak semestru / stary format). */
export function shouldRefreshUsosStudentProfile(profile) {
  if (isUsosProfileIncomplete(profile)) return true;
  const semester = sanitizeUsosSemesterValue(profile?.semester);
  if (!isUsosSemesterValueValid(semester)) return true;
  if (/^Semestr\s+\d/i.test(semester)) return true;
  if (/^I rok,\s*semestr\s+[12],/i.test(semester)) return true;
  return false;
}
