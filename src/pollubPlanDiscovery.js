import * as FileSystem from 'expo-file-system/legacy';
import {
  extractPdfCandidatesFromHtml,
  pickBestPdfCandidate,
  resolvePollubPlansPageUrl
} from './pollubPlanDiscoveryCore';

export {
  extractPdfCandidatesFromHtml,
  pickBestPdfCandidate,
  resolvePollubPlansPageUrl,
  scorePdfCandidate
} from './pollubPlanDiscoveryCore';

const REQUEST_TIMEOUT_MS = 30000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function fetchPlansPageHtml(url) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('Strona planów wydziału nie odpowiada.'));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pl-PL,pl;q=0.9'
        },
        redirect: 'follow'
      }),
      timeoutPromise
    ]);

    if (!response.ok) {
      throw new Error(`Nie udało się otworzyć strony planów (${response.status}).`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadPdfToAppStorage(url, filename) {
  const safeName = String(filename || 'pollub-plan.pdf').replace(/[^\w.-]+/g, '_');
  const destination = `${FileSystem.documentDirectory}pollub-discovered-${safeName}`;
  const result = await FileSystem.downloadAsync(String(url), destination);
  if (result.status !== 200) {
    throw new Error(`Nie udało się pobrać PDF planu (${result.status}).`);
  }
  return result.uri;
}

export async function discoverPollubPlanPdf({ studyInfo, onPhase }) {
  const pageUrl = resolvePollubPlansPageUrl(studyInfo);
  if (!pageUrl) {
    throw new Error('Nie rozpoznano strony planów dla Twojego wydziału.');
  }

  onPhase?.('POLLUB: Szukam planu na stronie wydziału');
  const html = await fetchPlansPageHtml(pageUrl);
  const candidates = extractPdfCandidatesFromHtml(html, pageUrl);
  const best = pickBestPdfCandidate(candidates, studyInfo);

  if (!best) {
    throw new Error('Nie znaleziono pasującego PDF planu na stronie wydziału.');
  }

  onPhase?.(`POLLUB: Pobieram ${best.filename}`);
  const localUri = await downloadPdfToAppStorage(best.url, best.filename);

  return {
    localUri,
    sourceUrl: best.url,
    filename: best.filename,
    pageUrl,
    score: best.score
  };
}
