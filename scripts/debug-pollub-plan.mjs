#!/usr/bin/env node
/**
 * Debug POLLUB plan parsing — logowanie eHMS, pobranie PDF, tabela eventów.
 *
 * Użycie:
 *   POLLUB_LOGIN=... POLLUB_PASSWORD=... npm run debug:pollub-plan
 *   POLLUB_LOGIN=... POLLUB_PASSWORD=... npm run debug:pollub-plan -- --date 2026-06-01
 *   POLLUB_LOGIN=... POLLUB_PASSWORD=... npm run debug:pollub-plan -- --pdf /path/to/plan.pdf
 */

import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  extractPdfCandidatesFromHtml,
  pickBestPdfCandidate,
  resolvePollubPlansPageUrl
} from '../src/pollubPlanDiscoveryCore.js';
import { parsePdfItemsToEvents, parsePdfItemsToWeeklyTemplates } from '../src/pollubWeeklyGridParser.js';

const BASE_URL = 'https://ehms.pollub.pl/standard/';
const GROUPS_URL = `${BASE_URL}?tab=3&sub=3`;
const STUDY_INFO_URL = `${BASE_URL}?tab=2`;
const GROUP_CODE_RE = /\b(G[CĆ]W\d{2}|GLA\d{2}|GOK\d{2}|GPR\d{2}|GWY\d{2})\b/gi;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

function parseArgs(argv) {
  const args = { date: '', day: '', pdf: '', assert: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--date') args.date = argv[++i] || '';
    else if (token === '--day') args.day = String(argv[++i] || '').toUpperCase();
    else if (token === '--pdf') args.pdf = argv[++i] || '';
    else if (token === '--assert') args.assert = true;
  }
  return args;
}

function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function parseSetCookie(header, url) {
  const jar = new Map();
  if (!header) return jar;
  const parts = Array.isArray(header) ? header : [header];
  for (const chunk of parts) {
    for (const piece of String(chunk).split(/,(?=\s*[^;,]+=[^;,]+)/)) {
      const segment = piece.split(';')[0]?.trim();
      const eq = segment.indexOf('=');
      if (eq <= 0) continue;
      jar.set(segment.slice(0, eq), segment.slice(eq + 1));
    }
  }
  return jar;
}

function mergeJar(jar, next) {
  for (const [key, value] of next.entries()) jar.set(key, value);
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchWithJar(url, jar, options = {}) {
  const headers = {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9',
    ...(options.headers || {})
  };
  if (jar.size) headers.Cookie = cookieHeader(jar);

  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  mergeJar(jar, parseSetCookie(response.headers.getSetCookie?.() || response.headers.get('set-cookie'), url));
  return response;
}

async function followRedirects(url, jar, method = 'GET', body = null) {
  let currentUrl = url;
  let nextMethod = method;
  let nextBody = body;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetchWithJar(currentUrl, jar, {
      method: nextMethod,
      body: nextBody,
      headers:
        nextMethod === 'POST'
          ? {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              Origin: 'https://ehms.pollub.pl',
              Referer: BASE_URL
            }
          : { Referer: BASE_URL }
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      if (response.status === 303 || response.status === 302) {
        nextMethod = 'GET';
        nextBody = null;
      }
      continue;
    }

    return { response, url: currentUrl };
  }

  throw new Error('Zbyt wiele przekierowań eHMS.');
}

function parseLoginFormFields(html) {
  const loginMatch = html.match(/name="(login_[a-f0-9]+)"/i);
  const passMatch = html.match(/name="(pass_[a-f0-9]+)"/i);
  const counterMatch = html.match(/name="counter"[^>]*value="([^"]*)"/i);
  if (!loginMatch || !passMatch) throw new Error('Brak pól logowania eHMS.');
  return {
    loginField: loginMatch[1],
    passwordField: passMatch[1],
    counter: counterMatch?.[1] || ''
  };
}

