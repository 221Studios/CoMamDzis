export function normalizeUsosIcalUrl(url) {
  return String(url || '')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/^webcal:/i, 'https:');
}

export function isUsosIcalFeedUrl(url) {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value) && !/^webcal:\/\//i.test(value)) return false;
  if (/upcoming_ical|\.ics(?:\?|$|\/)/i.test(value)) return true;
  if (/apps\.usos\.[a-z.]+\/services\/tt\//i.test(value) && /[?&]key=/i.test(value)) return true;
  if (/kontroler\.php\?_action=/i.test(value)) return false;
  return /\/tt\/|[?&]key=|token=|sec_/i.test(value) && /usos/i.test(value);
}

function apiBaseUrlForPortal(portalUrl) {
  const host = (() => {
    try {
      return new URL(portalUrl).hostname;
    } catch {
      return '';
    }
  })();
  if (/usosweb\.uj\.edu\.pl/i.test(host)) return 'https://apps.usos.uj.edu.pl';
  if (/usosweb\.uw\.edu\.pl/i.test(host)) return 'https://usosapps.uw.edu.pl';
  if (/usosweb\.usos\.pw\.edu\.pl|usosweb\.pw\.edu\.pl/i.test(host)) return 'https://apps.usos.pw.edu.pl';
  if (/usosweb\.umcs\.pl/i.test(host)) return 'https://usosapps.umcs.pl';
  return '';
}

function extractIcalFromJsGlobals(html, portalUrl) {
  const text = String(html || '');
  const userId = text.match(/user_id\s*[:=]\s*["']?(\d+)/i)?.[1]
    || text.match(/[?&]user_id=(\d+)/i)?.[1]
    || '';
  const key = text.match(/(?:ical|calendar|plan|export)[^"'<>]{0,120}key\s*[:=]\s*["']([A-Za-z0-9_-]+)["']/i)?.[1]
    || text.match(/plan_export[^"'<>]{0,120}key\s*[:=]\s*["']([A-Za-z0-9_-]+)["']/i)?.[1]
    || text.match(/[?&]key=([A-Za-z0-9_-]+)/i)?.[1]
    || '';
  if (!userId || !key) return '';

  const apiBase = apiBaseUrlForPortal(portalUrl);
  if (!apiBase) return '';
  return `${apiBase}/services/tt/upcoming_ical?lang=pl&user_id=${userId}&key=${key}`;
}

export function extractUsosIcalUrl(html, baseUrl = '') {
  const text = String(html || '');

  const prioritized = text.match(
    /https?:\/\/apps\.usos\.[a-z.]+\/services\/tt\/upcoming_ical\?[^\s"'<>]+/i
  );
  if (prioritized?.[0] && isUsosIcalFeedUrl(prioritized[0])) {
    return normalizeUsosIcalUrl(prioritized[0]);
  }

  const relativeIcal = text.match(
    /apps\.usos\.[a-z.]+\/services\/tt\/upcoming_ical\?[^\s"'<>]+/i
  );
  if (relativeIcal?.[0]) {
    const absolute = normalizeUsosIcalUrl(`https://${relativeIcal[0]}`);
    if (isUsosIcalFeedUrl(absolute)) return absolute;
  }

  const planExportField =
    text.match(
      /<text-field[^>]*\bid=["']plan_export_link["'][^>]*\bvalue\s*=\s*["'](https?:\/\/[^"']+)["']/i
    )
    || text.match(
      /<text-field[^>]*\bvalue\s*=\s*["'](https?:\/\/[^"']*upcoming_ical[^"']*)["'][^>]*\bid=["']plan_export_link["']/i
    )
    || text.match(
      /id=["']plan_export_link["'][\s\S]*?value\s*=\s*["'](https?:\/\/[^"']+)["']/i
    );
  if (planExportField?.[1] && isUsosIcalFeedUrl(normalizeUsosIcalUrl(planExportField[1]))) {
    return normalizeUsosIcalUrl(planExportField[1]);
  }

  const attributeValues = text.match(
    /(?:value|content|data-url|data-href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi
  ) || [];
  for (const attribute of attributeValues) {
    const value = normalizeUsosIcalUrl(attribute.match(/["'](https?:\/\/[^"']+)["']/i)?.[1] || '');
    if (isUsosIcalFeedUrl(value)) return value;
  }

  const upcomingValue = text.match(
    /value\s*=\s*["'](https?:\/\/apps\.usos\.[^"']+\/services\/tt\/upcoming_ical\?[^"']+)["']/i
  );
  if (upcomingValue?.[1] && isUsosIcalFeedUrl(upcomingValue[1])) {
    return normalizeUsosIcalUrl(upcomingValue[1]);
  }

  const hrefMatches = text.match(/href=["']([^"']+)["']/gi) || [];
  for (const hrefEntry of hrefMatches) {
    const href = normalizeUsosIcalUrl(hrefEntry.match(/href=["']([^"']+)["']/i)?.[1] || '');
    let absolute = href;
    if (baseUrl) {
      try {
        absolute = new URL(href, baseUrl).toString();
      } catch {
        absolute = href;
      }
    }
    if (isUsosIcalFeedUrl(absolute)) return absolute;
  }

  const rawMatch = text.match(
    /(?:https?|webcal):\/\/[^\s"'<>]+(?:upcoming_ical|\.ics|ical|ics|calendar|kalendarz|\/tt\/|[?&]key=)[^\s"'<>]*/i
  );
  if (!rawMatch?.[0]) {
    return extractIcalFromJsGlobals(text, baseUrl);
  }
  const candidate = normalizeUsosIcalUrl(rawMatch[0]);
  return isUsosIcalFeedUrl(candidate) ? candidate : extractIcalFromJsGlobals(text, baseUrl);
}

/** JS source embedded in WebView — must stay self-contained. */
export function buildWebViewIcalExtractSource() {
  return `(function extractUsosIcalUrl(html) {
    var text = String(html || '');
    function normalize(url) {
      return String(url || '').trim().replace(/&amp;/g, '&').replace(/^webcal:/i, 'https:');
    }
    function isFeed(url) {
      return /upcoming_ical|[?&]key=/.test(url) && /apps\\.usos\\./i.test(url);
    }
    var patterns = [
      /https?:\\/\\/apps\\.usos\\.[^"'\\s<>]+\\/services\\/tt\\/upcoming_ical\\?[^"'\\s<>]+/i,
      /<text-field[^>]*id=["']plan_export_link["'][^>]*value=["'](https?:\\/\\/[^"']+)["']/i,
      /<text-field[^>]*value=["'](https?:\\/\\/[^"']*upcoming_ical[^"']*)["'][^>]*id=["']plan_export_link["']/i,
      /id=["']plan_export_link["'][\\s\\S]*?value=["'](https?:\\/\\/[^"']+)["']/i,
      /value=["'](https?:\\/\\/[^"']*upcoming_ical[^"']*)["']/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      var candidate = normalize(match && (match[1] || match[0]));
      if (candidate && isFeed(candidate)) return candidate;
    }
    return '';
  })`;
}
