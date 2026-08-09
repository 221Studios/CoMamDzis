const EXPLICIT_TIME_RE = /w\s*g\.\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i;
const WEEK_RANGE_RE = /tyg\.\s*(\d+)\s*-\s*(\d+)/i;

const ROOM_PATTERNS = [
  {
    re: /\bCENTECH\s+(\d+)\b/i,
    building: 'Centrum Technologii',
    format: (match) => `CENTECH ${match[1]}`
  },
  {
    re: /\bCI\s+(\d+)\b/i,
    building: 'CI',
    format: (match) => `CI ${match[1]}`
  },
  {
    re: /\b(E\d{3})\b/i,
    building: 'Wydział Elektrotechniki',
    format: (match) => match[1].toUpperCase()
  },
  {
    re: /\b(M-[IVXLCDM]+)\b/i,
    building: 'Wydział Mechaniczny',
    format: (match) => match[1].toUpperCase()
  },
  {
    re: /\b(M\d{3})\b/i,
    building: 'Wydział Mechaniczny',
    format: (match) => match[1].toUpperCase()
  },
  {
    re: /\b(R\d{3})\b/i,
    building: 'Politechnika Lubelska',
    format: (match) => match[1].toUpperCase()
  },
  {
    re: /\bhala\/basen\b/i,
    building: 'Obiekt sportowy',
    format: () => 'hala/basen'
  },
  {
    re: /\b(AIII)\b/i,
    building: 'Politechnika Lubelska',
    format: (match) => match[1].toUpperCase()
  },
  {
    re: /\b(AI)\b/i,
    building: 'Politechnika Lubelska',
    format: (match) => match[1].toUpperCase()
  }
];

/** Skleja rozbite tokeny PDF: „M - IV” → „M-IV”, „CENTECH 302”. */
export function normalizeRoomText(text) {
  return String(text || '')
    .replace(/\bM\s*-\s*([IVXLCDM]+)\b/gi, 'M-$1')
    .replace(/\bCENTECH\s+(\d+)\b/gi, 'CENTECH $1')
    .replace(/\bCI\s+(\d+)\b/gi, 'CI $1')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanRoomSegment(segment) {
  return normalizeRoomText(segment)
    .replace(EXPLICIT_TIME_RE, '')
    .replace(WEEK_RANGE_RE, '')
    .replace(/,\s*\d+\s*t\..*$/i, '')
    .replace(/,\s*w\s*g\..*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchRoomInText(source) {
  const normalized = normalizeRoomText(source);
  for (const pattern of ROOM_PATTERNS) {
    const match = normalized.match(pattern.re);
    if (!match) continue;
    const room = pattern.format(match);
    return {
      room,
      buildingName: pattern.building,
      roomName: room
    };
  }
  return null;
}

export function parsePollubRoomLocation(text) {
  const source = normalizeRoomText(text);
  const semi = source.match(/;\s*([^;]+?)\s*$/);

  if (semi) {
    const segment = cleanRoomSegment(semi[1]);
    const fromSegment = matchRoomInText(segment);
    if (fromSegment) return fromSegment;

    if (segment && !/^(dr|mgr|prof|inż)/i.test(segment)) {
      return {
        room: segment,
        buildingName: 'Politechnika Lubelska',
        roomName: segment
      };
    }
  }

  const tailAfterForm = source.match(
    /\s-\s*(?:W|ćw|cw|lab|proj|aud|sem)\s*-\s*(.+)$/i
  )?.[1];
  if (tailAfterForm) {
    const fromTail = matchRoomInText(cleanRoomSegment(tailAfterForm));
    if (fromTail) return fromTail;
  }

  const afterSemi = semi ? cleanRoomSegment(semi[1]) : '';
  const fromText = matchRoomInText(afterSemi || source);
  if (fromText) return fromText;

  return { room: '', buildingName: '', roomName: '' };
}

export function extractRoom(text) {
  return parsePollubRoomLocation(text).room;
}