function isLoggedIn(html) {
  if (/log_form/i.test(html) && /name="login_/i.test(html)) return false;
  return /wyloguj/i.test(html) || /MOJE STUDIA/i.test(html);
}

function parseGroupsFromHtml(html) {
  const groups = new Set();
  let match = GROUP_CODE_RE.exec(html);
  while (match) {
    groups.add(String(match[1]).toUpperCase().replace('Ć', 'C'));
    match = GROUP_CODE_RE.exec(html);
  }
  return [...groups].sort();
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDtDdField(html, label) {
  const safe = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<dt[^>]*>\\s*${safe}\\s*:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i');
  const match = String(html || '').match(re);
  return match?.[1] ? stripHtmlToText(match[1]) : '';
}

function parseStudyInfoFromHtml(html) {
  const yearSemesterRaw =
    extractDtDdField(html, 'Rok / semestr (w roku akad.)') ||
    extractDtDdField(html, 'Rok / semestr');
  const yearSemesterMatch = yearSemesterRaw.match(/(\d+)\s*\/\s*(\d+)/);
  return {
    faculty: extractDtDdField(html, 'Wydział'),
    program: extractDtDdField(html, 'Kierunek'),
    studySystem: extractDtDdField(html, 'System studiów'),
    studyKind: extractDtDdField(html, 'Rodzaj studiów'),
    yearInProgram: yearSemesterMatch ? Number(yearSemesterMatch[1]) : null,
    semesterInYear: yearSemesterMatch ? Number(yearSemesterMatch[2]) : null
  };
}

async function loginEhms(login, password) {
  const jar = new Map();
  const { response: loginPage } = await followRedirects(BASE_URL, jar);
  const fields = parseLoginFormFields(await loginPage.text());
  const body = formEncode({
    log_form: 'yes',
    [fields.loginField]: login,
    [fields.passwordField]: password,
    ...(fields.counter ? { counter: fields.counter } : {})
  });
  const { response: authResponse } = await followRedirects(BASE_URL, jar, 'POST', body);
  const authHtml = await authResponse.text();
  if (!isLoggedIn(authHtml)) {
    throw new Error('Logowanie eHMS nie powiodło się.');
  }
  return jar;
}

async function fetchHtml(url, jar) {
  const { response } = await followRedirects(url, jar);
  if (!response.ok) throw new Error(`HTTP ${response.status} dla ${url}`);
  return response.text();
}

async function downloadPdf(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT }
  });
  if (!response.ok) throw new Error(`Nie udało się pobrać PDF (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function extractPdfItemsFromBuffer(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const items = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      const text = item.str?.trim();
      if (!text) continue;
      items.push({
        text,
        x: item.transform[4],
        y: item.transform[5],
        page: pageNum
      });
    }
  }
  return items;
}

function eventTimeRange(event) {
  const start = String(event.start || '').slice(11, 16);
  const end = String(event.end || '').slice(11, 16);
  return `${start}-${end}`;
}

function dayNameFromDate(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return ['NIEDZ', 'PON', 'WT', 'SR', 'CZW', 'PT', 'SOB'][date.getDay()];
}

function printTable(events) {
  const header = ['Data', 'Godz', 'Forma', 'Grupa', 'Sala', 'Kol', 'Tytuł'];
  const rows = events.map((ev) => [
    String(ev.start || '').slice(0, 10),
    eventTimeRange(ev),
    ev.form || '',
    ev.groupName || ev.module || '',
    ev.roomName || '',
    ev.columnCode || '',
    String(ev.title || '').slice(0, 50)
  ]);
  const widths = header.map((col, i) =>
    Math.max(col.length, ...rows.map((row) => String(row[i]).length))
  );
  const fmt = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(fmt(row));
}

async function resolvePdfBuffer(args, studyInfo) {
  if (args.pdf) {
    return readFile(args.pdf);
  }

  const pageUrl = resolvePollubPlansPageUrl(studyInfo);
  if (!pageUrl) throw new Error('Nie rozpoznano strony planów wydziału.');

  const html = await fetch(pageUrl, {
    headers: { 'User-Agent': BROWSER_USER_AGENT }
  }).then((r) => r.text());
  const candidates = extractPdfCandidatesFromHtml(html, pageUrl);
  const best = pickBestPdfCandidate(candidates, studyInfo);
  if (!best?.url) throw new Error('Nie znaleziono PDF planu na stronie wydziału.');
  console.log(`PDF: ${best.filename} (${best.url})`);
  return downloadPdf(best.url);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const login = process.env.POLLUB_LOGIN || '';
  const password = process.env.POLLUB_PASSWORD || '';

  if (!login || !password) {
    console.error('Ustaw POLLUB_LOGIN i POLLUB_PASSWORD w środowisku.');
    process.exit(1);
  }

  console.log('Logowanie eHMS...');
  const jar = await loginEhms(login.trim(), password);

  const groupsHtml = await fetchHtml(GROUPS_URL, jar);
  const groups = parseGroupsFromHtml(groupsHtml);
  if (!groups.length) throw new Error('Brak grup w eHMS.');
  console.log(`Grupy: ${groups.join(', ')}`);

  const studyHtml = await fetchHtml(STUDY_INFO_URL, jar);
  const studyInfo = parseStudyInfoFromHtml(studyHtml);
  console.log(`Wydział: ${studyInfo.faculty}`);
  console.log(`Kierunek: ${studyInfo.program}`);

  const pdfBuffer = args.pdf ? await readFile(args.pdf) : await resolvePdfBuffer(args, studyInfo);
  const cachePath = join(tmpdir(), 'pollub-debug-plan.pdf');
  await writeFile(cachePath, pdfBuffer);
  console.log(`Zapisano PDF: ${cachePath}`);

  const items = await extractPdfItemsFromBuffer(pdfBuffer);
  console.log(`Fragmentów tekstu PDF: ${items.length}`);

  const startDate = args.date || '2026-06-01';
  const endDateObj = args.date
    ? new Date(`${startDate}T12:00:00`)
    : new Date(`${startDate}T12:00:00`);
  if (args.date) {
    endDateObj.setDate(endDateObj.getDate() + 1);
  } else {
    endDateObj.setDate(endDateObj.getDate() + 7);
  }
  const endDate = endDateObj.toISOString().slice(0, 10);
  const templates = parsePdfItemsToWeeklyTemplates(items, groups);
  const events = parsePdfItemsToEvents(items, groups, startDate, endDate);

  let filtered = events;
  if (args.date) {
    filtered = events.filter((ev) => String(ev.start || '').startsWith(args.date));
  }
  if (args.day) {
    filtered = filtered.filter((ev) => dayNameFromDate(String(ev.start).slice(0, 10)).startsWith(args.day));
  }

  console.log(`\nSzablony tygodniowe: ${templates.length}, eventy w zakresie: ${filtered.length}\n`);
  printTable(filtered);

  if (args.assert && args.date === '2026-06-01') {
    const monday = filtered;
    const hasGwyLecture = monday.some(
      (ev) => ev.form === 'Wykład' && ev.groupName === 'GWY01' && eventTimeRange(ev).startsWith('10:')
    );
    if (!hasGwyLecture) {
      console.error('ASSERT FAIL: brak wykładu GWY01 ok. 10:30 w poniedziałek');
      process.exit(1);
    }
    console.log('\nASSERT OK: wykład GWY01 w poniedziałek');
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
