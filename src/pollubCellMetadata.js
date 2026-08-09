const WEEK_RANGE_RE = /tyg\.\s*(\d+)\s*-\s*(\d+)/i;
const EXPLICIT_TIME_RE = /w\s*g\.\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i;
const DOT_TIME_RE = /(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})/;

const POLLUB_FORM_RULES = [
  { pattern: /\s-\s*proj\s*(?:-\s*)?/i, form: 'Projekt' },
  { pattern: /\s-\s*lab\s*(?:-\s*)?/i, form: 'Laboratorium' },
  { pattern: /\s-\s*(?:ćw|cw)\s*(?:-\s*)?/i, form: 'Ćwiczenia' },
  { pattern: /\s-\s*W\s*(?:-\s*)?/i, form: 'Wykład' },
  { pattern: /\s-\s*aud\s*(?:-\s*)?/i, form: 'Audytorium' },
  { pattern: /\s-\s*sem\s*(?:-\s*)?/i, form: 'Seminarium' }
];

const TEACHER_IN_TEXT_RE =
  /(?:(?:prof\.\s*)?(?:dr\s+hab\.\s*)?(?:(?:dr|mgr)\s+(?:inż\.\s*)?|inż\.\s*))(?:[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż.-]+)*(?:,\s*profesor\s+uczelni)?)/gi;

function cleanupCellText(text) {
  return String(text || '')
    .replace(/pierwsze zajęcia organizacyjne[^.]*\.?/gi, '')
    .replace(/w hali sportowej[^.]*\.?/gi, '')
    .replace(/zajęcia dodatkowe realizowane[^.]*\.?/gi, '')
    .replace(/efektywnego zarządzania[^.]*\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSubjectTitle(text) {
  let title = cleanupCellText(text);
  title = title
    .replace(EXPLICIT_TIME_RE, '')
    .replace(DOT_TIME_RE, '')
    .replace(WEEK_RANGE_RE, '')
    .replace(/;\s*$/, '')
    .replace(/,\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title || 'Zajęcia';
}

function extractTeacherFromSegment(segment) {
  let source = String(segment || '').trim();
  if (!source) return '';
  const semi = source.indexOf(';');
  if (semi >= 0) source = source.slice(0, semi);
  source = source.replace(/,\s*(?:\(\s*łącznie|\d+\s*t\.|w\s*g\.).*$/i, '').trim();
  const match = source.match(
    /(?:(?:prof\.\s*)?(?:dr\s+hab\.\s*)?(?:(?:dr|mgr)\s+(?:inż\.\s*)?|inż\.\s*))(?:[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż.-]+)*(?:,\s*profesor\s+uczelni)?)/
  );
  return match ? match[0].replace(/\s+/g, ' ').trim() : '';
}

function findTeachersInText(text) {
  const teachers = [];
  for (const match of String(text || '').matchAll(TEACHER_IN_TEXT_RE)) {
    const teacher = String(match[0] || '').replace(/\s+/g, ' ').trim();
    if (!teacher) continue;
    if (teachers.some((entry) => entry.toLowerCase() === teacher.toLowerCase())) continue;
    teachers.push(teacher);
  }
  return teachers;
}

export function formLabelFromKind(kind) {
  const map = {
    W: 'Wykład',
    LAB: 'Laboratorium',
    PROJ: 'Projekt',
    CW: 'Ćwiczenia'
  };
  return map[kind] || '';
}

export function parsePollubCellMetadata(rawText, extraLines = []) {
  const combined = [String(rawText || ''), ...extraLines.map((line) => String(line || ''))]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleaned = cleanupCellText(combined);
  if (!cleaned) {
    return { title: 'Zajęcia', form: '', teachers: [] };
  }

  const teachers = [];
  const registerTeacher = (value) => {
    const teacher = extractTeacherFromSegment(value);
    if (!teacher) return;
    if (teachers.some((entry) => entry.toLowerCase() === teacher.toLowerCase())) return;
    teachers.push(teacher);
  };

  let form = '';
  let subjectSource = cleaned;

  for (const rule of POLLUB_FORM_RULES) {
    const match = subjectSource.match(rule.pattern);
    if (!match || match.index == null) continue;
    form = rule.form;
    registerTeacher(subjectSource.slice(match.index + match[0].length));
    subjectSource = subjectSource.slice(0, match.index).trim();
    break;
  }

  if (!form) {
    const attached = subjectSource.match(
      /\s-\s*(proj|lab)\s+(?=(?:prof\.\s*)?(?:dr\s+hab\.\s*)?(?:inż\.\s*)?(?:dr|mgr)\s+)/i
    );
    if (attached && attached.index != null) {
      form = attached[1].toLowerCase() === 'proj' ? 'Projekt' : 'Laboratorium';
      registerTeacher(subjectSource.slice(attached.index + attached[0].length));
      subjectSource = subjectSource.slice(0, attached.index).trim();
    }
  }

  for (const chunk of cleaned.split(';')) {
    registerTeacher(chunk);
  }
  for (const teacher of findTeachersInText(cleaned)) {
    registerTeacher(teacher);
  }

  return {
    title: buildSubjectTitle(subjectSource),
    form,
    teachers
  };
}
