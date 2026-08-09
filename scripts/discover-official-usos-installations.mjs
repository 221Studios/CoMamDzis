#!/usr/bin/env node
/**
 * Pobiera oficjalną listę publicznych instalacji USOS API i próbuje ustalić domenę USOSweb.
 *
 * Źródło: services/apisrv/installations opisane w oficjalnej dokumentacji USOS API.
 * Wyniki zapisuje do scripts/.usos-login-probe/official-usos-installations.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOGIN_PROBE_REPORT_DIR } from './lib/usos-login-probe.mjs';

const SOURCE_URL = 'https://apps.usos.uj.edu.pl/services/apisrv/installations';
const TIMEOUT_MS = 12000;

const installations = await fetchJson(SOURCE_URL);
const results = await mapConcurrent(installations, 8, async (installation) => {
  const apiBaseUrl = normalizeApiBaseUrl(installation.base_url);
  const name = installation.institution_name?.pl || installation.institution_name?.en || apiBaseUrl;
  const mobileConfig = await fetchMobileConfig(apiBaseUrl);
  const usoswebDomain = mobileConfig?.usosweb_domain || '';
  const portalUrl = usoswebDomain ? `https://${usoswebDomain.replace(/\/+$/, '')}` : '';

  return {
    name,
    apiBaseUrl,
    portalUrl,
    portalHost: portalUrl ? new URL(portalUrl).hostname : '',
    version: installation.version || '',
    contactEmails: installation.contact_emails || [],
    mobileConfigStatus: mobileConfig?.status || 0,
    mobileConfigError: mobileConfig?.error || ''
  };
});

mkdirSync(LOGIN_PROBE_REPORT_DIR, { recursive: true });
const outPath = join(LOGIN_PROBE_REPORT_DIR, 'official-usos-installations.json');
writeFileSync(outPath, `${JSON.stringify({
  sourceUrl: SOURCE_URL,
  generatedAt: new Date().toISOString(),
  count: results.length,
  withPortal: results.filter((row) => row.portalUrl).length,
  installations: results
}, null, 2)}\n`, 'utf8');

console.log(`Pobrano ${results.length} publiczne instalacje USOS API.`);
console.log(`Z domeną USOSweb z mobile_usos_config: ${results.filter((row) => row.portalUrl).length}/${results.length}`);
console.log(`Zapisano: ${outPath}`);

async function fetchMobileConfig(apiBaseUrl) {
  try {
    const response = await fetchWithTimeout(
      `${apiBaseUrl.replace(/\/$/, '')}/services/apisrv/mobile_usos_config?fields=usosweb_domain|contact_email`,
      TIMEOUT_MS
    );
    if (!response.ok) {
      return { status: response.status, error: `HTTP ${response.status}` };
    }
    const json = await response.json();
    return { status: response.status, ...json };
  } catch (error) {
    return { status: 0, error: errorMessage(error) };
  }
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CoMamDzis USOS official installation discovery'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function normalizeApiBaseUrl(url) {
  const parsed = new URL(String(url || '').trim());
  parsed.protocol = 'https:';
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

function errorMessage(error) {
  return [error?.message || String(error), error?.cause?.code || error?.code || ''].filter(Boolean).join(' ');
}
