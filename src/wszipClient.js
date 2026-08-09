import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import { formatLocalDateTimeFromPolish } from './dateUtils';
import { parsePdfItemsToEvents } from './wszipPdfParser';

export const WSZIP_PDF_PREFIX = 'wszip-pdf:';
export const WSZIP_STORED_PREFIX = 'wszip-stored:v1:';
const WSZIP_PLAN_FILENAME = 'wszip-plan.pdf';

function encodeBase64Utf8(value) {
  const bytes = encodeURIComponent(String(value)).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(bytes);
  }
  throw new Error('Brak obsługi zapisu profilu WSZiP w tej wersji aplikacji.');
}

function decodeBase64Utf8(value) {
  const binary = globalThis.atob(value);
  return decodeURIComponent(
    binary
      .split('')
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join('')
  );
}

export function packWszipPdfCredential(uri) {
  return `${WSZIP_PDF_PREFIX}${uri}`;
}

export function unpackWszipPdfCredential(value) {
  const raw = String(value || '');
  if (!raw.startsWith(WSZIP_PDF_PREFIX)) return '';
  return raw.slice(WSZIP_PDF_PREFIX.length);
}

export function looksLikeWszipPdfCredential(value) {
  return String(value || '').startsWith(WSZIP_PDF_PREFIX);
}

export function packWszipStoredCredential(pdfUri = '') {
  const payload = JSON.stringify({
    pdfUri: String(pdfUri || '').trim()
  });
  return `${WSZIP_STORED_PREFIX}${encodeBase64Utf8(payload)}`;
}

export function unpackWszipStoredCredential(value) {
  const raw = String(value || '');

  if (raw.startsWith(WSZIP_STORED_PREFIX)) {
    try {
      const parsed = JSON.parse(decodeBase64Utf8(raw.slice(WSZIP_STORED_PREFIX.length)));
      return {
        pdfUri: String(parsed.pdfUri || '').trim()
      };
    } catch {
      return null;
    }
  }

  if (looksLikeWszipPdfCredential(raw)) {
    return {
      pdfUri: unpackWszipPdfCredential(raw)
    };
  }

  return null;
}

export function looksLikeWszipStoredCredential(value) {
  return String(value || '').startsWith(WSZIP_STORED_PREFIX);
}

export function wszipPdfLabel(value) {
  const stored = unpackWszipStoredCredential(value);
  const uri = stored?.pdfUri || String(value || '').trim();
  if (!uri) return '';
  const parts = uri.split('/');
  return decodeURIComponent(parts[parts.length - 1] || WSZIP_PLAN_FILENAME);
}

async function persistPdfInAppStorage(sourceUri) {
  const destination = `${FileSystem.documentDirectory}${WSZIP_PLAN_FILENAME}`;
  const source = String(sourceUri || '').trim();
  if (!source) {
    throw new Error('Nie udało się odczytać wybranego pliku PDF.');
  }

  try {
    await FileSystem.copyAsync({ from: source, to: destination });
    const copied = await FileSystem.getInfoAsync(destination);
    if (copied.exists) return destination;
  } catch {
    // Niektóre URI content:// na Androidzie wymagają bezpośredniego odczytu.
  }

  const base64 = await FileSystem.readAsStringAsync(source, {
    encoding: 'base64'
  });
  await FileSystem.writeAsStringAsync(destination, base64, {
    encoding: 'base64'
  });

  const saved = await FileSystem.getInfoAsync(destination);
  if (!saved.exists) {
    throw new Error('Nie udało się zapisać wybranego pliku PDF w aplikacji.');
  }

  return destination;
}

function resolvePickedPdfUri(result) {
  if (!result || result.canceled) return '';
  return result.assets?.[0]?.uri || result.uri || '';
}

export async function pickWszipPdfFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false
  });

  const sourceUri = resolvePickedPdfUri(result);
  if (!sourceUri) return null;

  return persistPdfInAppStorage(sourceUri);
}

