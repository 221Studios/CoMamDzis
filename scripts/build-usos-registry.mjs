/**
 * Buduje src/data/usosUniversities.json z:
 * - lista_usos_kompletna.txt (format: Instytucja / Domena / URL)
 * - lista_usos_z_api.txt (format: USOSweb / USOS API)
 *
 * Uruchom: node scripts/build-usos-registry.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function normalizePortalUrl(url) {
  const raw = String(url || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return `${parsed.protocol}//${parsed.hostname}`.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, '');
  }
}

function portalHost(portalUrl) {
  try {
    return new URL(portalUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function slugId(host) {
  return host
    .replace(/^www\./, '')
    .replace(/^usosweb\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shortNameFromEntry(name, host) {
  const known = {
    'usosweb.uw.edu.pl': 'UW',
    'usosweb.uj.edu.pl': 'UJ',
    'usosweb.usos.pw.edu.pl': 'PW',
    'usosweb.put.poznan.pl': 'PUT',
    'usosweb.umcs.pl': 'UMCS',
    'usosweb.amu.edu.pl': 'UAM',
    'usosweb.us.edu.pl': 'UŚ',
    'usosweb.uw.edu.pl': 'UW',
    'usosweb.sgh.waw.pl': 'SGH',
    'usosweb.sggw.edu.pl': 'SGGW',
    'usosweb.polsl.pl': 'PŚ',
    'usosweb.pwr.edu.pl': 'PWR',
    'usosweb.umk.pl': 'UMK',
    'usosweb.uni.lodz.pl': 'UŁ',
    'usosweb.uni.wroc.pl': 'UWr',
    'usosweb.uwb.edu.pl': 'UWB',
    'usosweb.uwm.edu.pl': 'UWM'
  };
  if (known[host]) return known[host];

  const words = String(name || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(w|we|i|im|na|z|do|the|of|in|and)$/i.test(w));
  if (words.length >= 2) {
    return words
      .slice(0, 4)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('');
  }
  const base = host.replace(/^usosweb\./, '').split('.')[0];
  return base.slice(0, 6).toUpperCase();
}

function inferEmailDomains(portalHostName) {
  const host = portalHostName.replace(/^www\./, '').toLowerCase();
  if (!host.startsWith('usosweb.')) {
    return [host];
  }

  const suffix = host.slice('usosweb.'.length);
  const domains = new Set([suffix]);

  if (suffix.startsWith('usos.')) {
    domains.add(suffix.slice('usos.'.length));
  }
  if (suffix.startsWith('akademia.')) {
    domains.add(suffix.slice('akademia.'.length));
  }

  for (const domain of [...domains]) {
    domains.add(`student.${domain}`);
    domains.add(`st.${domain}`);
  }

  return [...domains].filter(Boolean);
}

function parseKompletnaList(text) {
  const entries = [];
  const blocks = String(text || '').split(/-{10,}/);
  for (const block of blocks) {
    const name = block.match(/Instytucja:\s*(.+)/i)?.[1]?.trim();
    const domainLine = block.match(/Domena:\s*(\S+)/i)?.[1]?.trim();
    const urlLine = block.match(/URL:\s*(\S+)/i)?.[1]?.trim();
    const portalUrl = normalizePortalUrl(urlLine || (domainLine ? `https://${domainLine}` : ''));
    if (!portalUrl || !name) continue;
    entries.push({ name, portalUrl, apiBaseUrl: '' });
  }
  return entries;
}

function parseApiList(text) {
  const entries = [];
  const blocks = String(text || '').split(/-{10,}/);
  for (const block of blocks) {
    const name = block.match(/Instytucja:\s*(.+)/i)?.[1]?.trim();
    const portalUrl = normalizePortalUrl(block.match(/USOSweb:\s*(\S+)/i)?.[1]?.trim() || '');
    const apiBaseUrl = normalizePortalUrl(block.match(/USOS API:\s*(\S+)/i)?.[1]?.trim() || '');
    if (!portalUrl || !name) continue;
    entries.push({ name, portalUrl, apiBaseUrl });
  }
  return entries;
}

function mergeEntries(items) {
  const byPortal = new Map();

  for (const item of items) {
    const portalUrl = normalizePortalUrl(item.portalUrl);
    const host = portalHost(portalUrl);
    if (!host) continue;

    const existing = byPortal.get(portalUrl);
    if (!existing) {
      byPortal.set(portalUrl, {
        name: item.name,
        portalUrl,
        portalHost: host,
        apiBaseUrl: item.apiBaseUrl || '',
        aliases: []
      });
      continue;
    }

    if (item.apiBaseUrl && !existing.apiBaseUrl) {
      existing.apiBaseUrl = normalizePortalUrl(item.apiBaseUrl);
    }
    if (item.name.length > existing.name.length && /[ąćęłńóśźż]/i.test(item.name)) {
      existing.name = item.name;
    } else if (!/[ąćęłńóśźż]/i.test(existing.name) && item.name) {
      existing.name = item.name;
    }
  }

  return [...byPortal.values()]
    .map((entry) => {
      const id = slugId(entry.portalHost);
      const domains = inferEmailDomains(entry.portalHost);
      return {
        id,
        name: entry.name,
        shortName: shortNameFromEntry(entry.name, entry.portalHost),
        portalUrl: entry.portalUrl,
        portalHost: entry.portalHost,
        apiBaseUrl: entry.apiBaseUrl || '',
        domains
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

function main() {
  const kompletnaPath = join(root, 'lista_usos_kompletna.txt');
  const apiPath = join(root, 'lista_usos_z_api.txt');

  const kompletna = readFileSync(kompletnaPath, 'utf8');
  const api = readFileSync(apiPath, 'utf8');

  const merged = mergeEntries([...parseKompletnaList(kompletna), ...parseApiList(api)]);

  const outDir = join(root, 'src', 'data');
  mkdirSync(outDir, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    count: merged.length,
    universities: merged
  };
  const outPath = join(outDir, 'usosUniversities.js');
  writeFileSync(
    outPath,
    `/** Auto-generated by scripts/build-usos-registry.mjs — nie edytuj ręcznie. */\nexport default ${JSON.stringify(payload, null, 2)};\n`,
    'utf8'
  );

  console.log(`Zapisano ${merged.length} uczelni USOS → ${outPath}`);
}

main();
