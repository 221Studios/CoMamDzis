import AsyncStorage from '@react-native-async-storage/async-storage';

import { WAT_FACULTIES } from './watConfig.js';

export const STUDENT_PROFILE_STORAGE_PREFIX = 'comamdzis_student_profile_v1:';

export const STUDENT_PROFILE_FIELDS = [
  { key: 'fullName', label: 'Imię i nazwisko' },
  { key: 'albumNumber', label: 'Nr albumu' },
  { key: 'university', label: 'Uczelnia' },
  { key: 'program', label: 'Kierunek' },
  { key: 'faculty', label: 'Wydział' },
  { key: 'degreeLevel', label: 'Poziom studiów' },
  { key: 'studyMode', label: 'Forma studiów' },
  { key: 'semester', label: 'Semestr' },
  { key: 'group', label: 'Grupa' }
];

const FIELD_KEYS = STUDENT_PROFILE_FIELDS.map((field) => field.key);

export function createEmptyStudentProfile() {
  return {
    fullName: '',
    albumNumber: '',
    university: '',
    program: '',
    faculty: '',
    degreeLevel: '',
    studyMode: '',
    semester: '',
    group: '',
    manualFields: []
  };
}

function safeStorageKeyPart(value) {
  return String(value || 'default').trim().toLowerCase().replace(/[^A-Za-z0-9._-]/g, '_');
}

export function studentProfileStorageKey(school, login) {
  return `${STUDENT_PROFILE_STORAGE_PREFIX}${safeStorageKeyPart(school)}_${safeStorageKeyPart(login)}`;
}

export function parseStudentProfile(raw) {
  if (!raw) return createEmptyStudentProfile();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const manualFields = Array.isArray(parsed?.manualFields)
      ? parsed.manualFields.filter((key) => FIELD_KEYS.includes(key))
      : [];
    const migrated = {
      ...parsed,
      studyMode: parsed?.studyMode || parsed?.studyKind || parsed?.studyType || '',
      manualFields
    };
    return {
      ...createEmptyStudentProfile(),
      ...Object.fromEntries(FIELD_KEYS.map((key) => [key, cleanStoredProfileValue(migrated?.[key])])),
      manualFields
    };
  } catch {
    return createEmptyStudentProfile();
  }
}

export async function readStudentProfile(school, login) {
  if (!school || !login) return createEmptyStudentProfile();
  const stored = await AsyncStorage.getItem(studentProfileStorageKey(school, login));
  return parseStudentProfile(stored);
}

export async function writeStudentProfile(school, login, profile) {
  if (!school || !login) return;
  const payload = {
    ...createEmptyStudentProfile(),
    ...profile,
    manualFields: [...new Set((profile?.manualFields || []).filter((key) => FIELD_KEYS.includes(key)))],
    updatedAt: new Date().toISOString()
  };
  await AsyncStorage.setItem(studentProfileStorageKey(school, login), JSON.stringify(payload));
  return payload;
}

export function displayProfileValue(value) {
  const text = String(value || '').trim();
  if (/^semestr\.?$/i.test(text)) return '-';
  if (/^semestr\s*[:\\-–—]?\s*$/i.test(text)) return '-';
  return text || '-';
}

export function mergeAutoStudentProfile(profile, autoPatch = {}) {
  const next = parseStudentProfile(profile);
  const manual = new Set(next.manualFields || []);

  FIELD_KEYS.forEach((key) => {
    const incoming = String(autoPatch?.[key] || '').trim();
    if (!incoming || manual.has(key)) return;
    const current = String(next[key] || '').trim();
    if (key === 'semester' && current && /^semestr\.?$/i.test(current)) {
      next[key] = incoming;
      return;
    }
    next[key] = incoming;
  });

  return next;
}

export function setManualStudentProfileField(profile, key, value) {
  if (!FIELD_KEYS.includes(key)) return parseStudentProfile(profile);
  const next = parseStudentProfile(profile);
  const manualFields = new Set(next.manualFields || []);
  manualFields.add(key);
  next[key] = String(value || '').trim();
  next.manualFields = [...manualFields];
  return next;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractLabeledValue(text, labels) {
  const source = String(text || '');
  const candidates = Array.isArray(labels) ? labels : [labels];

  for (const label of candidates) {
    const safe = escapeRegex(label);
    const patterns = [
      new RegExp(`${safe}\\s*\\n\\s*([^\\n]{1,200})`, 'i'),
      new RegExp(`${safe}\\s*[:\\-–—]\\s*([^\\n]{1,200})`, 'i')
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return String(match[1]).trim();
    }
  }

  return '';
}

function looksLikeEmail(value) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(String(value || ''));
}

function cleanProfileLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanStoredProfileValue(value) {
  return trimJoinedProfileValue(cleanProfileLine(value));
}

function trimJoinedProfileValue(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';

  return cleaned
    .replace(/\s*[/|]\s*(?:wydzia[łl]|status\s*studenta|statusstudenta|uczelnia|rodzaj\s*studi[oó]w|rodzajstudi[oó]w|poziom\s*studi[oó]w|poziomstudi[oó]w|forma\s*studi[oó]w|formastudi[oó]w|wpis\s+na\s+semestr)[\s\S]*$/i, '')
    .replace(/\s{2,}(?:wydzia[łl]|status\s*studenta|statusstudenta|uczelnia|rodzaj\s*studi[oó]w|rodzajstudi[oó]w|poziom\s*studi[oó]w|poziomstudi[oó]w|forma\s*studi[oó]w|formastudi[oó]w|wpis\s+na\s+semestr)[\s\S]*$/i, '')
    .trim();
}

function cleanUniversityValue(value) {
  const cleaned = cleanStoredProfileValue(value);
  if (!cleaned) return '';
  if (looksLikeEmail(cleaned)) return '';
  if (/\(\d{3,}\)/.test(cleaned)) return '';
  return cleaned;
}

function firstEmailLineIndex(lines) {
  return lines.findIndex((line) => looksLikeEmail(line));
}

function extractCappedValue(text, pattern) {
  const match = String(text || '').match(pattern);
  return cleanProfileLine(match?.[1] || '');
}

function parseCdvCompactStudyInfo(lines, albumLineIndex) {
  if (albumLineIndex < 0) return {};

  const stopWords = /^(profil|wyloguj|najbliższe zajęcia|strona główna|informacje|wirtualna uczelnia)$/i;
  const fragments = [];

  for (let index = albumLineIndex + 1; index < lines.length && fragments.length < 4; index += 1) {
    const line = cleanProfileLine(lines[index]);
    if (!line || stopWords.test(line)) continue;
    if (/^\d{1,2}\s+\S+/.test(line) || /\d{1,2}:\d{2}/.test(line)) break;
    fragments.push(line);
    if (/sem\.?\s*:/i.test(line)) break;
  }

  const compact = fragments.join(' ');
  if (!compact || !compact.includes(',')) return {};

  const parts = compact.split(',').map(cleanProfileLine).filter(Boolean);
  const semesterPart = parts.find((part) => /^sem\.?\s*:/i.test(part));
  const semesterValue = extractCappedValue(semesterPart || '', /^sem\.?\s*:\s*(.+)$/i);

  return {
    program: parts[0] || '',
    degreeLevel: parts[1] || '',
    studyMode: parts[2] || '',
    semester: semesterValue ? `Semestr ${semesterValue}` : semesterPart || ''
  };
}

const PROFILE_BOUNDARY_LABELS = [
  'Imię i nazwisko',
  'Nazwisko i imię',
  'Student',
  'Użytkownik',
  'Numer albumu',
  'Nr albumu',
  'Numer indeksu',
  'Nr indeksu',
  'Indeks',
  'Album',
  'Status studenta',
  'Status',
  'Uczelnia',
  'Szkoła wyższa',
  'Rodzaj studiów',
  'Typ studiów',
  'Kierunek studiów',
  'Kierunek',
  'Program studiów',
  'Wydział',
  'Instytut',
  'Jednostka organizacyjna',
  'Poziom studiów',
  'Stopień studiów',
  'Stopień',
  'Forma studiów',
  'Tryb studiów',
  'System studiów',
  'Tryb',
  'Rok studiów',
  'Rok akademicki',
  'Rok',
  'Semestr studiów',
  'Semestr',
  'Rok / semestr (w roku akad.)',
  'Grupa',
  'Grupa dziekańska',
  'Grupa laboratoryjna',
  'Grupa ćwiczeniowa',
  'Specjalność',
  'Specjalizacja'
];

function extractProfileValue(text, labels) {
  const source = String(text || '');
  const candidates = Array.isArray(labels) ? labels : [labels];
  const boundary = PROFILE_BOUNDARY_LABELS.map(escapeRegex).join('|');

  for (const label of candidates) {
    const safe = escapeRegex(label);
    const pattern = new RegExp(
      `${safe}\\s*(?:[:\\-–—]|\\n)\\s*([\\s\\S]{1,300}?)(?=(?:\\n\\s*)?(?:${boundary})\\s*(?:[:\\-–—]|\\n)|$)`,
      'i'
    );
    const match = source.match(pattern);
    const value = cleanExtractedProfileValue(match?.[1] || '');
    if (value) return value;
  }

  return cleanStoredProfileValue(extractLabeledValue(text, labels));
}

