import {
  extractPdfCandidatesFromHtml,
  pickBestPdfCandidate,
  scorePdfCandidate
} from './pollubPlanDiscoveryCore';

export { extractPdfCandidatesFromHtml, pickBestPdfCandidate, scorePdfCandidate };

const WSZIP_PROGRAMS = [
  { key: 'zarzadzanie', label: 'Zarządzanie' },
  { key: 'administracja', label: 'Administracja' },
  { key: 'psychologia', label: 'Psychologia' }
];

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

function extractProfileField(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, 'i');
    const match = text.match(re);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

export function parseWszipStudyInfoFromMoodleHtml(html, loginEmail = '') {
  const text = stripHtmlToText(html);
  const normalized = normalizeText(text);

  let program = extractProfileField(text, ['Kierunek studiów', 'Kierunek', 'Program studiów']);
  if (!program) {
    for (const entry of WSZIP_PROGRAMS) {
      if (normalized.includes(entry.key)) {
        program = entry.label;
        break;
      }
    }
  }

  let degreeLevel = extractProfileField(text, ['Poziom studiów', 'Stopień studiów', 'Stopień']);
  if (!degreeLevel) {
    if (/ii stopnia|drugiego stopnia|magisterskie studia ii/i.test(text)) {
      degreeLevel = 'II stopnia';
    } else if (/jednolite|5 letnie|5-letnie/i.test(text)) {
      degreeLevel = 'Jednolite magisterskie';
    } else if (/i stopnia|pierwszego stopnia|licencjack/i.test(text)) {
      degreeLevel = 'I stopnia';
    }
  }

  let studyMode = extractProfileField(text, ['Forma studiów', 'Rodzaj studiów', 'Tryb studiów', 'System studiów']);
  if (!studyMode) {
    if (/niestacjonar|zaoczn|wieczor/i.test(text)) studyMode = 'Niestacjonarne';
    else if (/stacjonar|dzienne/i.test(text)) studyMode = 'Stacjonarne';
  }

  const fullName =
    extractProfileField(text, ['Imię i nazwisko', 'Nazwisko, Imię', 'Nazwisko i imię', 'Student']) ||
    extractProfileField(text, ['Imię', 'Nazwisko']);

  const group = extractProfileField(text, ['Grupa', 'Grupa dziekańska', 'Grupa laboratoryjna']);

  return {
    fullName,
    program,
    degreeLevel,
    studyMode,
    studySystem: studyMode,
    studyKind: degreeLevel,
    group,
    loginEmail: String(loginEmail || '').trim(),
    university: 'WSZiP'
  };
}

export function studyInfoForWszipScoring(profile) {
  return {
    program: profile?.program || '',
    specialization: profile?.group || '',
    studyKind: profile?.degreeLevel || profile?.studyKind || '',
    degreeLevel: profile?.degreeLevel || '',
    studySystem: profile?.studyMode || profile?.studySystem || '',
    studyMode: profile?.studyMode || profile?.studySystem || ''
  };
}

export function pickBestWszipPdfCandidate(candidates, profile) {
  const list = Array.isArray(candidates) ? candidates : [];
  const best = pickBestPdfCandidate(list, studyInfoForWszipScoring(profile));
  if (best) return best;

  const planLike = list.filter((candidate) => /plan|rozklad|harmonogram|zajec/i.test(
    `${candidate?.filename || ''} ${candidate?.linkText || ''} ${candidate?.context || ''}`
  ));
  if (planLike.length === 1) {
    return { ...planLike[0], score: 50 };
  }

  return null;
}
