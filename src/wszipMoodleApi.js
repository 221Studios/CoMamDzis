import * as FileSystem from 'expo-file-system/legacy';
import * as WebBrowser from 'expo-web-browser';

export const WSZIP_MOODLE_BASE_URL = 'https://mdl.wszip.poznan.pl';
export const WSZIP_HANDOFF_START_URL = `${WSZIP_MOODLE_BASE_URL}/local/comamdzis_plan/start.php`;
export const WSZIP_HANDOFF_EXCHANGE_URL = `${WSZIP_MOODLE_BASE_URL}/local/comamdzis_plan/api/exchange.php`;
export const WSZIP_DEEP_LINK_SCHEME = 'comamdzis';
export const WSZIP_DEEP_LINK_HOST = 'wszip-moodle';
export const WSZIP_DEEP_LINK_URL = `${WSZIP_DEEP_LINK_SCHEME}://${WSZIP_DEEP_LINK_HOST}`;

function safeFilename(value) {
  return String(value || 'wszip-plan.pdf').replace(/[^\w.-]+/g, '_') || 'wszip-plan.pdf';
}

function parseQueryParams(url) {
  const value = String(url || '');
  const query = value.includes('?') ? value.slice(value.indexOf('?') + 1) : '';
  const params = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawKey, rawValue = ''] = part.split('=');
    const key = decodeURIComponent(rawKey || '');
    if (!key) continue;
    params[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
  }
  return params;
}

export function isWszipMoodleDeepLink(url) {
  const value = String(url || '').trim();
  return value.startsWith(`${WSZIP_DEEP_LINK_URL}?`) || value.startsWith(`${WSZIP_DEEP_LINK_URL}/`);
}

export function extractWszipMoodleCode(url) {
  if (!isWszipMoodleDeepLink(url)) return '';
  return String(parseQueryParams(url).code || '').trim();
}

export async function openWszipMoodleHandoff({ email }) {
  const url = new URL(WSZIP_HANDOFF_START_URL);
  url.searchParams.set('redirect_uri', WSZIP_DEEP_LINK_URL);
  const loginHint = String(email || '').trim();
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  await WebBrowser.openBrowserAsync(url.toString(), {
    showInRecents: true,
    enableBarCollapsing: false
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok || parsed?.ok === false) {
    throw new Error(parsed?.error || `Moodle API zwróciło HTTP ${response.status}.`);
  }
  return parsed;
}

function pickBestPdf(pdfs) {
  const list = Array.isArray(pdfs) ? pdfs.filter((item) => item?.downloadurl) : [];
  if (!list.length) return null;
  return [...list].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
}

export async function exchangeWszipMoodleCode({ code, email }) {
  const body = JSON.stringify({
    code: String(code || '').trim(),
    login: String(email || '').trim()
  });
  return fetchJson(WSZIP_HANDOFF_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body
  });
}

export async function downloadWszipPdfFromMoodle({ code, email, onPhase }) {
  const handoffCode = String(code || '').trim();
  if (!handoffCode) {
    throw new Error('Brak kodu powrotu z Moodle.');
  }

  onPhase?.('WSZiP: odbieram sesję z Moodle');
  const payload = await exchangeWszipMoodleCode({ code: handoffCode, email });
  const best = pickBestPdf(payload?.pdfs);
  if (!best) {
    throw new Error('Moodle nie zwrócił żadnego PDF planu. Sprawdź, czy plugin widzi plik planu.');
  }

  onPhase?.(`WSZiP: pobieram ${best.filename || 'plan PDF'}`);
  const response = await fetch(best.downloadurl);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać PDF z Moodle (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  const reader = new FileReader();
  const base64 = await new Promise((resolve, reject) => {
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : '');
    };
    reader.onerror = () => reject(new Error('Nie udało się odczytać pobranego PDF.'));
    reader.readAsDataURL(blob);
  });
  if (!base64) {
    throw new Error('Pobrany PDF jest pusty.');
  }

  const destination = `${FileSystem.documentDirectory}wszip-moodle-${safeFilename(best.filename)}`;
  await FileSystem.writeAsStringAsync(destination, base64, {
    encoding: 'base64'
  });
  const info = await FileSystem.getInfoAsync(destination);
  if (!info.exists) {
    throw new Error('Nie udało się zapisać PDF z Moodle w aplikacji.');
  }

  return {
    pdfUri: destination,
    filename: best.filename || '',
    profile: payload?.profile || null,
    sourceUrl: best.url || best.downloadurl
  };
}