function cleanExtractedProfileValue(value) {
  return cleanStoredProfileValue(value);
}

export function parseHtmlStudentProfile(html) {
  const text = String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<\/\s*tr\s*>/gi, '\n')
    .replace(/<\/\s*td\s*>/gi, '\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
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

  const lines = text.split('\n').map(cleanProfileLine).filter(Boolean);
  const emailIndex = firstEmailLineIndex(lines);
  const albumLineIndex = lines.findIndex((line) => /\balbum\s*:/i.test(line));
  const compactCdvInfo = parseCdvCompactStudyInfo(lines, albumLineIndex);

  const fullName =
    extractProfileValue(text, ['Imię i nazwisko', 'Nazwisko, Imię', 'Nazwisko i imię', 'Student', 'Użytkownik']) ||
    extractProfileValue(text, ['Imię', 'Nazwisko']) ||
    (emailIndex > 0 ? lines[emailIndex - 1] : '');

  const albumNumber =
    extractProfileValue(text, [
      'Numer albumu',
      'Nr albumu',
      'Numer indeksu',
      'Nr indeksu',
      'Indeks',
      'Album'
    ]) ||
    extractCappedValue(text, /\bAlbum\s*:\s*([A-Z0-9/-]+)/i);

  return {
    fullName,
    albumNumber,
    university: cleanUniversityValue(extractProfileValue(text, ['Uczelnia', 'Szkoła wyższa'])),
    program: extractProfileValue(text, ['Kierunek studiów', 'Kierunek', 'Program studiów']) || compactCdvInfo.program || '',
    faculty: extractProfileValue(text, ['Wydział', 'Instytut', 'Jednostka organizacyjna']),
    degreeLevel: extractProfileValue(text, ['Poziom studiów', 'Stopień studiów', 'Stopień']) || compactCdvInfo.degreeLevel || '',
    studyMode: extractProfileValue(text, ['Forma studiów', 'Rodzaj studiów', 'Typ studiów', 'Tryb studiów', 'System studiów', 'Tryb']) || compactCdvInfo.studyMode || '',
    semester: extractProfileValue(text, ['Semestr studiów', 'Semestr', 'Rok / semestr (w roku akad.)']) || compactCdvInfo.semester || '',
    group: extractProfileValue(text, ['Grupa', 'Grupa dziekańska', 'Grupa laboratoryjna', 'Grupa ćwiczeniowa'])
  };
}

export function studentProfileFromPollub({ studyInfo, groups, login }) {
  const info = studyInfo || {};
  const semesterParts = [];
  if (info.semesterLabel) semesterParts.push(info.semesterLabel);
  if (info.academicYear) semesterParts.push(info.academicYear);
  if (!info.semesterLabel && info.semesterInYear) semesterParts.push(`Semestr ${info.semesterInYear}`);

  return {
    fullName: info.fullName || '',
    albumNumber: info.albumNumber || String(login || '').trim(),
    university: info.university || 'Politechnika Lubelska',
    program: info.program || '',
    faculty: info.faculty || '',
    degreeLevel: info.degreeLevel || info.studyKind || '',
    studyMode: info.studySystem || info.studyMode || '',
    semester: semesterParts.join(' · '),
    group: (groups || []).join(', ')
  };
}

export function studentProfileFromWseit({ login, contextLabel }) {
  return {
    albumNumber: String(login || '').trim(),
    university: 'WSEIT',
    program: String(contextLabel || '').trim()
  };
}

export function studentProfileFromWat({ facultyId, groupCode, login, semesterTerm }) {
  const faculty = WAT_FACULTIES.find((entry) => entry.id === facultyId);
  return {
    albumNumber: String(login || '').trim(),
    faculty: faculty?.name || faculty?.shortName || '',
    group: String(groupCode || '').trim(),
    semester: semesterTerm ? `Semestr ${semesterTerm}` : ''
  };
}

export function studentProfileFromLogin({ login, email }) {
  const identity = String(login || email || '').trim();
  const albumMatch = identity.match(/\b\d{4,8}\b/);
  return {
    albumNumber: albumMatch ? albumMatch[0] : identity.includes('@') ? '' : identity
  };
}

export function studentProfileFromPollubLegacyMeta(meta) {
  if (!meta) return {};
  return studentProfileFromPollub({
    studyInfo: meta.studyInfo,
    groups: meta.groups,
    login: ''
  });
}