export function buildWszipPdfCredential(pdfUri) {
  const uri = String(pdfUri || '').trim();
  if (!uri) return '';
  return packWszipPdfCredential(uri);
}

async function readPdfBase64FromUri(pdfUri) {
  const uri = String(pdfUri || '').trim();
  if (!uri) {
    throw new Error('Brak pliku PDF planu. Wybierz pobrany plik z Moodle.');
  }

  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new Error('Plik PDF nie istnieje. Pobierz plan ponownie z Moodle i wybierz plik jeszcze raz.');
  }

  return FileSystem.readAsStringAsync(uri, {
    encoding: 'base64'
  });
}

export function parseTextLinesToEvents(lines) {
  const events = [];
  let currentDate = null;
  const dateRegex = /(\d{2}\.\d{2}\.\d{4})/;
  const timeRegex = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;

    const dateMatch = line.match(dateRegex);
    if (dateMatch) {
      currentDate = dateMatch[1];
    }

    const timeMatch = line.match(timeRegex);
    if (!currentDate || !timeMatch) continue;

    const startTime = timeMatch[1];
    const endTime = timeMatch[2];
    const cleanLine = line.replace(dateRegex, '').replace(timeRegex, '').trim();
    const startIso = formatLocalDateTimeFromPolish(currentDate, startTime);
    const endIso = formatLocalDateTimeFromPolish(currentDate, endTime);
    const roomMatch = cleanLine.match(/(?:sala|s\.)\s*([^\s,]+)/i);
    const roomName = roomMatch ? roomMatch[0] : '';
    const title = cleanLine.replace(/(?:sala|s\.)\s*[^\s,]+/i, '').trim() || 'Zajęcia';

    events.push({
      id: `wszip-${startIso}-${events.length}`,
      type: 'WSZIP:PDF',
      title,
      module: '',
      form: '',
      start: startIso,
      end: endIso,
      room: roomName,
      teachers: '',
      teacherNames: [],
      buildingName: 'Główny Budynek WSZiP',
      buildingAddress: '',
      roomName: roomName || 'Brak danych o sali',
      subject: '',
      additionalInfo: '',
      locationMode: 'Budynek',
      color: '#10b981',
      status: '',
      hangoutLink: '',
      hangoutLinkLabel: ''
    });
  }

  return events;
}

export async function fetchScheduleFromPdf({
  pdfUri,
  startDateKey,
  endDateKey,
  onPhase,
  extractPdfTextLocal
}) {
  if (!extractPdfTextLocal) {
    throw new Error('Brak lokalnego parsera PDF w aplikacji.');
  }

  onPhase?.('WSZiP: Wczytuję plik PDF planu');
  const base64Pdf = await readPdfBase64FromUri(pdfUri);

  onPhase?.('WSZiP: Wyciągam tekst z PDF (proces lokalny)...');
  const extracted = await extractPdfTextLocal(base64Pdf);

  onPhase?.('WSZiP: Konwertuję tekst na harmonogram');
  const allEvents = Array.isArray(extracted) && extracted[0]?.text != null
    ? parsePdfItemsToEvents(extracted)
    : parseTextLinesToEvents(Array.isArray(extracted) ? extracted : []);

  if (!allEvents.length) {
    throw new Error('Nie udało się odczytać zajęć z PDF. Sprawdź, czy wybrałaś właściwy plik planu.');
  }

  onPhase?.(`WSZiP: Wczytano ${allEvents.length} terminów z PDF`);
  return allEvents;
}

export async function loginAndFetchSchedule({
  pdfUri,
  startDateKey,
  endDateKey,
  onPhase,
  extractPdfTextLocal
}) {
  if (!pdfUri) {
    throw new Error('Wybierz plik PDF planu pobrany z Moodle po zalogowaniu w przeglądarce.');
  }

  return fetchScheduleFromPdf({
    pdfUri,
    startDateKey,
    endDateKey,
    onPhase,
    extractPdfTextLocal
  });
}
