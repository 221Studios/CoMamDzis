/** Czyszczenie pól informacji dodatkowych na karcie planu (sale, budynki — bez linków). */

const URL_RE = /\b(?:https?|webcal):\/\/[^\s<>"']+/gi;
const WWW_RE = /\bwww\.[^\s<>"']+/gi;

/** PW WMEiL: skrót gmachu → prefiks jednostki w kodzie budynku (np. 1130-ITLiMS). */
const PW_BUILDING_UNIT_PREFIX = {
  ITLiMS: '1130',
  ITC: '1130'
};

export const UNKNOWN_ROOM_LABEL = 'Sala nieznana';
export const UNKNOWN_ROOM_TOKEN = 'nieznana';

function cleanLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function stripUrlsFromPlanText(value) {
  return String(value || '')
    .replace(URL_RE, ' ')
    .replace(WWW_RE, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isStreetAddress(text) {
  const value = cleanLine(text);
  if (!value) return false;
  return /\d{2}-\d{3}\b/.test(value) || /\bul\.|\bal\.|\bpl\.|\baleja\b/i.test(value);
}

function isRoomOrBuildingLine(line) {
  const text = cleanLine(line);
  if (!text) return false;
  if (/^(budynek|sala|lokalizacja|pokój|pokoj|audytorium|laboratorium|gmach)\b/i.test(text)) return true;
  if (/^(budynek|sala|lokalizacja|pokój|pokoj|audytorium|laboratorium|gmach)\s*:/i.test(text)) return true;
  if (/^bud\.[A-Za-z0-9-]+/i.test(text)) return true;
  if (/^\[\d+-[A-Za-z0-9-]+\]/.test(text)) return false;
  return false;
}

function isOnlineLocationText(...parts) {
  return parts
    .filter(Boolean)
    .some((value) => /\bonline\b|\bteams\b|\bzoom\b|\bmeet\b|\bstrumie[nń]/i.test(String(value)));
}

export function isPlanEventOnline(event) {
  return [event?.locationMode, event?.roomName, event?.buildingName, event?.buildingAddress, event?.hangoutLink, event?.additionalInfo]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes('online'));
}

export function isUnknownRoomName(roomName) {
  const value = cleanLine(roomName);
  if (!value) return true;
  return (
    /^nieznana$/i.test(value)
    || /^sala nieznana$/i.test(value)
    || /^brak danych o sali$/i.test(value)
  );
}

export function formatPlanRoomLabel(event) {
  const raw = cleanLine(event?.roomName);
  if (raw && !isUnknownRoomName(raw)) {
    return raw.toLowerCase().startsWith('sala') ? raw : `Sala ${raw}`;
  }
  if (isPlanEventOnline(event)) return '';
  return UNKNOWN_ROOM_LABEL;
}

function formatPlanRoomInfoLine(roomName) {
  if (!roomName || isUnknownRoomName(roomName)) return UNKNOWN_ROOM_LABEL;
  return `Sala: ${roomName}`;
}

export function formatUsosBuildingLabel(gmachLine, roomName = '') {
  const line = cleanLine(gmachLine);
  if (!line) return '';

  const bracketCode = line.match(/\[(\d+-[A-Za-z0-9-]+)\]/)?.[1];
  if (bracketCode) return `bud.${bracketCode}`;

  const budDotCode = line.match(/^bud\.(\S+)/i)?.[1];
  if (budDotCode) return `bud.${budDotCode}`;

  const short = line.match(/^gmach\s+(\S+)/i)?.[1];
  if (!short) return line;
  if (/^główny$/i.test(short)) return 'Gmach Główny';

  const roomPrefix = String(roomName).match(/^([A-Za-z][A-Za-z0-9]*)-/i)?.[1];
  if (roomPrefix && roomPrefix.toUpperCase() === short.toUpperCase()) {
    const unit = PW_BUILDING_UNIT_PREFIX[short];
    if (unit) return `bud.${unit}-${short}`;
  }

  return `bud.${short}`;
}

export function parseUsosIcalEventLocation(description = '', location = '') {
  const lines = stripUrlsFromPlanText(description)
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);

  let roomName = '';
  let buildingName = '';

  lines.forEach((line) => {
    const salaMatch = line.match(/^sala\s*:\s*(.+)$/i);
    if (salaMatch) {
      roomName = cleanLine(salaMatch[1]);
      return;
    }
    if (/^gmach\b/i.test(line) || /^bud\./i.test(line) || /^budynek\s*:/i.test(line)) {
      buildingName = formatUsosBuildingLabel(
        line.replace(/^budynek\s*:\s*/i, 'Gmach '),
        roomName
      );
    }
  });

  const buildingAddress = isStreetAddress(location) ? cleanLine(stripUrlsFromPlanText(location)) : '';
  const onlineOnly = isOnlineLocationText(description, ...lines) && !buildingName;
  if (!roomName && !onlineOnly) {
    roomName = UNKNOWN_ROOM_TOKEN;
  }

  const additionalInfo = [formatPlanRoomInfoLine(roomName), buildingName].filter(Boolean).join('\n');

  return {
    roomName,
    buildingName,
    buildingAddress,
    additionalInfo
  };
}

export function extractRoomAndBuildingLines(value) {
  const lines = String(value || '')
    .split(/\n+/)
    .map((line) => cleanLine(stripUrlsFromPlanText(line)))
    .filter(Boolean);

  const picked = lines.filter(isRoomOrBuildingLine);
  if (picked.length) return picked.join('\n');

  return lines
    .filter((line) => /\b(sala|budynek|gmach|audytorium|laboratorium|bud\.)/i.test(line))
    .join('\n');
}

export function sanitizePlanAdditionalInfo(event) {
  const stripped = stripUrlsFromPlanText(event?.additionalInfo || '');
  if (/^USOS:/i.test(String(event?.type || ''))) {
    const fromFields = [formatPlanRoomInfoLine(event?.roomName), event?.buildingName || '']
      .filter(Boolean)
      .join('\n');
    if (fromFields) return fromFields;
    return extractRoomAndBuildingLines(stripped);
  }
  return stripped;
}

export function shouldShowPlanOnlineLink(event) {
  if (!event?.hangoutLink) return false;
  if (/^USOS:/i.test(String(event?.type || ''))) return false;
  const label = String(event.hangoutLinkLabel || '').toLowerCase();
  if (label.includes('usos')) return false;
  return true;
}

/** @deprecated Użyj parseUsosIcalEventLocation. */
export function parseUsosIcalLocation(location) {
  return parseUsosIcalEventLocation('', location);
}
