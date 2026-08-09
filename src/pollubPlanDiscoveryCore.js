const ROMAN = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'];

const FACULTY_PLANS_PAGES = [
  {
    match: (faculty) => faculty.includes('mechanicz'),
    url: 'https://wm.pollub.pl/studenci/plany-zajec'
  },
  {
    match: (faculty) => faculty.includes('srodowiska') || faculty.includes('energetyki'),
    url: 'https://wisie.pollub.pl/studenci/studia/plany-zajec'
  },
  {
    match: (faculty) => faculty.includes('matematyki') && faculty.includes('informatyki'),
    url: 'https://wmit.pollub.pl/studenci/rozklady-zajec'
  },
  {
    match: (faculty) => faculty.includes('zarzadzania'),
    url: 'https://wz.pollub.pl/studenci/kluczowe-informacje/rozklady-zajec'
  }
];

const IGNORED_PDF_RE =
  /informator|informacje_dla|jak.czytac|organizacja_roku|terminy_zjazd|zjazd|uchwal|zarzadzen|regulamin|strategia|konsultac|mlegitymac|folder_informacyjny|oplat|vademecum/i;

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*tr\s*>/gi, '\n')
    .replace(/<\/\s*td\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\/\s*h[1-6]\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isSecondDegree(studyInfo) {
  const value = normalizeText(studyInfo?.studyKind || studyInfo?.degreeLevel);
  return value.includes('ii stopnia') || value.includes('2 stopnia');
}

function isNiestacjonarne(studyInfo) {
  const value = normalizeText(studyInfo?.studySystem || studyInfo?.studyMode);
  return value.includes('niestacjon') || value.includes('zaocz') || value.includes('wieczor');
}

function programMatches(context, program) {
  const normalizedProgram = normalizeText(program);
  const normalizedContext = normalizeText(context);
  if (!normalizedProgram || !normalizedContext) return false;

  const words = normalizedProgram.split(' ').filter((word) => word.length > 2);
  if (!words.length) return normalizedContext.includes(normalizedProgram);
  return words.every((word) => normalizedContext.includes(word));
}

export function resolvePollubPlansPageUrl(studyInfo) {
  const faculty = normalizeText(studyInfo?.faculty);
  if (!faculty) return '';

  for (const entry of FACULTY_PLANS_PAGES) {
    if (entry.match(faculty)) return entry.url;
  }

  return '';
}

export function extractPdfCandidatesFromHtml(html, pageUrl) {
  const base = new URL(pageUrl);
  const source = String(html || '');
  const candidates = [];
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match = linkRe.exec(source);

  while (match) {
    const attrs = match[1];
    const inner = match[2];
    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    if (!hrefMatch) {
      match = linkRe.exec(source);
      continue;
    }

    const href = hrefMatch[1];
    if (!/\.pdf(?:[?#]|$)/i.test(href)) {
      match = linkRe.exec(source);
      continue;
    }

    const titleMatch = attrs.match(/title="([^"]*)"/i);
    const linkText = stripHtmlToText(inner);
    const rawFilename = titleMatch?.[1] || href.split('/').pop() || '';
    const filename = decodeURIComponent(String(rawFilename).split('?')[0].split('#')[0]);

    const contextStart = Math.max(0, match.index - 3000);
    const contextBeforeHtml = source.slice(contextStart, match.index);
    const contextEnd = Math.min(source.length, match.index + match[0].length + 400);
    const contextHtml = source.slice(contextStart, contextEnd);
    const contextBefore = stripHtmlToText(contextBeforeHtml);
    const context = stripHtmlToText(contextHtml);

    candidates.push({
      url: new URL(href, base).toString(),
      filename,
      linkText,
      context,
      contextBefore
    });

    match = linkRe.exec(source);
  }

  return candidates;
}

export function scorePdfCandidate(candidate, studyInfo) {
  const filename = String(candidate?.filename || '');
  const linkText = String(candidate?.linkText || '');
  const sectionContext = `${candidate?.contextBefore || candidate?.context || ''} ${linkText}`;
  const context = `${candidate?.context || ''} ${linkText} ${filename}`;
  const normalizedSection = normalizeText(sectionContext);
  const normalizedContext = normalizeText(context);
  const normalizedFilename = normalizeText(filename);

  if (!filename || IGNORED_PDF_RE.test(filename) || IGNORED_PDF_RE.test(normalizedContext)) {
    return -1000;
  }

  if (/grupy/i.test(filename) && !/plan/i.test(filename)) {
    return -500;
  }

  let score = 0;

  if (programMatches(sectionContext, studyInfo?.program)) score += 120;
  else if (programMatches(sectionContext, studyInfo?.specialization)) score += 80;

  const niestacjonarne = isNiestacjonarne(studyInfo);
  if (niestacjonarne) {
    if (/niestacjon|zaoczn|_n_|_ns|wieczor/.test(normalizedSection)) score += 40;
    if (/stacjonarne/.test(normalizedSection) && !/niestacjon/.test(normalizedSection)) score -= 60;
  } else {
    if (/stacjonarne|dzienne/.test(normalizedSection)) score += 25;
    if (/niestacjon|zaoczn|_n_|_ns/.test(normalizedSection) && !/stacjonarne/.test(normalizedSection)) {
      score -= 80;
    }
    if (/dzienne/.test(normalizedFilename)) score += 20;
    if (/zaoczne/.test(normalizedFilename)) score -= 80;
  }

  const secondDegree = isSecondDegree(studyInfo);
  if (secondDegree) {
    if (/ii stopnia|2 stopnia|_2_/.test(normalizedSection)) score += 25;
    if (/i stopnia|1 stopnia/.test(normalizedSection) && !/ii stopnia/.test(normalizedSection)) {
      score -= 40;
    }

    const sem = Number(studyInfo?.semesterInYear);
    const roman = ROMAN[sem] || '';
    if (roman) {
      const semPattern = new RegExp(`(?:^|[^a-z])${roman}\\s*sem`, 'i');
      const semPattern2 = new RegExp(`${roman}_sem`, 'i');
      const semPattern3 = new RegExp(`${roman}\\s*sem`, 'i');
      if (semPattern2.test(normalizedFilename) || semPattern3.test(normalizedFilename)) score += 120;
      else if (semPattern.test(normalizedSection)) score += 50;
    }
  } else {
    if (/i stopnia|1 stopnia|licencjat|inzyniersk/.test(normalizedSection)) score += 20;
    if (/ii stopnia|2 stopnia/.test(normalizedSection)) score -= 40;

    const year = Number(studyInfo?.yearInProgram);
    const romanYear = ROMAN[year] || '';
    if (year) {
      const yearPattern = new RegExp(`(?:^|[^0-9])${year}[_\\s-]*rok`, 'i');
      const romanYearPattern = romanYear ? new RegExp(`\\b${romanYear}\\s*rok\\b`, 'i') : null;
      if (yearPattern.test(normalizedFilename)) score += 120;
      else if (romanYearPattern?.test(normalizedSection)) score += 70;
      else if (yearPattern.test(normalizedSection)) score += 40;
    }
  }

  if (/pobierz/.test(normalizedSection) && /rok|sem|stopnia/.test(normalizedSection)) score += 10;

  return score;
}

export function pickBestPdfCandidate(candidates, studyInfo) {
  const list = Array.isArray(candidates) ? candidates : [];
  let best = null;
  let bestScore = 0;

  for (const candidate of list) {
    const score = scorePdfCandidate(candidate, studyInfo);
    if (score > bestScore) {
      bestScore = score;
      best = { ...candidate, score };
    }
  }

  if (!best || bestScore < 60) return null;
  return best;
}
