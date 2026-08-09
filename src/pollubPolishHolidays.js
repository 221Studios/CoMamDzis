import { toDateKey } from './dateUtils.js';

/** Niedziela Wielkanocna (kalendarz gregoriański). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDaysToDate(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Zwraca zbiór kluczy dat (YYYY-MM-DD) świąt państwowych w PL dla danego roku. */
export function polishPublicHolidayKeys(year) {
  const keys = new Set();
  const add = (date) => keys.add(toDateKey(date));

  add(new Date(year, 0, 1));
  add(new Date(year, 0, 6));
  add(new Date(year, 4, 1));
  add(new Date(year, 4, 3));
  add(new Date(year, 7, 15));
  add(new Date(year, 10, 1));
  add(new Date(year, 10, 11));
  add(new Date(year, 11, 25));
  add(new Date(year, 11, 26));

  const easter = easterSunday(year);
  add(easter);
  add(addDaysToDate(easter, 1));
  add(addDaysToDate(easter, 60));

  return keys;
}

const cache = new Map();

function keysForYear(year) {
  if (!cache.has(year)) {
    cache.set(year, polishPublicHolidayKeys(year));
  }
  return cache.get(year);
}

/** Czy dzień jest świętem państwowym w Polsce (brak zajęć). */
export function isPolishPublicHoliday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const key = toDateKey(date);
  const years = [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1];
  for (const year of years) {
    if (keysForYear(year).has(key)) return true;
  }
  return false;
}
